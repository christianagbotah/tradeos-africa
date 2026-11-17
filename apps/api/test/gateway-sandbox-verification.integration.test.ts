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
    const check=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(url)).toContain("/transactions/123456/verify");
      expect((init?.headers as Record<string,string>).authorization)
        .toBe("Bearer "+KEY.FLUTTERWAVE);
      return check.mock.calls.length===1?
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
});
