import {randomUUID} from "node:crypto";
import {mkdtemp,writeFile,chmod,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {beforeAll,afterAll,beforeEach,describe,it,expect} from "vitest";
import {createPool} from "../src/db.js";
import {buildApp} from "../src/app.js";

process.env.DATABASE_URL??="postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
const app=buildApp(pool);
let temp="";
let acceptedScript="";
let uncertainScript="";
const savedEnv={
  enabled:process.env.TRADEOS_DOCUMENT_EMAIL_ENABLED,
  verified:process.env.TRADEOS_DOCUMENT_EMAIL_VERIFIED,
  sender:process.env.TRADEOS_DOCUMENT_EMAIL_FROM,
  sendmail:process.env.TRADEOS_SENDMAIL_PATH,
};
beforeAll(async()=>{
  await app.ready();
  temp=await mkdtemp(join(tmpdir(),"tradeos-document-delivery-"));
  acceptedScript=join(temp,"accept-mail");
  uncertainScript=join(temp,"uncertain-mail");
  await writeFile(acceptedScript,"#!/bin/sh\ncat > "+join(temp,"last-message")+"\nexit 0\n");
  await writeFile(uncertainScript,"#!/bin/sh\ncat >/dev/null\nexit 75\n");
  await chmod(acceptedScript,0o700);
  await chmod(uncertainScript,0o700);
});
beforeEach(async()=>{
  await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");
  process.env.TRADEOS_DOCUMENT_EMAIL_ENABLED="false";
  process.env.TRADEOS_DOCUMENT_EMAIL_VERIFIED="false";
  process.env.TRADEOS_DOCUMENT_EMAIL_FROM="docs@tradeos.test";
  process.env.TRADEOS_SENDMAIL_PATH=acceptedScript;
});
afterAll(async()=>{
  for(const [key,value] of Object.entries({
    TRADEOS_DOCUMENT_EMAIL_ENABLED:savedEnv.enabled,
    TRADEOS_DOCUMENT_EMAIL_VERIFIED:savedEnv.verified,
    TRADEOS_DOCUMENT_EMAIL_FROM:savedEnv.sender,
    TRADEOS_SENDMAIL_PATH:savedEnv.sendmail,
  })) if(value===undefined)delete process.env[key];else process.env[key]=value;
  await app.close();await pool.end();
  if(temp)await rm(temp,{recursive:true,force:true});
});
async function fixture(label:string){
  const email=label+"@tradeos.test";
  const register=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"Owner",email,password:"TradeOS-delivery-123!",
      platform:"WEB",deviceKey:label,appVersion:"test"}});
  expect(register.statusCode,register.body).toBe(201);
  const headers={authorization:"Bearer "+register.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:"Merchant "+label,businessType:"RETAIL_HARDWARE",
      branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const branchId=onboard.json().branch.id as string;
  const catalog=await app.inject({method:"POST",url:"/v1/catalog/items",
    headers,payload:{businessId,name:"Cash register repair",kind:"SERVICE",
      units:[{code:"job",label:"Job",canSell:true,defaultSalePriceMinor:2250}]}});
  expect(catalog.statusCode,catalog.body).toBe(201);
  const item=catalog.json().item.id as string;
  const quote=await app.inject({method:"POST",url:"/v1/commercial-documents",
    headers,payload:{businessId,branchId,kind:"QUOTATION",
      customerName:"Ama Boateng",customerEmail:"ama@example.com",
      clientRequestId:randomUUID(),
      lines:[{itemId:item,saleUnitCode:"job",quantity:2}]}});
  expect(quote.statusCode,quote.body).toBe(201);
  const quoteId=quote.json().document.id as string;
  return {businessId,branchId,headers,item,quoteId};
}
type Merchant=Awaited<ReturnType<typeof fixture>>;
async function issue(m:Merchant){
  const r=await app.inject({method:"POST",
    url:"/v1/commercial-documents/"+m.quoteId+"/issue",
    headers:m.headers,payload:{businessId:m.businessId}});
  expect(r.statusCode,r.body).toBe(200);
}
function prepare(m:Merchant,extra:Record<string,unknown>={}){
  return app.inject({method:"POST",url:"/v1/document-deliveries",
    headers:m.headers,payload:{
      businessId:m.businessId,documentId:m.quoteId,
      documentKind:"COMMERCIAL_DOCUMENT",channel:"EMAIL",
      recipientEmail:"ama@example.com",recipientConfirmed:true,
      clientRequestId:randomUUID(),...extra}});
}
function send(m:Merchant,id:string){
  return app.inject({method:"POST",url:"/v1/document-deliveries/"+id+"/send",
    headers:m.headers,payload:{businessId:m.businessId}});
}
function enable(){
  process.env.TRADEOS_DOCUMENT_EMAIL_ENABLED="true";
  process.env.TRADEOS_DOCUMENT_EMAIL_VERIFIED="true";
}

describe("tenant-scoped audited transactional document delivery",()=>{
  it("rejects unissued documents, unconfirmed recipients, and unsupported WhatsApp",async()=>{
    const m=await fixture("delivery-gates");
    const draft=await prepare(m);
    expect(draft.statusCode,draft.body).toBe(409);
    expect(draft.json().error).toBe("DELIVERY_DOCUMENT_NOT_ISSUED");
    await issue(m);
    const noConsent=await prepare(m,{recipientConfirmed:false});
    expect(noConsent.statusCode,noConsent.body).toBe(400);
    const injection=await prepare(m,{
      recipientEmail:"ama@example.com\r\nBcc: attacker@example.com"});
    expect(injection.statusCode,injection.body).toBe(400);
    expect(injection.json().error).toBe("DELIVERY_EMAIL_INVALID");
    const unsupported=await prepare(m,{channel:"WHATSAPP"});
    expect(unsupported.statusCode,unsupported.body).toBe(409);
    const manual=await prepare(m,{recipientEmail:"unknown@example.com"});
    expect(manual.statusCode,manual.body).toBe(409);
    const correct=await prepare(m);
    expect(correct.statusCode,correct.body).toBe(201);
    expect(correct.json().delivery).toMatchObject({
      status:"QUEUED",attemptCount:0,recipientEmail:"ama@example.com",
      documentNumber:expect.stringMatching(/^Q-\d{4}-/),
    });
    const readiness=await app.inject({method:"GET",
      url:"/v1/document-deliveries/readiness?businessId="+m.businessId,
      headers:m.headers});
    expect(readiness.json()).toMatchObject({
      emailEnabled:false,whatsappEnabled:false});
    const sent=await send(m,correct.json().delivery.id);
    expect(sent.statusCode,sent.body).toBe(409);
    expect(sent.json().error).toBe("DELIVERY_EMAIL_NOT_READY");
    const counts=await pool.query<{count:string}>(
      "SELECT COUNT(*)::text AS count FROM document_delivery_attempts");
    expect(Number(counts.rows[0]?.count)).toBe(0);
  });

  it("accepts exactly one email from verified sender, never claims inbox delivery",async()=>{
    const m=await fixture("accepted-mail");
    await issue(m);enable();
    const prep=await prepare(m);
    expect(prep.statusCode,prep.body).toBe(201);
    const id=prep.json().delivery.id as string;
    const first=await send(m,id);
    expect(first.statusCode,first.body).toBe(200);
    expect(first.json().delivery).toMatchObject({
      status:"ACCEPTED",attemptCount:1,senderEmail:"docs@tradeos.test",
    });
    expect(first.json().notice).toContain("not confirmed");
    const second=await send(m,id);
    expect(second.statusCode,second.body).toBe(200);
    expect(second.json().idempotentReplay).toBe(true);
    const history=await app.inject({method:"GET",
      url:"/v1/document-deliveries?businessId="+m.businessId+
        "&documentKind=COMMERCIAL_DOCUMENT&documentId="+m.quoteId,
      headers:m.headers});
    expect(history.statusCode,history.body).toBe(200);
    expect(history.json().deliveries).toHaveLength(1);
    expect(history.json().deliveries[0].status).toBe("ACCEPTED");
    const message=await readFile(join(temp,"last-message"),"utf8");
    expect(message).toContain("From: TradeOS Africa <docs@tradeos.test>");
    expect(message).toContain("To: <ama@example.com>");
    expect(message).toContain("Cash register repair");
    expect(message).toContain("₵45.00");
    expect(message).toContain("verified document");
    expect(message).not.toContain("Content-Type: application/pdf");
    const attempts=await pool.query<{status:string}>(
      "SELECT status FROM document_delivery_attempts WHERE delivery_id=$1",[id]);
    expect(attempts.rows.map(row=>row.status)).toEqual(["ACCEPTED"]);
    const nonFinancial=await pool.query<{payments:string;movements:string}>(
      `SELECT (SELECT COUNT(*)::text FROM payments) AS payments,
       (SELECT COUNT(*)::text FROM inventory_movements) AS movements`);
    expect(nonFinancial.rows[0]).toEqual({payments:"0",movements:"0"});
  });

  it("isolates tenants and blocks idempotency key reuse or recipient spoofing",async()=>{
    const a=await fixture("delivery-tenant-a");
    const b=await fixture("delivery-tenant-b");
    await issue(a);
    const key=randomUUID();
    const created=await prepare(a,{clientRequestId:key});
    expect(created.statusCode,created.body).toBe(201);
    const same=await prepare(a,{clientRequestId:key});
    expect(same.statusCode,same.body).toBe(200);
    expect(same.json().idempotentReplay).toBe(true);
    const switched=await prepare(a,{clientRequestId:key,
      recipientEmail:"other@example.com",
      recipientOverrideReason:"Recipient updated after a verified call"});
    expect(switched.statusCode).toBe(409);
    expect(switched.json().error).toBe("DELIVERY_REQUEST_CONFLICT");
    const override=await prepare(a,{recipientEmail:"other@example.com",
      recipientOverrideReason:"Recipient verified by telephone with the buyer"});
    expect(override.statusCode,override.body).toBe(201);
    expect(override.json().delivery.recipientOverrideReason)
      .toContain("verified by telephone");
    const wrongBusiness=await app.inject({method:"GET",
      headers:b.headers,url:"/v1/document-deliveries?businessId="+b.businessId+
        "&documentKind=COMMERCIAL_DOCUMENT&documentId="+a.quoteId});
    expect(wrongBusiness.statusCode).toBe(200);
    expect(wrongBusiness.json().deliveries).toHaveLength(0);
    const forbidden=await app.inject({method:"POST",
      url:"/v1/document-deliveries/"+created.json().delivery.id+"/send",
      headers:b.headers,payload:{businessId:a.businessId}});
    expect(forbidden.statusCode).toBe(403);
    const anonymous=await app.inject({method:"GET",
      url:"/v1/document-deliveries?businessId="+a.businessId+
        "&documentKind=COMMERCIAL_DOCUMENT&documentId="+a.quoteId});
    expect(anonymous.statusCode).toBe(401);
    const crossPrepare=await prepare(b,{
      documentId:a.quoteId,recipientEmail:"ama@example.com"});
    expect(crossPrepare.statusCode).toBe(404);
  });

  it("marks uncertain provider results for manual review and blocks repeat sends",async()=>{
    const m=await fixture("uncertain-email");
    await issue(m);enable();
    process.env.TRADEOS_SENDMAIL_PATH=uncertainScript;
    const prepared=await prepare(m);
    expect(prepared.statusCode,prepared.body).toBe(201);
    const id=prepared.json().delivery.id as string;
    const uncertain=await send(m,id);
    expect(uncertain.statusCode,uncertain.body).toBe(502);
    expect(uncertain.json().delivery.status).toBe("REVIEW_REQUIRED");
    expect(uncertain.json().error).toBe("DELIVERY_PROVIDER_UNCERTAIN");
    process.env.TRADEOS_SENDMAIL_PATH=acceptedScript;
    const retry=await send(m,id);
    expect(retry.statusCode,retry.body).toBe(409);
    expect(retry.json().error).toBe("DELIVERY_MANUAL_REVIEW_REQUIRED");
    const attempts=await pool.query<{status:string}>(
      "SELECT status FROM document_delivery_attempts WHERE delivery_id=$1",[id]);
    expect(attempts.rows.map(row=>row.status)).toEqual(["REVIEW_REQUIRED"]);
  });

  it("sends an issued supplier purchase order to its supplier snapshot only",async()=>{
    const m=await fixture("supplier-document");
    enable();
    const supplier=(await pool.query<{id:string}>(
      `INSERT INTO suppliers(business_id,name,email)
       VALUES($1,'Steel Supplies Ghana','supplier@tradeos.test') RETURNING id`,
       [m.businessId])).rows[0]!.id;
    const product=(await pool.query<{id:string}>(
      `INSERT INTO catalog_items(business_id,name,kind,stock_unit_code,track_stock)
       VALUES($1,'Steel nails','PRODUCT','bag',true) RETURNING id`,
      [m.businessId])).rows[0]!.id;
    await pool.query(`INSERT INTO catalog_item_units(
      business_id,item_id,unit_code,unit_label,can_purchase,can_stock)
      VALUES($1,$2,'bag','Bag',true,true)`,[m.businessId,product]);
    const created=await app.inject({method:"POST",url:"/v1/purchase-orders",
      headers:m.headers,payload:{businessId:m.businessId,branchId:m.branchId,
        supplierId:supplier,clientRequestId:randomUUID(),
        lines:[{itemId:product,purchaseUnitCode:"bag",quantity:3,
          unitCostMinor:1500}]}});
    expect(created.statusCode,created.body).toBe(201);
    const po=created.json().order.id as string;
    const issued=await app.inject({method:"POST",
      url:"/v1/purchase-orders/"+po+"/issue",
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(issued.statusCode,issued.body).toBe(200);
    const prepared=await app.inject({method:"POST",
      url:"/v1/document-deliveries",headers:m.headers,payload:{
        businessId:m.businessId,documentId:po,documentKind:"PURCHASE_ORDER",
        channel:"EMAIL",recipientEmail:"supplier@tradeos.test",
        recipientConfirmed:true,clientRequestId:randomUUID()}});
    expect(prepared.statusCode,prepared.body).toBe(201);
    const accepted=await send(m,prepared.json().delivery.id);
    expect(accepted.statusCode,accepted.body).toBe(200);
    expect(accepted.json().delivery.status).toBe("ACCEPTED");
    const body=await readFile(join(temp,"last-message"),"utf8");
    expect(body).toContain("Steel nails");
    expect(body).toContain("₵45.00");
    expect(body).toContain("supplier@tradeos.test");
    expect(body).toContain("/purchase-orders/"+po);
    const stockMovements=await pool.query<{count:string}>(
      "SELECT COUNT(*)::text AS count FROM inventory_movements WHERE business_id=$1",
      [m.businessId]);
    expect(Number(stockMovements.rows[0]?.count)).toBe(0);
  });

  it("rate-limits prepared emails without breaking exact idempotent retries",async()=>{
    const m=await fixture("delivery-rate");
    await issue(m);
    const key=randomUUID();
    const first=await prepare(m,{clientRequestId:key});
    expect(first.statusCode,first.body).toBe(201);
    for(let i=0;i<19;i++){
      const response=await prepare(m);
      expect(response.statusCode,response.body).toBe(201);
    }
    const limited=await prepare(m);
    expect(limited.statusCode,limited.body).toBe(429);
    expect(limited.json().error).toBe("DELIVERY_RATE_LIMIT");
    const replay=await prepare(m,{clientRequestId:key});
    expect(replay.statusCode,replay.body).toBe(200);
    expect(replay.json().idempotentReplay).toBe(true);
  });

  it("rejects sending a prepared document after cancellation",async()=>{
    const m=await fixture("cancel-quote");
    await issue(m);enable();
    const prepared=await prepare(m);
    expect(prepared.statusCode,prepared.body).toBe(201);
    const cancel=await app.inject({method:"POST",
      url:"/v1/commercial-documents/"+m.quoteId+"/cancel",
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(cancel.statusCode,cancel.body).toBe(200);
    const blocked=await send(m,prepared.json().delivery.id);
    expect(blocked.statusCode,blocked.body).toBe(409);
    expect(blocked.json().error).toBe("DELIVERY_DOCUMENT_NOT_ISSUED");
    const attempts=await pool.query<{count:string}>(
      "SELECT COUNT(*)::text AS count FROM document_delivery_attempts");
    expect(Number(attempts.rows[0]?.count)).toBe(0);
  });
});
