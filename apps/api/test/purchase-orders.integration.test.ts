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
  return {businessId,branchId,supplier,item,headers};
}
type Merchant=Awaited<ReturnType<typeof merchant>>;
function payload(m:Merchant,id=randomUUID()){
  return {businessId:m.businessId,branchId:m.branchId,supplierId:m.supplier,
    clientRequestId:id,expectedDeliveryDate:"2026-12-31",
    notes:"Deliver safely in Accra",
    lines:[
      {itemId:m.item,purchaseUnitCode:"piece",quantity:2,unitCostMinor:2500},
      {itemId:m.item,purchaseUnitCode:"bundle",quantity:0.5,unitCostMinor:25000},
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
      {itemName:"Steel rods",purchaseUnitCode:"bundle",quantity:.5,lineTotalMinor:12_500},
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

  it("does not expose orders without bearer authorization",async()=>{
    const m=await merchant("auth");
    await request(m,payload(m));
    const response=await app.inject({method:"GET",
      url:`/v1/purchase-orders?businessId=${m.businessId}`});
    expect(response.statusCode).toBe(401);
  });
});
