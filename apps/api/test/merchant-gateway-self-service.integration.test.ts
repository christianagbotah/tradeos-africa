import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
import {
  saveMerchantPaymentCredentials,verifyMerchantHubtelConnection,
  requestMerchantGatewayActivation,revokeMerchantPaymentCredentials,
  checkHubtelCollectionBalance,checkHostedGatewayApiAccess,
  verifyMerchantHostedGatewayConnection,
} from "../src/payment-providers/merchant-connections.js";
import {unsealMerchantGatewayCredentials} from
  "../src/payment-providers/vault.js";
import {validateMerchantGatewayCredentials} from
  "../src/payment-providers/merchant-schemas.js";

const url=process.env.DATABASE_URL??
  "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
if(!url.endsWith("/tradeos_ci")||
  !/(@127\.0\.0\.1:5432|@localhost:5432)/.test(url))
  throw Error("Merchant credential tests require isolated local tradeos_ci");
process.env.DATABASE_URL=url;
const keyName="TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64";
const prior=process.env[keyName];
const pool=createPool(),app=buildApp(pool);
const password="TradeOS-Test-1234";
beforeAll(async()=>{
  process.env[keyName]=Buffer.alloc(32,76).toString("base64");
  await app.ready();
});
afterAll(async()=>{
  await app.close();await pool.end();
  if(prior===undefined)delete process.env[keyName];
  else process.env[keyName]=prior;
});
async function merchant(){
  const nonce=randomUUID();
  const signed=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"Merchant Gateway Owner",
      email:"merchant-gateway-"+nonce+"@example.test",
      password,platform:"WEB",deviceKey:"gateway-"+nonce,appVersion:"test"}});
  expect(signed.statusCode,signed.body).toBe(201);
  const headers={authorization:"Bearer "+signed.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:"Merchant "+nonce,
      businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const actor=(await pool.query<{user_id:string}>(
    "SELECT user_id FROM business_memberships WHERE business_id=$1 AND role='OWNER'",
    [businessId])).rows[0]!.user_id;
  return {businessId,actor,headers};
}
const hubtelFields={
  apiId:"hubtel-business-test-id",apiKey:"my-private-hubtel-key-"+randomUUID(),
  collectionAccount:"456"+Math.floor(10000000+Math.random()*89999999),
  disbursementAccount:"987"+Math.floor(10000000+Math.random()*89999999),
};
const hubtelBalance=(status=200)=>new Response(JSON.stringify({
  responseCode:"0000",message:"Success",data:{amount:135.75},
}),{status,headers:{"content-type":"application/json"}});

describe("tenant-owned multi-provider merchant credential portal",()=>{
  it("saves Hubtel LIVE API ID/key/accounts encrypted, tests read-only access, requests activation without charging",async()=>{
    const m=await merchant(),other=await merchant();
    const root="/v1/businesses/"+m.businessId+
      "/payment-gateways/merchant-connections";
    const fields={...hubtelFields,collectionAccount:"57"+
      Math.floor(100000000+Math.random()*900000000)};
    const put=(payload:unknown)=>app.inject({method:"PUT",
      url:root+"/HUBTEL/LIVE",headers:m.headers,payload});
    expect((await app.inject({method:"GET",url:root})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:root,headers:other.headers})).statusCode)
      .toBe(403);
    expect((await put({fields,expectedRevision:0,
      currentPassword:"wrong"})).statusCode).toBe(403);
    const saved=await put({fields,expectedRevision:0,currentPassword:password});
    expect(saved.statusCode,saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      connection:{providerCode:"HUBTEL",environment:"LIVE",
        status:"SAVED_UNVERIFIED",revision:1,collectionEnabled:false}});
    expect(saved.body).not.toContain(fields.apiId);
    expect(saved.body).not.toContain(fields.apiKey);
    const list=await app.inject({method:"GET",url:root,headers:m.headers});
    expect(list.statusCode,list.body).toBe(200);
    expect(list.json().connections[0]).toMatchObject({
      accountReference:fields.collectionAccount,status:"SAVED_UNVERIFIED"});
    expect(list.body).not.toContain(fields.apiId);
    expect(list.body).not.toContain(fields.apiKey);
    const vault=(await pool.query<{encrypted_credentials:Buffer;nonce:Buffer;
      auth_tag:Buffer;key_version:1}>(
      "SELECT encrypted_credentials,nonce,auth_tag,key_version "+
      "FROM business_merchant_gateway_credentials "+
      "WHERE business_id=$1 AND provider_code='HUBTEL' AND environment='LIVE'",
      [m.businessId])).rows[0]!;
    const sealed={encrypted:vault.encrypted_credentials,nonce:vault.nonce,
      tag:vault.auth_tag,keyVersion:vault.key_version};
    expect(vault.encrypted_credentials.toString()).not.toContain(fields.apiKey);
    expect(unsealMerchantGatewayCredentials(m.businessId,"HUBTEL","LIVE",sealed))
      .toMatchObject(fields);
    expect(()=>unsealMerchantGatewayCredentials(other.businessId,
      "HUBTEL","LIVE",sealed)).toThrow();
    expect(()=>unsealMerchantGatewayCredentials(m.businessId,
      "PAYSTACK","LIVE",sealed)).toThrow();
    expect(()=>unsealMerchantGatewayCredentials(m.businessId,
      "HUBTEL","TEST",sealed)).toThrow();
    expect((await app.inject({method:"POST",url:root+
      "/HUBTEL/LIVE/request-activation",headers:m.headers,
      payload:{expectedRevision:1,currentPassword:password}})).statusCode)
      .toBe(409);

    const fetchMock=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(url)).toBe("https://trnf.hubtel.com/api/inter-transfers/"+
        fields.collectionAccount);
      const auth=(init?.headers as Record<string,string>).authorization;
      expect(Buffer.from(auth.slice("Basic ".length),"base64").toString())
        .toBe(fields.apiId+":"+fields.apiKey);
      expect(init?.method).toBe("GET");
      return hubtelBalance();
    });
    const verified=await verifyMerchantHubtelConnection(pool,{
      businessId:m.businessId,actorUserId:m.actor,environment:"LIVE",
      expectedRevision:1,currentPassword:password,
      fetchImpl:fetchMock as typeof fetch});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(verified).toMatchObject({replayed:false,connection:{
      status:"VERIFIED",collectionEnabled:false}});
    const requested=await requestMerchantGatewayActivation(pool,{
      businessId:m.businessId,actorUserId:m.actor,providerCode:"HUBTEL",
      environment:"LIVE",expectedRevision:1,currentPassword:password});
    expect(requested.connection.activationRequestedAt).toBeTruthy();
    expect(requested.connection.collectionEnabled).toBe(false);
    expect((await requestMerchantGatewayActivation(pool,{
      businessId:m.businessId,actorUserId:m.actor,providerCode:"HUBTEL",
      environment:"LIVE",expectedRevision:1,currentPassword:password}))
      .replayed).toBe(true);
    const row=(await pool.query<{collection_enabled:boolean;status:string}>(
      "SELECT collection_enabled,status FROM business_merchant_gateway_credentials "+
      "WHERE business_id=$1 AND provider_code='HUBTEL'",
      [m.businessId])).rows[0]!;
    expect(row).toEqual({collection_enabled:false,status:"VERIFIED"});
    await expect(pool.query(
      "UPDATE business_merchant_gateway_credentials SET collection_enabled=true "+
      "WHERE business_id=$1",[m.businessId])).rejects.toThrow();
    expect((await pool.query<{event_type:string}>(
      "SELECT event_type FROM business_merchant_gateway_credential_audit "+
      "WHERE business_id=$1 ORDER BY occurred_at,id",
      [m.businessId])).rows.map(x=>x.event_type)).toEqual([
      "CREDENTIAL_SAVED","ACCOUNT_VERIFIED","ACTIVATION_REQUESTED"]);
    await expect(pool.query(
      "DELETE FROM business_merchant_gateway_credential_audit "+
      "WHERE business_id=$1",[m.businessId])).rejects.toThrow();
  });

  it("rejects incorrect Hubtel balance credentials, wrong market fields and account takeovers",async()=>{
    const a=await merchant(),b=await merchant();
    const fields={...hubtelFields,collectionAccount:"77"+
      Math.floor(100000000+Math.random()*900000000)};
    const first=await saveMerchantPaymentCredentials(pool,{
      businessId:a.businessId,actorUserId:a.actor,providerCode:"HUBTEL",
      environment:"LIVE",fields,expectedRevision:0,currentPassword:password});
    expect(first.verified).toBe(false);
    await expect(saveMerchantPaymentCredentials(pool,{
      businessId:b.businessId,actorUserId:b.actor,providerCode:"HUBTEL",
      environment:"LIVE",fields,expectedRevision:0,currentPassword:password}))
      .rejects.toMatchObject({code:"GATEWAY_HUBTEL_ACCOUNT_ALREADY_CONNECTED"});
    await expect(verifyMerchantHubtelConnection(pool,{
      businessId:a.businessId,actorUserId:a.actor,environment:"LIVE",
      expectedRevision:1,currentPassword:password,
      fetchImpl:async()=>hubtelBalance(403)})).rejects.toMatchObject({
      code:"HUBTEL_PROBE_ACCESS_REJECTED"});
    const row=(await pool.query<{status:string}>(
      "SELECT status FROM business_merchant_gateway_credentials "+
      "WHERE business_id=$1 AND provider_code='HUBTEL'",[a.businessId])).rows[0];
    expect(row?.status).toBe("SAVED_UNVERIFIED");
    expect((await revokeMerchantPaymentCredentials(pool,{
      businessId:a.businessId,actorUserId:a.actor,providerCode:"HUBTEL",
      environment:"LIVE",expectedRevision:1,currentPassword:password}))
      .connection.status).toBe("REVOKED");
    const savedAgain=await saveMerchantPaymentCredentials(pool,{
      businessId:b.businessId,actorUserId:b.actor,providerCode:"HUBTEL",
      environment:"LIVE",fields,expectedRevision:0,currentPassword:password});
    expect(savedAgain.connection.status).toBe("SAVED_UNVERIFIED");
    await expect(saveMerchantPaymentCredentials(pool,{
      businessId:b.businessId,actorUserId:b.actor,providerCode:"HUBTEL",
      environment:"LIVE",fields,expectedRevision:0,currentPassword:password}))
      .rejects.toMatchObject({code:"GATEWAY_MERCHANT_REVISION_CONFLICT"});
  });

  it("saves Paystack TEST keys into both the new portal and existing sandbox ledger",async()=>{
    const m=await merchant(),key="sk_test_"+randomUUID().replaceAll("-","");
    const saved=await saveMerchantPaymentCredentials(pool,{
      businessId:m.businessId,actorUserId:m.actor,providerCode:"PAYSTACK",
      environment:"TEST",fields:{secretKey:key},expectedRevision:0,
      currentPassword:password});
    expect(saved.connection).toMatchObject({
      providerCode:"PAYSTACK",environment:"TEST",collectionEnabled:false});
    const legacy=(await pool.query<{revision:number;connection_status:string;
      encrypted_secret:Buffer}>(
      "SELECT revision,connection_status,encrypted_secret "+
      "FROM business_gateway_connections "+
      "WHERE business_id=$1 AND provider_code='PAYSTACK'",
      [m.businessId])).rows[0]!;
    expect(legacy.revision).toBe(1);
    expect(legacy.connection_status).toBe("PENDING_VERIFICATION");
    expect(legacy.encrypted_secret.toString()).not.toContain(key);
    expect((await revokeMerchantPaymentCredentials(pool,{
      businessId:m.businessId,actorUserId:m.actor,providerCode:"PAYSTACK",
      environment:"TEST",expectedRevision:1,currentPassword:password}))
      .connection.status).toBe("REVOKED");
    const row=(await pool.query<{encrypted_secret:Buffer|null;
      connection_status:string}>(
      "SELECT encrypted_secret,connection_status FROM business_gateway_connections "+
      "WHERE business_id=$1 AND provider_code='PAYSTACK'",
      [m.businessId])).rows[0]!;
    expect(row.encrypted_secret).toBeNull();
    expect(row.connection_status).toBe("REVOKED");
    expect(()=>validateMerchantGatewayCredentials("PAYSTACK","LIVE",
      {secretKey:key})).toThrow();
    expect(()=>validateMerchantGatewayCredentials("HUBTEL","LIVE",
      {apiId:"a",apiKey:"xx",collectionAccount:"abc"})).toThrow();
    expect(()=>validateMerchantGatewayCredentials("MPESA","LIVE",
      {consumerKey:"testkey",consumerSecret:"testsecret",
        shortCode:"hello",passkey:"passkeyhere"})).toThrow();
  });

  it("proves read-only Hubtel account check cannot transfer or settle funds",async()=>{
    const fetchMock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      return hubtelBalance();
    });
    expect(await checkHubtelCollectionBalance({
      apiId:"merchant-id",apiKey:"merchant-key",
      collectionAccount:"123456",fetchImpl:fetchMock as typeof fetch}))
      .toEqual({verified:true});
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(checkHubtelCollectionBalance({
      apiId:"merchant-id",apiKey:"merchant-key",collectionAccount:"123456",
      fetchImpl:async()=>new Response(JSON.stringify({
        responseCode:"0000",data:{amount:null}}),{status:200}),
    })).rejects.toMatchObject({code:"HUBTEL_PROBE_INVALID"});
  });
  it("independently checks Paystack and Flutterwave TEST accounts with GET only",async()=>{
    const m=await merchant();
    const credentials=[
      {provider:"PAYSTACK" as const,secret:"sk_test_"+randomUUID().replaceAll("-",""),
        url:"https://api.paystack.co/balance",
        response:{status:true,data:[]}},
      {provider:"FLUTTERWAVE" as const,
        secret:"FLWSECK_TEST-"+randomUUID().replaceAll("-",""),
        url:"https://api.flutterwave.com/v3/balances",
        response:{status:"success",data:[]}},
    ];
    for(const item of credentials){
      await saveMerchantPaymentCredentials(pool,{
        businessId:m.businessId,actorUserId:m.actor,providerCode:item.provider,
        environment:"TEST",fields:{secretKey:item.secret},expectedRevision:0,
        currentPassword:password,
      });
      const fetchMock=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
        expect(String(url)).toBe(item.url);
        expect(init?.method).toBe("GET");
        expect(init?.body).toBeUndefined();
        expect((init?.headers as Record<string,string>).authorization)
          .toBe("Bearer "+item.secret);
        return new Response(JSON.stringify(item.response),{status:200});
      });
      const result=await verifyMerchantHostedGatewayConnection(pool,{
        businessId:m.businessId,actorUserId:m.actor,providerCode:item.provider,
        environment:"TEST",expectedRevision:1,currentPassword:password,
        fetchImpl:fetchMock as typeof fetch,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.connection).toMatchObject({
        status:"VERIFIED",collectionEnabled:false});
      const request=await requestMerchantGatewayActivation(pool,{
        businessId:m.businessId,actorUserId:m.actor,providerCode:item.provider,
        environment:"TEST",expectedRevision:1,currentPassword:password});
      expect(request.connection.activationRequestedAt).toBeTruthy();
      expect(request.connection.collectionEnabled).toBe(false);
      await expect(checkHostedGatewayApiAccess({
        provider:item.provider,secretKey:item.secret,
        fetchImpl:async()=>new Response(JSON.stringify({status:false,data:[]}),
          {status:200}),
      })).rejects.toMatchObject({code:"GATEWAY_PROBE_INVALID"});
    }
  });

  it("does not silently enable provider collections with a valid account",async()=>{
    const m=await merchant();
    const rows=await pool.query<{c:string}>(
      "SELECT count(*)::text AS c FROM business_merchant_gateway_credentials "+
      "WHERE business_id=$1 AND collection_enabled=true",[m.businessId]);
    expect(rows.rows[0]?.c).toBe("0");
    const merchantSessionPath="/v1/businesses/"+m.businessId+
      "/payment-gateways/merchant-connections";
    const info=await app.inject({method:"GET",url:merchantSessionPath,
      headers:m.headers});
    expect(info.statusCode,info.body).toBe(200);
    expect(info.json().collectionEnabled).toBe(false);
    const foreign=await merchant();
    expect((await app.inject({method:"GET",url:merchantSessionPath,
      headers:foreign.headers})).statusCode).toBe(403);
  });

});
