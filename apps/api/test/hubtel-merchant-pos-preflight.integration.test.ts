import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,expect,it,vi} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
import {hubtelPosConnection} from "../src/commerce/hubtel-pos-config.js";
import {startSaleHubtelCheckout} from "../src/commerce/hubtel-pos-service.js";
import {
  saveMerchantPaymentCredentials,verifyMerchantHubtelConnection,
  requestMerchantGatewayActivation,
} from "../src/payment-providers/merchant-connections.js";

const url=process.env.DATABASE_URL??
  "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
if(!url.endsWith("/tradeos_ci")||
  !/(@127\.0\.0\.1:5432|@localhost:5432)/.test(url))
  throw Error("Hubtel preflight tests require the isolated tradeos_ci database");
process.env.DATABASE_URL=url;
const names=["TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64",
  "TRADEOS_HUBTEL_POS_ENABLED","TRADEOS_HUBTEL_MERCHANT_POS_ENABLED",
  "TRADEOS_HUBTEL_POS_CREDENTIALS_JSON","TRADEOS_HUBTEL_COLLECTION_ACCOUNT"] as const;
const original=Object.fromEntries(names.map(n=>[n,process.env[n]]));
const pool=createPool(),app=buildApp(pool);
const pass="TradeOS-Test-1234";
beforeAll(async()=>{
  process.env.TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64=
    Buffer.alloc(32,84).toString("base64");
  process.env.TRADEOS_HUBTEL_POS_ENABLED="true";
  process.env.TRADEOS_HUBTEL_MERCHANT_POS_ENABLED="true";
  process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT="999999";
  delete process.env.TRADEOS_HUBTEL_POS_CREDENTIALS_JSON;
  await app.ready();
});
afterAll(async()=>{
  await app.close();await pool.end();
  for(const name of names){
    const prior=original[name];
    if(prior===undefined)delete process.env[name];
    else process.env[name]=prior;
  }
});
async function tenant(){
  const tag=randomUUID();
  const reg=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"Hubtel Preflight Merchant",
      email:"preflight-"+tag+"@example.test",password:pass,
      platform:"WEB",deviceKey:"preflight-"+tag,appVersion:"test"}});
  expect(reg.statusCode,reg.body).toBe(201);
  const headers={authorization:"Bearer "+reg.json().session.accessToken};
  const created=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:"Preflight "+tag,
      businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(created.statusCode,created.body).toBe(201);
  const businessId=created.json().business.id as string;
  const branchId=created.json().branch.id as string;
  const actor=(await pool.query<{user_id:string}>(
    "SELECT user_id FROM business_memberships "+
    "WHERE business_id=$1 AND role='OWNER'",[businessId])).rows[0]!.user_id;
  return {businessId,branchId,actor,headers,tag};
}
describe("Merchant-owned Hubtel collection activation preflight",()=>{
  it("reports each gate and cannot initiate or settle while merchant collection is disabled",async()=>{
    const m=await tenant(),other=await tenant();
    const route="/v1/businesses/"+m.businessId+
      "/payment-gateways/HUBTEL/activation-readiness";
    expect((await app.inject({method:"GET",url:route})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:route,
      headers:other.headers})).statusCode).toBe(403);
    const initially=await app.inject({method:"GET",url:route,headers:m.headers});
    expect(initially.statusCode,initially.body).toBe(200);
    expect(initially.json()).toMatchObject({
      merchantCredentialStatus:"NOT_CONFIGURED",
      activationRequested:false,merchantCollectionEnabled:false});
    const account="6"+Math.floor(100000000+Math.random()*900000000);
    await pool.query(
      "INSERT INTO business_hubtel_sales_accounts "+
      "(business_id,collection_account,credential_alias,"+
      "approval_status,verified_at,enabled) "+
      "VALUES($1,$2,$3,'VERIFIED',now(),true)",
      [m.businessId,account,"p_"+m.tag.slice(0,18)]);
    const fields={
      apiId:"merchant-check-id",
      apiKey:"merchant-check-key",
      collectionAccount:account,
    };
    await saveMerchantPaymentCredentials(pool,{
      businessId:m.businessId,actorUserId:m.actor,providerCode:"HUBTEL",
      environment:"LIVE",fields,currentPassword:pass,expectedRevision:0,
    });
    const pending=await app.inject({method:"GET",url:route,headers:m.headers});
    expect(pending.json().merchantCredentialStatus).toBe("SAVED_UNVERIFIED");
    const mock=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      expect(init?.method).toBe("GET");
      expect(String(url)).toBe(
        "https://trnf.hubtel.com/api/inter-transfers/"+account);
      return new Response(JSON.stringify({
        responseCode:"0000",data:{amount:12.25}}),{status:200});
    });
    await verifyMerchantHubtelConnection(pool,{
      businessId:m.businessId,actorUserId:m.actor,environment:"LIVE",
      expectedRevision:1,currentPassword:pass,
      fetchImpl:mock as typeof fetch,
    });
    await requestMerchantGatewayActivation(pool,{
      businessId:m.businessId,actorUserId:m.actor,providerCode:"HUBTEL",
      environment:"LIVE",expectedRevision:1,currentPassword:pass,
    });
    const final=await app.inject({method:"GET",url:route,headers:m.headers});
    expect(final.statusCode,final.body).toBe(200);
    expect(final.body).not.toContain(fields.apiId);
    expect(final.body).not.toContain(fields.apiKey);
    expect(final.json()).toMatchObject({
      merchantCredentialStatus:"VERIFIED",
      activationRequested:true,accountApproved:false,
      accountReviewStatus:"PENDING",merchantCollectionEnabled:false,
    });
    const steps=final.json().steps as {code:string;status:string}[];
    for(const code of ["CREDENTIAL_VAULT","MERCHANT_CREDENTIALS",
      "API_ACCESS","ACTIVATION_REQUEST"]){
      expect(steps.find(s=>s.code===code)?.status).toBe("DONE");
    }
    expect(steps.find(s=>s.code==="ACCOUNT_APPROVAL")?.status).toBe("BLOCKED");
    expect(steps.find(s=>s.code==="POS_RELEASE")?.status).toBe("BLOCKED");
    expect(mock).toHaveBeenCalledTimes(1);
    expect(await hubtelPosConnection(pool,m.businessId)).toBeNull();
    const saleId=(await pool.query<{id:string}>(
      "INSERT INTO sales(business_id,branch_id,status,currency_code,"+
      "total_minor,client_mutation_id) "+
      "VALUES($1,$2,'OPEN','GHS',4500,$3) RETURNING id",
      [m.businessId,m.branchId,"sale-"+m.tag])).rows[0]!.id;
    await pool.query(
      "INSERT INTO payments(business_id,branch_id,sale_id,amount_minor,"+
      "currency_code,method,status,client_mutation_id) "+
      "VALUES($1,$2,$3,4500,'GHS','MOMO','PENDING',$4)",
      [m.businessId,m.branchId,saleId,"payment-"+m.tag]);
    const neverFetch=vi.fn(async()=>{throw Error("Unexpected checkout call");});
    const beforeFetch=globalThis.fetch;
    globalThis.fetch=neverFetch as unknown as typeof fetch;
    try{
      await expect(startSaleHubtelCheckout(pool,{
        businessId:m.businessId,saleId,clientRequestId:randomUUID(),
      })).rejects.toMatchObject({code:"HUBTEL_POS_DISABLED"});
      expect(neverFetch).not.toHaveBeenCalled();
    }finally{globalThis.fetch=beforeFetch;}
    const sale=(await pool.query<{status:string}>(
      "SELECT status FROM sales WHERE id=$1",[saleId])).rows[0];
    expect(sale?.status).toBe("OPEN");
  });
});
