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
function installMock(account="111111",status:"Paid"|"Unpaid"="Paid",amount=70){
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
        clientReference:reference,status,amount,
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
        currencyCode:"GHS",transactionId:"late-confirmed-transaction",date:new Date().toISOString()},
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

  it("retries HTTP 403 provider failures without treating checkout as paid or cancelled",async()=>{
    const m=await merchant("reconciler-403","merchant_1","111111");
    installMock();
    await startSaleHubtelCheckout(pool,{businessId:m.businessId,saleId:m.saleId,
      clientRequestId:randomUUID()});
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts SET created_at=now()-interval '6 minutes' "+
      "WHERE sale_id=$1",[m.saleId]);
    globalThis.fetch=vi.fn(async()=>new Response("",{status:403})) as unknown as typeof fetch;
    const failed=await runHubtelPosReconciliationTick(pool);
    expect(failed).toMatchObject({attempted:1,failed:1,reviewRequired:0});
    const attempt=await pool.query<{
      state:string;last_status_error_code:string;next_status_check_at:Date;
    }>(
      "SELECT state,last_status_error_code,next_status_check_at "+
      "FROM hubtel_sale_checkout_attempts WHERE sale_id=$1",[m.saleId]);
    expect(attempt.rows[0]?.state).toBe("READY");
    expect(attempt.rows[0]?.last_status_error_code).toBe("HUBTEL_STATUS_UNAVAILABLE");
    expect(attempt.rows[0]!.next_status_check_at.getTime()).toBeGreaterThan(Date.now());
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
