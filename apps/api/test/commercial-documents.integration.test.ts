import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
const app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();});

async function owner(email:string) {
  const r=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:"Document Owner",email,password:"TradeOS-documents-123!",platform:"WEB",
    deviceKey:randomUUID(),appVersion:"test",
  }});
  expect(r.statusCode).toBe(201);
  return r.json<{session:{accessToken:string}}>().session.accessToken;
}
async function business(token:string,name:string) {
  const r=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers:{authorization:`Bearer ${token}`},
    payload:{name,businessType:"SERVICES",branchName:"Main"}});
  expect(r.statusCode).toBe(201);
  const result=r.json<{business:{id:string};branch:{id:string}}>();
  return {businessId:result.business.id,branchId:result.branch.id};
}
async function service(token:string,businessId:string,price:number) {
  const r=await app.inject({method:"POST",url:"/v1/catalog/items",
    headers:{authorization:`Bearer ${token}`},
    payload:{businessId,name:"Service item",kind:"SERVICE",
      units:[{code:"service",label:"Service",canSell:true,defaultSalePriceMinor:price}]}});
  expect(r.statusCode).toBe(201);
  return r.json<{item:{id:string}}>().item.id;
}
function payload(scope:{businessId:string;branchId:string},itemId:string,requestId=randomUUID()){
  return {...scope,clientRequestId:requestId,kind:"QUOTATION",
    customerName:"Retail Customer",notes:"Deliver within two working days",
    lines:[{itemId,saleUnitCode:"service",quantity:2.5}]};
}
function bearer(token:string){return {authorization:`Bearer ${token}`};}

describe("tenant-scoped commercial quotations and proformas",()=>{
  it("snapshots authoritative catalog prices without stock, sale or cashbook postings",async()=>{
    const token=await owner("quote-one@tradeos.test");
    const scope=await business(token,"Quote Business");
    const itemId=await service(token,scope.businessId,1200);
    const request=payload(scope,itemId);
    const first=await app.inject({method:"POST",url:"/v1/commercial-documents",
      headers:bearer(token),payload:request});
    expect(first.statusCode).toBe(201);
    const doc=first.json<{document:{
      id:string;documentNumber:string;status:string;subtotalMinor:number;totalMinor:number;
      lines:Array<{itemName:string;lineTotalMinor:number}>;
    }}>().document;
    expect(doc.status).toBe("DRAFT");
    expect(doc.documentNumber).toMatch(/^Q-\d{4}-000001$/);
    expect(doc.totalMinor).toBe(3000);
    expect(doc.lines).toMatchObject([{itemName:"Service item",lineTotalMinor:3000}]);
    const retry=await app.inject({method:"POST",url:"/v1/commercial-documents",
      headers:bearer(token),payload:request});
    expect(retry.statusCode).toBe(200);
    expect(retry.json<{idempotentReplay:boolean;document:{id:string}}>().document.id).toBe(doc.id);
    expect(retry.json().idempotentReplay).toBe(true);
    const changed=await app.inject({method:"POST",url:"/v1/commercial-documents",
      headers:bearer(token),payload:{...request,notes:"Changed under same request key"}});
    expect(changed.statusCode).toBe(409);

    const issued=await app.inject({method:"POST",
      url:`/v1/commercial-documents/${doc.id}/issue`,headers:bearer(token),
      payload:{businessId:scope.businessId}});
    expect(issued.statusCode).toBe(200);
    expect(issued.json<{document:{status:string}}>().document.status).toBe("ISSUED");
    const issuedReplay=await app.inject({method:"POST",
      url:`/v1/commercial-documents/${doc.id}/issue`,headers:bearer(token),
      payload:{businessId:scope.businessId}});
    expect(issuedReplay.statusCode).toBe(200);
    const events=await pool.query<{event_type:string}>(
      "SELECT event_type FROM audit_events WHERE business_id=$1 AND entity_id=$2 ORDER BY occurred_at",
      [scope.businessId,doc.id]);
    expect(events.rows.map(e=>e.event_type)).toEqual([
      "COMMERCIAL_DOCUMENT_CREATED","COMMERCIAL_DOCUMENT_ISSUED"
    ]);
    for(const table of ["sales","payments","inventory_movements","cashbook_entries"]) {
      const count=await pool.query<{count:string}>(`SELECT COUNT(*)::text AS count FROM ${table} WHERE business_id=$1`,
        [scope.businessId]);
      expect(Number(count.rows[0]?.count)).toBe(0);
    }
  });

  it("rejects cross-tenant customer/catalog references and hides document detail",async()=>{
    const ownerA=await owner("quote-tenant-a@tradeos.test");
    const ownerB=await owner("quote-tenant-b@tradeos.test");
    const tenantA=await business(ownerA,"Tenant A");
    const tenantB=await business(ownerB,"Tenant B");
    const itemA=await service(ownerA,tenantA.businessId,1000);
    const itemB=await service(ownerB,tenantB.businessId,3000);
    const wrong=await app.inject({method:"POST",url:"/v1/commercial-documents",
      headers:bearer(ownerA),payload:payload(tenantA,itemB)});
    expect(wrong.statusCode).toBe(409);
    const created=await app.inject({method:"POST",url:"/v1/commercial-documents",
      headers:bearer(ownerA),payload:payload(tenantA,itemA)});
    expect(created.statusCode).toBe(201);
    const id=created.json<{document:{id:string}}>().document.id;
    const hidden=await app.inject({method:"GET",
      url:`/v1/commercial-documents/${id}?businessId=${tenantB.businessId}`,
      headers:bearer(ownerB)});
    expect(hidden.statusCode).toBe(404);
    const forbidden=await app.inject({method:"GET",
      url:`/v1/commercial-documents/${id}?businessId=${tenantA.businessId}`,
      headers:bearer(ownerB)});
    expect(forbidden.statusCode).toBe(403);
    const cancelled=await app.inject({method:"POST",
      url:`/v1/commercial-documents/${id}/cancel`,headers:bearer(ownerA),
      payload:{businessId:tenantA.businessId}});
    expect(cancelled.statusCode).toBe(200);
    const issueAfterCancel=await app.inject({method:"POST",
      url:`/v1/commercial-documents/${id}/issue`,headers:bearer(ownerA),
      payload:{businessId:tenantA.businessId}});
    expect(issueAfterCancel.statusCode).toBe(409);
  });

  it.each(["QUOTATION","PROFORMA"] as const)("edits %s drafts atomically, keeps references and rejects stale or issued edits",async kind=>{
    const token=await owner("edit-"+kind.toLowerCase()+"@tradeos.test");
    const scope=await business(token,"Draft editor");
    const item=await service(token,scope.businessId,1200);
    const original=await app.inject({method:"POST",url:"/v1/commercial-documents",
      headers:bearer(token),payload:{...payload(scope,item),kind}});
    expect(original.statusCode).toBe(201);
    const doc=original.json().document;
    const url=`/v1/commercial-documents/${doc.id}`;
    const edit={...payload(scope,item),kind,expectedUpdatedAt:doc.updatedAt,
      customerName:"Corrected customer",notes:"Revised terms",
      lines:[{itemId:item,saleUnitCode:"service",quantity:3}]};
    const updated=await app.inject({method:"PATCH",url,headers:bearer(token),payload:edit});
    expect(updated.statusCode).toBe(200);
    const revised=updated.json().document;
    expect(revised).toMatchObject({id:doc.id,documentNumber:doc.documentNumber,status:"DRAFT",
      customerName:"Corrected customer",notes:"Revised terms",totalMinor:3600});
    expect(revised.lines).toHaveLength(1);
    expect(revised.lines[0].quantity).toBe(3);
    expect(revised.updatedAt).not.toBe(doc.updatedAt);
    const list=await app.inject({method:"GET",url:`/v1/commercial-documents?businessId=${scope.businessId}&branchId=${scope.branchId}`,headers:bearer(token)});
    expect(list.json().documents[0]).toMatchObject({id:doc.id,totalMinor:3600});
    expect((await app.inject({method:"PATCH",url,headers:bearer(token),payload:edit})).statusCode).toBe(409);
    expect((await app.inject({method:"POST",url:url+"/issue",headers:bearer(token),payload:{businessId:scope.businessId}})).statusCode).toBe(200);
    expect((await app.inject({method:"PATCH",url,headers:bearer(token),payload:{...edit,expectedUpdatedAt:revised.updatedAt}})).statusCode).toBe(409);
    const audit=await pool.query("SELECT event_type FROM audit_events WHERE entity_id=$1 AND event_type='COMMERCIAL_DOCUMENT_UPDATED'",[doc.id]);
    expect(audit.rowCount).toBe(1);
  });

  it("distinguishes PROFORMA documents and issues sequential unique references",async()=>{
    const token=await owner("proforma@tradeos.test");
    const scope=await business(token,"Proforma Business");
    const item=await service(token,scope.businessId,1250);
    const first=await app.inject({method:"POST",url:"/v1/commercial-documents",
      headers:bearer(token),payload:{...payload(scope,item),kind:"PROFORMA"}});
    expect(first.statusCode).toBe(201);
    const second=await app.inject({method:"POST",url:"/v1/commercial-documents",
      headers:bearer(token),payload:{...payload(scope,item),kind:"PROFORMA"}});
    expect(second.statusCode).toBe(201);
    expect(first.json().document.documentNumber).toMatch(/^PF-\d{4}-000001$/);
    expect(second.json().document.documentNumber).toMatch(/^PF-\d{4}-000002$/);
  });
});
