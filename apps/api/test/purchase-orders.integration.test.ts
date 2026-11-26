import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { buildApp } from "../src/app.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
const app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();});

async function merchant(tag:string){
  const registered=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:"PO Test Owner",email:`po-${tag}@tradeos.test`,
    password:"TradeOS-PO-Test-12345!",platform:"WEB",
    deviceKey:"po-"+tag,appVersion:"test",
  }});
  expect(registered.statusCode,registered.body).toBe(201);
  const headers={authorization:"Bearer "+registered.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:`PO Merchant ${tag}`,businessType:"RETAIL_HARDWARE",
      branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const branchId=onboard.json().branch.id as string;
  const supplier=(await pool.query<{id:string}>(
    "INSERT INTO suppliers(business_id,name,phone,email,address) "+
    "VALUES($1,'Example Supplier','0241112233','supplier@example.com','Accra') RETURNING id",
    [businessId])).rows[0]!.id;
  const item=(await pool.query<{id:string}>(
    "INSERT INTO catalog_items(business_id,name,kind,stock_unit_code,track_stock,sku) "+
    "VALUES($1,'Steel rods','PRODUCT','piece',true,'PO-ROD') RETURNING id",
    [businessId])).rows[0]!.id;
  for(const [unit,label] of [["piece","Piece"],["bundle","Bundle"]]){
    await pool.query("INSERT INTO catalog_item_units(business_id,item_id,unit_code,unit_label,"+
      "can_purchase,can_sell,can_stock) VALUES($1,$2,$3,$4,true,false,false)",
      [businessId,item,unit,label]);
  }
  const secondItem=(await pool.query<{id:string}>(
    "INSERT INTO catalog_items(business_id,name,kind,stock_unit_code,track_stock,sku) "+
    "VALUES($1,'Steel mesh','PRODUCT','piece',true,'PO-MESH') RETURNING id",
    [businessId])).rows[0]!.id;
  await pool.query("INSERT INTO catalog_item_units(business_id,item_id,unit_code,unit_label,"+
    "can_purchase,can_sell,can_stock) VALUES($1,$2,'bundle','Bundle',true,false,false)",
    [businessId,secondItem]);
  return {businessId,branchId,supplier,item,secondItem,headers};
}
type Merchant=Awaited<ReturnType<typeof merchant>>;
function payload(m:Merchant,id=randomUUID()){
  return {businessId:m.businessId,branchId:m.branchId,supplierId:m.supplier,
    clientRequestId:id,expectedDeliveryDate:"2026-12-31",
    notes:"Deliver safely in Accra",
    lines:[
      {itemId:m.item,purchaseUnitCode:"piece",quantity:2,unitCostMinor:2500},
      {itemId:m.secondItem,purchaseUnitCode:"bundle",quantity:0.5,unitCostMinor:25000},
    ]};
}
const request=(m:Merchant,body:unknown)=>app.inject({
  method:"POST",url:"/v1/purchase-orders",headers:m.headers,payload:body,
});
function endpoint(m:Merchant,id:string,action:string){
  return app.inject({method:"POST",url:`/v1/purchase-orders/${id}/${action}`,
    headers:m.headers,payload:{businessId:m.businessId}});
}
async function tableCount(table:string,businessId:string){
  const found=await pool.query<{count:string}>(
    `SELECT COUNT(*)::text AS count FROM ${table} WHERE business_id=$1`,[businessId]);
  return Number(found.rows[0]!.count);
}

describe("supplier purchase order creation and lifecycle",()=>{
  it("saves independent supplier orders without stock, debt or cash postings",async()=>{
    const m=await merchant("main");
    const same=payload(m);
    const first=await request(m,same);
    expect(first.statusCode,first.body).toBe(201);
    const order=first.json().order as {id:string;orderNumber:string;status:string;
      totalMinor:number;lines:Array<{itemName:string;purchaseUnitCode:string;
      quantity:number;lineTotalMinor:number}>};
    expect(order.orderNumber).toMatch(/^PO-\d{4}-000001$/);
    expect(order.totalMinor).toBe(17_500);
    expect(order.status).toBe("DRAFT");
    expect(order.lines).toMatchObject([
      {itemName:"Steel rods",purchaseUnitCode:"piece",quantity:2,lineTotalMinor:5_000},
      {itemName:"Steel mesh",purchaseUnitCode:"bundle",quantity:.5,lineTotalMinor:12_500},
    ]);
    const retry=await request(m,same);
    expect(retry.statusCode,retry.body).toBe(200);
    expect(retry.json().idempotentReplay).toBe(true);
    expect(retry.json().order.id).toBe(order.id);
    const changed=await request(m,{...same,notes:"Changed under same idempotency ID"});
    expect(changed.statusCode).toBe(409);
    const issued=await endpoint(m,order.id,"issue");
    expect(issued.statusCode,issued.body).toBe(200);
    expect(issued.json().order.status).toBe("ISSUED");
    expect((await endpoint(m,order.id,"issue")).statusCode).toBe(200);
    const cancelled=await endpoint(m,order.id,"cancel");
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().order.status).toBe("CANCELLED");
    expect((await endpoint(m,order.id,"issue")).statusCode).toBe(409);
    const list=await app.inject({method:"GET",headers:m.headers,
      url:`/v1/purchase-orders?businessId=${m.businessId}&branchId=${m.branchId}`});
    expect(list.statusCode).toBe(200);
    expect(list.json().orders).toHaveLength(1);
    const second=await request(m,payload(m));
    expect(second.statusCode).toBe(201);
    expect(second.json().order.orderNumber).toMatch(/^PO-\d{4}-000002$/);
    for(const table of ["purchases","purchase_lines","inventory_movements",
      "inventory_valuations","supplier_payable_ledger","cashbook_entries"]){
      expect(await tableCount(table,m.businessId),table).toBe(0);
    }
    const events=await pool.query<{event_type:string}>(
      "SELECT event_type FROM audit_events WHERE business_id=$1 "+
      "AND entity_id=$2 ORDER BY occurred_at,id",[m.businessId,order.id]);
    expect(events.rows.map(e=>e.event_type)).toEqual([
      "PURCHASE_ORDER_CREATED","PURCHASE_ORDER_ISSUED","PURCHASE_ORDER_CANCELLED",
    ]);
  });

  it("enforces cross-business item, supplier and branch isolation",async()=>{
    const a=await merchant("tenant-a");
    const b=await merchant("tenant-b");
    expect((await request(a,{...payload(a),supplierId:b.supplier})).statusCode).toBe(404);
    expect((await request(a,{...payload(a),branchId:b.branchId})).statusCode).toBe(404);
    expect((await request(a,{...payload(a),
      lines:[{itemId:b.item,purchaseUnitCode:"piece",quantity:1,unitCostMinor:100}]}))
      .statusCode).toBe(409);
    const created=await request(a,payload(a));
    expect(created.statusCode).toBe(201);
    const orderId=created.json().order.id as string;
    const forbidden=await app.inject({method:"GET",headers:b.headers,
      url:`/v1/purchase-orders/${orderId}?businessId=${a.businessId}`});
    expect(forbidden.statusCode).toBe(403);
    const hidden=await app.inject({method:"GET",headers:b.headers,
      url:`/v1/purchase-orders/${orderId}?businessId=${b.businessId}`});
    expect(hidden.statusCode).toBe(404);
    expect((await endpoint(b,orderId,"cancel")).statusCode).toBe(404);
    const wrongList=await app.inject({method:"GET",headers:b.headers,
      url:`/v1/purchase-orders?businessId=${b.businessId}`});
    expect(wrongList.json().orders).toHaveLength(0);
  });

  it("validates money, quantity, purchasable item and dates",async()=>{
    const m=await merchant("bad-input");
    const base=payload(m);
    const badRows=[
      {...base,clientRequestId:randomUUID(),lines:[]},
      {...base,clientRequestId:randomUUID(),lines:[
        {itemId:m.item,purchaseUnitCode:"piece",quantity:0,unitCostMinor:100}]},
      {...base,clientRequestId:randomUUID(),lines:[
        {itemId:m.item,purchaseUnitCode:"piece",quantity:1.123456789,unitCostMinor:100}]},
      {...base,clientRequestId:randomUUID(),lines:[
        {itemId:m.item,purchaseUnitCode:"piece",quantity:1,unitCostMinor:-1}]},
      {...base,clientRequestId:randomUUID(),expectedDeliveryDate:"2026-02-30"},
      {...base,clientRequestId:randomUUID(),expectedDeliveryDate:"not-a-date"},
      {...base,clientRequestId:randomUUID(),lines:[
        {itemId:m.item,purchaseUnitCode:"not-a-purchasable-unit",quantity:1,unitCostMinor:100}]},
    ];
    for(const body of badRows){
      const r=await request(m,body);
      expect([400,409]).toContain(r.statusCode);
    }
    expect(await tableCount("supplier_purchase_orders",m.businessId)).toBe(0);
  });

  it("rejects repeated product IDs across purchasing units on create and edit",async()=>{
    const m=await merchant("duplicate");
    const base=payload(m);
    const duplicate=[base.lines[0]!,{...base.lines[1]!,itemId:m.item}];
    const rejected=await request(m,{...base,lines:duplicate});
    expect(rejected.statusCode,rejected.body).toBe(400);
    expect(await tableCount("supplier_purchase_orders",m.businessId)).toBe(0);
    const created=await request(m,base);
    expect(created.statusCode,created.body).toBe(201);
    const order=created.json().order;
    const rejectedPatch=await app.inject({method:"PATCH",url:`/v1/purchase-orders/${order.id}`,
      headers:m.headers,payload:{...base,lines:duplicate,expectedUpdatedAt:order.updatedAt}});
    expect(rejectedPatch.statusCode,rejectedPatch.body).toBe(400);
    const unchanged=await app.inject({method:"GET",headers:m.headers,
      url:`/v1/purchase-orders/${order.id}?businessId=${m.businessId}`});
    expect(unchanged.json().order.totalMinor).toBe(17500);
    expect(unchanged.json().order.lines).toHaveLength(2);
  });

  it("does not expose orders without bearer authorization",async()=>{
    const m=await merchant("auth");
    await request(m,payload(m));
    const response=await app.inject({method:"GET",
      url:`/v1/purchase-orders?businessId=${m.businessId}`});
    expect(response.statusCode).toBe(401);
  });
});

describe("saved purchase-order draft editing",()=>{
  const patch=(m:Merchant,id:string,body:unknown)=>app.inject({
    method:"PATCH",url:`/v1/purchase-orders/${id}`,
    headers:m.headers,payload:body,
  });
  it("edits a saved draft, rebuilds snapshots, and audits without stock or money",async()=>{
    const m=await merchant("edit-ok");
    const first=await request(m,payload(m));
    expect(first.statusCode,first.body).toBe(201);
    const original=first.json().order as {id:string;updatedAt:string;orderNumber:string};
    const supplier2=(await pool.query<{id:string}>(
      "INSERT INTO suppliers(business_id,name) VALUES($1,'Replacement Supplier') RETURNING id",
      [m.businessId])).rows[0]!.id;
    const revised=await patch(m,original.id,{
      ...payload(m),supplierId:supplier2,expectedUpdatedAt:original.updatedAt,
      notes:"Different safe delivery instructions",expectedDeliveryDate:"2027-01-20",
      lines:[{itemId:m.item,purchaseUnitCode:"bundle",quantity:3,
        unitCostMinor:7550}],
    });
    expect(revised.statusCode,revised.body).toBe(200);
    const saved=revised.json().order;
    expect(saved).toMatchObject({id:original.id,orderNumber:original.orderNumber,
      status:"DRAFT",supplierName:"Replacement Supplier",
      expectedDeliveryDate:"2027-01-20",notes:"Different safe delivery instructions",
      subtotalMinor:22650,totalMinor:22650});
    expect(saved.updatedAt).not.toBe(original.updatedAt);
    expect(saved.lines).toHaveLength(1);
    expect(saved.lines[0]).toMatchObject({purchaseUnitCode:"bundle",
      purchaseUnitLabel:"Bundle",quantity:3,unitCostMinor:7550,lineTotalMinor:22650});
    for(const table of ["purchases","purchase_lines","inventory_movements",
      "supplier_payable_ledger","cashbook_entries"]){
      expect(await tableCount(table,m.businessId),table).toBe(0);
    }
    const audit=await pool.query<{event_type:string}>(
      "SELECT event_type FROM audit_events WHERE business_id=$1 AND entity_id=$2 ORDER BY occurred_at,id",
      [m.businessId,original.id]);
    expect(audit.rows.map(row=>row.event_type)).toEqual([
      "PURCHASE_ORDER_CREATED","PURCHASE_ORDER_DRAFT_UPDATED",
    ]);
    const stale=await patch(m,original.id,{...payload(m),
      expectedUpdatedAt:original.updatedAt});
    expect(stale.statusCode,stale.body).toBe(409);
    expect(stale.json().error).toBe("PURCHASE_ORDER_VERSION_CONFLICT");
    const afterStale=await app.inject({method:"GET",headers:m.headers,
      url:`/v1/purchase-orders/${original.id}?businessId=${m.businessId}`});
    expect(afterStale.json().order.totalMinor).toBe(22650);
  });

  it("rejects editing issued and cancelled purchase orders",async()=>{
    const m=await merchant("edit-lock");
    const created=await request(m,payload(m));
    const original=created.json().order;
    const body={...payload(m),expectedUpdatedAt:original.updatedAt};
    expect((await endpoint(m,original.id,"issue")).statusCode).toBe(200);
    const issued=await patch(m,original.id,body);
    expect(issued.statusCode,issued.body).toBe(409);
    expect(issued.json().error).toBe("PURCHASE_ORDER_NOT_DRAFT");
    expect((await endpoint(m,original.id,"cancel")).statusCode).toBe(200);
    expect((await patch(m,original.id,body)).statusCode).toBe(409);
  });

  it("rejects cross-business suppliers and stock units atomically",async()=>{
    const a=await merchant("edit-tenant-a");
    const b=await merchant("edit-tenant-b");
    const created=await request(a,payload(a));
    const original=created.json().order;
    const body={...payload(a),expectedUpdatedAt:original.updatedAt};
    const otherSupplier=await patch(a,original.id,{...body,supplierId:b.supplier});
    expect(otherSupplier.statusCode).toBe(404);
    const otherItem=await patch(a,original.id,{...body,
      lines:[{itemId:b.item,purchaseUnitCode:"piece",quantity:1,unitCostMinor:100}]});
    expect(otherItem.statusCode).toBe(409);
    const otherTenant=await patch(b,original.id,{...payload(b),
      expectedUpdatedAt:original.updatedAt});
    expect(otherTenant.statusCode).toBe(404);
    const badUnit=await patch(a,original.id,{...body,
      lines:[{itemId:a.item,purchaseUnitCode:"unknown",quantity:1,unitCostMinor:100}]});
    expect(badUnit.statusCode).toBe(409);
    const unchanged=await app.inject({method:"GET",headers:a.headers,
      url:`/v1/purchase-orders/${original.id}?businessId=${a.businessId}`});
    expect(unchanged.json().order.totalMinor).toBe(17500);
    expect(unchanged.json().order.lines).toHaveLength(2);
  });
});

describe("draft editing authorization and atomic rollback",()=>{
  it("does not mutate when edit lacks a version, authorization or valid unit",async()=>{
    const m=await merchant("edit-rollback");
    const created=await request(m,payload(m));
    const prior=created.json().order;
    const endpointUrl=`/v1/purchase-orders/${prior.id}`;
    const body={...payload(m),expectedUpdatedAt:prior.updatedAt};
    const missing=await app.inject({method:"PATCH",url:endpointUrl,
      headers:m.headers,payload:{...payload(m)}});
    expect(missing.statusCode).toBe(400);
    const untrusted=await app.inject({method:"PATCH",url:endpointUrl,payload:body});
    expect(untrusted.statusCode).toBe(401);
    const invalid=await app.inject({method:"PATCH",url:endpointUrl,
      headers:m.headers,payload:{...body,lines:[{
        itemId:m.item,purchaseUnitCode:"piece",quantity:1,unitCostMinor:-3,
      }]}});
    expect(invalid.statusCode).toBe(400);
    const reread=await app.inject({method:"GET",url:
      `${endpointUrl}?businessId=${m.businessId}`,headers:m.headers});
    expect(reread.statusCode).toBe(200);
    expect(reread.json().order).toMatchObject({
      updatedAt:prior.updatedAt,totalMinor:17500,supplierId:m.supplier,
    });
    expect(reread.json().order.lines).toHaveLength(2);
    const audits=await pool.query<{event_type:string}>(
      "SELECT event_type FROM audit_events WHERE business_id=$1 AND entity_id=$2",
      [m.businessId,prior.id]);
    expect(audits.rows.map(a=>a.event_type)).toEqual(["PURCHASE_ORDER_CREATED"]);
  });
});
