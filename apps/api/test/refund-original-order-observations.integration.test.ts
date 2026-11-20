import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
import {HubtelStatusClient} from "../src/platform-admin/hubtel-status-client.js";
import {classifyAuthenticatedOriginalOrderStatus} from "../src/refund-original-order-observations.js";

process.env.DATABASE_URL??="postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
const app=buildApp(pool);
const configBefore={
  enabled:process.env.TRADEOS_HUBTEL_POS_ENABLED,
  aliases:process.env.TRADEOS_HUBTEL_POS_CREDENTIALS_JSON,
  platform:process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT,
};
const account="800111222";
const alias="refund-qa-account";
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{
  await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");
  process.env.TRADEOS_HUBTEL_POS_ENABLED="true";
  process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT="799000222";
  process.env.TRADEOS_HUBTEL_POS_CREDENTIALS_JSON=JSON.stringify({
    [alias]:{apiId:"qa-id",apiKey:"qa-secret"},
  });
  vi.restoreAllMocks();
});
afterAll(async()=>{
  vi.restoreAllMocks();
  for(const [key,val] of [
    ["TRADEOS_HUBTEL_POS_ENABLED",configBefore.enabled],
    ["TRADEOS_HUBTEL_POS_CREDENTIALS_JSON",configBefore.aliases],
    ["TRADEOS_HUBTEL_COLLECTION_ACCOUNT",configBefore.platform],
  ] as const){
    if(val===undefined)delete process.env[key];
    else process.env[key]=val;
  }
  await app.close();await pool.end();
});

const verified=(status:"PAID"|"UNPAID"|"REFUNDED",id:string|null="qa-original-transaction")=>({
  clientReference:"qa-client-ref",collectionAccount:account,
  status,paymentMethod:"MOMO" as const,
  amountMinor:status==="UNPAID"?null:1500,
  currencyCode:"GHS" as const,transactionId:status==="UNPAID"?null:id,
  externalTransactionId:null,providerReportedAt:null,
  verifiedAt:"2026-11-20T15:00:00.000Z",
});
async function register(email:string,key:string){
  const response=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:email.split("@")[0],email,
      password:"QA-Refund-Status-2026!",platform:"WEB",
      deviceKey:key,appVersion:"test"}});
  expect(response.statusCode).toBe(201);
  return {
    userId:response.json().user.id as string,
    headers:{authorization:`Bearer ${response.json().session.accessToken}`},
  };
}
async function fixture(){
  const owner=await register("owner-recheck@tradeos.test","recheck-owner");
  const cashier=await register("cashier-recheck@tradeos.test","recheck-cashier");
  const stranger=await register("stranger-recheck@tradeos.test","recheck-stranger");
  const onboarding=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers:owner.headers,
    payload:{name:"Refund Recheck QA",branchName:"Main",businessType:"RETAIL_HARDWARE"}});
  expect(onboarding.statusCode).toBe(201);
  const businessId:string=onboarding.json().business.id;
  const branchId:string=onboarding.json().branch.id;
  await pool.query(
    "INSERT INTO business_memberships(business_id,user_id,role,status) VALUES($1,$2,'CASHIER','ACTIVE')",
    [businessId,cashier.userId]);
  const otherBranchId=(await pool.query<{id:string}>(
    "INSERT INTO branches(business_id,name,code) VALUES($1,'Other','OTHER') RETURNING id",
    [businessId])).rows[0]!.id;
  await pool.query(
    `INSERT INTO business_hubtel_sales_accounts
      (business_id,collection_account,credential_alias,approval_status,enabled,verified_at)
      VALUES($1,$2,$3,'VERIFIED',true,now())`,
    [businessId,account,alias]);

  async function create(key:string,branch=branchId,amount=1500,status="PENDING"){
    const clientReference=key==="main"?"qa-client-ref":`qa-client-${key}`;
    const originalTransactionId=key==="main"?"qa-original-transaction":`qa-original-${key}`;
    const sale=(await pool.query<{id:string}>(
      `INSERT INTO sales
        (business_id,branch_id,status,currency_code,subtotal_net_minor,
         total_minor,client_mutation_id)
        VALUES($1,$2,'PARTIALLY_REFUNDED','GHS',1500,1500,$3) RETURNING id`,
      [businessId,branch,`sale-${key}`])).rows[0]!.id;
    const payment=(await pool.query<{id:string}>(
      `INSERT INTO payments
        (business_id,branch_id,sale_id,amount_minor,currency_code,
         method,status,provider_reference,client_mutation_id)
        VALUES($1,$2,$3,1500,'GHS','MOMO','SUCCEEDED',$4,$5)
        RETURNING id`,
      [businessId,branch,sale,originalTransactionId,`pay-${key}`])).rows[0]!.id;
    const checkout=(await pool.query<{id:string}>(
      `INSERT INTO hubtel_sale_checkout_attempts
        (business_id,branch_id,sale_id,payment_id,client_request_id,
         client_reference,merchant_collection_account,
         expected_amount_minor,currency_code,state,verified_provider_transaction_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,1500,'GHS','RECONCILED',
               $8) RETURNING id`,
      [businessId,branch,sale,payment,randomUUID(),clientReference,account,originalTransactionId])).rows[0]!.id;
    const ret=(await pool.query<{id:string}>(
      `INSERT INTO return_cases
        (business_id,branch_id,original_sale_id,status,reason,refund_method,
         currency_code,refund_total_minor,client_mutation_id)
        VALUES($1,$2,$3,'PROCESSING','Return QA','MOMO','GHS',$4,$5) RETURNING id`,
      [businessId,branch,sale,amount,`ret-${key}`])).rows[0]!.id;
    const refund=(await pool.query<{id:string}>(
      `INSERT INTO refund_transactions
        (business_id,return_case_id,original_payment_id,amount_minor,currency_code,
         method,status,idempotency_key)
        VALUES($1,$2,$3,$4,'GHS','MOMO',$5,$6) RETURNING id`,
      [businessId,ret,payment,amount,status,`refund-${key}`])).rows[0]!.id;
    return {sale,payment,checkout,refund};
  }
  const main=await create("main");
  const partial=await create("partial",branchId,500);
  const other=await create("other",otherBranchId);
  const baseUrl="/v1/refunds/hubtel-original-order";
  return {owner,cashier,stranger,businessId,branchId,otherBranchId,
    main,partial,other,
    list:(id:string,branch=branchId)=>
      `${baseUrl}-observations?businessId=${businessId}&branchId=${branch}&refundId=${id}`,
    post:(id:string,clientRequestId=randomUUID(),branch=branchId)=>({
      businessId,branchId:branch,refundId:id,clientRequestId,
    }),
  };
}

describe("authenticated Hubtel original-order refund checks",()=>{
  it("classifies verified original order state, never individual refund payment",()=>{
    expect(classifyAuthenticatedOriginalOrderStatus(verified("REFUNDED"),
      "qa-original-transaction")).toBe("ORIGINAL_ORDER_REFUND_REPORTED");
    expect(classifyAuthenticatedOriginalOrderStatus(verified("PAID"),
      "qa-original-transaction")).toBe("ORIGINAL_ORDER_PAID");
    expect(classifyAuthenticatedOriginalOrderStatus(verified("UNPAID"),
      "qa-original-transaction")).toBe("ORIGINAL_ORDER_UNPAID_CONFLICT");
    expect(classifyAuthenticatedOriginalOrderStatus(verified("REFUNDED","different"),
      "qa-original-transaction")).toBe("ORIGINAL_ORDER_REFERENCE_CONFLICT");
  });
  it("records authenticated order observations idempotently without refund settlement",async()=>{
    const f=await fixture();
    const mock=vi.spyOn(HubtelStatusClient.prototype,"verifyStatus")
      .mockResolvedValue(verified("REFUNDED"));
    const listBefore=await app.inject({method:"GET",
      url:f.list(f.main.refund),headers:f.owner.headers});
    expect(listBefore.statusCode).toBe(200);
    expect(listBefore.json()).toMatchObject({
      refundId:f.main.refund,recheckAvailable:true,
      observations:[],providerFinality:"NOT_ESTABLISHED",
      refundSpecificSettlementVerified:false,canMarkPaid:false,
    });
    const id=randomUUID();
    const posted=await app.inject({method:"POST",
      url:"/v1/refunds/hubtel-original-order-recheck",
      headers:f.owner.headers,payload:f.post(f.main.refund,id)});
    expect(posted.statusCode).toBe(201);
    const obs=posted.json().observation;
    expect(obs).toMatchObject({
      refundId:f.main.refund,originalOrderStatus:"REFUNDED",
      observationKind:"ORIGINAL_ORDER_REFUND_REPORTED",
      providerFinality:"NOT_ESTABLISHED",refundDestinationVerified:false,
      refundSpecificSettlementVerified:false,canMarkPaid:false,
      paymentStatusUnchanged:true,idempotentReplay:false,
    });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith({
      clientReference:"qa-client-ref",expectedAmountMinor:1500,currencyCode:"GHS",
    });
    const replay=await app.inject({method:"POST",
      url:"/v1/refunds/hubtel-original-order-recheck",
      headers:f.owner.headers,payload:f.post(f.main.refund,id)});
    expect(replay.statusCode).toBe(200);
    expect(replay.json().observation).toMatchObject({
      id:obs.id,idempotentReplay:true,
    });
    expect(mock).toHaveBeenCalledTimes(1);
    const throttled=await app.inject({method:"POST",
      url:"/v1/refunds/hubtel-original-order-recheck",
      headers:f.owner.headers,payload:f.post(f.main.refund)});
    expect(throttled.statusCode).toBe(429);
    expect(mock).toHaveBeenCalledTimes(1);
    const listAfter=await app.inject({method:"GET",
      url:f.list(f.main.refund),headers:f.owner.headers});
    expect(listAfter.json().observations).toHaveLength(1);
    expect(listAfter.json().nextCheckAt).not.toBeNull();
    expect(listAfter.json().observations[0]).toMatchObject({id:obs.id});
    await expect(pool.query(
      "UPDATE refund_provider_order_observations SET observation_kind='ORIGINAL_ORDER_PAID' WHERE id=$1",
      [obs.id])).rejects.toThrow();
    await expect(pool.query(
      "DELETE FROM refund_provider_order_observations WHERE id=$1",
      [obs.id])).rejects.toThrow();
    const refund=(await pool.query<{status:string;amount_minor:string}>(
      "SELECT status,amount_minor::text FROM refund_transactions WHERE id=$1",
      [f.main.refund])).rows[0];
    expect(refund).toEqual({status:"PENDING",amount_minor:"1500"});
    const audit=(await pool.query<{n:string}>(
      `SELECT count(*)::text AS n FROM audit_events
       WHERE entity_id=$1 AND event_type='REFUND_ORIGINAL_HUBTEL_ORDER_CHECKED'`,
      [f.main.refund])).rows[0]!.n;
    expect(audit).toBe("1");
  });
  it("blocks partial refunds, other branch, cashier, outsiders and no credentials",async()=>{
    const f=await fixture();
    const mock=vi.spyOn(HubtelStatusClient.prototype,"verifyStatus")
      .mockResolvedValue(verified("PAID"));
    const post=(payload:Record<string,unknown>,headers?:{authorization:string})=>
      app.inject({method:"POST",url:"/v1/refunds/hubtel-original-order-recheck",
        ...(headers?{headers}:{}),payload});
    const partial=await post(f.post(f.partial.refund),f.owner.headers);
    expect(partial.statusCode).toBe(409);
    expect((await post(f.post(f.other.refund),f.owner.headers)).statusCode).toBe(404);
    expect((await post(f.post(f.main.refund),f.cashier.headers)).statusCode).toBe(403);
    expect((await post(f.post(f.main.refund),f.stranger.headers)).statusCode).toBe(403);
    expect((await post(f.post(f.main.refund))).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:f.list(f.other.refund),
      headers:f.owner.headers})).statusCode).toBe(404);
    expect((await app.inject({method:"GET",url:f.list(f.main.refund),
      headers:f.cashier.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:f.list(f.main.refund)})).statusCode).toBe(401);
    process.env.TRADEOS_HUBTEL_POS_ENABLED="false";
    const disabled=await app.inject({method:"GET",url:f.list(f.main.refund),
      headers:f.owner.headers});
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().recheckAvailable).toBe(false);
    const denied=await post(f.post(f.main.refund),f.owner.headers);
    expect(denied.statusCode).toBe(503);
    expect(mock).not.toHaveBeenCalled();
  });
  it("serializes concurrent provider checks before any network calls",async()=>{
    const f=await fixture();
    const status=vi.spyOn(HubtelStatusClient.prototype,"verifyStatus")
      .mockResolvedValue(verified("PAID"));
    const requests=await Promise.all([randomUUID(),randomUUID()].map(clientRequestId=>
      app.inject({method:"POST",url:"/v1/refunds/hubtel-original-order-recheck",
        headers:f.owner.headers,payload:f.post(f.main.refund,clientRequestId)})));
    expect(requests.map(x=>x.statusCode).sort()).toEqual([201,429]);
    expect(status).toHaveBeenCalledTimes(1);
    const events=await pool.query<{n:string}>(
      "SELECT count(*)::text AS n FROM refund_provider_order_observations WHERE refund_transaction_id=$1",
      [f.main.refund]);
    expect(events.rows[0]!.n).toBe("1");
    const audit=await pool.query<{n:string}>(
      `SELECT count(*)::text AS n FROM audit_events
       WHERE entity_id=$1 AND event_type='REFUND_ORIGINAL_HUBTEL_ORDER_CHECKED'`,
      [f.main.refund]);
    expect(audit.rows[0]!.n).toBe("1");
  });

  it("records a conflicting provider transaction without creating refund finality",async()=>{
    const f=await fixture();
    vi.spyOn(HubtelStatusClient.prototype,"verifyStatus")
      .mockResolvedValue(verified("REFUNDED","mismatched-reference"));
    const result=await app.inject({method:"POST",
      url:"/v1/refunds/hubtel-original-order-recheck",headers:f.owner.headers,
      payload:f.post(f.main.refund)});
    expect(result.statusCode).toBe(201);
    expect(result.json().observation).toMatchObject({
      observationKind:"ORIGINAL_ORDER_REFERENCE_CONFLICT",
      canMarkPaid:false,refundSpecificSettlementVerified:false,
    });
    expect((await pool.query<{status:string}>(
      "SELECT status FROM refund_transactions WHERE id=$1",[f.main.refund]
    )).rows[0]?.status).toBe("PENDING");
  });
});
