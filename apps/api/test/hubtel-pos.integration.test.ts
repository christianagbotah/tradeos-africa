import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
import {
  startSaleHubtelCheckout,verifySaleHubtelCheckout,
  getHubtelPosReadiness,
} from "../src/commerce/hubtel-pos-service.js";
import {applySaleMutation} from "../src/commerce/sales.js";
import { runHubtelPosReconciliationTick } from "../src/commerce/hubtel-pos-reconciliation-scheduler.js";

process.env.DATABASE_URL??="postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
const app=buildApp(pool);
const saved={
  enabled:process.env.TRADEOS_HUBTEL_POS_ENABLED,
  json:process.env.TRADEOS_HUBTEL_POS_CREDENTIALS_JSON,
  platform:process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT,
};
const originalFetch=globalThis.fetch;
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{
  process.env.TRADEOS_HUBTEL_POS_ENABLED="true";
  process.env.TRADEOS_HUBTEL_POS_CREDENTIALS_JSON=JSON.stringify({
    merchant_1:{apiId:"merchant-test-id",apiKey:"merchant-test-secret"},
    merchant_2:{apiId:"other-merchant-id",apiKey:"other-merchant-secret"},
  });
  process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT="999999";
  globalThis.fetch=originalFetch;
  await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");
});
afterAll(async()=>{
  globalThis.fetch=originalFetch;
  if(saved.enabled===undefined)delete process.env.TRADEOS_HUBTEL_POS_ENABLED;
  else process.env.TRADEOS_HUBTEL_POS_ENABLED=saved.enabled;
  if(saved.json===undefined)delete process.env.TRADEOS_HUBTEL_POS_CREDENTIALS_JSON;
  else process.env.TRADEOS_HUBTEL_POS_CREDENTIALS_JSON=saved.json;
  if(saved.platform===undefined)delete process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT;
  else process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT=saved.platform;
  await app.close();await pool.end();
});

async function merchant(tag:string,alias:string,account:string){
  const registered=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:"Test Sale Merchant",email:"hubtel-pos-"+tag+"@test.tradeos",
    password:"TradeOS-Test-1234",platform:"WEB",deviceKey:"test-"+tag,appVersion:"test",
  }});
  expect(registered.statusCode,registered.body).toBe(201);
  const headers={authorization:"Bearer "+registered.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:"Merchant "+tag,businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const branchId=onboard.json().branch.id as string;
  await pool.query(
    "INSERT INTO business_hubtel_sales_accounts "+
    "(business_id,collection_account,credential_alias,approval_status,verified_at,enabled) "+
    "VALUES($1,$2,$3,'VERIFIED',now(),true)",[businessId,account,alias]);
  const saleId=(await pool.query<{id:string}>(
    "INSERT INTO sales(business_id,branch_id,status,currency_code,total_minor,"+
    "client_mutation_id) VALUES($1,$2,'OPEN','GHS',7000,$3) RETURNING id",
    [businessId,branchId,"pos-sale-"+tag])).rows[0]!.id;
  const paymentId=(await pool.query<{id:string}>(
    "INSERT INTO payments(business_id,branch_id,sale_id,amount_minor,"+
    "currency_code,method,status,client_mutation_id) "+
    "VALUES($1,$2,$3,7000,'GHS','MOMO','PENDING',$4) RETURNING id",
    [businessId,branchId,saleId,"pos-payment-"+tag])).rows[0]!.id;
  return {businessId,branchId,saleId,paymentId,headers};
}
type Merchant=Awaited<ReturnType<typeof merchant>>;
function installMock(account="111111",status:"Paid"|"Unpaid"="Paid",amount=70,
  paymentMethod:"mobilemoney"|"card"="mobilemoney"){
  let reference="";
  const request=vi.fn(async (url:RequestInfo|URL,init?:RequestInit)=>{
    const uri=String(url);
    if(uri==="https://payproxyapi.hubtel.com/items/initiate"){
      const input=JSON.parse(String(init?.body)) as {merchantAccountNumber:string;
        clientReference:string;totalAmount:number;callbackUrl:string};
      expect(input.merchantAccountNumber).toBe(account);
      expect(input.totalAmount).toBe(70);
      expect(input.callbackUrl).toContain("/v1/payments/hubtel/notifications");
      reference=input.clientReference;
      return new Response(JSON.stringify({responseCode:"0000",status:"Success",data:{
        clientReference:reference,checkoutId:"7569a11e8b784f21baa9443b3fce31ed",
        checkoutUrl:"https://pay.hubtel.com/7569a11e8b784f21baa9443b3fce31ed",
        checkoutDirectUrl:"https://pay.hubtel.com/7569a11e8b784f21baa9443b3fce31ed/direct",
      }}),{status:200});
    }
    if(uri.startsWith("https://api-txnstatus.hubtel.com/")){
      expect(uri).toContain("/transactions/"+account+"/status");
      expect(uri).toContain("clientReference="+encodeURIComponent(reference));
      return new Response(JSON.stringify({responseCode:"0000",data:{
        clientReference:reference,status,amount,paymentMethod,
        transactionId:status==="Paid"?"txn-confirmed-123":null,
        currencyCode:"GHS",date:"2026-11-15T11:00:00Z",
      }}),{status:200});
    }
    throw new Error("Unexpected request");
  });
  globalThis.fetch=request as unknown as typeof fetch;
  return request;
}
async function ledger(merchant:Merchant){
  const row=(await pool.query<{status:string;payment_status:string;
    receipt_count:string;amount:string;attempt_state:string}>(
    "SELECT s.status,p.status AS payment_status,"+
    "(SELECT count(*)::text FROM cashbook_entries c WHERE c.source_type='PAYMENT' AND c.source_id=p.id) AS receipt_count,"+
    "(SELECT coalesce(sum(amount_delta_minor),0)::text FROM cashbook_entries c "+
    "WHERE c.source_type='PAYMENT' AND c.source_id=p.id) AS amount,"+
    "(SELECT state FROM hubtel_sale_checkout_attempts a WHERE a.payment_id=p.id) AS attempt_state "+
    "FROM sales s JOIN payments p ON p.sale_id=s.id WHERE s.id=$1",
    [merchant.saleId])).rows[0]!;
  return row;
}

describe("Hubtel multi-tenant POS safety",()=>{
  it("returns disabled by default and does not create a pending sale",async()=>{
    process.env.TRADEOS_HUBTEL_POS_ENABLED="false";
    const m=await merchant("disabled","merchant_1","111111");
    const ready=await getHubtelPosReadiness(pool,m.businessId);
    expect(ready.enabled).toBe(false);
    await expect(startSaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,clientRequestId:randomUUID(),
    })).rejects.toMatchObject({code:"HUBTEL_POS_DISABLED"});
    expect((await ledger(m)).receipt_count).toBe("0");
    await expect(applySaleMutation(pool,{businessId:m.businessId,branchId:m.branchId,
      clientMutationId:randomUUID(),occurredAt:new Date().toISOString()},
      {paymentProvider:"HUBTEL",paymentMethod:"MOMO",
        lines:[{itemId:randomUUID(),quantity:1,saleUnitCode:"pcs"}]},
    )).rejects.toMatchObject({code:"HUBTEL_POS_DISABLED"});
  });
  it("keeps POS sale unpaid until independent status; idempotently posts one cashbook receipt",async()=>{
    const m=await merchant("verified","merchant_1","111111");
    const b=await merchant("other","merchant_2","222222");
    const fetchMock=installMock();
    const forged=await app.inject({method:"POST",
      url:"/v1/sales/"+m.saleId+"/hubtel/checkout",headers:b.headers,
      payload:{businessId:m.businessId,clientRequestId:randomUUID()}});
    expect(forged.statusCode).toBe(403);
    const first=await app.inject({method:"POST",
      url:"/v1/sales/"+m.saleId+"/hubtel/checkout",headers:m.headers,
      payload:{businessId:m.businessId,clientRequestId:randomUUID()}});
    expect(first.statusCode,first.body).toBe(200);
    const saleCheckout=first.json().checkout as {state:string;checkoutUrl:string};
    expect(saleCheckout.state).toBe("READY");
    expect(saleCheckout.checkoutUrl).toContain("https://pay.hubtel.com/");
    const source=(await pool.query<{credential_source:string;
      merchant_credential_revision:number|null}>(
      "SELECT credential_source,merchant_credential_revision "+
      "FROM hubtel_sale_checkout_attempts WHERE sale_id=$1",
      [m.saleId])).rows[0];
    expect(source).toMatchObject({credential_source:"PLATFORM_ALIAS",
      merchant_credential_revision:null});
    await expect(pool.query(
      "UPDATE hubtel_sale_checkout_attempts "+
      "SET credential_source='MERCHANT_VAULT',merchant_credential_revision=1 "+
      "WHERE sale_id=$1",[m.saleId])).rejects.toThrow();
    expect(await ledger(m)).toMatchObject({
      status:"OPEN",payment_status:"PENDING",receipt_count:"0",
    });
    const retry=await app.inject({method:"POST",
      url:"/v1/sales/"+m.saleId+"/hubtel/checkout",headers:m.headers,
      payload:{businessId:m.businessId,clientRequestId:randomUUID()}});
    expect(retry.statusCode).toBe(200);
    expect(retry.json().checkout.attemptId).toBe(first.json().checkout.attemptId);
    expect(fetchMock.mock.calls.filter(call=>String(call[0]).includes("/items/initiate"))).toHaveLength(1);
    const fakeCallback=await app.inject({method:"POST",
      url:"/v1/payments/hubtel/notifications",payload:{
        ResponseCode:"0000",Data:{ClientReference:"fraud",Amount:7000}}});
    expect(fakeCallback.statusCode).toBe(202);
    expect((await ledger(m)).receipt_count).toBe("0");
    const forgedVerify=await app.inject({method:"POST",
      url:"/v1/sales/"+m.saleId+"/hubtel/verify",headers:b.headers,
      payload:{businessId:m.businessId}});
    expect(forgedVerify.statusCode).toBe(403);
    const verified=await app.inject({method:"POST",
      url:"/v1/sales/"+m.saleId+"/hubtel/verify",headers:m.headers,
      payload:{businessId:m.businessId}});
    expect(verified.statusCode,verified.body).toBe(200);
    expect(verified.json().result.state).toBe("PAID");
    expect(await ledger(m)).toMatchObject({
      status:"COMPLETED",payment_status:"SUCCEEDED",receipt_count:"1",
      amount:"7000",attempt_state:"RECONCILED",
    });
    const repeat=await app.inject({method:"POST",
      url:"/v1/sales/"+m.saleId+"/hubtel/verify",headers:m.headers,
      payload:{businessId:m.businessId}});
    expect(repeat.statusCode).toBe(200);
    expect((await ledger(m)).receipt_count).toBe("1");
    expect((await ledger(b)).receipt_count).toBe("0");
  });
  it("keeps a Hubtel card sale unpaid until independent status verification",async()=>{
    const m=await merchant("card-payment","merchant_1","111111");
    await pool.query("UPDATE payments SET method='CARD' WHERE id=$1",[m.paymentId]);
    installMock("111111","Paid",70,"card");
    const created=await startSaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,clientRequestId:randomUUID(),
    });
    expect(created.state).toBe("READY");
    expect(await ledger(m)).toMatchObject({
      status:"OPEN",payment_status:"PENDING",receipt_count:"0",
    });
    const result=await verifySaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,
    });
    expect(result.state).toBe("PAID");
    expect(await ledger(m)).toMatchObject({
      status:"COMPLETED",payment_status:"SUCCEEDED",
      receipt_count:"1",amount:"7000",attempt_state:"RECONCILED",
    });
    const entry=(await pool.query<{method:string}>(
      "SELECT method FROM cashbook_entries WHERE business_id=$1 "+
      "AND source_type='PAYMENT' AND source_id=$2",
      [m.businessId,m.paymentId])).rows[0];
    expect(entry?.method).toBe("CARD");
  });
  it("rejects card-labelled sales that actually use MoMo on Hubtel",async()=>{
    const m=await merchant("card-method-mismatch","merchant_1","111111");
    await pool.query("UPDATE payments SET method='CARD' WHERE id=$1",[m.paymentId]);
    installMock("111111","Paid",70,"mobilemoney");
    await startSaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,clientRequestId:randomUUID(),
    });
    await expect(verifySaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,
    })).rejects.toMatchObject({code:"HUBTEL_POS_PAYMENT_METHOD_MISMATCH"});
    expect(await ledger(m)).toMatchObject({
      status:"OPEN",payment_status:"PENDING",receipt_count:"0",
    });
  });
  it("refuses mismatched amounts without crediting the cashbook",async()=>{
    const m=await merchant("mismatch","merchant_1","111111");
    installMock("111111","Paid",69.99);
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    await expect(verifySaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,
    })).rejects.toMatchObject({code:"HUBTEL_STATUS_AMOUNT_MISMATCH"});
    expect(await ledger(m)).toMatchObject({status:"OPEN",
      payment_status:"PENDING",receipt_count:"0"});
  });
  it("does not convert Unpaid status to a sale receipt",async()=>{
    const m=await merchant("unpaid","merchant_1","111111");
    installMock("111111","Unpaid");
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    const result=await verifySaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,
    });
    expect(result.state).toBe("UNPAID");
    expect(await ledger(m)).toMatchObject({status:"OPEN",
      payment_status:"PENDING",receipt_count:"0",attempt_state:"PENDING_VERIFICATION"});
  });
  it("enforces a single collection account per tenant and rejects cross-scope attempts",async()=>{
    const a=await merchant("scope-a","merchant_1","111111");
    const b=await merchant("scope-b","merchant_2","222222");
    await expect(pool.query(
      "INSERT INTO business_hubtel_sales_accounts "+
      "(business_id,collection_account,credential_alias) VALUES($1,'111111','duplicate_account')",
      [b.businessId])).rejects.toMatchObject({code:"23505"});
    await expect(pool.query(
      "INSERT INTO hubtel_sale_checkout_attempts "+
      "(business_id,branch_id,sale_id,payment_id,client_request_id,"+
      "client_reference,merchant_collection_account,expected_amount_minor,currency_code) "+
      "VALUES($1,$2,$3,$4,$5,'TSP-1234567890ABCDEF','111111',7000,'GHS')",
      [a.businessId,b.branchId,b.saleId,b.paymentId,randomUUID()],
    )).rejects.toMatchObject({code:"P0001"});
  });
});

describe("Hubtel provider switch preserves original payment ownership",()=>{
  it("rejects new direct Hubtel checkout requests when Paystack is selected",async()=>{
    const tag="provider-switch-no-new";
    const m=await merchant(tag,"merchant_1","111111");
    const calls=installMock();
    await pool.query(
      "INSERT INTO business_payment_gateway_preferences " +
      "(business_id,provider_code,changed_by_user_id) " +
      "SELECT $1,'PAYSTACK',id FROM app_users WHERE email=$2",
      [m.businessId,"hubtel-pos-"+tag+"@test.tradeos"],
    );
    const readiness=await getHubtelPosReadiness(pool,m.businessId);
    expect(readiness).toMatchObject({enabled:false,existingCheckoutEnabled:true,
      preferredProvider:"PAYSTACK"});
    const forbidden=await app.inject({method:"POST",
      url:"/v1/sales/"+m.saleId+"/hubtel/checkout",
      headers:m.headers,payload:{businessId:m.businessId,clientRequestId:randomUUID()}});
    expect(forbidden.statusCode,forbidden.body).toBe(409);
    expect(forbidden.json().error).toBe("PAYMENT_PROVIDER_NOT_SELECTED");
    expect(calls).not.toHaveBeenCalled();
    expect(await ledger(m)).toMatchObject({status:"OPEN",payment_status:"PENDING",
      receipt_count:"0",attempt_state:null});
  });

  it("still verifies the original Hubtel checkout after switching to Paystack",async()=>{
    const tag="provider-switch-old";
    const m=await merchant(tag,"merchant_1","111111");
    const calls=installMock();
    const checkout=await startSaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,clientRequestId:randomUUID()});
    expect(checkout.state).toBe("READY");
    await pool.query(
      "INSERT INTO business_payment_gateway_preferences " +
      "(business_id,provider_code,changed_by_user_id) " +
      "SELECT $1,'PAYSTACK',id FROM app_users WHERE email=$2",
      [m.businessId,"hubtel-pos-"+tag+"@test.tradeos"],
    );
    const readiness=await getHubtelPosReadiness(pool,m.businessId);
    expect(readiness).toMatchObject({enabled:false,existingCheckoutEnabled:true,
      preferredProvider:"PAYSTACK"});
    const verified=await verifySaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId});
    expect(verified.state).toBe("PAID");
    expect(await ledger(m)).toMatchObject({status:"COMPLETED",
      payment_status:"SUCCEEDED",receipt_count:"1",attempt_state:"RECONCILED"});
    expect(calls).toHaveBeenCalledTimes(2);
  });
});

describe("Hubtel five-minute reconciliation worker and merchant monitoring",()=>{
  it("does not check a checkout before five minutes, then settles confirmed payment once",async()=>{
    const m=await merchant("reconciler-paid","merchant_1","111111");
    installMock();
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    const early=await runHubtelPosReconciliationTick(pool);
    expect(early).toMatchObject({enabled:true,acquired:true,attempted:0});
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts SET created_at=now()-interval '6 minutes' "+
      "WHERE sale_id=$1",[m.saleId]);
    const tick=await runHubtelPosReconciliationTick(pool);
    expect(tick).toMatchObject({attempted:1,paid:1,failed:0});
    expect(await ledger(m)).toMatchObject({status:"COMPLETED",payment_status:"SUCCEEDED",
      receipt_count:"1",attempt_state:"RECONCILED"});
    const duplicate=await runHubtelPosReconciliationTick(pool);
    expect(duplicate.attempted).toBe(0);
    expect((await ledger(m)).receipt_count).toBe("1");
  });

  it("holds stock and cashbook on repeated unpaid results and supports late verified payment",async()=>{
    const m=await merchant("reconciler-unpaid","merchant_1","111111");
    installMock("111111","Unpaid");
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts SET created_at=now()-interval '6 minutes' "+
      "WHERE sale_id=$1",[m.saleId]);
    const first=await runHubtelPosReconciliationTick(pool);
    expect(first).toMatchObject({attempted:1,unpaid:1,reviewRequired:0});
    const next=await pool.query<{next_status_check_at:Date;status_check_attempts:number}>(
      "SELECT next_status_check_at,status_check_attempts FROM hubtel_sale_checkout_attempts WHERE sale_id=$1",
      [m.saleId]);
    expect(next.rows[0]!.status_check_attempts).toBe(1);
    expect(next.rows[0]!.next_status_check_at.getTime()).toBeGreaterThan(Date.now()+4*60_000);
    expect((await runHubtelPosReconciliationTick(pool)).attempted).toBe(0);
    const muchLater=new Date(Date.now()+25*60*60_000);
    const stale=await runHubtelPosReconciliationTick(pool,{now:()=>muchLater});
    expect(stale).toMatchObject({attempted:1,reviewRequired:1});
    expect(await ledger(m)).toMatchObject({status:"OPEN",payment_status:"PENDING",
      receipt_count:"0",attempt_state:"REVIEW_REQUIRED"});
    const ref=(await pool.query<{client_reference:string}>(
      "SELECT client_reference FROM hubtel_sale_checkout_attempts WHERE sale_id=$1",
      [m.saleId])).rows[0]!.client_reference;
    globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify({
      responseCode:"0000",data:{clientReference:ref,status:"Paid",amount:70,
        paymentMethod:"mobilemoney",currencyCode:"GHS",
        transactionId:"late-confirmed-transaction",date:new Date().toISOString()},
    }),{status:200})) as unknown as typeof fetch;
    const recovered=await verifySaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId});
    expect(recovered.state).toBe("PAID");
    expect(await ledger(m)).toMatchObject({status:"COMPLETED",payment_status:"SUCCEEDED",
      receipt_count:"1",attempt_state:"RECONCILED"});
    const audits=await pool.query<{count:string}>(
      "SELECT COUNT(*)::text AS count FROM audit_events WHERE business_id=$1 AND "+
      "entity_id=$2 AND event_type='HUBTEL_POS_RECONCILIATION_REVIEW_REQUIRED'",
      [m.businessId,m.saleId]);
    expect(audits.rows[0]?.count).toBe("1");
  });

  it("requires manual review for HTTP 403 provider failures without settling checkout",async()=>{
    const m=await merchant("reconciler-403","merchant_1","111111");
    installMock();
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts SET created_at=now()-interval '6 minutes' "+
      "WHERE sale_id=$1",[m.saleId]);
    globalThis.fetch=vi.fn(async()=>new Response("",{status:403})) as unknown as typeof fetch;
    const failed=await runHubtelPosReconciliationTick(pool);
    expect(failed).toMatchObject({attempted:1,failed:1,reviewRequired:1});
    const attempt=await pool.query<{
      state:string;last_status_error_code:string;next_status_check_at:Date|null;
    }>(
      "SELECT state,last_status_error_code,next_status_check_at "+
      "FROM hubtel_sale_checkout_attempts WHERE sale_id=$1",[m.saleId]);
    expect(attempt.rows[0]?.state).toBe("REVIEW_REQUIRED");
    expect(attempt.rows[0]?.last_status_error_code).toBe("HUBTEL_STATUS_ACCESS_DENIED");
    expect(attempt.rows[0]?.next_status_check_at).toBeNull();
    expect((await ledger(m)).receipt_count).toBe("0");
  });

  it("marks a stalled PREPARED request for manual review without releasing its sale",async()=>{
    const m=await merchant("reconciler-prepared","merchant_1","111111");
    globalThis.fetch=vi.fn(async()=>{throw new Error("Network uncertain");}) as unknown as typeof fetch;
    await expect(startSaleHubtelCheckout(pool,{businessId:m.businessId,
      saleId:m.saleId,clientRequestId:randomUUID()})).rejects.toBeTruthy();
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts SET created_at=now()-interval '16 minutes' "+
      "WHERE sale_id=$1",[m.saleId]);
    const tick=await runHubtelPosReconciliationTick(pool);
    expect(tick).toMatchObject({attempted:1,reviewRequired:1});
    expect(await ledger(m)).toMatchObject({status:"OPEN",payment_status:"PENDING",
      receipt_count:"0",attempt_state:"REVIEW_REQUIRED"});
  });

  it("does not expose another tenant's reconciliation data or merchant credentials",async()=>{
    const a=await merchant("monitor-a","merchant_1","111111");
    const b=await merchant("monitor-b","merchant_2","222222");
    installMock();
    await startSaleHubtelCheckout(pool,{businessId:a.businessId,saleId:a.saleId,
      clientRequestId:randomUUID()});
    const other=await app.inject({method:"GET",
      url:`/v1/payments/hubtel/reconciliation?businessId=${a.businessId}`,headers:b.headers});
    expect(other.statusCode).toBe(403);
    const owner=await app.inject({method:"GET",
      url:`/v1/payments/hubtel/reconciliation?businessId=${a.businessId}`,headers:a.headers});
    expect(owner.statusCode,owner.body).toBe(200);
    expect(owner.json().summary.awaiting).toBe(1);
    expect(owner.json().attempts).toHaveLength(1);
    expect(owner.json().attempts[0].saleId).toBe(a.saleId);
    expect(owner.body).not.toContain("merchant-test-secret");
    expect(owner.body).not.toContain("111111");
    const forbiddenBranch=await app.inject({method:"GET",
      url:`/v1/payments/hubtel/reconciliation?businessId=${a.businessId}&branchId=${b.branchId}`,
      headers:a.headers});
    expect(forbiddenBranch.statusCode).toBe(200);
    expect(forbiddenBranch.json().attempts).toHaveLength(0);
  });
});

describe("Hubtel reconciliation review-only escalation",()=>{
  it("turns provider amount mismatch into review without cash or stock reversal",async()=>{
    const m=await merchant("reconciler-mismatch","merchant_1","111111");
    installMock("111111","Paid",69.99);
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,
      saleId:m.saleId,clientRequestId:randomUUID()});
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts SET created_at=now()-interval '7 minutes' "+
      "WHERE sale_id=$1",[m.saleId]);
    const tick=await runHubtelPosReconciliationTick(pool);
    expect(tick).toMatchObject({attempted:1,failed:1,reviewRequired:1});
    expect(await ledger(m)).toMatchObject({status:"OPEN",payment_status:"PENDING",
      receipt_count:"0",attempt_state:"REVIEW_REQUIRED"});
    const attempt=await pool.query<{last_status_error_code:string}>(
      "SELECT last_status_error_code FROM hubtel_sale_checkout_attempts "+
      "WHERE sale_id=$1",[m.saleId]);
    expect(attempt.rows[0]?.last_status_error_code).toBe("HUBTEL_STATUS_AMOUNT_MISMATCH");
  });

  it("immediately holds a verified provider-method mismatch for review",async()=>{
    const m=await merchant("reconciler-method-mismatch","merchant_1","111111");
    installMock("111111","Paid",70,"card");
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,
      saleId:m.saleId,clientRequestId:randomUUID()});
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts SET created_at=now()-interval '7 minutes' " +
      "WHERE sale_id=$1",[m.saleId]);
    const tick=await runHubtelPosReconciliationTick(pool);
    expect(tick).toMatchObject({attempted:1,failed:1,reviewRequired:1,paid:0});
    expect(await ledger(m)).toMatchObject({status:"OPEN",
      payment_status:"PENDING",receipt_count:"0",attempt_state:"REVIEW_REQUIRED"});
    const result=await pool.query<{last_status_error_code:string;
      next_status_check_at:Date|null}>(
      "SELECT last_status_error_code,next_status_check_at " +
      "FROM hubtel_sale_checkout_attempts WHERE sale_id=$1",[m.saleId]);
    expect(result.rows[0]).toMatchObject({
      last_status_error_code:"HUBTEL_POS_PAYMENT_METHOD_MISMATCH",
      next_status_check_at:null});
  });

  it("does not create receipt on a provider-refunded status",async()=>{
    const m=await merchant("reconciler-refunded","merchant_1","111111");
    installMock();
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,
      saleId:m.saleId,clientRequestId:randomUUID()});
    const ref=(await pool.query<{client_reference:string}>(
      "SELECT client_reference FROM hubtel_sale_checkout_attempts WHERE sale_id=$1",
      [m.saleId])).rows[0]!.client_reference;
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts SET created_at=now()-interval '7 minutes' "+
      "WHERE sale_id=$1",[m.saleId]);
    globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify({
      responseCode:"0000",data:{clientReference:ref,status:"Refunded",
        amount:70,currencyCode:"GHS",transactionId:"txn-refunded-123"},
    }),{status:200})) as unknown as typeof fetch;
    const tick=await runHubtelPosReconciliationTick(pool);
    expect(tick).toMatchObject({attempted:1,reviewRequired:1,paid:0});
    expect(await ledger(m)).toMatchObject({status:"OPEN",
      payment_status:"PENDING",receipt_count:"0",attempt_state:"REVIEW_REQUIRED"});
  });

  it("obeys database scheduler election and the global POS kill switch",async()=>{
    const lockKey="8706112026111502";
    const other=await pool.connect();
    try {
      await other.query("SELECT pg_advisory_lock($1::bigint)",[lockKey]);
      const bypass=await runHubtelPosReconciliationTick(pool);
      expect(bypass).toMatchObject({enabled:true,acquired:false,attempted:0});
    }finally{
      await other.query("SELECT pg_advisory_unlock($1::bigint)",[lockKey]);
      other.release();
    }
    process.env.TRADEOS_HUBTEL_POS_ENABLED="false";
    const stopped=await runHubtelPosReconciliationTick(pool);
    expect(stopped).toMatchObject({enabled:false,acquired:false,attempted:0});
  });
});

describe("Hubtel post-settlement manual exception review",()=>{
  async function settle(tag:string) {
    const m=await merchant(tag,"merchant_1","111111");
    installMock();
    await startSaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,clientRequestId:randomUUID(),
    });
    const paid=await verifySaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,
    });
    expect(paid.state).toBe("PAID");
    expect(await ledger(m)).toMatchObject({
      status:"COMPLETED",payment_status:"SUCCEEDED",
      receipt_count:"1",attempt_state:"RECONCILED",
    });
    const ref=(await pool.query<{client_reference:string}>(
      "SELECT client_reference FROM hubtel_sale_checkout_attempts WHERE sale_id=$1",
      [m.saleId])).rows[0]!.client_reference;
    return {m,ref};
  }
  function statusResponse(ref:string,status:"Paid"|"Unpaid"|"Refunded",
    transactionId="txn-confirmed-123",paymentMethod="mobilemoney") {
    const mock=vi.fn(async (url:RequestInfo|URL)=>{
      expect(String(url)).toContain(
        "https://api-txnstatus.hubtel.com/transactions/111111/status");
      expect(String(url)).toContain("clientReference="+encodeURIComponent(ref));
      return new Response(JSON.stringify({responseCode:"0000",data:{
        clientReference:ref,status,amount:70,
        paymentMethod,transactionId,currencyCode:"GHS",
        date:"2026-11-18T10:00:00Z",
      }}),{status:200});
    });
    globalThis.fetch=mock as unknown as typeof fetch;
    return mock;
  }
  function route(saleId:string){
    return "/v1/sales/"+saleId+"/hubtel/settlement-review";
  }

  it("persists a confirmed refund alert without reversing the original paid sale",async()=>{
    const {m,ref}=await settle("settlement-refund-later");
    const foreign=await merchant("settlement-foreign","merchant_2","222222");
    const calls=statusResponse(ref,"Refunded");
    const forbidden=await app.inject({method:"POST",url:route(m.saleId),
      headers:foreign.headers,payload:{businessId:m.businessId}});
    expect(forbidden.statusCode).toBe(403);
    const first=await app.inject({method:"POST",url:route(m.saleId),
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(first.statusCode,first.body).toBe(200);
    expect(first.json().result).toMatchObject({
      state:"REVIEW_REQUIRED",exceptionKind:"REFUND_REPORTED",saleId:m.saleId});
    expect(await ledger(m)).toMatchObject({status:"COMPLETED",
      payment_status:"SUCCEEDED",receipt_count:"1",amount:"7000",
      attempt_state:"RECONCILED"});
    const monitor=await app.inject({method:"GET",
      url:"/v1/payments/hubtel/reconciliation?businessId="+m.businessId,
      headers:m.headers});
    expect(monitor.statusCode,monitor.body).toBe(200);
    expect(monitor.json().summary.settlementAlerts).toBe(1);
    expect(monitor.json().attempts[0]).toMatchObject({
      settlementExceptionCount:1,settlementExceptionKind:"REFUND_REPORTED",
      state:"RECONCILED",paymentStatus:"SUCCEEDED" });
    expect(monitor.body).not.toContain("merchant-test-secret");
    expect(monitor.body).not.toContain("111111");
    await expect(pool.query(
      "INSERT INTO hubtel_pos_settlement_exceptions "+
      "(attempt_id,business_id,branch_id,sale_id,payment_id,exception_kind,"+
      "client_reference,original_provider_transaction_id,verified_at) "+
      "VALUES($1,$2,$3,$4,$5,'REFUND_REPORTED',$6,'txn-confirmed-123',now())",
      [monitor.json().attempts[0].attemptId,foreign.businessId,
        foreign.branchId,m.saleId,m.paymentId,ref],
    )).rejects.toMatchObject({code:"P0001"});
    const duplicate=await app.inject({method:"POST",url:route(m.saleId),
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(duplicate.statusCode).toBe(429);
    expect(calls).toHaveBeenCalledTimes(1);
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts "+
      "SET last_post_settlement_checked_at=now()-interval '6 minutes' "+
      "WHERE sale_id=$1",[m.saleId]);
    const afterCooldown=await app.inject({method:"POST",url:route(m.saleId),
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(afterCooldown.statusCode,afterCooldown.body).toBe(200);
    const counts=await pool.query<{exceptions:string;audits:string}>(
      "SELECT "+
      "(SELECT count(*)::text FROM hubtel_pos_settlement_exceptions WHERE sale_id=$1) AS exceptions,"+
      "(SELECT count(*)::text FROM audit_events "+
      "WHERE entity_id=$1 AND event_type='HUBTEL_POS_SETTLEMENT_EXCEPTION_OBSERVED') AS audits",
      [m.saleId]);
    expect(counts.rows[0]).toMatchObject({exceptions:"1",audits:"1"});
    const existing=(await pool.query<{id:string}>(
      "SELECT id FROM hubtel_pos_settlement_exceptions WHERE sale_id=$1",
      [m.saleId])).rows[0]!.id;
    await expect(pool.query(
      "UPDATE hubtel_pos_settlement_exceptions SET exception_kind='STATUS_CONFLICT' WHERE id=$1",
      [existing])).rejects.toMatchObject({code:"P0001"});
    await expect(pool.query(
      "DELETE FROM hubtel_pos_settlement_exceptions WHERE id=$1",
      [existing])).rejects.toMatchObject({code:"P0001"});
  });

  it("treats a later Unpaid response as conflict, never unpaid cancellation",async()=>{
    const {m,ref}=await settle("settlement-unpaid-later");
    statusResponse(ref,"Unpaid");
    const result=await app.inject({method:"POST",url:route(m.saleId),
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(result.statusCode,result.body).toBe(200);
    expect(result.json().result).toMatchObject({
      state:"REVIEW_REQUIRED",exceptionKind:"STATUS_CONFLICT"});
    expect(await ledger(m)).toMatchObject({
      status:"COMPLETED",payment_status:"SUCCEEDED",receipt_count:"1"});
  });

  it("detects later tender or provider transaction conflicts without new receipts",async()=>{
    const {m,ref}=await settle("settlement-method-mismatch");
    statusResponse(ref,"Paid","txn-confirmed-123","card");
    const first=await app.inject({method:"POST",url:route(m.saleId),
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(first.statusCode,first.body).toBe(200);
    expect(first.json().result.exceptionKind).toBe("METHOD_CONFLICT");
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts "+
      "SET last_post_settlement_checked_at=now()-interval '6 minutes' "+
      "WHERE sale_id=$1",[m.saleId]);
    statusResponse(ref,"Paid","different-provider-transaction","mobilemoney");
    const second=await app.inject({method:"POST",url:route(m.saleId),
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(second.statusCode,second.body).toBe(200);
    expect(second.json().result.exceptionKind).toBe("TRANSACTION_CONFLICT");
    const monitor=await app.inject({method:"GET",
      url:"/v1/payments/hubtel/reconciliation?businessId="+m.businessId,
      headers:m.headers});
    expect(monitor.json().attempts[0].settlementExceptionCount).toBe(2);
    expect(monitor.json().summary.settlementAlerts).toBe(1);
    expect(await ledger(m)).toMatchObject({
      status:"COMPLETED",payment_status:"SUCCEEDED",receipt_count:"1"});
  });

  it("does not create exceptions when Hubtel confirms the original paid transaction",async()=>{
    const {m,ref}=await settle("settlement-clean-recheck");
    statusResponse(ref,"Paid");
    const result=await app.inject({method:"POST",url:route(m.saleId),
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(result.statusCode,result.body).toBe(200);
    expect(result.json().result).toMatchObject({
      state:"UNCHANGED",exceptionKind:null});
    const rows=await pool.query<{count:string}>(
      "SELECT count(*)::text AS count FROM hubtel_pos_settlement_exceptions WHERE sale_id=$1",
      [m.saleId]);
    expect(rows.rows[0]!.count).toBe("0");
    expect((await ledger(m)).receipt_count).toBe("1");
  });
});
