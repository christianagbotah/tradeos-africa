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
  it("flags overdue unpaid checkouts without reversing stock or confusing tenant totals",async()=>{
    const aged=await merchant("hold-overdue","merchant_1","111111");
    const foreign=await merchant("hold-foreign","merchant_2","222222");
    installMock();
    await startSaleHubtelCheckout(pool,{businessId:aged.businessId,saleId:aged.saleId,
      clientRequestId:randomUUID()});
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts SET created_at=now()-interval '26 hours' "+
      "WHERE business_id=$1 AND sale_id=$2",[aged.businessId,aged.saleId]);
    const owner=await app.inject({method:"GET",
      url:`/v1/payments/hubtel/reconciliation?businessId=${aged.businessId}&branchId=${aged.branchId}&limit=1`,
      headers:aged.headers});
    expect(owner.statusCode,owner.body).toBe(200);
    expect(owner.json().summary).toMatchObject({
      overdueUnverified24h:1,
      pendingCheckoutsByCurrency:[
        {currencyCode:"GHS",pendingCount:1,overdue24hCount:1,pendingMinor:7000},
      ],
    });
    expect(owner.json().attempts[0]).toMatchObject({
      saleId:aged.saleId,overdue24h:true,paymentStatus:"PENDING",saleStatus:"OPEN",
    });
    expect(await ledger(aged)).toMatchObject({
      status:"OPEN",payment_status:"PENDING",receipt_count:"0",
      attempt_state:"READY",
    });
    expect(owner.body).not.toContain("merchant-test-secret");
    expect(owner.body).not.toContain("111111");
    const foreignView=await app.inject({method:"GET",
      url:`/v1/payments/hubtel/reconciliation?businessId=${aged.businessId}`,
      headers:foreign.headers});
    expect(foreignView.statusCode).toBe(403);
    const otherBranch=await app.inject({method:"GET",
      url:`/v1/payments/hubtel/reconciliation?businessId=${aged.businessId}&branchId=${foreign.branchId}`,
      headers:aged.headers});
    expect(otherBranch.statusCode).toBe(200);
    expect(otherBranch.json().summary.pendingCheckoutsByCurrency).toEqual([]);
    expect(otherBranch.json().summary.overdueUnverified24h).toBe(0);
  });

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


describe("Hubtel cancellation stock impact preflight (read only)", () => {
  async function originalStock(m: Merchant, label: string,
    kind: "PRODUCT" | "SERVICE", quantity: string, costMinor: number,
    movements: Array<{ name: string; quantity: string; reason: string; costMinor?: number }>) {
    const itemId = (await pool.query<{ id: string }>(
      "INSERT INTO catalog_items(business_id,name,kind,track_stock,stock_unit_code) " +
      "VALUES($1,$2,$3,$4,$5) RETURNING id",
      [m.businessId,label,kind,kind==="PRODUCT",kind==="PRODUCT"?"piece":null],
    )).rows[0]!.id;
    const lineId = (await pool.query<{ id: string }>(
      "INSERT INTO sale_lines(sale_id,business_id,item_id,item_name_snapshot,item_kind," +
      "quantity,sale_unit_code,stock_quantity,stock_unit_code,unit_net_minor," +
      "unit_cost_minor,line_net_minor,line_total_minor,line_cost_minor) " +
      "VALUES($1,$2,$3,$4,$5,1,'piece',$6,$7,7000,$8,7000,7000,$9) RETURNING id",
      [m.saleId,m.businessId,itemId,label,kind,
        kind==="PRODUCT"?quantity:null,kind==="PRODUCT"?"piece":null,
        costMinor,costMinor],
    )).rows[0]!.id;
    for (let i=0;i<movements.length;i++) {
      const movement=movements[i]!;
      const componentItemId = (await pool.query<{ id: string }>(
        "INSERT INTO catalog_items(business_id,name,kind,track_stock,stock_unit_code) " +
        "VALUES($1,$2,'PRODUCT',true,'piece') RETURNING id",
        [m.businessId,movement.name],
      )).rows[0]!.id;
      const sourceItemId=kind==="PRODUCT"?itemId:componentItemId;
      const movementId=(await pool.query<{id:string}>(
        "INSERT INTO inventory_movements(business_id,branch_id,item_id,stock_unit_code," +
        "quantity_delta,location_type,reason,reference_type,reference_id," +
        "idempotency_key,occurred_at) " +
        "VALUES($1,$2,$3,'piece',$4,'AVAILABLE',$5,'SALE_LINE',$6,$7,now()) RETURNING id",
        [m.businessId,m.branchId,sourceItemId,
          "-"+movement.quantity,movement.reason,lineId,
          "original-consumption-"+m.saleId+"-"+i],
      )).rows[0]!.id;
      if(movement.costMinor!==undefined) {
        await pool.query(
          "INSERT INTO sale_stock_cost_allocations(business_id,branch_id,sale_line_id," +
          "inventory_movement_id,item_id,stock_unit_code,consumed_quantity,consumed_cost_minor) "+
          "VALUES($1,$2,$3,$4,$5,'piece',$6,$7)",
          [m.businessId,m.branchId,lineId,movementId,sourceItemId,
            movement.quantity,movement.costMinor],
        );
      }
    }
    return {lineId,itemId};
  }

  it("shows exact product stock quantities without posting any cancellation, reversal or cash movement",async()=>{
    const m=await merchant("cancel-preflight-product","merchant_1","111111");
    installMock();
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    await originalStock(m,"Box of bolts","PRODUCT","1.25000000",1250,[
      {name:"Box of bolts",quantity:"1.25000000",reason:"SALE",costMinor:1250},
    ]);
    const before=(await pool.query<{ count:string }>(
      "SELECT count(*)::text AS count FROM inventory_movements WHERE business_id=$1",
      [m.businessId])).rows[0]!.count;
    const url=`/v1/sales/${m.saleId}/hubtel/cancellation-preflight?businessId=${m.businessId}`;
    const response=await app.inject({method:"GET",url,headers:m.headers});
    expect(response.statusCode,response.body).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.json().assessment).toMatchObject({
      saleId:m.saleId,currencyCode:"GHS",
      checkoutAmountMinor:7000,recordedCostBasisMinor:1250,saleLineCount:1,
      costEvidenceComplete:true,
      saleStatus:"OPEN",paymentStatus:"PENDING",checkoutState:"READY",
      permission:"REVIEW_ONLY",canReleaseStock:false,
      stockToReview:[{itemName:"Box of bolts",stockUnitCode:"piece",
        quantityToReview:"1.25000000",consumptionReason:"SALE",consumedCostMinor:1250}],
    });
    expect(response.json().assessment.blockers).toContain("HUBTEL_PAYMENT_FINALITY_NOT_ESTABLISHED");
    expect(response.json().assessment.blockers).toContain("ATOMIC_STOCK_REVERSAL_NOT_ENABLED");
    expect(response.json().assessment.blockers).not.toContain("SOURCE_STOCK_JOURNAL_MISMATCH");
    expect((await ledger(m))).toMatchObject({status:"OPEN",payment_status:"PENDING",
      receipt_count:"0",attempt_state:"READY"});
    expect((await pool.query<{ count:string }>(
      "SELECT count(*)::text AS count FROM inventory_movements WHERE business_id=$1",
      [m.businessId])).rows[0]!.count).toBe(before);
    const anotherTenant=await merchant("cancel-preflight-foreign","merchant_2","222222");
    const forbidden=await app.inject({method:"GET",url,headers:anotherTenant.headers});
    expect(forbidden.statusCode).toBe(403);
    const anonymous=await app.inject({method:"GET",url});
    expect(anonymous.statusCode).toBe(401);
    await pool.query("UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1",
      [m.businessId]);
    const cashier=await app.inject({method:"GET",url,headers:m.headers});
    expect(cashier.statusCode).toBe(403);
  });

  it("identifies the original component journal and blocks automatic recipe valuation reversal",async()=>{
    const m=await merchant("cancel-preflight-service","merchant_1","111111");
    installMock();
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    await originalStock(m,"Preparation service","SERVICE","0",2250,[
      {name:"Ingredient A",quantity:"2.50000000",reason:"SERVICE_CONSUMPTION",costMinor:1000},
      {name:"Ingredient B",quantity:"0.75000000",reason:"SERVICE_CONSUMPTION",costMinor:1250},
    ]);
    const response=await app.inject({method:"GET",
      url:`/v1/sales/${m.saleId}/hubtel/cancellation-preflight?businessId=${m.businessId}`,
      headers:m.headers});
    expect(response.statusCode,response.body).toBe(200);
    const assessed=response.json().assessment;
    expect(assessed.stockToReview).toHaveLength(2);
    expect(assessed.stockToReview.map((r:{quantityToReview:string})=>r.quantityToReview).sort())
      .toEqual(["0.75000000","2.50000000"]);
    expect(assessed.recordedCostBasisMinor).toBe(2250);
    expect(assessed.costEvidenceComplete).toBe(true);
    expect(assessed.stockToReview.map((r:{consumedCostMinor:number})=>r.consumedCostMinor).sort())
      .toEqual([1000,1250]);
    expect(assessed.blockers).not.toContain("COMPONENT_VALUATION_ALLOCATION_REVIEW");
    expect(assessed.blockers).toContain("HUBTEL_PAYMENT_FINALITY_NOT_ESTABLISHED");
    expect(assessed.canReleaseStock).toBe(false);
    expect((await ledger(m)).receipt_count).toBe("0");
  });

  it("detects missing stock-source movements and blocks already settled checkout impact releases",async()=>{
    const m=await merchant("cancel-preflight-unsafe","merchant_1","111111");
    installMock();
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    await originalStock(m,"Tracked item","PRODUCT","3.00000000",900,[]);
    const url=`/v1/sales/${m.saleId}/hubtel/cancellation-preflight?businessId=${m.businessId}`;
    const missing=await app.inject({method:"GET",url,headers:m.headers});
    expect(missing.statusCode).toBe(200);
    expect(missing.json().assessment.blockers).toContain("SOURCE_STOCK_JOURNAL_MISMATCH");
    expect((await verifySaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId})).state)
      .toBe("PAID");
    const paid=await app.inject({method:"GET",url,headers:m.headers});
    expect(paid.statusCode).toBe(200);
    expect(paid.json().assessment.blockers).toContain("SALE_OR_PAYMENT_ALREADY_SETTLED");
    expect(paid.json().assessment.canReleaseStock).toBe(false);
    expect(await ledger(m)).toMatchObject({status:"COMPLETED",
      payment_status:"SUCCEEDED",receipt_count:"1",attempt_state:"RECONCILED"});
  });
});


describe("Hubtel pending-checkout cancellation investigation requests",()=>{

  it("lists current branch investigations with all-time counts, payment outcomes and pagination",async()=>{
    const m=await merchant("investigation-list","merchant_1","111111");
    const outsider=await merchant("investigation-list-outsider","merchant_2","222222");
    installMock();
    const reason="Customer left checkout unfinished and requires a provider finality investigation.";
    const review=async(saleId:string)=>{
      const result=await app.inject({method:"POST",headers:m.headers,
        url:`/v1/sales/${saleId}/hubtel/cancellation-investigation`,
        payload:{businessId:m.businessId,note:reason},
      });
      expect(result.statusCode,result.body).toBe(200);
      return result.json().investigation.reviewId as string;
    };
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    const first=await review(m.saleId);
    expect((await verifySaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,
    })).state).toBe("PAID");
    const saleId=(await pool.query<{id:string}>(
      "INSERT INTO sales(business_id,branch_id,status,currency_code,total_minor,"+
      "client_mutation_id) VALUES($1,$2,'OPEN','GHS',7000,$3) RETURNING id",
      [m.businessId,m.branchId,"investigation-list-extra-"+randomUUID()],
    )).rows[0]!.id;
    await pool.query(
      "INSERT INTO payments(business_id,branch_id,sale_id,amount_minor,"+
      "currency_code,method,status,client_mutation_id) "+
      "VALUES($1,$2,$3,7000,'GHS','MOMO','PENDING',$4)",
      [m.businessId,m.branchId,saleId,"investigation-list-payment-"+randomUUID()],
    );
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId,
      clientRequestId:randomUUID()});
    const second=await review(saleId);

    const base=`/v1/payments/hubtel/cancellation-investigations?businessId=${m.businessId}&branchId=${m.branchId}`;
    const page1=await app.inject({method:"GET",url:base+"&limit=1&offset=0",
      headers:m.headers});
    expect(page1.statusCode,page1.body).toBe(200);
    expect(page1.headers["cache-control"]).toContain("no-store");
    expect(page1.json()).toMatchObject({
      scope:"BRANCH_ALL_TIME",summary:{total:2,pending:1,paid:1,other:0},
      filteredCount:2,limit:1,offset:0,hasMore:true,
      cases:[{reviewId:second,saleId,amountMinor:7000,currencyCode:"GHS",
        outcome:"PENDING",paymentStatus:"PENDING",providerFinality:"NOT_ESTABLISHED",
        canReleaseStock:false}],
    });
    const page2=await app.inject({method:"GET",url:base+"&limit=1&offset=1",
      headers:m.headers});
    expect(page2.statusCode,page2.body).toBe(200);
    expect(page2.json()).toMatchObject({
      summary:{total:2,pending:1,paid:1,other:0},
      filteredCount:2,hasMore:false,
      cases:[{reviewId:first,saleId:m.saleId,outcome:"PAID",
        saleStatus:"COMPLETED",paymentStatus:"SUCCEEDED",canReleaseStock:false}],
    });
    const paid=await app.inject({method:"GET",url:base+"&outcome=PAID&limit=1",
      headers:m.headers});
    expect(paid.statusCode,paid.body).toBe(200);
    expect(paid.json().cases).toHaveLength(1);
    expect(paid.json().cases[0].reviewId).toBe(first);
    expect(paid.json().filteredCount).toBe(1);
    const pending=await app.inject({method:"GET",url:base+"&outcome=PENDING",
      headers:m.headers});
    expect(pending.statusCode,pending.body).toBe(200);
    expect(pending.json().cases.map((x:{reviewId:string})=>x.reviewId))
      .toEqual([second]);
    const otherBranch=await app.inject({method:"GET",
      url:base.replace("branchId="+m.branchId,"branchId="+outsider.branchId),
      headers:m.headers});
    expect(otherBranch.statusCode).toBe(200);
    expect(otherBranch.json().summary.total).toBe(0);
    expect(otherBranch.json().cases).toEqual([]);
    const foreign=await app.inject({method:"GET",url:base,headers:outsider.headers});
    expect(foreign.statusCode).toBe(403);
    const anonymous=await app.inject({method:"GET",url:base});
    expect(anonymous.statusCode).toBe(401);
    const unknown=await app.inject({method:"GET",url:base+"&outcome=VOIDED",
      headers:m.headers});
    expect(unknown.statusCode).toBe(400);
    const invalidOffset=await app.inject({method:"GET",url:base+"&offset=-1",
      headers:m.headers});
    expect(invalidOffset.statusCode).toBe(400);
    expect(await ledger(m)).toMatchObject({
      status:"COMPLETED",payment_status:"SUCCEEDED",receipt_count:"1",
    });
  });


  it("creates one audited merchant investigation under concurrent retries, without canceling checkout or releasing stock",async()=>{
    const m=await merchant("investigation-concurrent","merchant_1","111111");
    const request=installMock();
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    const original=await ledger(m);
    const route="/v1/sales/"+m.saleId+"/hubtel/cancellation-investigation";
    const body={businessId:m.businessId,
      note:"Customer abandoned payment, but the provider has not issued a confirmed checkout void."};
    const attempts=await Promise.all(Array.from({length:4},()=>app.inject({
      method:"POST",url:route,headers:m.headers,payload:body,
    })));
    for(const response of attempts)expect(response.statusCode,response.body).toBe(200);
    const ids=attempts.map(x=>x.json().investigation.reviewId);
    expect(new Set(ids).size).toBe(1);
    expect(attempts.map(x=>x.json().investigation.idempotentReplay).sort())
      .toEqual([false,true,true,true]);
    expect(attempts[0]!.json().investigation).toMatchObject({
      saleId:m.saleId,branchId:m.branchId,
      status:"AWAITING_PROVIDER_INVESTIGATION",
      providerFinality:"NOT_ESTABLISHED",canReleaseStock:false,
    });
    expect(await ledger(m)).toEqual(original);
    expect(request.mock.calls.filter(call=>
      String(call[0]).includes("/transactions/"))).toHaveLength(0);
    expect((await pool.query<{count:string}>(
      "SELECT count(*)::text AS count FROM hubtel_pos_cancellation_investigations "+
      "WHERE business_id=$1 AND sale_id=$2",
      [m.businessId,m.saleId])).rows[0]!.count).toBe("1");
    expect((await pool.query<{count:string}>(
      "SELECT count(*)::text AS count FROM audit_events "+
      "WHERE business_id=$1 AND event_type='HUBTEL_CANCELLATION_INVESTIGATION_REQUESTED'",
      [m.businessId])).rows[0]!.count).toBe("1");
    expect((await pool.query<{count:string}>(
      "SELECT count(*)::text AS count FROM inventory_movements WHERE business_id=$1",
      [m.businessId])).rows[0]!.count).toBe("0");
    const preflight=await app.inject({method:"GET",headers:m.headers,
      url:`/v1/sales/${m.saleId}/hubtel/cancellation-preflight?businessId=${m.businessId}`});
    expect(preflight.statusCode,preflight.body).toBe(200);
    expect(preflight.json().assessment.investigation).toMatchObject({
      reviewId:ids[0],status:"AWAITING_PROVIDER_INVESTIGATION",
      providerFinality:"NOT_ESTABLISHED",canReleaseStock:false,
    });
    // Hubtel may still settle AFTER a merchant's cancellation investigation.
    // The case must never prevent a genuine paid confirmation or cause a
    // second stock movement, refund or receipt.
    const paid=await verifySaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,
    });
    expect(paid.state).toBe("PAID");
    expect(await ledger(m)).toMatchObject({
      status:"COMPLETED",payment_status:"SUCCEEDED",receipt_count:"1",
      attempt_state:"RECONCILED",
    });
    const afterPaidReplay=await app.inject({
      method:"POST",url:route,headers:m.headers,payload:body,
    });
    expect(afterPaidReplay.statusCode,afterPaidReplay.body).toBe(200);
    expect(afterPaidReplay.json().investigation).toMatchObject({
      reviewId:ids[0],idempotentReplay:true,canReleaseStock:false,
    });
    expect((await pool.query<{count:string}>(
      "SELECT count(*)::text AS count FROM audit_events "+
      "WHERE business_id=$1 AND event_type='HUBTEL_CANCELLATION_INVESTIGATION_REQUESTED'",
      [m.businessId])).rows[0]!.count).toBe("1");
    expect((await pool.query<{count:string}>(
      "SELECT count(*)::text AS count FROM inventory_movements WHERE business_id=$1",
      [m.businessId])).rows[0]!.count).toBe("0");
    // An immutable investigation can never be silently edited into a 'void'.
    await expect(pool.query(
      "UPDATE hubtel_pos_cancellation_investigations SET reason='fraud' WHERE business_id=$1",
      [m.businessId])).rejects.toThrow();
    await expect(pool.query(
      "DELETE FROM hubtel_pos_cancellation_investigations WHERE business_id=$1",
      [m.businessId])).rejects.toThrow();
  });

  it("rejects invalid reasons and unauthorised tenants, and never accepts a first request after PAID",async()=>{
    const m=await merchant("investigation-authorization","merchant_1","111111");
    const other=await merchant("investigation-other","merchant_2","222222");
    const route="/v1/sales/"+m.saleId+"/hubtel/cancellation-investigation";
    const payload={businessId:m.businessId,
      note:"Customer reports the checkout has been abandoned and no payment was authorised."};
    const unauthorized=await app.inject({method:"POST",url:route,payload});
    expect(unauthorized.statusCode).toBe(401);
    const crossTenant=await app.inject({method:"POST",url:route,
      headers:other.headers,payload});
    expect(crossTenant.statusCode).toBe(403);
    const shortReason=await app.inject({method:"POST",url:route,
      headers:m.headers,payload:{...payload,note:"cancel it"}});
    expect(shortReason.statusCode).toBe(400);
    installMock();
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    await pool.query("UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1",
      [m.businessId]);
    const cashier=await app.inject({method:"POST",url:route,
      headers:m.headers,payload});
    expect(cashier.statusCode).toBe(403);
    await pool.query("UPDATE business_memberships SET role='OWNER' WHERE business_id=$1",
      [m.businessId]);
    const settled=await verifySaleHubtelCheckout(pool,{
      businessId:m.businessId,saleId:m.saleId,
    });
    expect(settled.state).toBe("PAID");
    const afterPaid=await app.inject({method:"POST",url:route,
      headers:m.headers,payload});
    expect(afterPaid.statusCode).toBe(409);
    expect((await ledger(m))).toMatchObject({
      status:"COMPLETED",payment_status:"SUCCEEDED",receipt_count:"1",
    });
    expect((await pool.query<{count:string}>(
      "SELECT count(*)::text AS count FROM hubtel_pos_cancellation_investigations "+
      "WHERE business_id=$1",[m.businessId])).rows[0]!.count).toBe("0");
    expect((await pool.query<{count:string}>(
      "SELECT count(*)::text AS count FROM hubtel_pos_cancellation_investigations "+
      "WHERE business_id=$1",[other.businessId])).rows[0]!.count).toBe("0");
  });
});
