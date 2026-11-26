import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { processSupplierDeliveryOnce } from "../src/supplier-document-delivery-worker.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
const app=buildApp(pool);
const KEYS=[
  "TRADEOS_DOC_DELIVERY_ENABLED","TRADEOS_DOC_SMTP_VERIFIED",
  "TRADEOS_DOC_SMTP_FROM","TRADEOS_DOC_SMTP_FROM_NAME",
  "TRADEOS_DOC_SMTP_HOST","TRADEOS_DOC_SMTP_PORT","TRADEOS_DOC_SMTP_USER",
  "TRADEOS_DOC_SMTP_PASS",
] as const;
const env=new Map(KEYS.map(key=>[key,process.env[key]]));
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{
  await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");
  for(const key of KEYS)delete process.env[key];
});
afterAll(async()=>{
  for(const key of KEYS){
    const value=env.get(key);
    if(value===undefined)delete process.env[key];
    else process.env[key]=value;
  }
  await app.close();await pool.end();
});
function enableTestSender(){
  process.env.TRADEOS_DOC_DELIVERY_ENABLED="true";
  process.env.TRADEOS_DOC_SMTP_VERIFIED="true";
  process.env.TRADEOS_DOC_SMTP_FROM="verified@tradeos.test";
  process.env.TRADEOS_DOC_SMTP_FROM_NAME="TradeOS Test Merchant Delivery";
  process.env.TRADEOS_DOC_SMTP_HOST="local-fake-smtp.invalid";
  process.env.TRADEOS_DOC_SMTP_PORT="587";
  process.env.TRADEOS_DOC_SMTP_USER="fake";
  process.env.TRADEOS_DOC_SMTP_PASS="fake";
}
async function merchant(tag:string){
  const registered=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"Delivery Test Owner",email:`delivery-${tag}@tradeos.test`,
      password:"TradeOS-Test-Delivery-Owner-123!",platform:"WEB",
      deviceKey:"delivery-"+tag,appVersion:"test"}});
  expect(registered.statusCode,registered.body).toBe(201);
  const headers={authorization:"Bearer "+registered.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",headers,
    payload:{name:`Merchant Shop ${tag}`,businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const branchId=onboard.json().branch.id as string;
  const supplierId=(await pool.query<{id:string}>(
    `INSERT INTO suppliers(business_id,name,phone,email,address)
     VALUES($1,'Wholesaler Ghana','0241112222','supplier@example.com','Accra')
     RETURNING id`,[businessId])).rows[0]!.id;
  const item=(await pool.query<{id:string}>(
    `INSERT INTO catalog_items(business_id,name,kind,stock_unit_code,track_stock)
     VALUES($1,'Steel rod','PRODUCT','piece',true) RETURNING id`,
    [businessId])).rows[0]!.id;
  await pool.query(`INSERT INTO catalog_item_units(
      business_id,item_id,unit_code,unit_label,can_purchase,can_sell,can_stock)
    VALUES($1,$2,'piece','piece',true,false,false)`,[businessId,item]);
  const draft=await app.inject({method:"POST",url:"/v1/purchase-orders",headers,
    payload:{businessId,branchId,supplierId,clientRequestId:randomUUID(),
      lines:[{itemId:item,purchaseUnitCode:"piece",quantity:4,unitCostMinor:1250}]}});
  expect(draft.statusCode,draft.body).toBe(201);
  const orderId=draft.json().order.id as string;
  return {businessId,branchId,supplierId,orderId,item,headers};
}
type Merchant=Awaited<ReturnType<typeof merchant>>;
async function issue(m:Merchant){
  const result=await app.inject({method:"POST",
    url:`/v1/purchase-orders/${m.orderId}/issue`,
    headers:m.headers,payload:{businessId:m.businessId}});
  expect(result.statusCode,result.body).toBe(200);
}
async function prepare(m:Merchant,input?:{
  email?:string;requestId?:string
}){
  return app.inject({method:"POST",
    url:`/v1/purchase-orders/${m.orderId}/deliveries`,headers:m.headers,
    payload:{businessId:m.businessId,
      clientRequestId:input?.requestId??randomUUID(),
      recipientEmail:input?.email??"supplier@example.com"}});
}
const config=(m:Merchant)=>app.inject({method:"GET",headers:m.headers,
  url:`/v1/supplier-document-delivery/config?businessId=${m.businessId}`});
const history=(m:Merchant)=>app.inject({method:"GET",headers:m.headers,
  url:`/v1/purchase-orders/${m.orderId}/deliveries?businessId=${m.businessId}`});
async function action(m:Merchant,deliveryId:string,verb:string,extra={}) {
  return app.inject({method:"POST",headers:m.headers,
    url:`/v1/supplier-document-deliveries/${deliveryId}/${verb}`,
    payload:{businessId:m.businessId,...extra}});
}
async function count(m:Merchant,table:string){
  const found=(await pool.query<{count:string}>(
    `SELECT COUNT(*)::text AS count FROM ${table} WHERE business_id=$1`,
    [m.businessId])).rows[0];
  return Number(found?.count??0);
}
describe("safe supplier purchase-order email outbox",()=>{
  it("prepares an immutable server-sourced document and refuses unconfigured outbound email",async()=>{
    const m=await merchant("disabled");await issue(m);
    const availability=await config(m);
    expect(availability.statusCode,availability.body).toBe(200);
    expect(availability.json().email).toMatchObject({
      ready:false,issue:"DISABLED",acceptanceOnly:true,
      deliveryReceiptsAvailable:false});
    expect(availability.json().whatsapp.ready).toBe(false);
    const requestId=randomUUID();
    const created=await prepare(m,{requestId});
    expect(created.statusCode,created.body).toBe(201);
    const record=created.json().delivery;
    expect(record).toMatchObject({
      status:"PREPARED",documentNumber:expect.stringMatching(/^PO-/),
      recipientEmail:"supplier@example.com",attemptCount:0,deliveryConfirmed:false,
    });
    expect(record.bodyText).toContain("Steel rod | 4 piece | ₵12.50 | ₵50.00");
    expect(record.bodyText).toContain("TOTAL: ₵50.00");
    const replay=await prepare(m,{requestId});
    expect(replay.statusCode,replay.body).toBe(200);
    expect(replay.json().delivery.id).toBe(record.id);
    const changed=await prepare(m,{requestId,email:"changed@example.com"});
    expect(changed.statusCode,changed.body).toBe(409);
    const blocked=await action(m,record.id,"authorize",{
      recipientEmail:"supplier@example.com",
      recipientConfirmed:true,consentConfirmed:true});
    expect(blocked.statusCode,blocked.body).toBe(503);
    expect(blocked.json().error).toBe("DELIVERY_SENDER_NOT_READY");
    const listed=await history(m);
    expect(listed.statusCode,listed.body).toBe(200);
    expect(listed.json().deliveries).toHaveLength(1);
    expect(listed.json().deliveries[0].status).toBe("PREPARED");
    expect(await count(m,"inventory_movements")).toBe(0);
    expect(await count(m,"supplier_payable_ledger")).toBe(0);
    expect(await count(m,"cashbook_entries")).toBe(0);
  });
  it("allows an authenticated merchant to preview the exact saved PDF before sending",async()=>{
    const a=await merchant("pdf-own"),b=await merchant("pdf-foreign");
    await issue(a);
    const created=await prepare(a);
    expect(created.statusCode,created.body).toBe(201);
    const deliveryId=created.json().delivery.id as string;
    const path="/v1/supplier-document-deliveries/"+deliveryId+"/pdf?businessId=";
    const pdf=await app.inject({method:"GET",headers:a.headers,
      url:path+a.businessId});
    expect(pdf.statusCode,pdf.body).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain(".pdf");
    expect(pdf.headers["cache-control"]).toContain("no-store");
    expect(pdf.rawPayload.subarray(0,5).toString()).toBe("%PDF-");
    const unauthenticated=await app.inject({method:"GET",url:path+a.businessId});
    expect(unauthenticated.statusCode).toBe(401);
    const foreign=await app.inject({method:"GET",headers:b.headers,
      url:path+b.businessId});
    expect(foreign.statusCode).toBe(404);
    // Previewing must not mark as sent, affect stock or post money.
    expect((await history(a)).json().deliveries[0].status).toBe("PREPARED");
    expect(await count(a,"inventory_movements")).toBe(0);
    expect(await count(a,"cashbook_entries")).toBe(0);
  });
  it("prepares manual WhatsApp and matching PDF without email or provider sends",async()=>{
    const a=await merchant("wa-manual"),b=await merchant("wa-other");
    await issue(a);
    await pool.query("UPDATE suppliers SET email=NULL WHERE id=$1",[a.supplierId]);
    const url="/v1/purchase-orders/"+a.orderId+"/manual-whatsapp?businessId=";
    const prepared=await app.inject({method:"GET",headers:a.headers,
      url:url+a.businessId});
    expect(prepared.statusCode,prepared.body).toBe(200);
    expect(prepared.headers["cache-control"]).toContain("no-store");
    expect(prepared.json()).toMatchObject({
      recipientPhone:"233241112222",providerConnected:false,delivered:false,
    });
    expect(prepared.json().message).toContain("₵50.00");
    expect(prepared.json().message).toContain("attach the full purchase-order PDF");
    expect((await app.inject({method:"GET",url:url+a.businessId})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",headers:b.headers,
      url:url+b.businessId})).statusCode).toBe(404);
    const pdf=await app.inject({method:"GET",headers:a.headers,
      url:"/v1/purchase-orders/"+a.orderId+
        "/manual-share-pdf?businessId="+a.businessId});
    expect(pdf.statusCode,pdf.body).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.rawPayload.subarray(0,5).toString()).toBe("%PDF-");
    expect((await app.inject({method:"GET",headers:b.headers,
      url:"/v1/purchase-orders/"+a.orderId+
        "/manual-share-pdf?businessId="+b.businessId})).statusCode).toBe(404);
    expect(await count(a,"supplier_document_deliveries")).toBe(0);
    expect(await count(a,"supplier_document_delivery_attempts")).toBe(0);
    expect(await count(a,"cashbook_entries")).toBe(0);
    expect(await count(a,"inventory_movements")).toBe(0);
  });
  it("rejects cancelled or inactive supplier manual WhatsApp operations",async()=>{
    const m=await merchant("wa-status");
    const url="/v1/purchase-orders/"+m.orderId+"/manual-whatsapp?businessId="+m.businessId;
    expect((await app.inject({method:"GET",headers:m.headers,url})).statusCode).toBe(409);
    await issue(m);
    await pool.query("UPDATE suppliers SET phone='0302112233' WHERE id=$1",[m.supplierId]);
    const invalid=await app.inject({method:"GET",headers:m.headers,url});
    expect(invalid.statusCode,invalid.body).toBe(409);
    expect(invalid.json().error).toBe("SUPPLIER_WHATSAPP_PHONE_REQUIRED");
    await pool.query("UPDATE suppliers SET phone='0241112222',is_active=false WHERE id=$1",[m.supplierId]);
    expect((await app.inject({method:"GET",headers:m.headers,url})).statusCode).toBe(409);
    await pool.query("UPDATE suppliers SET is_active=true WHERE id=$1",[m.supplierId]);
    const cancelled=await app.inject({method:"POST",headers:m.headers,
      url:"/v1/purchase-orders/"+m.orderId+"/cancel",
      payload:{businessId:m.businessId}});
    expect(cancelled.statusCode,cancelled.body).toBe(200);
    expect((await app.inject({method:"GET",headers:m.headers,url})).statusCode).toBe(409);
  });
  it("enforces issued orders, saved supplier address, tenant isolation and auth",async()=>{
    const a=await merchant("scope-a"),b=await merchant("scope-b");
    const unissued=await prepare(a);
    expect(unissued.statusCode).toBe(409);
    await issue(a);
    const bad=await prepare(a,{email:"spoofed@fraud.test"});
    expect(bad.statusCode,bad.body).toBe(409);
    expect(bad.json().error).toBe("DELIVERY_SUPPLIER_EMAIL_MISMATCH");
    const noAuth=await app.inject({method:"GET",
      url:`/v1/purchase-orders/${a.orderId}/deliveries?businessId=${a.businessId}`});
    expect(noAuth.statusCode).toBe(401);
    const own=await prepare(a);
    expect(own.statusCode,own.body).toBe(201);
    const foreignList=await app.inject({method:"GET",headers:b.headers,
      url:`/v1/purchase-orders/${a.orderId}/deliveries?businessId=${b.businessId}`});
    expect(foreignList.statusCode).toBe(404);
    const foreignManage=await action(b,own.json().delivery.id,"cancel");
    expect(foreignManage.statusCode).toBe(404);
    expect((await history(a)).json().deliveries).toHaveLength(1);
  });
  it("requires recipient confirmation, supplier expectation and a ready verified sender",async()=>{
    const m=await merchant("approval");await issue(m);
    enableTestSender();
    const available=await config(m);
    expect(available.json().email).toMatchObject({
      ready:true,issue:null,senderEmail:"verified@tradeos.test"});
    const created=await prepare(m);
    const did=created.json().delivery.id as string;
    const missing=await action(m,did,"authorize",{
      recipientEmail:"supplier@example.com",recipientConfirmed:true});
    expect(missing.statusCode).toBe(409);
    const mismatch=await action(m,did,"authorize",{
      recipientEmail:"another@example.com",recipientConfirmed:true,consentConfirmed:true});
    expect(mismatch.statusCode).toBe(409);
    const approved=await action(m,did,"authorize",{
      recipientEmail:"supplier@example.com",recipientConfirmed:true,consentConfirmed:true});
    expect(approved.statusCode,approved.body).toBe(200);
    expect(approved.json().delivery).toMatchObject({
      status:"QUEUED",recipientConfirmed:true,consentConfirmed:true,
      senderEmail:"verified@tradeos.test",attemptCount:0});
    const again=await action(m,did,"authorize",{
      recipientEmail:"supplier@example.com",recipientConfirmed:true,consentConfirmed:true});
    expect(again.statusCode).toBe(200);
    expect(await count(m,"supplier_document_deliveries")).toBe(1);
  });
  it("records SMTP acceptance only and never posts inventory, payable or cash",async()=>{
    const m=await merchant("accepted");await issue(m);enableTestSender();
    const created=await prepare(m);
    const did=created.json().delivery.id as string;
    await action(m,did,"authorize",{recipientEmail:"supplier@example.com",
      recipientConfirmed:true,consentConfirmed:true});
    const delivered:Array<string>=[];
    const result=await processSupplierDeliveryOnce(pool,async(job)=>{
      delivered.push(job.id);
      expect(job.body_text).toContain("TOTAL: ₵50.00");
      expect(job.sender_email).toBe("verified@tradeos.test");
      return {messageId:"<accepted-id@fake.test>",accepted:true};
    });
    expect(result).toBe("ACCEPTED");
    expect(delivered).toEqual([did]);
    expect((await history(m)).json().deliveries[0]).toMatchObject({
      status:"ACCEPTED",attemptCount:1,providerMessageId:"<accepted-id@fake.test>",
      deliveryConfirmed:false});
    expect(await processSupplierDeliveryOnce(pool,async()=>{
      throw new Error("No duplicate sending allowed");
    })).toBe("EMPTY");
    expect(await count(m,"supplier_document_delivery_attempts")).toBe(1);
    for(const table of ["purchases","inventory_movements","supplier_payable_ledger",
      "cashbook_entries"]){expect(await count(m,table),table).toBe(0);}
    const cancel=await action(m,did,"cancel");
    expect(cancel.statusCode).toBe(409);
    const retry=await action(m,did,"retry",{confirmedNoDelivery:true});
    expect(retry.statusCode).toBe(409);
  });
  it("holds uncertain SMTP outcomes for manual review and prevents blind resends",async()=>{
    const m=await merchant("uncertain");await issue(m);enableTestSender();
    const created=await prepare(m);
    const did=created.json().delivery.id as string;
    await action(m,did,"authorize",{recipientEmail:"supplier@example.com",
      recipientConfirmed:true,consentConfirmed:true});
    let n=0;
    expect(await processSupplierDeliveryOnce(pool,async()=>{
      n++;throw new Error("SMTP acknowledgement may have been lost");
    })).toBe("REVIEW_REQUIRED");
    expect(await processSupplierDeliveryOnce(pool,async()=>{
      n++;return {messageId:"second",accepted:true};
    })).toBe("EMPTY");
    expect(n).toBe(1);
    const without=await action(m,did,"retry");
    expect(without.statusCode).toBe(409);
    const authorized=await action(m,did,"retry",{confirmedNoDelivery:true});
    expect(authorized.statusCode,authorized.body).toBe(200);
    expect(authorized.json().delivery.status).toBe("QUEUED");
    expect(await processSupplierDeliveryOnce(pool,async()=>{
      n++;return {messageId:"retry-accepted",accepted:true};
    })).toBe("ACCEPTED");
    expect(n).toBe(2);
    expect(await count(m,"supplier_document_delivery_attempts")).toBe(2);
    expect((await history(m)).json().deliveries[0]).toMatchObject({
      status:"ACCEPTED",attemptCount:2,deliveryConfirmed:false});
  });
  it("stops queued messages when supplier email changes, or when an order is cancelled",async()=>{
    const m=await merchant("sup-changed");await issue(m);enableTestSender();
    const created=await prepare(m);const did=created.json().delivery.id as string;
    await action(m,did,"authorize",{recipientEmail:"supplier@example.com",
      recipientConfirmed:true,consentConfirmed:true});
    await pool.query("UPDATE suppliers SET email='new@example.com' WHERE id=$1",
      [m.supplierId]);
    let sends=0;
    expect(await processSupplierDeliveryOnce(pool,async()=>{
      sends++;return {messageId:"unexpected",accepted:true};
    })).toBe("EMPTY");
    expect(sends).toBe(0);
    expect((await history(m)).json().deliveries[0].status).toBe("REVIEW_REQUIRED");
    expect((await history(m)).json().deliveries[0].lastErrorCode)
      .toBe("DELIVERY_RECONFIRM_REQUIRED");
  });
  it("cancels prepared or queued outbox entries without sending",async()=>{
    const m=await merchant("cancelled");await issue(m);enableTestSender();
    const first=await prepare(m);
    expect((await action(m,first.json().delivery.id,"cancel")).statusCode).toBe(200);
    const second=await prepare(m);
    await action(m,second.json().delivery.id,"authorize",{
      recipientEmail:"supplier@example.com",recipientConfirmed:true,consentConfirmed:true});
    expect((await action(m,second.json().delivery.id,"cancel")).statusCode).toBe(200);
    expect(await processSupplierDeliveryOnce(pool,async()=>{
      throw new Error("Cancelled entry should not send");
    })).toBe("EMPTY");
    expect(await count(m,"supplier_document_delivery_attempts")).toBe(0);
  });
});


describe("purchase order cancellation propagates to supplier email outbox",()=>{
  it("automatically cancels prepared and queued messages without touching sent history",async()=>{
    const m=await merchant("po-cancellation");await issue(m);enableTestSender();
    const one=await prepare(m);
    const two=await prepare(m);
    expect(one.statusCode).toBe(201);
    expect(two.statusCode).toBe(201);
    await action(m,two.json().delivery.id,"authorize",{
      recipientEmail:"supplier@example.com",recipientConfirmed:true,consentConfirmed:true});
    const cancelled=await app.inject({method:"POST",headers:m.headers,
      url:`/v1/purchase-orders/${m.orderId}/cancel`,
      payload:{businessId:m.businessId}});
    expect(cancelled.statusCode,cancelled.body).toBe(200);
    expect(cancelled.json().order.status).toBe("CANCELLED");
    const records=(await history(m)).json().deliveries as Array<{
      status:string;authorizedAt:string|null;lastErrorCode:string
    }>;
    expect(records).toHaveLength(2);
    for(const record of records)expect(record).toMatchObject({
      status:"CANCELLED",authorizedAt:null,lastErrorCode:"PO_CANCELLED",
    });
    let unexpected=0;
    expect(await processSupplierDeliveryOnce(pool,async()=>{
      unexpected++;return {messageId:"should-never-send",accepted:true};
    })).toBe("EMPTY");
    expect(unexpected).toBe(0);
    expect(await count(m,"supplier_document_delivery_attempts")).toBe(0);
  });
});
