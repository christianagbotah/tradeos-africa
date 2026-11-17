import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
import {selectedGateway,requireHubtelPreference} from
  "../src/payment-providers/service.js";

// This suite contains a TRUNCATE. Absolutely no production or staging DB.
const url=process.env.DATABASE_URL??"postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
if(!url.endsWith("/tradeos_ci")||!/(@127\.0\.0\.1:5432|@localhost:5432)/.test(url)){
  throw new Error("Gateway integration tests require isolated local tradeos_ci database");
}
process.env.DATABASE_URL=url;
const pool=createPool();
const app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();});

async function merchant(name:string){
  const registered=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:"Payment Owner",email:"gateway-"+name+"@example.test",
    password:"TradeOS-Test-1234",platform:"WEB",deviceKey:"test-"+name,appVersion:"test",
  }});
  expect(registered.statusCode).toBe(201);
  const headers={authorization:"Bearer "+registered.json().session.accessToken};
  const onboarding=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:"Gateway "+name,businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(onboarding.statusCode).toBe(201);
  const businessId=onboarding.json().business.id as string;
  return {headers,businessId};
}
const path=(id:string)=>"/v1/businesses/"+id+"/payment-gateways";
describe("per-business preferred gateway selection",()=>{
  it("authenticates, scopes by tenant and never exposes credential values",async()=>{
    const a=await merchant("alpha");
    const b=await merchant("beta");
    const unauth=await app.inject({method:"GET",url:path(a.businessId)});
    expect(unauth.statusCode).toBe(401);
    const foreign=await app.inject({method:"GET",url:path(a.businessId),headers:b.headers});
    expect(foreign.statusCode).toBe(403);
    const response=await app.inject({method:"GET",url:path(a.businessId),
      headers:a.headers});
    expect(response.statusCode,response.body).toBe(200);
    expect(response.json()).toMatchObject({
      countryCode:"GH",currencyCode:"GHS",preferredProvider:null,
      effectiveLegacyProvider:"HUBTEL",revision:0,collectionReady:false,
    });
    expect(response.json().providers.find((x:{code:string})=>x.code==="PAYSTACK").eligible)
      .toBe(true);
    expect(response.json().providers.find((x:{code:string})=>x.code==="STRIPE").eligible)
      .toBe(false);
    expect(response.body).not.toMatch(/sk_(live|test)_|apiKey|clientSecret|credentialAlias/);
    expect(await selectedGateway(pool,a.businessId)).toBe("HUBTEL");
  });
  it("saves owner preference with audit, revision lock and no electronic activation",async()=>{
    const a=await merchant("selection");
    const endpoint=path(a.businessId)+"/preference";
    const rejected=await app.inject({method:"PUT",url:endpoint,
      headers:a.headers,payload:{providerCode:"STRIPE",expectedRevision:0}});
    expect(rejected.statusCode).toBe(422);
    const unknown=await app.inject({method:"PUT",url:endpoint,
      headers:a.headers,payload:{providerCode:"ARBITRARY",expectedRevision:0}});
    expect(unknown.statusCode).toBe(400);
    const save=await app.inject({method:"PUT",url:endpoint,
      headers:a.headers,payload:{providerCode:"PAYSTACK",expectedRevision:0}});
    expect(save.statusCode,save.body).toBe(200);
    expect(save.json()).toMatchObject({preference:{
      providerCode:"PAYSTACK",revision:1,changed:true}});
    expect(await selectedGateway(pool,a.businessId)).toBe("PAYSTACK");
    await expect(requireHubtelPreference(pool,a.businessId)).rejects.toMatchObject({
      code:"PAYMENT_PROVIDER_NOT_SELECTED",statusCode:409});
    const replay=await app.inject({method:"PUT",url:endpoint,
      headers:a.headers,payload:{providerCode:"FLUTTERWAVE",expectedRevision:0}});
    expect(replay.statusCode).toBe(409);
    const saved=await app.inject({method:"GET",url:path(a.businessId),headers:a.headers});
    expect(saved.json()).toMatchObject({
      preferredProvider:"PAYSTACK",effectiveLegacyProvider:null,
      revision:1,collectionReady:false,
    });
    const back=await app.inject({method:"PUT",url:endpoint,
      headers:a.headers,payload:{providerCode:"HUBTEL",expectedRevision:1}});
    expect(back.statusCode,back.body).toBe(200);
    await requireHubtelPreference(pool,a.businessId);
    const audit=await pool.query<{count:string}>(
      "SELECT count(*)::text AS count FROM business_payment_gateway_preference_audit "+
      "WHERE business_id=$1",[a.businessId]);
    expect(audit.rows[0]?.count).toBe("2");
  });
  it("restricts one merchant from changing another merchant preference",async()=>{
    const a=await merchant("scoped");
    const b=await merchant("unrelated");
    const res=await app.inject({method:"PUT",url:path(b.businessId)+"/preference",
      headers:a.headers,payload:{providerCode:"PAYSTACK",expectedRevision:0}});
    expect(res.statusCode).toBe(403);
    expect(await selectedGateway(pool,b.businessId)).toBe("HUBTEL");
  });
  it("validates European merchant currencies instead of assuming Ghana for all",async()=>{
    const a=await merchant("europe");
    await pool.query("UPDATE businesses SET country_code='DE',currency_code='EUR' "+
      "WHERE id=$1",[a.businessId]);
    const result=await app.inject({method:"GET",url:path(a.businessId),headers:a.headers});
    expect(result.statusCode).toBe(200);
    const provider=result.json().providers as Array<{code:string;eligible:boolean}>;
    expect(provider.find(p=>p.code==="STRIPE")?.eligible).toBe(true);
    expect(provider.find(p=>p.code==="HUBTEL")?.eligible).toBe(false);
    const save=await app.inject({method:"PUT",url:path(a.businessId)+"/preference",
      headers:a.headers,payload:{providerCode:"STRIPE",expectedRevision:0}});
    expect(save.statusCode,save.body).toBe(200);
  });
});
