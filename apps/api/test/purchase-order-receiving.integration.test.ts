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

async function setup(tag:string) {
  const deviceKey="po-receive-"+tag;
  const register=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:"PO Receiving Owner",email:`po-receive-${tag}@tradeos.test`,
    password:"TradeOS-PO-Receiving-Test-12345!",platform:"WEB",deviceKey,appVersion:"test",
  }});
  expect(register.statusCode,register.body).toBe(201);
  const headers={authorization:"Bearer "+register.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:`PO Receipt Merchant ${tag}`,businessType:"RETAIL_HARDWARE",
      branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const branchId=onboard.json().branch.id as string;
  const supplierId=(await pool.query<{id:string}>(
    "INSERT INTO suppliers(business_id,name) VALUES($1,'Hardware Distributor') RETURNING id",
    [businessId])).rows[0]!.id;
  const products:{itemId:string;unit:string;qty:number;cost:number}[]=[];
  for(const [name,unit,qty,cost] of [["Steel rod","piece",10,1500],
    ["Nails","box",3,10000]] as const){
    const itemId=(await pool.query<{id:string}>(
      "INSERT INTO catalog_items(business_id,name,kind,stock_unit_code,track_stock) "+
      "VALUES($1,$2,'PRODUCT','piece',true) RETURNING id",
      [businessId,name])).rows[0]!.id;
    await pool.query("INSERT INTO catalog_item_units(business_id,item_id,unit_code,unit_label,"+
      "can_purchase,can_sell,can_stock) VALUES($1,$2,$3,$4,true,false,false)",
      [businessId,itemId,unit,unit]);
    if(unit==="box")await pool.query(
      "INSERT INTO item_unit_conversions(business_id,item_id,from_unit_code,to_unit_code,factor) "+
      "VALUES($1,$2,'box','piece',10)",[businessId,itemId]);
    products.push({itemId,unit,qty,cost});
  }
  const draft=await app.inject({method:"POST",url:"/v1/purchase-orders",
    headers,payload:{businessId,branchId,supplierId,clientRequestId:randomUUID(),
      lines:products.map(i=>({itemId:i.itemId,purchaseUnitCode:i.unit,
        quantity:i.qty,unitCostMinor:i.cost}))}});
  expect(draft.statusCode,draft.body).toBe(201);
  const orderId=draft.json().order.id as string;
  const lines=draft.json().order.lines as Array<{
    id:string;itemId:string;purchaseUnitCode:string;unitCostMinor:number;
  }>;
  const issued=await app.inject({method:"POST",
    url:`/v1/purchase-orders/${orderId}/issue`,
    headers,payload:{businessId}});
  expect(issued.statusCode,issued.body).toBe(200);
  return {deviceKey,headers,businessId,branchId,supplierId,orderId,products,lines};
}
type Merchant=Awaited<ReturnType<typeof setup>>;
function payload(m:Merchant,quantities:[number,number],costs?:[number,number]){
  return {supplierId:m.supplierId,purchaseOrderId:m.orderId,
    settlementMethod:"SUPPLIER_CREDIT",supplierReference:"INV-DELIVERY-1",
    lines:m.lines.map((line,i)=>({
      purchaseOrderLineId:line.id,itemId:line.itemId,
      purchaseUnitCode:line.purchaseUnitCode,quantity:quantities[i]!,
      unitCostMinor:costs?.[i]??line.unitCostMinor,
    })).filter(line=>line.quantity>0)};
}
async function receive(m:Merchant,key:string,body:unknown){
  const r=await app.inject({method:"POST",url:"/v1/sync",headers:m.headers,
    payload:{mutations:[{clientId:m.deviceKey,clientMutationId:key,businessId:m.businessId,
      branchId:m.branchId,mutationType:"PURCHASE_RECEIVE_CREATE",
      occurredAt:new Date().toISOString(),payload:body}]}});
  expect(r.statusCode,r.body).toBe(200);
  return r.json().mutationResults[0] as {
    status:string;errorCode?:string;result?:{purchaseId:string;totalMinor:number};
  };
}
async function order(m:Merchant){
  const r=await app.inject({method:"GET",
    url:`/v1/purchase-orders/${m.orderId}?businessId=${m.businessId}`,
    headers:m.headers});
  expect(r.statusCode,r.body).toBe(200);
  return r.json().order as {
    receiptCount:number;fulfillmentStatus:string;canReceive:boolean;
    receivedTotalMinor:number;priceVarianceMinor:number;
    lines:Array<{quantity:number;receivedQuantity:number;remainingQuantity:number}>;
    receipts:Array<{id:string;totalMinor:number;supplierReference:string|null}>;
  };
}
async function count(table:string,businessId:string) {
  const r=await pool.query<{count:string}>(
    `SELECT COUNT(*)::text AS count FROM ${table} WHERE business_id=$1`,[businessId]);
  return Number(r.rows[0]!.count);
}
describe("supplier PO linked stock receipts",()=>{
  it("posts two partial deliveries through the existing stock/payable path with invoice cost variance",async()=>{
    const m=await setup("two-deliveries");
    const initial=await order(m);
    expect(initial).toMatchObject({receiptCount:0,fulfillmentStatus:"NOT_RECEIVED",
      canReceive:true,priceVarianceMinor:0});
    const first=await receive(m,"po-partial-a",payload(m,[4,1]));
    expect(first.status).toBe("APPLIED");
    expect(first.result?.totalMinor).toBe(16_000);
    const linked=(await pool.query<{purchase_order_line_id:string|null}>(
      `SELECT purchase_order_line_id FROM purchase_lines
       WHERE business_id=$1 AND purchase_id=$2`,
      [m.businessId,first.result!.purchaseId])).rows;
    expect(linked.map(l=>l.purchase_order_line_id).sort())
      .toEqual(m.lines.map(l=>l.id).sort());
    expect((await receive(m,"po-partial-a",payload(m,[4,1]))).status).toBe("APPLIED");
    const replayChange=await receive(m,"po-partial-a",payload(m,[5,1]));
    expect(replayChange).toMatchObject({status:"REJECTED",
      errorCode:"PURCHASE_REPLAY_CONFLICT"});
    const partial=await order(m);
    expect(partial).toMatchObject({receiptCount:1,fulfillmentStatus:"PARTIAL",
      canReceive:true,receivedTotalMinor:16000});
    expect(partial.lines.map(l=>[l.receivedQuantity,l.remainingQuantity]))
      .toEqual([[4,6],[1,2]]);
    const second=await receive(m,"po-partial-b",payload(m,[6,2],[1600,10000]));
    expect(second.status).toBe("APPLIED");
    expect(second.result?.totalMinor).toBe(29_600);
    const complete=await order(m);
    expect(complete).toMatchObject({receiptCount:2,fulfillmentStatus:"RECEIVED",
      canReceive:false,receivedTotalMinor:45600,priceVarianceMinor:600});
    expect(complete.lines.map(l=>[l.receivedQuantity,l.remainingQuantity]))
      .toEqual([[10,0],[3,0]]);
    expect(complete.receipts.map(r=>r.totalMinor).sort((a,b)=>a-b))
      .toEqual([16000,29600]);
    expect(await count("purchases",m.businessId)).toBe(2);
    expect(await count("purchase_lines",m.businessId)).toBe(4);
    expect(await count("supplier_payable_ledger",m.businessId)).toBe(2);
    const stock=(await pool.query<{item_id:string;qty:string}>(
      `SELECT item_id,SUM(quantity_delta)::text AS qty FROM inventory_movements
       WHERE business_id=$1 AND branch_id=$2 GROUP BY item_id`,
      [m.businessId,m.branchId])).rows;
    expect(stock).toHaveLength(2);
    const nails=stock.find(s=>s.item_id===m.products[1]!.itemId);
    expect(Number(nails?.qty)).toBe(30);
    const payable=await pool.query<{balance:string}>(
      `SELECT SUM(balance_delta_minor)::text AS balance
       FROM supplier_payable_ledger WHERE business_id=$1`,[m.businessId]);
    expect(Number(payable.rows[0]?.balance)).toBe(45600);
    const third=await receive(m,"po-over-fully-received",payload(m,[1,0]));
    expect(third).toMatchObject({status:"REJECTED",errorCode:"PO_OVER_RECEIPT"});
    expect(await count("purchases",m.businessId)).toBe(2);
  });

  it("rejects over-receipt, mismatched line/unit, and duplicate line IDs atomically",async()=>{
    const m=await setup("reject-invalid");
    const bads=[
      payload(m,[11,0]),
      {...payload(m,[1,0]),lines:[{...payload(m,[1,0]).lines[0]!,itemId:m.products[1]!.itemId}]},
      {...payload(m,[1,0]),lines:[{...payload(m,[1,0]).lines[0]!,purchaseUnitCode:"box"}]},
      {...payload(m,[1,0]),lines:[...payload(m,[1,0]).lines,...payload(m,[1,0]).lines]},
      {...payload(m,[1,0]),purchaseOrderId:randomUUID()},
      {...payload(m,[1,0]),supplierId:randomUUID()},
      {...payload(m,[1,0]),lines:payload(m,[1,0]).lines.map(({purchaseOrderLineId,...l})=>l)},
    ];
    for(const [i,bad] of bads.entries()){
      const r=await receive(m,`reject-${i}`,bad);
      expect(r.status,JSON.stringify(bad)).toBe("REJECTED");
    }
    expect(await count("purchases",m.businessId)).toBe(0);
    expect(await count("inventory_movements",m.businessId)).toBe(0);
    expect(await count("supplier_payable_ledger",m.businessId)).toBe(0);
    const first=await receive(m,"valid-four",payload(m,[4,0]));
    expect(first.status).toBe("APPLIED");
    expect((await receive(m,"exceeds-remaining",payload(m,[7,0])))
      .errorCode).toBe("PO_OVER_RECEIPT");
    expect((await order(m)).lines[0]?.remainingQuantity).toBe(6);
  });

  it("locks an order against concurrent final receipts and prevents double posting",async()=>{
    const m=await setup("concurrent");
    const receipt=payload(m,[10,3]);
    const [a,b]=await Promise.all([
      receive(m,"parallel-a",receipt),
      receive(m,"parallel-b",receipt),
    ]);
    expect([a.status,b.status].sort()).toEqual(["APPLIED","REJECTED"]);
    expect([a.errorCode,b.errorCode].filter(Boolean)).toEqual(["PO_OVER_RECEIPT"]);
    expect(await count("purchases",m.businessId)).toBe(1);
    expect(await count("purchase_lines",m.businessId)).toBe(2);
    const complete=await order(m);
    expect(complete.fulfillmentStatus).toBe("RECEIVED");
    expect(complete.receiptCount).toBe(1);
  });

  it("enforces cross-tenant PO scope and blocks new receipts after cancellation",async()=>{
    const a=await setup("business-a");
    const b=await setup("business-b");
    const incorrect=await receive(b,"cross-company",
      {...payload(b,[2,0]),purchaseOrderId:a.orderId});
    expect(incorrect).toMatchObject({status:"REJECTED",errorCode:"PO_NOT_FOUND"});
    expect(await count("purchases",b.businessId)).toBe(0);
    expect((await receive(a,"receipt-before-cancel",payload(a,[3,1]))).status).toBe("APPLIED");
    const cancel=await app.inject({method:"POST",
      url:`/v1/purchase-orders/${a.orderId}/cancel`,
      headers:a.headers,payload:{businessId:a.businessId}});
    expect(cancel.statusCode).toBe(200);
    expect((await receive(a,"receipt-after-cancel",payload(a,[1,1]))))
      .toMatchObject({status:"REJECTED",errorCode:"PO_NOT_RECEIVABLE"});
    const prior=await order(a);
    expect(prior.fulfillmentStatus).toBe("PARTIAL");
    expect(prior.receiptCount).toBe(1);
    expect(prior.canReceive).toBe(false);
    expect(await count("purchases",a.businessId)).toBe(1);
  });

  it("lets an unlinked purchase receipt continue posting with no PO association",async()=>{
    const m=await setup("legacy");
    const r=await receive(m,"ad-hoc",{
      supplierId:m.supplierId,settlementMethod:"SUPPLIER_CREDIT",
      lines:[{itemId:m.products[0]!.itemId,purchaseUnitCode:"piece",
        quantity:2,unitCostMinor:1000}],
    });
    expect(r.status).toBe("APPLIED");
    const row=(await pool.query<{purchase_order_id:string|null}>(
      "SELECT purchase_order_id FROM purchases WHERE business_id=$1",
      [m.businessId])).rows[0];
    expect(row?.purchase_order_id).toBeNull();
    expect((await order(m)).receiptCount).toBe(0);
  });
});
