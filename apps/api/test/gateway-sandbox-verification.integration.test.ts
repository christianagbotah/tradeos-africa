import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {createPool} from "../src/db.js";
import {buildApp} from "../src/app.js";
import {sealTestGatewayKey} from "../src/payment-providers/vault.js";
import {prepareTestGatewayAttempt} from "../src/payment-providers/attempts.js";
import {observeSandboxGatewayVerification} from
  "../src/payment-providers/sandbox-verification.js";

const url=process.env.DATABASE_URL??
  "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
if(!url.endsWith("/tradeos_ci")||
   !/(@127\.0\.0\.1:5432|@localhost:5432)/.test(url))
  throw new Error("Sandbox verification tests must use isolated tradeos_ci PostgreSQL");
process.env.DATABASE_URL=url;
const master="TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64";
const previous=process.env[master];
const pool=createPool(),app=buildApp(pool);
const password="TradeOS-Test-1234";
beforeAll(async()=>{
  process.env[master]=Buffer.alloc(32,71).toString("base64");
  await app.ready();
});
afterAll(async()=>{
  await app.close();await pool.end();
  if(previous===undefined)delete process.env[master];
  else process.env[master]=previous;
});
type Provider="PAYSTACK"|"FLUTTERWAVE";
const KEY={
  PAYSTACK:"sk_test_syntheticABCDEFGHIJKLMNOP",
  FLUTTERWAVE:"FLWSECK_TEST-syntheticABCDEFGHIJKLMNOP",
} as const;
async function merchant(provider:Provider="PAYSTACK"){
  const id=randomUUID();
  const register=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:"Sandbox Merchant",email:"sandbox-"+id+"@example.test",
    password,platform:"WEB",deviceKey:"test-"+id,appVersion:"test"}});
  expect(register.statusCode,register.body).toBe(201);
  const headers={authorization:"Bearer "+register.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:"Sandbox "+id,businessType:"RETAIL_HARDWARE",
      branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const branchId=onboard.json().branch.id as string;
  const actor=(await pool.query<{user_id:string}>(
    "SELECT user_id FROM business_memberships "+
    "WHERE business_id=$1 AND role='OWNER'",[businessId])).rows[0]!.user_id;
  const sealed=sealTestGatewayKey(businessId,provider,KEY[provider]);
  await pool.query(
    "INSERT INTO business_payment_gateway_preferences "+
    "(business_id,provider_code,changed_by_user_id) VALUES($1,$2,$3)",
    [businessId,provider,actor]);
  await pool.query(
    "INSERT INTO business_gateway_connections "+
    "(business_id,provider_code,encrypted_secret,nonce,auth_tag,changed_by_user_id) "+
    "VALUES($1,$2,$3,$4,$5,$6)",
    [businessId,provider,sealed.encrypted,sealed.nonce,sealed.tag,actor]);
  return {businessId,branchId,provider,headers};
}
async function sale(m:Awaited<ReturnType<typeof merchant>>){
  const id=randomUUID();
  const saleId=(await pool.query<{id:string}>(
    "INSERT INTO sales (business_id,branch_id,status,currency_code,"+
    "total_minor,client_mutation_id) "+
    "VALUES($1,$2,'OPEN','GHS',8500,$3) RETURNING id",
    [m.businessId,m.branchId,"sandbox-sale-"+id])).rows[0]!.id;
  const paymentId=(await pool.query<{id:string}>(
    "INSERT INTO payments (business_id,branch_id,sale_id,amount_minor,"+
    "currency_code,method,status,client_mutation_id) "+
    "VALUES($1,$2,$3,8500,'GHS','MOMO','PENDING',$4) RETURNING id",
    [m.businessId,m.branchId,saleId,"sandbox-payment-"+id])).rows[0]!.id;
  const prepared=await prepareTestGatewayAttempt(pool,{
    businessId:m.businessId,saleId,clientRequestId:randomUUID()});
  return {saleId,paymentId,attemptId:prepared.attempt.attemptId,
    reference:prepared.attempt.clientReference};
}
const json=(body:unknown)=>new Response(JSON.stringify(body),{status:200});
function paystackResponse(reference:string,id=123456){
  return json({status:true,data:{reference,id,status:"success",amount:8500,
    currency:"GHS",channel:"mobile_money"}});
}
function flutterResponse(reference:string,id=123456){
  return json({status:"success",data:{tx_ref:reference,id,status:"successful",
    amount:85,currency:"GHS",payment_type:"mobilemoneyghana"}});
}
async function financialState(paymentId:string,saleId:string){
  const p=(await pool.query<{status:string}>(
    "SELECT status FROM payments WHERE id=$1",[paymentId])).rows[0];
  const s=(await pool.query<{status:string}>(
    "SELECT status FROM sales WHERE id=$1",[saleId])).rows[0];
  const ledger=(await pool.query<{count:string}>(
    "SELECT count(*)::text AS count FROM cashbook_entries "+
    "WHERE source_type='PAYMENT' AND source_id=$1",[paymentId])).rows[0];
  return {payment:p?.status,sale:s?.status,cashbook:ledger?.count};
}

describe("independently polled, non-posting sandbox evidence",()=>{
  it("records Paystack TEST paid evidence once; never posts money or accepts another tenant",async()=>{
    const m=await merchant(),foreign=await merchant();
    const a=await sale(m);
    const fetchMock=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(url)).toContain(
        "/transaction/verify/"+a.reference);
      expect((init?.headers as Record<string,string>).authorization)
        .toBe("Bearer "+KEY.PAYSTACK);
      return paystackResponse(a.reference);
    });
    const attempt={businessId:m.businessId,attemptId:a.attemptId,
      fetchImpl:fetchMock as typeof fetch};
    const observed=await observeSandboxGatewayVerification(pool,attempt);
    expect(observed).toMatchObject({replayed:false,evidence:{
      status:"TEST_PAID_OBSERVED",providerCode:"PAYSTACK",
      attemptId:a.attemptId,posted:false,collectionEnabled:false}});
    expect(await financialState(a.paymentId,a.saleId)).toEqual({
      payment:"PENDING",sale:"OPEN",cashbook:"0"});
    const again=await observeSandboxGatewayVerification(pool,attempt);
    expect(again).toMatchObject({replayed:true,evidence:{
      observationId:observed.evidence.observationId}});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const audit=await app.inject({method:"GET",
      url:"/v1/businesses/"+m.businessId+"/payment-gateways/attempts",
      headers:m.headers});
    expect(audit.statusCode,audit.body).toBe(200);
    expect(audit.json().attempts.find((x:{attemptId:string})=>
      x.attemptId===a.attemptId)).toMatchObject({sandboxEvidence:{
        status:"TEST_PAID_OBSERVED",posted:false}});
    expect(audit.body).not.toContain(KEY.PAYSTACK);
    const unauthorized=await app.inject({method:"GET",
      url:"/v1/businesses/"+m.businessId+"/payment-gateways/attempts",
      headers:foreign.headers});
    expect(unauthorized.statusCode).toBe(403);
    await expect(observeSandboxGatewayVerification(pool,{
      businessId:foreign.businessId,attemptId:a.attemptId,
      fetchImpl:fetchMock as typeof fetch})).rejects.toMatchObject({
        code:"GATEWAY_SANDBOX_ATTEMPT_NOT_FOUND"});
    const db=(await pool.query<{c:string}>(
      "SELECT count(*)::text AS c "+
      "FROM gateway_sandbox_verification_observations WHERE attempt_id=$1",
      [a.attemptId])).rows[0];
    expect(db?.c).toBe("1");
    await expect(pool.query(
      "UPDATE gateway_sandbox_verification_observations SET "+
      "observation_kind='SANDBOX_UNPAID' WHERE attempt_id=$1",
      [a.attemptId])).rejects.toThrow();
    await expect(pool.query(
      "DELETE FROM gateway_sandbox_verification_observations "+
      "WHERE attempt_id=$1",[a.attemptId])).rejects.toThrow();
  });

  it("blocks reference/amount mismatch, flags review, does not settle or persist fake paid",async()=>{
    const m=await merchant(),a=await sale(m);
    const wrong=vi.fn(async()=>paystackResponse(a.reference,45678));
    await expect(observeSandboxGatewayVerification(pool,{
      businessId:m.businessId,attemptId:a.attemptId,
      fetchImpl:async()=>json({status:true,data:{
        reference:a.reference,status:"success",id:45678,amount:8600,
        currency:"GHS",channel:"card"}})})).rejects.toMatchObject({
          code:"GATEWAY_VERIFICATION_MISMATCH"});
    const attempt=(await pool.query<{state:string}>(
      "SELECT state FROM gateway_collection_attempts WHERE id=$1",
      [a.attemptId])).rows[0];
    expect(attempt?.state).toBe("REVIEW_REQUIRED");
    expect((await pool.query<{c:string}>(
      "SELECT count(*)::text AS c FROM gateway_sandbox_verification_observations "+
      "WHERE attempt_id=$1",[a.attemptId])).rows[0]?.c).toBe("0");
    expect(await financialState(a.paymentId,a.saleId)).toEqual({
      payment:"PENDING",sale:"OPEN",cashbook:"0"});
    await expect(observeSandboxGatewayVerification(pool,{
      businessId:m.businessId,attemptId:a.attemptId,
      fetchImpl:wrong as typeof fetch})).rejects.toMatchObject({
        code:"GATEWAY_SANDBOX_ATTEMPT_CLOSED"});
    expect(wrong).not.toHaveBeenCalled();
  });

  it("records unpaid then independently verified Flutterwave TEST paid; rejects reuse",async()=>{
    const m=await merchant("FLUTTERWAVE"),a=await sale(m);
    let checks=0;
    const check=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      checks++;
      expect(String(url)).toContain("/transactions/123456/verify");
      expect((init?.headers as Record<string,string>).authorization)
        .toBe("Bearer "+KEY.FLUTTERWAVE);
      return checks===1?
        json({status:"success",data:{tx_ref:a.reference,status:"pending"}}):
        flutterResponse(a.reference);
    });
    const args={businessId:m.businessId,attemptId:a.attemptId,
      providerTransactionId:"123456",fetchImpl:check as typeof fetch};
    expect((await observeSandboxGatewayVerification(pool,args)).evidence.status)
      .toBe("TEST_UNPAID_OBSERVED");
    expect((await observeSandboxGatewayVerification(pool,args)).evidence.status)
      .toBe("TEST_PAID_OBSERVED");
    expect(await financialState(a.paymentId,a.saleId)).toEqual({
      payment:"PENDING",sale:"OPEN",cashbook:"0"});
    expect((await pool.query<{c:string}>(
      "SELECT count(*)::text AS c FROM gateway_sandbox_verification_observations "+
      "WHERE attempt_id=$1",[a.attemptId])).rows[0]?.c).toBe("2");
    await expect(observeSandboxGatewayVerification(pool,{
      ...args,providerTransactionId:"999999"})).rejects.toMatchObject({
        code:"GATEWAY_SANDBOX_PROVIDER_TX_CONFLICT"});
    const b=await sale(m);
    await expect(observeSandboxGatewayVerification(pool,{
      businessId:m.businessId,attemptId:b.attemptId,
      providerTransactionId:"123456",
      fetchImpl:async()=>flutterResponse(b.reference)})).rejects.toMatchObject({
        code:"GATEWAY_SANDBOX_PROVIDER_TX_REUSED"});
    expect(await financialState(b.paymentId,b.saleId)).toEqual({
      payment:"PENDING",sale:"OPEN",cashbook:"0"});
  });

  it("refuses rotated merchant keys before network access",async()=>{
    const m=await merchant(),a=await sale(m);
    await pool.query("UPDATE business_gateway_connections "+
      "SET revision=revision+1 WHERE business_id=$1 AND provider_code='PAYSTACK'",
      [m.businessId]);
    const fetchMock=vi.fn(async()=>paystackResponse(a.reference));
    await expect(observeSandboxGatewayVerification(pool,{
      businessId:m.businessId,attemptId:a.attemptId,
      fetchImpl:fetchMock as typeof fetch})).rejects.toMatchObject({
        code:"GATEWAY_SANDBOX_CONNECTION_CHANGED"});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("blocks cross-provider double checkout in both insert directions",async()=>{
    const m=await merchant();
    const account="9"+String(Math.floor(Math.random()*900000000)+100000000);
    const alias="sandbox-"+randomUUID().slice(0,18);
    await pool.query(
      "INSERT INTO business_hubtel_sales_accounts "+
      "(business_id,collection_account,credential_alias) VALUES($1,$2,$3)",
      [m.businessId,account,alias]);

    // Legacy Hubtel checkout first: future TEST Paystack preparation must not
    // create a second attempt, even after a merchant switches preference.
    const tag=randomUUID();
    const legacySale=(await pool.query<{id:string}>(
      "INSERT INTO sales (business_id,branch_id,status,currency_code,"+
      "total_minor,client_mutation_id) "+
      "VALUES($1,$2,'OPEN','GHS',8500,$3) RETURNING id",
      [m.businessId,m.branchId,"legacy-"+tag])).rows[0]!.id;
    const legacyPayment=(await pool.query<{id:string}>(
      "INSERT INTO payments (business_id,branch_id,sale_id,amount_minor,"+
      "currency_code,method,status,client_mutation_id) "+
      "VALUES($1,$2,$3,8500,'GHS','MOMO','PENDING',$4) RETURNING id",
      [m.businessId,m.branchId,legacySale,"legacy-payment-"+tag])).rows[0]!.id;
    await pool.query(
      "INSERT INTO hubtel_sale_checkout_attempts "+
      "(business_id,branch_id,sale_id,payment_id,client_request_id,"+
      "client_reference,merchant_collection_account,expected_amount_minor,"+
      "currency_code) VALUES($1,$2,$3,$4,$5,$6,$7,8500,'GHS')",
      [m.businessId,m.branchId,legacySale,legacyPayment,randomUUID(),
        "TSP-"+randomUUID().replaceAll("-","").slice(0,24),account]);
    await expect(prepareTestGatewayAttempt(pool,{
      businessId:m.businessId,saleId:legacySale,
      clientRequestId:randomUUID()})).rejects.toMatchObject({
        code:"GATEWAY_ATTEMPT_EXISTING_HUBTEL",statusCode:409});

    // TEST Paystack prepared first: a later Hubtel insert must fail at the
    // database boundary even if an internal caller bypasses the API guard.
    const a=await sale(m);
    await expect(pool.query(
      "INSERT INTO hubtel_sale_checkout_attempts "+
      "(business_id,branch_id,sale_id,payment_id,client_request_id,"+
      "client_reference,merchant_collection_account,expected_amount_minor,"+
      "currency_code) VALUES($1,$2,$3,$4,$5,$6,$7,8500,'GHS')",
      [m.businessId,m.branchId,a.saleId,a.paymentId,randomUUID(),
        "TSP-"+randomUUID().replaceAll("-","").slice(0,24),account],
    )).rejects.toThrow();
    expect(await financialState(a.paymentId,a.saleId)).toEqual({
      payment:"PENDING",sale:"OPEN",cashbook:"0"});
  });

});

describe("merchant-facing, no-money sandbox test workspace routes",()=>{
  it("prepares one idempotent test reference without contacting a provider",async()=>{
    const m=await merchant("PAYSTACK"),other=await merchant("PAYSTACK");
    const saleId=(await pool.query<{id:string}>(
      "INSERT INTO sales(business_id,branch_id,status,currency_code,total_minor,"+
      "client_mutation_id) VALUES($1,$2,'OPEN','GHS',8500,$3) RETURNING id",
      [m.businessId,m.branchId,"portal-"+randomUUID()])).rows[0]!.id;
    const paymentId=(await pool.query<{id:string}>(
      "INSERT INTO payments(business_id,branch_id,sale_id,amount_minor,"+
      "currency_code,method,status,client_mutation_id) "+
      "VALUES($1,$2,$3,8500,'GHS','MOMO','PENDING',$4) RETURNING id",
      [m.businessId,m.branchId,saleId,"portal-pay-"+randomUUID()])).rows[0]!.id;
    const route="/v1/businesses/"+m.businessId+"/payment-gateways/attempts";
    const payload={saleId,clientRequestId:randomUUID()};
    const foreign=await app.inject({method:"POST",url:route,
      headers:other.headers,payload});
    expect(foreign.statusCode).toBe(403);
    const first=await app.inject({method:"POST",url:route,headers:m.headers,payload});
    expect(first.statusCode,first.body).toBe(200);
    expect(first.json()).toMatchObject({charged:false,replayed:false,
      attempt:{saleId,environment:"TEST",providerCode:"PAYSTACK",state:"PREPARED"}});
    const second=await app.inject({method:"POST",url:route,headers:m.headers,payload});
    expect(second.statusCode,second.body).toBe(200);
    expect(second.json()).toMatchObject({charged:false,replayed:true});
    expect(second.json().attempt.attemptId).toBe(first.json().attempt.attemptId);
    const conflicting=await app.inject({method:"POST",url:route,headers:m.headers,
      payload:{saleId,clientRequestId:randomUUID()}});
    expect(conflicting.statusCode).toBe(409);
    expect(await financialState(paymentId,saleId)).toEqual({
      payment:"PENDING",sale:"OPEN",cashbook:"0"});
  });

  it("independently checks Paystack TEST once/minute with exact original reference",async()=>{
    const m=await merchant("PAYSTACK"),other=await merchant("PAYSTACK");
    const a=await sale(m);
    const endpoint="/v1/businesses/"+m.businessId+"/payment-gateways/attempts/"+
      a.attemptId+"/verify-sandbox";
    // IDs must be unique across this *entire* isolated suite. The DB correctly
    // rejects a single provider transaction ID attributed to two sales.
    const providerId=800000000+Math.floor(Math.random()*100000000);
    const old=globalThis.fetch;
    const net=vi.fn(async(uri:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(uri)).toContain("/transaction/verify/"+a.reference);
      expect((init?.headers as Record<string,string>).authorization)
        .toBe("Bearer "+KEY.PAYSTACK);
      return paystackResponse(a.reference,providerId);
    });
    globalThis.fetch=net as typeof fetch;
    try{
      const denied=await app.inject({method:"POST",url:endpoint,
        headers:other.headers,payload:{}});
      expect(denied.statusCode).toBe(403);
      const paid=await app.inject({method:"POST",url:endpoint,
        headers:m.headers,payload:{}});
      expect(paid.statusCode,paid.body).toBe(200);
      expect(paid.json()).toMatchObject({replayed:false,
        evidence:{status:"TEST_PAID_OBSERVED",posted:false,collectionEnabled:false}});
      const rate=await app.inject({method:"POST",url:endpoint,
        headers:m.headers,payload:{}});
      expect(rate.statusCode).toBe(429);
      expect(net).toHaveBeenCalledTimes(1);
      const checks=(await pool.query<{portal_verification_count:number}>(
        "SELECT portal_verification_count FROM gateway_collection_attempts WHERE id=$1",
        [a.attemptId])).rows[0]!;
      expect(checks.portal_verification_count).toBe(1);
      expect(await financialState(a.paymentId,a.saleId)).toEqual({
        payment:"PENDING",sale:"OPEN",cashbook:"0"});
    }finally{globalThis.fetch=old;}
  });

  it("validates Flutterwave provider ID before consuming quota, then records TEST only",async()=>{
    const m=await merchant("FLUTTERWAVE"),a=await sale(m);
    const endpoint="/v1/businesses/"+m.businessId+"/payment-gateways/attempts/"+
      a.attemptId+"/verify-sandbox";
    const invalid=await app.inject({method:"POST",url:endpoint,
      headers:m.headers,payload:{}});
    expect(invalid.statusCode,invalid.body).toBe(400);
    const quota=(await pool.query<{portal_verification_count:number}>(
      "SELECT portal_verification_count FROM gateway_collection_attempts WHERE id=$1",
      [a.attemptId])).rows[0]!;
    expect(quota.portal_verification_count).toBe(0);
    const providerId=String(800000000+Math.floor(Math.random()*100000000));
    const old=globalThis.fetch;
    const net=vi.fn(async(uri:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(uri)).toContain("/transactions/"+providerId+"/verify");
      expect((init?.headers as Record<string,string>).authorization)
        .toBe("Bearer "+KEY.FLUTTERWAVE);
      return flutterResponse(a.reference,Number(providerId));
    });
    globalThis.fetch=net as typeof fetch;
    try{
      const observed=await app.inject({method:"POST",url:endpoint,
        headers:m.headers,payload:{providerTransactionId:providerId}});
      expect(observed.statusCode,observed.body).toBe(200);
      expect(observed.json().evidence.status).toBe("TEST_PAID_OBSERVED");
      expect(net).toHaveBeenCalledTimes(1);
      expect(await financialState(a.paymentId,a.saleId)).toEqual({
        payment:"PENDING",sale:"OPEN",cashbook:"0"});
    }finally{globalThis.fetch=old;}
  });

  it("closes TEST attempts without refund/settlement and never reopens them",async()=>{
    const m=await merchant(),a=await sale(m);
    const endpoint="/v1/businesses/"+m.businessId+"/payment-gateways/attempts/"+
      a.attemptId+"/close";
    const first=await app.inject({method:"POST",url:endpoint,headers:m.headers,
      payload:{decision:"REVIEW_REQUIRED",reasonCode:"MERCHANT_REQUESTED_REVIEW"}});
    expect(first.statusCode,first.body).toBe(200);
    expect(first.json()).toMatchObject({
      replayed:false,charged:false,attempt:{state:"REVIEW_REQUIRED"}});
    const again=await app.inject({method:"POST",url:endpoint,headers:m.headers,
      payload:{decision:"REVIEW_REQUIRED",reasonCode:"MERCHANT_REQUESTED_REVIEW"}});
    expect(again.statusCode).toBe(200);
    expect(again.json().replayed).toBe(true);
    const restart=await app.inject({method:"POST",url:endpoint,headers:m.headers,
      payload:{decision:"CANCELLED",reasonCode:"MERCHANT_CANCELLED_TEST"}});
    expect(restart.statusCode).toBe(409);
    expect(await financialState(a.paymentId,a.saleId)).toEqual({
      payment:"PENDING",sale:"OPEN",cashbook:"0"});
  });
});

describe("one-time merchant-hosted TEST checkout initiation",()=>{
  const endpoint=(businessId:string,attemptId:string)=>
    "/v1/businesses/"+businessId+"/payment-gateways/attempts/"+attemptId+
    "/hosted-test-checkout";
  const input={customerEmail:"sandbox.customer@example.com",
    currentPassword:"TradeOS-Test-1234"};

  it("initiates one Paystack TEST checkout, safely replays and verifies without posting",async()=>{
    const m=await merchant("PAYSTACK"),a=await sale(m);
    const providerTransactionId=String(850000000+Math.floor(Math.random()*10000000));
    const old=globalThis.fetch;
    const net=vi.fn(async(uri:RequestInfo|URL,init?:RequestInit)=>{
      if(String(uri)==="https://api.paystack.co/transaction/initialize"){
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string,string>).authorization)
          .toBe("Bearer "+KEY.PAYSTACK);
        const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
        expect(body).toMatchObject({reference:a.reference,amount:8500,
          currency:"GHS",email:input.customerEmail});
        return json({status:true,data:{reference:a.reference,
          authorization_url:"https://checkout.paystack.com/test-hosted-"+a.attemptId}});
      }
      expect(String(uri)).toContain("/transaction/verify/"+a.reference);
      return paystackResponse(a.reference,Number(providerTransactionId));
    });
    globalThis.fetch=net as typeof fetch;
    try{
      const init=await app.inject({method:"POST",url:endpoint(m.businessId,a.attemptId),
        headers:m.headers,payload:input});
      expect(init.statusCode,init.body).toBe(200);
      expect(init.json()).toMatchObject({replayed:false,checkout:{
        state:"READY",providerCode:"PAYSTACK",charged:false,settled:false,
        environment:"TEST"}});
      const replay=await app.inject({method:"POST",url:endpoint(m.businessId,a.attemptId),
        headers:m.headers,payload:input});
      expect(replay.statusCode,replay.body).toBe(200);
      expect(replay.json()).toMatchObject({replayed:true,
        checkout:{state:"READY",charged:false,settled:false}});
      expect(net).toHaveBeenCalledTimes(1);
      const audit=await app.inject({method:"GET",headers:m.headers,
        url:"/v1/businesses/"+m.businessId+"/payment-gateways/attempts"});
      expect(audit.statusCode,audit.body).toBe(200);
      const row=audit.json().attempts.find((x:{attemptId:string})=>
        x.attemptId===a.attemptId);
      expect(row).toMatchObject({sandboxCheckout:{state:"READY",
        checkoutUrl:init.json().checkout.checkoutUrl,charged:false,settled:false}});
      expect(audit.body).not.toContain(KEY.PAYSTACK);
      const paid=await app.inject({method:"POST",headers:m.headers,
        url:"/v1/businesses/"+m.businessId+"/payment-gateways/attempts/"+
          a.attemptId+"/verify-sandbox",payload:{}});
      expect(paid.statusCode,paid.body).toBe(200);
      expect(paid.json().evidence).toMatchObject({
        status:"TEST_PAID_OBSERVED",posted:false,collectionEnabled:false});
      expect(await financialState(a.paymentId,a.saleId)).toEqual({
        payment:"PENDING",sale:"OPEN",cashbook:"0"});
      const cancel=await app.inject({method:"POST",headers:m.headers,
        url:"/v1/businesses/"+m.businessId+"/payment-gateways/attempts/"+
          a.attemptId+"/close",payload:{decision:"CANCELLED",
          reasonCode:"MERCHANT_CANCELLED_TEST"}});
      expect(cancel.statusCode,cancel.body).toBe(409);
    }finally{globalThis.fetch=old;}
  });

  it("creates a Flutterwave hosted TEST checkout on the original test key only",async()=>{
    const m=await merchant("FLUTTERWAVE"),a=await sale(m);
    const old=globalThis.fetch;
    const net=vi.fn(async(uri:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(uri)).toBe("https://api.flutterwave.com/v3/payments");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string,string>).authorization)
        .toBe("Bearer "+KEY.FLUTTERWAVE);
      const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
      expect(body).toMatchObject({tx_ref:a.reference,amount:"85.00",
        currency:"GHS",customer:{email:input.customerEmail}});
      return json({status:"success",data:{
        link:"https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-sandbox"}});
    });
    globalThis.fetch=net as typeof fetch;
    try{
      const started=await app.inject({method:"POST",headers:m.headers,
        url:endpoint(m.businessId,a.attemptId),payload:input});
      expect(started.statusCode,started.body).toBe(200);
      expect(started.json()).toMatchObject({replayed:false,checkout:{
        state:"READY",checkoutUrl:
          "https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-sandbox"}});
      expect(net).toHaveBeenCalledTimes(1);
      expect(await financialState(a.paymentId,a.saleId)).toEqual({
        payment:"PENDING",sale:"OPEN",cashbook:"0"});
    }finally{globalThis.fetch=old;}
  });

  it("holds ambiguous provider outcomes with zero replays or paid receipts",async()=>{
    const m=await merchant(),a=await sale(m);
    const old=globalThis.fetch;
    const net=vi.fn(async()=>{throw new Error("Synthetic provider timeout");});
    globalThis.fetch=net as typeof fetch;
    try{
      const attempt=await app.inject({method:"POST",headers:m.headers,
        url:endpoint(m.businessId,a.attemptId),payload:input});
      expect(attempt.statusCode,attempt.body).toBe(200);
      expect(attempt.json()).toMatchObject({replayed:false,
        checkout:{state:"OUTCOME_UNKNOWN",checkoutUrl:null,
          charged:false,settled:false}});
      const replay=await app.inject({method:"POST",headers:m.headers,
        url:endpoint(m.businessId,a.attemptId),payload:input});
      expect(replay.statusCode,replay.body).toBe(200);
      expect(replay.json()).toMatchObject({replayed:true,
        checkout:{state:"OUTCOME_UNKNOWN",checkoutUrl:null}});
      expect(net).toHaveBeenCalledTimes(1);
      const events=await pool.query<{event_type:string}>(
        "SELECT event_type FROM gateway_sandbox_hosted_checkout_events "+
        "WHERE attempt_id=$1 ORDER BY occurred_at",[a.attemptId]);
      expect(events.rows.map(x=>x.event_type))
        .toEqual(["INITIATED","OUTCOME_UNKNOWN"]);
      await expect(pool.query("DELETE FROM gateway_sandbox_hosted_checkout_events "+
        "WHERE attempt_id=$1",[a.attemptId])).rejects.toThrow();
      expect(await financialState(a.paymentId,a.saleId)).toEqual({
        payment:"PENDING",sale:"OPEN",cashbook:"0"});
    }finally{globalThis.fetch=old;}
  });

  it("blocks cross-tenant calls, wrong passwords and rotated TEST keys before any POST",async()=>{
    const m=await merchant("PAYSTACK"),foreign=await merchant();
    const a=await sale(m);
    const old=globalThis.fetch;
    const net=vi.fn(async()=>json({status:true,data:{}}));
    globalThis.fetch=net as typeof fetch;
    try{
      const url=endpoint(m.businessId,a.attemptId);
      const forbidden=await app.inject({method:"POST",url,headers:foreign.headers,
        payload:input});
      expect(forbidden.statusCode).toBe(403);
      const wrongPassword=await app.inject({method:"POST",url,headers:m.headers,
        payload:{...input,currentPassword:"IncorrectPassword123!"}});
      expect(wrongPassword.statusCode).toBe(403);
      await pool.query("UPDATE business_gateway_connections "+
        "SET revision=revision+1 WHERE business_id=$1 AND provider_code='PAYSTACK'",
        [m.businessId]);
      const rotated=await app.inject({method:"POST",url,headers:m.headers,
        payload:input});
      expect(rotated.statusCode,rotated.body).toBe(409);
      expect(net).toHaveBeenCalledTimes(0);
      expect((await pool.query<{c:string}>(
        "SELECT count(*)::text AS c FROM gateway_sandbox_hosted_checkouts "+
        "WHERE attempt_id=$1",[a.attemptId])).rows[0]?.c).toBe("0");
      expect(await financialState(a.paymentId,a.saleId)).toEqual({
        payment:"PENDING",sale:"OPEN",cashbook:"0"});
    }finally{globalThis.fetch=old;}
  });

  it("rejects a forged LIVE key even when it was encrypted into a TEST vault row",async()=>{
    const m=await merchant("PAYSTACK"),a=await sale(m);
    const secret=sealTestGatewayKey(m.businessId,"PAYSTACK",
      "sk_live_SYNTHETIC_SHOULD_NEVER_BE_SENT");
    await pool.query("UPDATE business_gateway_connections SET "+
      "encrypted_secret=$2,nonce=$3,auth_tag=$4 WHERE business_id=$1 "+
      "AND provider_code='PAYSTACK'",
      [m.businessId,secret.encrypted,secret.nonce,secret.tag]);
    const old=globalThis.fetch;
    const net=vi.fn(async()=>json({status:true,data:{}}));
    globalThis.fetch=net as typeof fetch;
    try{
      const attempt=await app.inject({method:"POST",headers:m.headers,
        url:endpoint(m.businessId,a.attemptId),payload:input});
      expect(attempt.statusCode,attempt.body).toBe(403);
      expect(attempt.json().error).toBe("GATEWAY_TEST_CHECKOUT_LIVE_KEY_BLOCKED");
      expect(net).not.toHaveBeenCalled();
      expect(await financialState(a.paymentId,a.saleId)).toEqual({
        payment:"PENDING",sale:"OPEN",cashbook:"0"});
    }finally{globalThis.fetch=old;}
  });

  it("rejects an unsafe provider checkout URL without leaking it or retrying",async()=>{
    const m=await merchant("PAYSTACK"),a=await sale(m);
    const old=globalThis.fetch;
    const net=vi.fn(async()=>json({status:true,data:{
      reference:a.reference,authorization_url:"https://malicious.invalid/collect"}}));
    globalThis.fetch=net as typeof fetch;
    try{
      const result=await app.inject({method:"POST",headers:m.headers,
        url:endpoint(m.businessId,a.attemptId),payload:input});
      expect(result.statusCode,result.body).toBe(200);
      expect(result.json().checkout).toMatchObject({
        state:"OUTCOME_UNKNOWN",checkoutUrl:null,charged:false,settled:false});
      expect(result.body).not.toContain("malicious.invalid");
      const retry=await app.inject({method:"POST",headers:m.headers,
        url:endpoint(m.businessId,a.attemptId),payload:input});
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({replayed:true,
        checkout:{state:"OUTCOME_UNKNOWN"}});
      expect(net).toHaveBeenCalledTimes(1);
      expect(await financialState(a.paymentId,a.saleId)).toEqual({
        payment:"PENDING",sale:"OPEN",cashbook:"0"});
    }finally{globalThis.fetch=old;}
  });

  it("does not expose a checkout link when merchant TEST credentials rotate mid-request",async()=>{
    const m=await merchant("PAYSTACK"),a=await sale(m);
    const old=globalThis.fetch;
    const net=vi.fn(async(uri:RequestInfo|URL)=>{
      expect(String(uri)).toBe("https://api.paystack.co/transaction/initialize");
      await pool.query("UPDATE business_gateway_connections "+
        "SET revision=revision+1 WHERE business_id=$1 AND provider_code='PAYSTACK'",
        [m.businessId]);
      return json({status:true,data:{reference:a.reference,
        authorization_url:"https://checkout.paystack.com/should-not-be-shown"}});
    });
    globalThis.fetch=net as typeof fetch;
    try{
      const response=await app.inject({method:"POST",headers:m.headers,
        url:endpoint(m.businessId,a.attemptId),payload:input});
      expect(response.statusCode,response.body).toBe(200);
      expect(response.json().checkout).toMatchObject({
        state:"OUTCOME_UNKNOWN",checkoutUrl:null,charged:false,settled:false});
      expect(response.body).not.toContain("should-not-be-shown");
      expect(net).toHaveBeenCalledTimes(1);
      expect(await financialState(a.paymentId,a.saleId)).toEqual({
        payment:"PENDING",sale:"OPEN",cashbook:"0"});
    }finally{globalThis.fetch=old;}
  });
});

type PickerMerchant=Awaited<ReturnType<typeof merchant>>;
async function pendingTestSale(m:PickerMerchant,options?:{
  amount?:number;method?:"MOMO"|"CARD"|"CASH";branchId?:string;
}){
  const mutation=randomUUID(),amount=options?.amount??8500;
  const branch=options?.branchId??m.branchId;
  const saleId=(await pool.query<{id:string}>(
    "INSERT INTO sales (business_id,branch_id,status,currency_code,"+
    "total_minor,client_mutation_id) "+
    "VALUES($1,$2,'OPEN','GHS',$3,$4) RETURNING id",
    [m.businessId,branch,amount,"picker-sale-"+mutation])).rows[0]!.id;
  const paymentId=(await pool.query<{id:string}>(
    "INSERT INTO payments (business_id,branch_id,sale_id,amount_minor,"+
    "currency_code,method,status,client_mutation_id) "+
    "VALUES($1,$2,$3,$4,'GHS',$5,'PENDING',$6) RETURNING id",
    [m.businessId,branch,saleId,amount,options?.method??"MOMO",
      "picker-payment-"+mutation])).rows[0]!.id;
  return {saleId,paymentId};
}
function pickerUrl(businessId:string,query=""){
  return "/v1/businesses/"+businessId+
    "/payment-gateways/eligible-test-sales"+query;
}

describe("merchant TEST checkout eligible sale selection (read-only)",()=>{
  it("shows only tenant-eligible pending sales and removes them after preparation",async()=>{
    const m=await merchant("PAYSTACK"),other=await merchant("PAYSTACK");
    const pending=await pendingTestSale(m);
    const denied=await app.inject({method:"GET",url:pickerUrl(m.businessId),
      headers:other.headers});
    expect(denied.statusCode).toBe(403);
    const unauth=await app.inject({method:"GET",url:pickerUrl(m.businessId)});
    expect(unauth.statusCode).toBe(401);
    const ready=await app.inject({method:"GET",url:pickerUrl(m.businessId),
      headers:m.headers});
    expect(ready.statusCode,ready.body).toBe(200);
    expect(ready.json()).toMatchObject({
      businessId:m.businessId,providerCode:"PAYSTACK",
      ready:true,reason:null,collectionEnabled:false,
      eligibleSales:[{saleId:pending.saleId,branchId:m.branchId,
        amountMinor:"8500",currencyCode:"GHS",paymentMethod:"MOMO"}],
    });
    expect(ready.body).not.toContain(KEY.PAYSTACK);
    expect(ready.body).not.toContain("provider_reference");
    const prep=await app.inject({method:"POST",url:
      "/v1/businesses/"+m.businessId+"/payment-gateways/attempts",
      headers:m.headers,payload:{saleId:pending.saleId,clientRequestId:randomUUID()}});
    expect(prep.statusCode,prep.body).toBe(200);
    const after=await app.inject({method:"GET",url:pickerUrl(m.businessId),
      headers:m.headers});
    expect(after.statusCode).toBe(200);
    expect(after.json().eligibleSales).toEqual([]);
    expect(await financialState(pending.paymentId,pending.saleId)).toEqual({
      payment:"PENDING",sale:"OPEN",cashbook:"0"});
  });

  it("excludes duplicate, mismatched, completed, CASH and already-attempted sales",async()=>{
    const m=await merchant("FLUTTERWAVE");
    const valid=await pendingTestSale(m,{method:"CARD"});
    const wrongTotal=await pendingTestSale(m);
    await pool.query("UPDATE payments SET amount_minor=amount_minor+1 WHERE id=$1",
      [wrongTotal.paymentId]);
    const secondTender=await pendingTestSale(m);
    await pool.query("INSERT INTO payments "+
      "(business_id,branch_id,sale_id,amount_minor,currency_code,method,"+
      "status,client_mutation_id) "+
      "VALUES($1,$2,$3,8500,'GHS','CASH','PENDING',$4)",
      [m.businessId,m.branchId,secondTender.saleId,randomUUID()]);
    const finished=await pendingTestSale(m);
    await pool.query("UPDATE sales SET status='COMPLETED' WHERE id=$1",
      [finished.saleId]);
    const cash=await pendingTestSale(m,{method:"CASH"});
    const used=await sale(m);
    const res=await app.inject({method:"GET",url:pickerUrl(m.businessId),
      headers:m.headers});
    expect(res.statusCode,res.body).toBe(200);
    const ids=res.json().eligibleSales.map((s:{saleId:string})=>s.saleId);
    expect(ids).toEqual([valid.saleId]);
    for(const banned of [wrongTotal.saleId,secondTender.saleId,
      finished.saleId,cash.saleId,used.saleId]){
      expect(ids).not.toContain(banned);
    }
    expect(await financialState(valid.paymentId,valid.saleId)).toEqual({
      payment:"PENDING",sale:"OPEN",cashbook:"0"});
  });

  it("filters by an authorized branch and rejects invalid query identifiers",async()=>{
    const m=await merchant("PAYSTACK");
    const first=await pendingTestSale(m);
    const secondBranch=(await pool.query<{id:string}>(
      "INSERT INTO branches(business_id,name,code) "+
      "VALUES($1,'Secondary branch','S2') RETURNING id",
      [m.businessId])).rows[0]!.id;
    const second=await pendingTestSale(m,{branchId:secondBranch});
    const res=await app.inject({method:"GET",url:pickerUrl(m.businessId,
      "?branchId="+secondBranch),headers:m.headers});
    expect(res.statusCode,res.body).toBe(200);
    expect(res.json().eligibleSales).toMatchObject([{
      saleId:second.saleId,branchId:secondBranch,branchName:"Secondary branch"}]);
    expect(res.body).not.toContain(first.saleId);
    const invalid=await app.inject({method:"GET",url:pickerUrl(m.businessId,
      "?branchId=not-a-uuid"),headers:m.headers});
    expect(invalid.statusCode).toBe(400);
    const huge=await app.inject({method:"GET",url:pickerUrl(m.businessId,
      "?limit=500000"),headers:m.headers});
    expect(huge.statusCode).toBe(400);
  });

  it("explains missing TEST key or unsupported preferred gateway without exposing sales",async()=>{
    const m=await merchant("PAYSTACK");
    await pendingTestSale(m);
    await pool.query("UPDATE business_gateway_connections SET "+
      "connection_status='REVOKED',encrypted_secret=NULL,nonce=NULL,auth_tag=NULL "+
      "WHERE business_id=$1 AND provider_code='PAYSTACK'",[m.businessId]);
    const missing=await app.inject({method:"GET",url:pickerUrl(m.businessId),
      headers:m.headers});
    expect(missing.statusCode,missing.body).toBe(200);
    expect(missing.json()).toMatchObject({ready:false,
      reason:"SAVE_MERCHANT_TEST_KEY",eligibleSales:[],collectionEnabled:false});
    await pool.query("UPDATE business_payment_gateway_preferences "+
      "SET provider_code='HUBTEL' WHERE business_id=$1",[m.businessId]);
    const other=await app.inject({method:"GET",url:pickerUrl(m.businessId),
      headers:m.headers});
    expect(other.statusCode,other.body).toBe(200);
    expect(other.json()).toMatchObject({ready:false,
      providerCode:"HUBTEL",reason:"SELECT_PAYSTACK_OR_FLUTTERWAVE",
      eligibleSales:[],collectionEnabled:false});
  });
});
