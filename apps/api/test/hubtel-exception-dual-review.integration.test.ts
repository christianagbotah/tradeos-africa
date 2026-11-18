import {randomUUID} from "node:crypto";
import {beforeAll,beforeEach,afterAll,describe,expect,it,vi} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
import {startSaleHubtelCheckout,verifySaleHubtelCheckout} from "../src/commerce/hubtel-pos-service.js";
import {reviewSettledHubtelSale} from "../src/commerce/hubtel-pos-settlement-review.js";

process.env.DATABASE_URL??="postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
const app=buildApp(pool);
const previous={
  pos:process.env.TRADEOS_HUBTEL_POS_ENABLED,
  json:process.env.TRADEOS_HUBTEL_POS_CREDENTIALS_JSON,
  platform:process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT,
};
const originalFetch=globalThis.fetch;
beforeAll(async()=>await app.ready());
beforeEach(async()=>{
  process.env.TRADEOS_HUBTEL_POS_ENABLED="true";
  process.env.TRADEOS_HUBTEL_POS_CREDENTIALS_JSON=JSON.stringify({
    test_merchant:{apiId:"test-api-id",apiKey:"test-api-key"},
  });
  process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT="999999";
  await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");
});
afterAll(async()=>{
  globalThis.fetch=originalFetch;
  for(const [key,value] of [
    ["TRADEOS_HUBTEL_POS_ENABLED",previous.pos],
    ["TRADEOS_HUBTEL_POS_CREDENTIALS_JSON",previous.json],
    ["TRADEOS_HUBTEL_COLLECTION_ACCOUNT",previous.platform],
  ] as const){
    if(value===undefined)delete process.env[key];
    else process.env[key]=value;
  }
  await app.close();await pool.end();
});

async function register(tag:string){
  const email="dual-review-"+tag+"@test.tradeos";
  const response=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:tag,email,password:"TradeOS-Test-1234",
      platform:"WEB",deviceKey:"device-"+tag,appVersion:"test"}});
  expect(response.statusCode,response.body).toBe(201);
  const user=(await pool.query<{id:string}>(
    "SELECT id FROM app_users WHERE email=$1",[email])).rows[0]!;
  return {userId:user.id,headers:{
    authorization:"Bearer "+response.json().session.accessToken,
  }};
}
type TestAccount=Awaited<ReturnType<typeof register>>;
async function scenario(tag:string){
  const owner=await register(tag+"-owner");
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers:owner.headers,
    payload:{name:"Test merchant "+tag,businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const {business,branch}=onboard.json() as {business:{id:string};branch:{id:string}};
  await pool.query(
    "INSERT INTO business_hubtel_sales_accounts "+
    "(business_id,collection_account,credential_alias,approval_status,verified_at,enabled) "+
    "VALUES($1,'111111','test_merchant','VERIFIED',now(),true)",
    [business.id]);
  const sale=(await pool.query<{id:string}>(
    "INSERT INTO sales(business_id,branch_id,status,currency_code,total_minor,client_mutation_id) "+
    "VALUES($1,$2,'OPEN','GHS',7000,$3) RETURNING id",
    [business.id,branch.id,randomUUID()])).rows[0]!;
  const payment=(await pool.query<{id:string}>(
    "INSERT INTO payments(business_id,branch_id,sale_id,amount_minor,currency_code,"+
    "method,status,client_mutation_id) "+
    "VALUES($1,$2,$3,7000,'GHS','MOMO','PENDING',$4) RETURNING id",
    [business.id,branch.id,sale.id,randomUUID()])).rows[0]!;
  let reference="";
  let providerStatus:"Paid"|"Refunded"="Paid";
  const fetchMock=vi.fn(async (url:RequestInfo|URL,init?:RequestInit)=>{
    const path=String(url);
    if(path==="https://payproxyapi.hubtel.com/items/initiate"){
      const body=JSON.parse(String(init?.body)) as {clientReference:string};
      reference=body.clientReference;
      return new Response(JSON.stringify({responseCode:"0000",status:"Success",data:{
        clientReference:reference,checkoutId:"7569a11e8b784f21baa9443b3fce31ed",
        checkoutUrl:"https://pay.hubtel.com/7569a11e8b784f21baa9443b3fce31ed",
        checkoutDirectUrl:"https://pay.hubtel.com/7569a11e8b784f21baa9443b3fce31ed/direct",
      }}),{status:200});
    }
    if(path.startsWith("https://api-txnstatus.hubtel.com/")){
      expect(path).toContain("/transactions/111111/status");
      expect(path).toContain("clientReference="+encodeURIComponent(reference));
      return new Response(JSON.stringify({responseCode:"0000",data:{
        clientReference:reference,status:providerStatus,amount:70,
        paymentMethod:"mobilemoney",transactionId:"txn-confirmed-123",
        currencyCode:"GHS",date:"2026-11-18T10:00:00Z",
      }}),{status:200});
    }
    throw new Error("An unapproved live Hubtel operation was attempted");
  });
  globalThis.fetch=fetchMock as unknown as typeof fetch;
  await startSaleHubtelCheckout(pool,{
    businessId:business.id,saleId:sale.id,clientRequestId:randomUUID()});
  expect((await verifySaleHubtelCheckout(pool,{businessId:business.id,saleId:sale.id})).state)
    .toBe("PAID");
  providerStatus="Refunded";
  expect((await reviewSettledHubtelSale(pool,{businessId:business.id,saleId:sale.id}))
    .exceptionKind).toBe("REFUND_REPORTED");
  const exception=(await pool.query<{id:string}>(
    "SELECT id FROM hubtel_pos_settlement_exceptions WHERE sale_id=$1",
    [sale.id])).rows[0]!;
  return {owner,businessId:business.id,branchId:branch.id,
    saleId:sale.id,paymentId:payment.id,exceptionId:exception.id,fetchMock};
}
async function staff(m:{businessId:string},tag:string,role:string){
  const person=await register(tag);
  await pool.query(
    "INSERT INTO business_memberships(business_id,user_id,role,status) "+
    "VALUES($1,$2,$3,'ACTIVE')",[m.businessId,person.userId,role]);
  return person;
}
function url(exceptionId:string,verb:"submit"|"decide"){
  return "/v1/payments/hubtel/exception-cases/"+exceptionId+"/"+verb;
}
function propose(m:{businessId:string;exceptionId:string},revision=0,
  recommendedAction="PROVIDER_INVESTIGATION"){
  return {businessId:m.businessId,expectedRevision:revision,
    recommendedAction,evidenceReference:"HD-CASE-2026-1001",
    note:"Original Hubtel status indicates the refund requires documented investigation."};
}
async function funds(m:{saleId:string;paymentId:string}){
  const state=await pool.query<{
    sale_status:string;payment_status:string;receipt_count:string;
    refund_count:string;return_count:string;
  }>(
    "SELECT s.status AS sale_status,p.status AS payment_status,"+
    "(SELECT count(*)::text FROM cashbook_entries WHERE source_type='PAYMENT' "+
    "AND source_id=p.id) AS receipt_count,"+
    "(SELECT count(*)::text FROM refund_transactions WHERE original_payment_id=p.id) "+
    "AS refund_count,"+
    "(SELECT count(*)::text FROM return_cases WHERE original_sale_id=s.id) "+
    "AS return_count "+
    "FROM sales s JOIN payments p ON p.sale_id=s.id WHERE s.id=$1",
    [m.saleId]);
  return state.rows[0]!;
}
describe("Hubtel exception evidence and dual-control review",()=>{
  it("allows accountant proposal, requires independent owner approval, never moves money",async()=>{
    const m=await scenario("accountant-approval");
    const accountant=await staff(m,"accountant-a","ACCOUNTANT");
    const beforeCalls=m.fetchMock.mock.calls.length;
    const submit=await app.inject({method:"POST",url:url(m.exceptionId,"submit"),
      headers:accountant.headers,payload:propose(m)});
    expect(submit.statusCode,submit.body).toBe(200);
    expect(submit.json().review).toMatchObject({
      status:"AWAITING_APPROVAL",revision:1,
      proposedByUserId:accountant.userId});
    const ownDecision=await app.inject({method:"POST",url:url(m.exceptionId,"decide"),
      headers:accountant.headers,payload:{
        businessId:m.businessId,expectedRevision:1,decision:"APPROVE",
        note:"I independently verified the external provider reference and settlement."}});
    expect(ownDecision.statusCode).toBe(403);
    const approval=await app.inject({method:"POST",url:url(m.exceptionId,"decide"),
      headers:m.owner.headers,payload:{
        businessId:m.businessId,expectedRevision:1,decision:"APPROVE",
        note:"Independent review approved provider investigation; no money was instructed."}});
    expect(approval.statusCode,approval.body).toBe(200);
    expect(approval.json().review).toMatchObject({
      status:"APPROVED_PROVIDER_INVESTIGATION",revision:2});
    expect(m.fetchMock.mock.calls).toHaveLength(beforeCalls);
    expect(await funds(m)).toMatchObject({
      sale_status:"COMPLETED",payment_status:"SUCCEEDED",
      receipt_count:"1",refund_count:"0",return_count:"0"});
    const list=await app.inject({method:"GET",
      url:"/v1/payments/hubtel/exception-cases?businessId="+m.businessId,
      headers:accountant.headers});
    expect(list.statusCode,list.body).toBe(200);
    expect(list.json().cases[0]).toMatchObject({
      exceptionId:m.exceptionId,status:"APPROVED_PROVIDER_INVESTIGATION",
      recommendedAction:"PROVIDER_INVESTIGATION",revision:2});
    expect(list.body).not.toContain("test-api-key");
    expect(list.body).not.toContain("111111");
    const replay=await app.inject({method:"POST",url:url(m.exceptionId,"decide"),
      headers:m.owner.headers,payload:{
        businessId:m.businessId,expectedRevision:1,decision:"APPROVE",
        note:"Independent review has already been completed; must not replay."}});
    expect(replay.statusCode).toBe(409);
    const rows=await pool.query<{count:string}>(
      "SELECT count(*)::text AS count FROM hubtel_pos_exception_review_events "+
      "WHERE business_id=$1",[m.businessId]);
    expect(rows.rows[0]!.count).toBe("2");
  });

  it("blocks same-owner self approval even with the OWNER role",async()=>{
    const m=await scenario("owner-self");
    const submit=await app.inject({method:"POST",url:url(m.exceptionId,"submit"),
      headers:m.owner.headers,payload:propose(m,0,"ACCOUNTING_REVIEW")});
    expect(submit.statusCode,submit.body).toBe(200);
    const forbidden=await app.inject({method:"POST",url:url(m.exceptionId,"decide"),
      headers:m.owner.headers,payload:{businessId:m.businessId,expectedRevision:1,
        decision:"APPROVE",
        note:"An owner cannot sign their own financial exception proposal."}});
    expect(forbidden.statusCode,forbidden.body).toBe(403);
    expect(forbidden.json().error).toBe("HUBTEL_REVIEW_SELF_APPROVAL_FORBIDDEN");
    const admin=await staff(m,"second-admin","ADMIN");
    const approved=await app.inject({method:"POST",url:url(m.exceptionId,"decide"),
      headers:admin.headers,payload:{businessId:m.businessId,expectedRevision:1,
        decision:"APPROVE",
        note:"Second independent administrator authorizes investigation only."}});
    expect(approved.statusCode,approved.body).toBe(200);
    expect(approved.json().review.status).toBe("APPROVED_ACCOUNTING_REVIEW");
    expect(await funds(m)).toMatchObject({
      sale_status:"COMPLETED",payment_status:"SUCCEEDED",
      receipt_count:"1",refund_count:"0",return_count:"0"});
  });

  it("returns a proposal for more evidence and enforces version and role gates",async()=>{
    const m=await scenario("return-revise");
    const manager=await staff(m,"case-manager","MANAGER");
    const cashier=await staff(m,"case-cashier","CASHIER");
    const forbidden=await app.inject({method:"POST",url:url(m.exceptionId,"submit"),
      headers:cashier.headers,payload:propose(m)});
    expect(forbidden.statusCode).toBe(403);
    const submitted=await app.inject({method:"POST",url:url(m.exceptionId,"submit"),
      headers:manager.headers,payload:propose(m)});
    expect(submitted.statusCode,submitted.body).toBe(200);
    const duplicate=await app.inject({method:"POST",url:url(m.exceptionId,"submit"),
      headers:manager.headers,payload:propose(m)});
    expect(duplicate.statusCode).toBe(409);
    const returned=await app.inject({method:"POST",url:url(m.exceptionId,"decide"),
      headers:m.owner.headers,payload:{businessId:m.businessId,expectedRevision:1,
        decision:"RETURN",
        note:"Evidence is incomplete; obtain the official Hubtel support case response."}});
    expect(returned.statusCode,returned.body).toBe(200);
    expect(returned.json().review).toMatchObject({status:"OPEN",revision:2});
    const stale=await app.inject({method:"POST",url:url(m.exceptionId,"submit"),
      headers:manager.headers,payload:propose(m,1)});
    expect(stale.statusCode).toBe(409);
    const resubmit=await app.inject({method:"POST",url:url(m.exceptionId,"submit"),
      headers:manager.headers,payload:propose(m,2,"ACCOUNTING_REVIEW")});
    expect(resubmit.statusCode,resubmit.body).toBe(200);
    expect(resubmit.json().review).toMatchObject({
      status:"AWAITING_APPROVAL",revision:3});
    const events=await pool.query<{action:string;case_revision:number}>(
      "SELECT action,case_revision FROM hubtel_pos_exception_review_events "+
      "WHERE business_id=$1 ORDER BY case_revision",[m.businessId]);
    expect(events.rows.map(r=>r.action)).toEqual(["SUBMITTED","RETURNED","SUBMITTED"]);
    expect(events.rows.map(r=>r.case_revision)).toEqual([1,2,3]);
    await expect(pool.query(
      "DELETE FROM hubtel_pos_exception_review_events WHERE business_id=$1",
      [m.businessId])).rejects.toMatchObject({code:"P0001"});
  });

  it("rejects cross-tenant forged review and DB case ownership",async()=>{
    const m=await scenario("tenant-original");
    const foreign=await register("other-tenant");
    const forged=await app.inject({method:"POST",url:url(m.exceptionId,"submit"),
      headers:foreign.headers,payload:propose(m)});
    expect(forged.statusCode).toBe(403);
    const attackerBusiness=await app.inject({method:"POST",url:"/v1/onboarding/business",
      headers:foreign.headers,
      payload:{name:"Unrelated",businessType:"RETAIL_HARDWARE",branchName:"Main"}});
    expect(attackerBusiness.statusCode,attackerBusiness.body).toBe(201);
    const otherId=attackerBusiness.json().business.id as string;
    const otherBranch=attackerBusiness.json().branch.id as string;
    await expect(pool.query(
      "INSERT INTO hubtel_pos_exception_review_cases "+
      "(exception_id,business_id,branch_id,status) VALUES($1,$2,$3,'OPEN')",
      [m.exceptionId,otherId,otherBranch],
    )).rejects.toMatchObject({code:"P0001"});
    const otherList=await app.inject({method:"GET",
      url:"/v1/payments/hubtel/exception-cases?businessId="+otherId,
      headers:foreign.headers});
    expect(otherList.statusCode,otherList.body).toBe(200);
    expect(otherList.json().cases).toHaveLength(0);
    expect(await funds(m)).toMatchObject({
      sale_status:"COMPLETED",payment_status:"SUCCEEDED",receipt_count:"1"});
  });
});
