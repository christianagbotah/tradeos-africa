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
  const deviceKey="invoice-check-"+tag;
  const registered=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"Supplier Invoice Reviewer",email:`invoice-check-${tag}@tradeos.test`,
      password:"TradeOS-Invoice-Match-Test-12345!",platform:"WEB",deviceKey,appVersion:"test"}});
  expect(registered.statusCode,registered.body).toBe(201);
  const headers={authorization:"Bearer "+registered.json().session.accessToken};
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers,payload:{name:`Invoice Match Merchant ${tag}`,businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const branchId=onboard.json().branch.id as string;
  const supplierId=(await pool.query<{id:string}>(
    "INSERT INTO suppliers(business_id,name) VALUES($1,'National Hardware Wholesale') RETURNING id",
    [businessId])).rows[0]!.id;
  const items:Array<{id:string;unit:string;qty:number;cost:number}>=[];
  for(const [name,stockUnit,purchaseUnit,qty,cost] of [
    ["Large bolt","piece","piece",10,2000],
    ["Nails","piece","box",4,12000],
  ] as const) {
    const item=(await pool.query<{id:string}>(
      `INSERT INTO catalog_items(business_id,name,kind,stock_unit_code,track_stock)
       VALUES($1,$2,'PRODUCT',$3,true) RETURNING id`,[businessId,name,stockUnit])).rows[0]!;
    await pool.query(
      `INSERT INTO catalog_item_units
       (business_id,item_id,unit_code,unit_label,can_stock,can_purchase,can_sell)
       VALUES ($1,$2,$3,$3,false,true,false)`,
      [businessId,item.id,purchaseUnit]);
    if(purchaseUnit!==stockUnit) await pool.query(
      `INSERT INTO item_unit_conversions
       (business_id,item_id,from_unit_code,to_unit_code,factor)
       VALUES ($1,$2,$3,$4,10)`,[businessId,item.id,purchaseUnit,stockUnit]);
    items.push({id:item.id,unit:purchaseUnit,qty,cost});
  }
  const draft=await app.inject({method:"POST",url:"/v1/purchase-orders",headers,
    payload:{businessId,branchId,supplierId,clientRequestId:randomUUID(),
      lines:items.map(i=>({itemId:i.id,purchaseUnitCode:i.unit,
        quantity:i.qty,unitCostMinor:i.cost}))}});
  expect(draft.statusCode,draft.body).toBe(201);
  const orderId=draft.json().order.id as string;
  const poLines=draft.json().order.lines as Array<{
    id:string;itemId:string;purchaseUnitCode:string;unitCostMinor:number;
  }>;
  const issue=await app.inject({method:"POST",url:`/v1/purchase-orders/${orderId}/issue`,
    headers,payload:{businessId}});
  expect(issue.statusCode,issue.body).toBe(200);
  const m={businessId,branchId,supplierId,orderId,poLines,items,headers,deviceKey};
  return m;
}
type Merchant=Awaited<ReturnType<typeof setup>>;
async function receive(m:Merchant,key:string,qty:[number,number],costs?:[number,number]){
  const response=await app.inject({method:"POST",url:"/v1/sync",headers:m.headers,
    payload:{mutations:[{businessId:m.businessId,branchId:m.branchId,
      clientId:m.deviceKey,clientMutationId:key,mutationType:"PURCHASE_RECEIVE_CREATE",
      occurredAt:new Date().toISOString(),
      payload:{supplierId:m.supplierId,purchaseOrderId:m.orderId,
        supplierReference:"SUP-DEL-"+key,settlementMethod:"SUPPLIER_CREDIT",
        lines:m.poLines.map((line,i)=>({
          purchaseOrderLineId:line.id,itemId:line.itemId,
          purchaseUnitCode:line.purchaseUnitCode,quantity:qty[i],
          unitCostMinor:costs?.[i]??line.unitCostMinor,
        })).filter(l=>l.quantity>0)}}]}});
  expect(response.statusCode,response.body).toBe(200);
  const result=response.json().mutationResults[0] as {
    status:string;errorCode?:string;result?:{purchaseId:string;totalMinor:number};
  };
  expect(result.status,JSON.stringify(result)).toBe("APPLIED");
  return result.result!;
}
const createInvoice=(m:Merchant,args:{
  requestId?:string;reference?:string;receiptIds:string[];invoiceTotalMinor:number;
  notes?:string;
})=>app.inject({method:"POST",url:`/v1/purchase-orders/${m.orderId}/invoice-matches`,
  headers:m.headers,payload:{
    businessId:m.businessId,clientRequestId:args.requestId??randomUUID(),
    invoiceReference:args.reference??"INV-1002",invoiceDate:"2026-11-15",
    invoiceTotalMinor:args.invoiceTotalMinor,receiptIds:args.receiptIds,
    notes:args.notes??"Delivery note matched",
  }});
const getMatches=(m:Merchant)=>app.inject({
  method:"GET",url:`/v1/purchase-orders/${m.orderId}/invoice-matches?businessId=${m.businessId}`,
  headers:m.headers,
});
async function counts(m:Merchant) {
  const tables=["purchases","purchase_lines","inventory_movements",
    "supplier_payable_ledger","supplier_credit_obligations","cashbook_entries",
    "supplier_invoice_matches","supplier_invoice_match_receipts"];
  const totals:Record<string,number>={};
  for(const table of tables){
    const r=await pool.query<{count:string}>(
      `SELECT COUNT(*)::text AS count FROM ${table} WHERE business_id=$1`,[m.businessId]);
    totals[table]=Number(r.rows[0]!.count);
  }
  return totals;
}
describe("supplier invoice receiving match and approvals",()=>{
  it("reconciles a partial delivery and approves exact matches without posting additional stock/payables",async()=>{
    const m=await setup("exact");
    const receipt=await receive(m,"part-one",[4,1]);
    expect(receipt.totalMinor).toBe(20000);
    const before=await counts(m);
    const requestId=randomUUID();
    const invoice=await createInvoice(m,{requestId,
      receiptIds:[receipt.purchaseId],invoiceTotalMinor:20000});
    expect(invoice.statusCode,invoice.body).toBe(201);
    const match=invoice.json().match;
    expect(match).toMatchObject({
      status:"DRAFT",hasException:false,invoiceVarianceMinor:0,
      poPriceVarianceMinor:0,receiptCount:1,receiptTotalMinor:20000,
    });
    expect(match.lines).toHaveLength(2);
    expect(match.lines.map((l:{quantity:number})=>l.quantity)).toEqual([4,1]);
    const replay=await createInvoice(m,{requestId,
      receiptIds:[receipt.purchaseId],invoiceTotalMinor:20000});
    expect(replay.statusCode,replay.body).toBe(200);
    expect(replay.json().idempotentReplay).toBe(true);
    const approved=await app.inject({method:"POST",
      url:`/v1/supplier-invoice-matches/${match.id}/approve`,headers:m.headers,
      payload:{businessId:m.businessId}});
    expect(approved.statusCode,approved.body).toBe(200);
    expect(approved.json().match.status).toBe("APPROVED");
    expect(approved.json().match.approvedAt).toBeTruthy();
    const after=await counts(m);
    for(const key of ["purchases","purchase_lines","inventory_movements",
      "supplier_payable_ledger","supplier_credit_obligations","cashbook_entries"]){
      expect(after[key],key).toBe(before[key]);
    }
    expect(after.supplier_invoice_matches).toBe(1);
    expect(after.supplier_invoice_match_receipts).toBe(1);
    const history=await getMatches(m);
    expect(history.statusCode,history.body).toBe(200);
    expect(history.json().matches).toHaveLength(1);
  });

  it("requires documented manager approval for invoice totals and PO unit price variances",async()=>{
    const m=await setup("variance");
    const received=await receive(m,"price-changed",[2,1],[2200,12000]);
    expect(received.totalMinor).toBe(16400);
    const invoice=await createInvoice(m,{reference:"INV-DIFFERENCE",
      receiptIds:[received.purchaseId],invoiceTotalMinor:16700});
    expect(invoice.statusCode,invoice.body).toBe(201);
    const match=invoice.json().match;
    expect(match).toMatchObject({
      hasException:true,invoiceVarianceMinor:300,poPriceVarianceMinor:400,
      receiptTotalMinor:16400,
    });
    const without=await app.inject({method:"POST",
      url:`/v1/supplier-invoice-matches/${match.id}/approve`,headers:m.headers,
      payload:{businessId:m.businessId}});
    expect(without.statusCode,without.body).toBe(409);
    expect(without.json().error).toBe("INVOICE_MATCH_EXCEPTION_NOTE_REQUIRED");
    const reviewed=await app.inject({method:"POST",
      url:`/v1/supplier-invoice-matches/${match.id}/approve`,headers:m.headers,
      payload:{businessId:m.businessId,
        approvalNote:"Supplier confirmed negotiated increase; tax checked separately"}});
    expect(reviewed.statusCode,reviewed.body).toBe(200);
    expect(reviewed.json().match).toMatchObject({status:"APPROVED",hasException:true,
      invoiceVarianceMinor:300,poPriceVarianceMinor:400});
    const repeat=await app.inject({method:"POST",
      url:`/v1/supplier-invoice-matches/${match.id}/approve`,headers:m.headers,
      payload:{businessId:m.businessId}});
    expect(repeat.statusCode,repeat.body).toBe(200);
    expect((await counts(m)).supplier_payable_ledger).toBe(1);
    expect((await counts(m)).cashbook_entries).toBe(0);
  });

  it("rejects competing invoice claims, reused invoice numbers and changed request keys",async()=>{
    const m=await setup("duplicates");
    const first=await receive(m,"first",[2,0]);
    const second=await receive(m,"second",[3,1]);
    const requestId=randomUUID();
    const saved=await createInvoice(m,{requestId,reference:"INV-ABC",
      receiptIds:[first.purchaseId],invoiceTotalMinor:4000});
    expect(saved.statusCode,saved.body).toBe(201);
    const changed=await createInvoice(m,{requestId,reference:"INV-ABC",
      receiptIds:[first.purchaseId],invoiceTotalMinor:4200});
    expect(changed.statusCode,changed.body).toBe(409);
    expect(changed.json().error).toBe("INVOICE_MATCH_REQUEST_CONFLICT");
    const duplicateReceipt=await createInvoice(m,{reference:"INV-DEF",
      receiptIds:[first.purchaseId],invoiceTotalMinor:4000});
    expect(duplicateReceipt.statusCode,duplicateReceipt.body).toBe(409);
    const duplicateNumber=await createInvoice(m,{reference:"inv-abc",
      receiptIds:[second.purchaseId],invoiceTotalMinor:18000});
    expect(duplicateNumber.statusCode,duplicateNumber.body).toBe(409);
    expect((await counts(m)).supplier_invoice_matches).toBe(1);
    const canceled=await app.inject({method:"POST",
      url:`/v1/supplier-invoice-matches/${saved.json().match.id}/cancel`,
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(canceled.statusCode,canceled.body).toBe(200);
    expect(canceled.json().match.status).toBe("CANCELLED");
    expect((await counts(m)).supplier_invoice_match_receipts).toBe(0);
    const corrected=await createInvoice(m,{reference:"INV-ABC",
      receiptIds:[first.purchaseId,second.purchaseId],invoiceTotalMinor:22000});
    expect(corrected.statusCode,corrected.body).toBe(201);
    expect(corrected.json().match.receiptCount).toBe(2);
    expect(corrected.json().match.receiptTotalMinor).toBe(22000);
    const approved=await app.inject({method:"POST",
      url:`/v1/supplier-invoice-matches/${corrected.json().match.id}/approve`,
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(approved.statusCode,approved.body).toBe(200);
    const cannotCancel=await app.inject({method:"POST",
      url:`/v1/supplier-invoice-matches/${corrected.json().match.id}/cancel`,
      headers:m.headers,payload:{businessId:m.businessId}});
    expect(cannotCancel.statusCode,cannotCancel.body).toBe(409);
    expect((await counts(m)).supplier_invoice_match_receipts).toBe(2);
  });

  it("isolates tenants and enforces supplied receipt scope",async()=>{
    const a=await setup("tenant-a"),b=await setup("tenant-b");
    const goods=await receive(a,"goods",[2,0]);
    const another=await receive(b,"goods",[2,0]);
    const stolen=await createInvoice(b,{reference:"CROSS-TENANT-100",
      receiptIds:[goods.purchaseId],invoiceTotalMinor:4000});
    expect(stolen.statusCode,stolen.body).toBe(409);
    expect(stolen.json().error).toBe("INVOICE_MATCH_RECEIPT_SCOPE");
    const saved=await createInvoice(a,{reference:"NORMAL-A",
      receiptIds:[goods.purchaseId],invoiceTotalMinor:4000});
    expect(saved.statusCode,saved.body).toBe(201);
    const crossList=await app.inject({method:"GET",
      url:`/v1/purchase-orders/${a.orderId}/invoice-matches?businessId=${b.businessId}`,
      headers:b.headers});
    expect(crossList.statusCode,crossList.body).toBe(404);
    const crossApprove=await app.inject({method:"POST",
      url:`/v1/supplier-invoice-matches/${saved.json().match.id}/approve`,
      headers:b.headers,payload:{businessId:b.businessId}});
    expect(crossApprove.statusCode,crossApprove.body).toBe(404);
    expect((await counts(b)).supplier_invoice_matches).toBe(0);
    expect((await counts(a)).supplier_invoice_matches).toBe(1);
    expect(another.totalMinor).toBe(4000);
  });
});
