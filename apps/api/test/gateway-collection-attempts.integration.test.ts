import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
import {
  prepareTestGatewayAttempt,listGatewayTestAttempts,closeTestGatewayAttempt,
} from "../src/payment-providers/attempts.js";

// Tests mutate money tables. NEVER run against VPS production/staging.
const url=process.env.DATABASE_URL??
  "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
if(!url.endsWith("/tradeos_ci")||
   !/(@127\.0\.0\.1:5432|@localhost:5432)/.test(url))
  throw new Error("Gateway ledger tests require isolated local tradeos_ci database");
process.env.DATABASE_URL=url;
const pool=createPool(),app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
afterAll(async()=>{await app.close();await pool.end();});

async function merchant(name:string){
  const tag=randomUUID();
  const signup=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"Gateway Test Owner",
      email:"attempt-"+tag+"@example.test",
      password:"TradeOS-Test-1234",platform:"WEB",
      deviceKey:"test-"+tag,appVersion:"test"}});
  expect(signup.statusCode,signup.body).toBe(201);
  const headers={authorization:"Bearer "+signup.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:"Merchant "+name,
      businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const branchId=onboard.json().branch.id as string;
  const userId=(await pool.query<{user_id:string}>(
    "SELECT user_id FROM business_memberships "+
    "WHERE business_id=$1 AND role='OWNER'",[businessId])).rows[0]!.user_id;
  await pool.query(
    "INSERT INTO business_payment_gateway_preferences "+
    "(business_id,provider_code,changed_by_user_id) VALUES($1,'PAYSTACK',$2)",
    [businessId,userId]);
  await pool.query(
    "INSERT INTO business_gateway_connections "+
    "(business_id,provider_code,encrypted_secret,nonce,auth_tag,changed_by_user_id) "+
    "VALUES($1,'PAYSTACK',$2,$3,$4,$5)",
    [businessId,Buffer.from("fake-encrypted-test-credential"),
      Buffer.alloc(12,10),Buffer.alloc(16,11),userId]);
  return {businessId,branchId,headers,userId};
}
async function sale(m:{businessId:string;branchId:string},amount=8500){
  const tag=randomUUID();
  const saleId=(await pool.query<{id:string}>(
    "INSERT INTO sales(business_id,branch_id,status,currency_code,total_minor,"+
    "client_mutation_id) VALUES($1,$2,'OPEN','GHS',$3,$4) RETURNING id",
    [m.businessId,m.branchId,amount,"attempt-sale-"+tag])).rows[0]!.id;
  const paymentId=(await pool.query<{id:string}>(
    "INSERT INTO payments(business_id,branch_id,sale_id,amount_minor,"+
    "currency_code,method,status,client_mutation_id) "+
    "VALUES($1,$2,$3,$4,'GHS','MOMO','PENDING',$5) RETURNING id",
    [m.businessId,m.branchId,saleId,amount,"attempt-payment-"+tag])).rows[0]!.id;
  return {saleId,paymentId};
}

describe("provider-neutral TEST collection attempt ledger",()=>{
  it("creates no charges, deduplicates same client request and locks original provider",async()=>{
    const a=await merchant("one");
    const b=await merchant("two");
    const {saleId,paymentId}=await sale(a);
    const request={businessId:a.businessId,saleId,clientRequestId:randomUUID()};
    const prepared=await prepareTestGatewayAttempt(pool,request);
    expect(prepared).toMatchObject({
      replayed:false,charged:false,
      attempt:{providerCode:"PAYSTACK",environment:"TEST",state:"PREPARED",
        expectedAmountMinor:"8500",currencyCode:"GHS",paymentMethod:"MOMO",
        saleId,paymentId,businessId:a.businessId},
    });
    expect(prepared.attempt.clientReference).toMatch(/^TSP-[0-9a-f]{24}$/);
    const again=await prepareTestGatewayAttempt(pool,request);
    expect(again).toMatchObject({replayed:true,charged:false});
    expect(again.attempt.attemptId).toBe(prepared.attempt.attemptId);
    await expect(prepareTestGatewayAttempt(pool,{
      ...request,clientRequestId:randomUUID(),
    })).rejects.toMatchObject({code:"GATEWAY_ATTEMPT_ALREADY_EXISTS",
      statusCode:409});
    expect((await pool.query<{c:string}>(
      "SELECT count(*)::text AS c FROM gateway_collection_attempts "+
      "WHERE business_id=$1",[a.businessId])).rows[0]!.c).toBe("1");

    // Provider selection can change, but this existing intent stays bound
    // to its original merchant and provider.
    await pool.query(
      "UPDATE business_payment_gateway_preferences SET provider_code='FLUTTERWAVE' "+
      "WHERE business_id=$1",[a.businessId]);
    const read=await listGatewayTestAttempts(pool,{businessId:a.businessId});
    expect(read).toMatchObject({collectionEnabled:false,
      summary:{prepared:1,cancelled:0,reviewRequired:0},
      attempts:[{providerCode:"PAYSTACK",state:"PREPARED"}]});
    const payment=(await pool.query<{status:string}>(
      "SELECT status FROM payments WHERE id=$1",[paymentId])).rows[0]!;
    expect(payment.status).toBe("PENDING");
    const saleRecord=(await pool.query<{status:string}>(
      "SELECT status FROM sales WHERE id=$1",[saleId])).rows[0]!;
    expect(saleRecord.status).toBe("OPEN");
    const receipts=(await pool.query<{c:string}>(
      "SELECT count(*)::text AS c FROM cashbook_entries "+
      "WHERE source_type='PAYMENT' AND source_id=$1",[paymentId])).rows[0]!;
    expect(receipts.c).toBe("0");

    // Foreign tenants never read each other's references.
    const endpoint="/v1/businesses/"+a.businessId+"/payment-gateways/attempts";
    expect((await app.inject({method:"GET",url:endpoint})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:endpoint,
      headers:b.headers})).statusCode).toBe(403);
    const ownerRead=await app.inject({method:"GET",url:endpoint,headers:a.headers});
    expect(ownerRead.statusCode,ownerRead.body).toBe(200);
    expect(ownerRead.json().attempts).toHaveLength(1);
    expect(ownerRead.body).not.toContain("encrypted_secret");
    expect(ownerRead.body).not.toContain("checkoutUrl");
    const bRead=await app.inject({method:"GET",
      url:"/v1/businesses/"+b.businessId+"/payment-gateways/attempts",
      headers:b.headers});
    expect(bRead.json().attempts).toHaveLength(0);
    const review=await closeTestGatewayAttempt(pool,{
      businessId:a.businessId,attemptId:prepared.attempt.attemptId,
      decision:"REVIEW_REQUIRED",reasonCode:"MANUAL_SANDBOX_REVIEW"});
    expect(review).toMatchObject({replayed:false,charged:false,
      attempt:{state:"REVIEW_REQUIRED"}});
    const reviewReplay=await closeTestGatewayAttempt(pool,{
      businessId:a.businessId,attemptId:prepared.attempt.attemptId,
      decision:"REVIEW_REQUIRED",reasonCode:"MANUAL_SANDBOX_REVIEW"});
    expect(reviewReplay.replayed).toBe(true);
    await expect(closeTestGatewayAttempt(pool,{
      businessId:a.businessId,attemptId:prepared.attempt.attemptId,
      decision:"CANCELLED",reasonCode:"DUPLICATE"})).rejects.toMatchObject({
        code:"GATEWAY_ATTEMPT_ALREADY_CLOSED"});
    expect((await listGatewayTestAttempts(pool,{businessId:a.businessId}))
      .summary.reviewRequired).toBe(1);
    const events=(await pool.query<{event_type:string}>(
      "SELECT event_type FROM gateway_collection_attempt_events "+
      "WHERE attempt_id=$1 ORDER BY event_time",
      [prepared.attempt.attemptId])).rows.map(x=>x.event_type);
    expect(events).toEqual(["PREPARED","FLAGGED_FOR_REVIEW"]);


    await expect(prepareTestGatewayAttempt(pool,{
      businessId:b.businessId,saleId,clientRequestId:randomUUID(),
    })).rejects.toMatchObject({code:"GATEWAY_ATTEMPT_SALE_NOT_FOUND"});

    // The database rejects internal reassignment and cross-tenant events.
    await expect(pool.query(
      "UPDATE gateway_collection_attempts SET provider_code='FLUTTERWAVE' "+
      "WHERE id=$1",[prepared.attempt.attemptId])).rejects.toThrow();
    await expect(pool.query(
      "INSERT INTO gateway_collection_attempt_events "+
      "(attempt_id,business_id,event_type) VALUES($1,$2,'PREPARED')",
      [prepared.attempt.attemptId,b.businessId])).rejects.toThrow();
    await expect(pool.query(
      "DELETE FROM gateway_collection_attempt_events WHERE attempt_id=$1",
      [prepared.attempt.attemptId])).rejects.toThrow();
    await expect(pool.query(
      "INSERT INTO gateway_collection_attempts "+
      "(business_id,branch_id,sale_id,payment_id,provider_code,"+
      "merchant_connection_revision,client_request_id,client_reference,"+
      "expected_amount_minor,currency_code,payment_method) "+
      "VALUES($1,$2,$3,$4,'PAYSTACK',1,$5,$6,8500,'GHS','MOMO')",
      [b.businessId,b.branchId,saleId,paymentId,randomUUID(),
        "TSP-00112233445566778899aabb"])).rejects.toThrow();
  });

  it("refuses mismatched monetary snapshots, ineligible sales and reused request keys",async()=>{
    const m=await merchant("invalid");
    const {saleId,paymentId}=await sale(m);
    const request={businessId:m.businessId,saleId,clientRequestId:randomUUID()};
    await pool.query("UPDATE payments SET amount_minor=8400 WHERE id=$1",[paymentId]);
    await expect(prepareTestGatewayAttempt(pool,request)).rejects.toMatchObject({
      code:"GATEWAY_ATTEMPT_SALE_NOT_COLLECTIBLE"});
    await pool.query("UPDATE payments SET amount_minor=8500 WHERE id=$1",[paymentId]);
    const accepted=await prepareTestGatewayAttempt(pool,request);
    const next=await sale(m);
    await expect(prepareTestGatewayAttempt(pool,{
      businessId:m.businessId,saleId:next.saleId,
      clientRequestId:request.clientRequestId,
    })).rejects.toMatchObject({code:"GATEWAY_ATTEMPT_UNIQUE_CONFLICT"});
    await pool.query("UPDATE sales SET status='VOIDED' WHERE id=$1",[next.saleId]);
    await expect(prepareTestGatewayAttempt(pool,{
      businessId:m.businessId,saleId:next.saleId,clientRequestId:randomUUID(),
    })).rejects.toMatchObject({code:"GATEWAY_ATTEMPT_SALE_NOT_COLLECTIBLE"});
    expect(accepted.attempt.state).toBe("PREPARED");
  });
});
