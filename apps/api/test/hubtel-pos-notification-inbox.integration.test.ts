import {randomBytes,randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";
import {getBusinessHubtelPosMonitor} from
  "../src/commerce/hubtel-pos-monitor.js";
import {recordUntrustedHubtelNotification} from
  "../src/commerce/hubtel-pos-notification-inbox.js";

const dbUrl=process.env.DATABASE_URL??
  "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
if(!dbUrl.endsWith("/tradeos_ci")||
  !/(@127\.0\.0\.1:5432|@localhost:5432)/.test(dbUrl))
  throw Error("Hubtel callback inbox requires isolated local tradeos_ci");
process.env.DATABASE_URL=dbUrl;
const enabledVar="TRADEOS_HUBTEL_NOTIFICATION_INBOX_ENABLED";
const before=process.env[enabledVar],pool=createPool(),app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
afterAll(async()=>{
  await app.close();await pool.end();
  if(before===undefined)delete process.env[enabledVar];
  else process.env[enabledVar]=before;
});
async function merchant(){
  const tag=randomUUID();
  const registered=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"Callback Inbox Test Merchant",
      email:"hubtel-callback-"+tag+"@example.test",
      password:"TradeOS-Test-1234",platform:"WEB",deviceKey:"inbox-"+tag,
      appVersion:"test"}});
  expect(registered.statusCode,registered.body).toBe(201);
  const headers={authorization:"Bearer "+registered.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:"Callback merchant "+tag,
      businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const branchId=onboard.json().branch.id as string;
  const account="3"+String(Math.floor(100000000+Math.random()*900000000));
  await pool.query(
    "INSERT INTO business_hubtel_sales_accounts "+
    "(business_id,collection_account,credential_alias,approval_status,"+
    "verified_at,enabled) VALUES($1,$2,$3,'VERIFIED',now(),true)",
    [businessId,account,"callback_"+tag.slice(0,20)]);
  const saleId=(await pool.query<{id:string}>(
    "INSERT INTO sales(business_id,branch_id,status,currency_code,total_minor,"+
    "client_mutation_id) VALUES($1,$2,'OPEN','GHS',5500,$3) RETURNING id",
    [businessId,branchId,"sale-"+tag])).rows[0]!.id;
  const paymentId=(await pool.query<{id:string}>(
    "INSERT INTO payments(business_id,branch_id,sale_id,amount_minor,"+
    "currency_code,method,status,client_mutation_id) "+
    "VALUES($1,$2,$3,5500,'GHS','MOMO','PENDING',$4) RETURNING id",
    [businessId,branchId,saleId,"payment-"+tag])).rows[0]!.id;
  const reference="TSP-"+randomBytes(12).toString("hex");
  const attemptId=(await pool.query<{id:string}>(
    "INSERT INTO hubtel_sale_checkout_attempts "+
    "(business_id,branch_id,sale_id,payment_id,client_request_id,"+
    "client_reference,merchant_collection_account,expected_amount_minor,"+
    "currency_code) VALUES($1,$2,$3,$4,$5,$6,$7,5500,'GHS') RETURNING id",
    [businessId,branchId,saleId,paymentId,randomUUID(),reference,account]))
    .rows[0]!.id;
  return {businessId,branchId,saleId,paymentId,attemptId,reference,headers};
}
async function financialStatus(saleId:string,paymentId:string){
  const ledger=(await pool.query<{sale_status:string;payment_status:string;
    receipts:string}>(
    "SELECT s.status AS sale_status,p.status AS payment_status,"+
    "(SELECT count(*)::text FROM cashbook_entries WHERE "+
    "source_type='PAYMENT' AND source_id=p.id) AS receipts "+
    "FROM sales s JOIN payments p ON p.sale_id=s.id "+
    "WHERE s.id=$1 AND p.id=$2",[saleId,paymentId])).rows[0];
  return ledger;
}
const endpoint="/v1/payments/hubtel/notifications";
describe("Hubtel callback hints are never authoritative payment verification",()=>{
  it("leaves collection untouched while disabled, then records only bounded untrusted hints",async()=>{
    const m=await merchant();
    delete process.env[enabledVar];
    const fake={
      ResponseCode:"0000",Status:"Success",
      Data:{ClientReference:m.reference,Amount:55,
        CustomerMobileNumber:"+233500000000",PaymentMethod:"MobileMoney"},
    };
    const disabled=await app.inject({method:"POST",url:endpoint,payload:fake});
    expect(disabled.statusCode,disabled.body).toBe(202);
    let stored=await pool.query<{n:string}>(
      "SELECT count(*)::text AS n FROM hubtel_pos_notification_inbox WHERE attempt_id=$1",
      [m.attemptId]);
    expect(stored.rows[0]?.n).toBe("0");
    process.env[enabledVar]="true";
    const unknown=await app.inject({method:"POST",url:endpoint,
      payload:{...fake,Data:{ClientReference:"TSP-"+randomBytes(12).toString("hex")}}});
    expect(unknown.statusCode).toBe(202);
    expect((await app.inject({method:"POST",url:endpoint,
      payload:{ResponseCode:"0000",Status:"Success",
        Data:{ClientReference:"not-a-valid-ref"}}})).statusCode).toBe(202);
    const first=await app.inject({method:"POST",url:endpoint,payload:fake});
    const replay=await app.inject({method:"POST",url:endpoint,payload:fake});
    expect(first.statusCode,first.body).toBe(202);
    expect(replay.statusCode,replay.body).toBe(202);
    expect(first.body).toContain("SERVER_SIDE_REQUIRED");
    stored=await pool.query<{n:string}>(
      "SELECT count(*)::text AS n FROM hubtel_pos_notification_inbox WHERE attempt_id=$1",
      [m.attemptId]);
    expect(stored.rows[0]?.n).toBe("1");
    const info=(await pool.query<{trust_level:string;status_hint:string;
      notification_digest:string}>(
      "SELECT trust_level,status_hint,notification_digest "+
      "FROM hubtel_pos_notification_inbox WHERE attempt_id=$1",
      [m.attemptId])).rows[0]!;
    expect(info.trust_level).toBe("UNTRUSTED");
    expect(info.status_hint).toBe("SUCCESS_CLAIM");
    expect(info.notification_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(info)).not.toContain("233500000000");
    const monitor=await getBusinessHubtelPosMonitor(pool,{
      businessId:m.businessId});
    const item=monitor.attempts.find(x=>x.attemptId===m.attemptId);
    expect(item).toMatchObject({notificationCount:1,
      lastNotificationHint:"SUCCESS_CLAIM",notificationTrust:"UNTRUSTED",
      saleStatus:"OPEN",paymentStatus:"PENDING"});
    expect((await app.inject({method:"GET",url:
      "/v1/payments/hubtel/reconciliation?businessId="+m.businessId,
      headers:m.headers})).statusCode).toBe(200);
    expect(await financialStatus(m.saleId,m.paymentId)).toEqual({
      sale_status:"OPEN",payment_status:"PENDING",receipts:"0"});
  });

  it("caps attacker-supplied variants and rejects cross-business forged scope",async()=>{
    const m=await merchant(),foreign=await merchant();
    process.env[enabledVar]="true";
    for(let i=0;i<20;i++){
      const result=await app.inject({method:"POST",url:endpoint,
        payload:{responseCode:i%2?"2001":"0000",
          status:i%2?"Failed":"Success",clientReference:m.reference,
          fakeSequence:i,amount:99999}});
      expect(result.statusCode,result.body).toBe(202);
    }
    const total=(await pool.query<{n:number}>(
      "SELECT count(*)::int AS n FROM hubtel_pos_notification_inbox "+
      "WHERE attempt_id=$1",[m.attemptId])).rows[0]?.n;
    expect(total).toBe(12);
    expect(await financialStatus(m.saleId,m.paymentId)).toEqual({
      sale_status:"OPEN",payment_status:"PENDING",receipts:"0"});
    await expect(pool.query(
      "INSERT INTO hubtel_pos_notification_inbox "+
      "(attempt_id,business_id,client_reference,notification_digest,"+
      "status_hint) VALUES($1,$2,$3,$4,'SUCCESS_CLAIM')",
      [m.attemptId,foreign.businessId,m.reference,
        randomBytes(32).toString("hex")])).rejects.toThrow();
    await expect(pool.query(
      "UPDATE hubtel_pos_notification_inbox SET status_hint='FAILED_CLAIM' "+
      "WHERE attempt_id=$1",[m.attemptId])).rejects.toThrow();
    await expect(pool.query(
      "DELETE FROM hubtel_pos_notification_inbox WHERE attempt_id=$1",
      [m.attemptId])).rejects.toThrow();
    const foreignMonitor=await getBusinessHubtelPosMonitor(pool,{
      businessId:foreign.businessId});
    expect(foreignMonitor.attempts.every(x=>x.attemptId!==m.attemptId)).toBe(true);
  });

  it("rejects invalid callback payloads without storing private customer details",async()=>{
    const m=await merchant();
    process.env[enabledVar]="true";
    for(const input of [null,[],42,{data:{clientReference:"abc"}},
      {responseCode:"0000",data:{clientReference:123}},
      {ResponseCode:"0000",Data:{ClientReference:"TSP-NOTHEX"}}]){
      expect(await recordUntrustedHubtelNotification(pool,input)).toBe("IGNORED");
    }
    const callbacks=(await pool.query<{n:number}>(
      "SELECT count(*)::int AS n FROM hubtel_pos_notification_inbox "+
      "WHERE attempt_id=$1",[m.attemptId])).rows[0]?.n;
    expect(callbacks).toBe(0);
  });
});
