import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
import {sealSmsProviderSecret,unsealSmsProviderSecret} from
  "../src/payment-providers/vault.js";

const url=process.env.DATABASE_URL??
  "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
if(!url.endsWith("/tradeos_ci")||
  !/(@127\.0\.0\.1:5432|@localhost:5432)/.test(url))
  throw new Error("SMS integration tests require isolated local tradeos_ci");
process.env.DATABASE_URL=url;
const env="TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64";
const previous=process.env[env];
const pass="TradeOS-Test-1234",pool=createPool(),app=buildApp(pool);
beforeAll(async()=>{
  process.env[env]=Buffer.alloc(32,78).toString("base64");
  await app.ready();
});
afterAll(async()=>{
  await app.close();await pool.end();
  if(previous===undefined)delete process.env[env];else process.env[env]=previous;
});
async function merchant(){
  const id=randomUUID();
  const signed=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"SMS Test Owner",email:"sms-"+id+"@example.test",
      password:pass,platform:"WEB",deviceKey:"sms-test-"+id,appVersion:"test"}});
  expect(signed.statusCode,signed.body).toBe(201);
  const headers={authorization:"Bearer "+signed.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:"SMS Merchant "+id,
      businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  return {businessId:onboard.json().business.id as string,headers};
}
describe("merchant-owned SMS connection configuration",()=>{
  it("saves encrypted Arkesel key, redacts reads, prevents replay and cross-tenant access",async()=>{
    const a=await merchant(),b=await merchant();
    const path="/v1/businesses/"+a.businessId+"/sms-providers/connections";
    const apiKey="ARKESEL_test_key_"+randomUUID();
    expect((await app.inject({method:"GET",url:path})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:path,headers:b.headers})).statusCode).toBe(403);
    const save=(payload:unknown)=>app.inject({
      method:"PUT",url:path+"/ARKESEL",headers:a.headers,payload});
    expect((await save({apiSecret:apiKey,senderId:"MyBrand",
      expectedRevision:0,currentPassword:"bad"})).statusCode).toBe(403);
    expect((await save({apiSecret:apiKey,senderId:"MyBrand",
      expectedRevision:0,currentPassword:pass,accountId:"unexpected"})).statusCode)
      .toBe(400);
    const created=await save({apiSecret:apiKey,senderId:"MyBrand",
      expectedRevision:0,currentPassword:pass});
    expect(created.statusCode,created.body).toBe(200);
    expect(created.json()).toMatchObject({connection:{providerCode:"ARKESEL",
      status:"SAVED_UNVERIFIED",revision:1,enabled:false}});
    expect(created.body).not.toContain(apiKey);
    const view=await app.inject({method:"GET",url:path,headers:a.headers});
    expect(view.statusCode,view.body).toBe(200);
    expect(view.json()).toMatchObject({sendingEnabled:false,vaultReady:true,
      connections:[{providerCode:"ARKESEL",senderId:"MyBrand",enabled:false}]});
    expect(view.body).not.toContain(apiKey);
    expect(view.body).not.toContain("encrypted_secret");
    const ciphertext=(await pool.query<{encrypted_secret:Buffer;nonce:Buffer;
      auth_tag:Buffer;vault_key_version:1}>(
      "SELECT encrypted_secret,nonce,auth_tag,vault_key_version "+
      "FROM business_sms_provider_connections "+
      "WHERE business_id=$1 AND provider_code='ARKESEL'",
      [a.businessId])).rows[0]!;
    expect(ciphertext.encrypted_secret.toString()).not.toContain(apiKey);
    expect(unsealSmsProviderSecret(a.businessId,"ARKESEL",{
      encrypted:ciphertext.encrypted_secret,nonce:ciphertext.nonce,
      tag:ciphertext.auth_tag,keyVersion:ciphertext.vault_key_version,
    })).toBe(apiKey);
    expect(()=>unsealSmsProviderSecret(b.businessId,"ARKESEL",{
      encrypted:ciphertext.encrypted_secret,nonce:ciphertext.nonce,
      tag:ciphertext.auth_tag,keyVersion:ciphertext.vault_key_version,
    })).toThrow();
    expect(()=>unsealSmsProviderSecret(a.businessId,"NALO",{
      encrypted:ciphertext.encrypted_secret,nonce:ciphertext.nonce,
      tag:ciphertext.auth_tag,keyVersion:ciphertext.vault_key_version,
    })).toThrow();
    expect((await save({apiSecret:apiKey,senderId:"MyBrand",
      expectedRevision:0,currentPassword:pass})).statusCode).toBe(409);
    const revoked=await app.inject({method:"DELETE",url:path+"/ARKESEL",
      headers:a.headers,payload:{expectedRevision:1,currentPassword:pass}});
    expect(revoked.statusCode,revoked.body).toBe(200);
    expect(revoked.json().connection).toMatchObject({
      status:"REVOKED",revision:2,enabled:false});
    const cleared=(await pool.query<{encrypted_secret:Buffer|null}>(
      "SELECT encrypted_secret FROM business_sms_provider_connections "+
      "WHERE business_id=$1 AND provider_code='ARKESEL'",
      [a.businessId])).rows[0];
    expect(cleared?.encrypted_secret).toBeNull();
    const audit=(await pool.query<{event_type:string}>(
      "SELECT event_type FROM business_sms_provider_connection_audit "+
      "WHERE business_id=$1 ORDER BY revision",
      [a.businessId])).rows.map(x=>x.event_type);
    expect(audit).toEqual(["CREDENTIAL_SAVED","CREDENTIAL_REVOKED"]);
  });

  it("supports separate Hubtel SMS Client ID/Secret and Twilio SID/token fields",async()=>{
    const m=await merchant();
    const path="/v1/businesses/"+m.businessId+"/sms-providers/connections/";
    const hubtel=await app.inject({method:"PUT",url:path+"HUBTEL_SMS",
      headers:m.headers,payload:{
        accountId:"sms-client-id",apiSecret:"secret-SMS-abcdef012345",
        senderId:"LIGHTWORLD",currentPassword:pass,expectedRevision:0}});
    expect(hubtel.statusCode,hubtel.body).toBe(200);
    expect(hubtel.json().connection).toMatchObject({
      senderId:"LIGHTWORLD",accountId:"sms-client-id",enabled:false});
    const invalid=await app.inject({method:"PUT",url:path+"TWILIO",
      headers:m.headers,payload:{
        accountId:"wrong",apiSecret:"TwilioToken123456",
        senderId:"+233591234567",currentPassword:pass,expectedRevision:0}});
    expect(invalid.statusCode).toBe(400);
    const twilio=await app.inject({method:"PUT",url:path+"TWILIO",
      headers:m.headers,payload:{
        accountId:"AC"+"0".repeat(32),apiSecret:"TwilioToken123456",
        senderId:"+233591234567",currentPassword:pass,expectedRevision:0}});
    expect(twilio.statusCode,twilio.body).toBe(200);
    const snapshot=await app.inject({method:"GET",url:path.slice(0,-1),headers:m.headers});
    expect(snapshot.json().connections).toHaveLength(2);
    expect(snapshot.body).not.toContain("TwilioToken123456");
  });

  it("fails closed when server vault is unavailable without disclosing key",async()=>{
    const m=await merchant();
    delete process.env[env];
    try{
      const res=await app.inject({method:"PUT",
        url:"/v1/businesses/"+m.businessId+"/sms-providers/connections/NALO",
        headers:m.headers,payload:{apiSecret:"nalo_test_api_12345",
          senderId:"MyBrand",currentPassword:pass,expectedRevision:0}});
      expect(res.statusCode,res.body).toBe(503);
      expect(res.body).not.toContain("nalo_test_api_12345");
    }finally{process.env[env]=Buffer.alloc(32,78).toString("base64");}
  });
});
