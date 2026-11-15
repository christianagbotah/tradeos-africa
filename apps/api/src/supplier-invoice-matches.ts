import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "./db.js";
import { proportionalMinor, safeMinor, signedMinor } from "./commerce/valuation.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const READ_ROLES:readonly BusinessRole[]=[
  "OWNER","ADMIN","MANAGER","ACCOUNTANT","INVENTORY","CASHIER","SALES","STAFF","VIEWER",
];
const CREATE_ROLES:readonly BusinessRole[]=["OWNER","ADMIN","MANAGER","ACCOUNTANT","INVENTORY"];
const APPROVE_ROLES:readonly BusinessRole[]=["OWNER","ADMIN","MANAGER"];
type MatchStatus="DRAFT"|"APPROVED"|"CANCELLED";

class InvoiceMatchError extends Error {
  constructor(message:string,readonly code="INVOICE_MATCH_INVALID",readonly statusCode=400){
    super(message);this.name="InvoiceMatchError";
  }
}
interface MatchInput {
  businessId?:string;
  clientRequestId?:string;
  invoiceReference?:string;
  invoiceDate?:string;
  invoiceTotalMinor?:number;
  receiptIds?:string[];
  notes?:string;
}
interface MatchRow {
  id:string;business_id:string;branch_id:string;supplier_id:string;
  purchase_order_id:string;invoice_reference:string;invoice_date:Date|string;
  currency_code:string;invoice_total_minor:string;receipt_total_minor:string;
  invoice_variance_minor:string;po_price_variance_minor:string;receipt_count:number;
  status:MatchStatus;notes:string;approval_note:string;approved_at:Date|null;
  cancelled_at:Date|null;created_at:Date;
}
interface ReceiptRow {
  id:string;total_minor:string;received_at:Date;
  supplier_reference:string|null;purchase_order_id:string;
  supplier_id:string;branch_id:string;
}
interface LineRow {
  id:string;item_name_snapshot:string;purchase_unit_code:string;
  unit_cost_minor:string;purchase_quantity:string;
  receipt_total_minor:string;
}
type Q=Pick<DatabaseClient,"query">|Pick<DatabasePool,"query">;
function id(value:unknown,name:string):string {
  if(typeof value!=="string"||!UUID.test(value))
    throw new InvoiceMatchError(`A valid ${name} is required`,"INVOICE_MATCH_ID_INVALID");
  return value;
}
function plain(value:unknown,name:string,max:number):string {
  if(typeof value!=="string")
    throw new InvoiceMatchError(`${name} must be text`);
  const trimmed=value.trim();
  if(!trimmed||trimmed.length>max)
    throw new InvoiceMatchError(`${name} must contain 1–${max} characters`);
  return trimmed;
}
function optional(value:unknown,name:string,max:number):string {
  if(value===undefined||value===null)return "";
  if(typeof value!=="string"||value.trim().length>max)
    throw new InvoiceMatchError(`${name} must be text no longer than ${max} characters`);
  return value.trim();
}
function inputOf(raw:MatchInput|undefined) {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
    throw new InvoiceMatchError("Invoice details are required");
  const businessId=id(raw.businessId,"business ID");
  const clientRequestId=id(raw.clientRequestId,"request ID");
  const invoiceReference=plain(raw.invoiceReference,"Supplier invoice number",120);
  const invoiceDate=plain(raw.invoiceDate,"Invoice date",10);
  const parsed=Date.parse(invoiceDate+"T00:00:00Z");
  if(!DAY.test(invoiceDate)||!Number.isFinite(parsed)||
    new Date(parsed).toISOString().slice(0,10)!==invoiceDate)
    throw new InvoiceMatchError("Invoice date must be a real YYYY-MM-DD date");
  const invoiceTotalMinor=raw.invoiceTotalMinor;
  if(typeof invoiceTotalMinor!=="number"||!Number.isSafeInteger(invoiceTotalMinor)||
    invoiceTotalMinor<0)
    throw new InvoiceMatchError("Invoice total must be a nonnegative integer of pesewas");
  const receiptIds=raw.receiptIds;
  if(!Array.isArray(receiptIds)||receiptIds.length<1||receiptIds.length>100)
    throw new InvoiceMatchError("Select 1 to 100 actual goods receipts");
  const receipts=receiptIds.map((value,index)=>id(value,`receipt ${index+1}`));
  if(new Set(receipts).size!==receipts.length)
    throw new InvoiceMatchError("Each goods receipt may be selected only once");
  const notes=optional(raw.notes,"Notes",2000);
  return {businessId,clientRequestId,invoiceReference,invoiceDate,
    invoiceTotalMinor,receiptIds:receipts.sort(),notes};
}
const SELECT_MATCH=`SELECT id,business_id,branch_id,supplier_id,purchase_order_id,
  invoice_reference,invoice_date,currency_code,invoice_total_minor::text,
  receipt_total_minor::text,invoice_variance_minor::text,po_price_variance_minor::text,
  receipt_count,status,notes,approval_note,approved_at,cancelled_at,created_at
  FROM supplier_invoice_matches`;
function mapMatch(row:MatchRow) {
  const invoiceDate=typeof row.invoice_date==="string"?
    row.invoice_date.slice(0,10):row.invoice_date.toISOString().slice(0,10);
  return {
    id:row.id,businessId:row.business_id,branchId:row.branch_id,
    supplierId:row.supplier_id,purchaseOrderId:row.purchase_order_id,
    invoiceReference:row.invoice_reference,invoiceDate,
    currencyCode:row.currency_code,status:row.status,
    invoiceTotalMinor:Number(row.invoice_total_minor),
    receiptTotalMinor:Number(row.receipt_total_minor),
    invoiceVarianceMinor:Number(row.invoice_variance_minor),
    poPriceVarianceMinor:Number(row.po_price_variance_minor),
    receiptCount:row.receipt_count,notes:row.notes,approvalNote:row.approval_note,
    approvedAt:row.approved_at?.toISOString()??null,
    cancelledAt:row.cancelled_at?.toISOString()??null,
    createdAt:row.created_at.toISOString(),
    hasException:Number(row.invoice_variance_minor)!==0||
      Number(row.po_price_variance_minor)!==0,
  };
}
async function snapshot(db:Q,businessId:string,orderId:string,receiptIds:string[]) {
  const receipts=(await db.query<ReceiptRow>(
    `SELECT id,total_minor::text,received_at,supplier_reference,
       purchase_order_id,supplier_id,branch_id
     FROM purchases WHERE business_id=$1 AND id=ANY($2::uuid[])
       AND purchase_order_id=$3 AND status='RECEIVED'
     ORDER BY received_at,id`,[businessId,receiptIds,orderId])).rows;
  if(receipts.length!==receiptIds.length)
    throw new InvoiceMatchError("All selected receipts must be posted against this purchase order",
      "INVOICE_MATCH_RECEIPT_SCOPE",409);
  const lineRows=(await db.query<LineRow>(
    `SELECT po.id,po.item_name_snapshot,po.purchase_unit_code,
       po.unit_cost_minor::text,
       COALESCE(SUM(pl.purchase_quantity),0)::text AS purchase_quantity,
       COALESCE(SUM(pl.line_cost_minor),0)::text AS receipt_total_minor
     FROM purchase_lines pl
     JOIN purchases p ON p.id=pl.purchase_id AND p.business_id=pl.business_id
     JOIN supplier_purchase_order_lines po ON po.id=pl.purchase_order_line_id
       AND po.business_id=pl.business_id AND po.order_id=p.purchase_order_id
     WHERE p.business_id=$1 AND p.purchase_order_id=$2
       AND p.id=ANY($3::uuid[]) AND p.status='RECEIVED'
     GROUP BY po.id,po.item_name_snapshot,po.purchase_unit_code,po.unit_cost_minor
     ORDER BY po.item_name_snapshot,po.id`,
    [businessId,orderId,receiptIds])).rows;
  if(lineRows.length===0)
    throw new InvoiceMatchError("Selected receipts contain no order items",
      "INVOICE_MATCH_EMPTY_RECEIPT",409);
  const lines=lineRows.map(line=>{
    const quantity=Number(line.purchase_quantity);
    const receiptTotalMinor=safeMinor(Number(line.receipt_total_minor));
    const expectedAtOrderPriceMinor=proportionalMinor(
      Number(line.unit_cost_minor),quantity,1);
    return {purchaseOrderLineId:line.id,itemName:line.item_name_snapshot,
      purchaseUnitCode:line.purchase_unit_code,quantity,
      poUnitCostMinor:Number(line.unit_cost_minor),
      expectedAtOrderPriceMinor,receiptTotalMinor,
      poPriceVarianceMinor:receiptTotalMinor-expectedAtOrderPriceMinor};
  });
  const receiptTotalMinor=receipts.reduce((sum,r)=>safeMinor(sum+Number(r.total_minor)),0);
  const poPriceVarianceMinor=lines.reduce((sum,r)=>
    signedMinor(sum+r.poPriceVarianceMinor),0);
  return {receipts,lines,receiptTotalMinor,poPriceVarianceMinor};
}
async function detail(db:Q,businessId:string,matchId:string) {
  const row=(await db.query<MatchRow>(SELECT_MATCH+
    " WHERE business_id=$1 AND id=$2",[businessId,matchId])).rows[0];
  if(!row)throw new InvoiceMatchError("Supplier invoice match not found",
    "INVOICE_MATCH_NOT_FOUND",404);
  const refs=(await db.query<{purchase_id:string}>(
    `SELECT purchase_id FROM supplier_invoice_match_receipts
     WHERE business_id=$1 AND invoice_match_id=$2 ORDER BY purchase_id`,
    [businessId,matchId])).rows.map(r=>r.purchase_id);
  const match=mapMatch(row);
  const derived=refs.length>0?await snapshot(db,businessId,row.purchase_order_id,refs):
    {receipts:[] as ReceiptRow[],lines:[] as Awaited<ReturnType<typeof snapshot>>["lines"],
      receiptTotalMinor:0,poPriceVarianceMinor:0};
  return {...match,lines:derived.lines,
    receipts:derived.receipts.map(r=>({
      id:r.id,receivedAt:r.received_at.toISOString(),
      totalMinor:Number(r.total_minor),supplierReference:r.supplier_reference,
    }))};
}
async function audit(tx:DatabaseClient,args:{
  businessId:string;branchId:string;staffId:string;matchId:string;
  eventType:string;invoiceReference:string;note?:string
}) {
  await tx.query(
    `INSERT INTO audit_events
     (business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,payload)
     VALUES ($1,$2,$3,$4,'SUPPLIER_INVOICE_MATCH',$5,$6::jsonb)`,
    [args.businessId,args.branchId,args.staffId,args.eventType,args.matchId,
      JSON.stringify({invoiceReference:args.invoiceReference,note:args.note??""})]);
}
function failure(
  req:{log:{error:(e:unknown)=>void}},
  reply:{code:(status:number)=>{send:(p:unknown)=>unknown}},error:unknown
) {
  if(error instanceof InvoiceMatchError||error instanceof AuthError)
    return reply.code(error.statusCode).send({error:error.code,message:error.message});
  const pg=error as {code?:string;constraint?:string};
  if(pg?.code==="23505")
    return reply.code(409).send({error:"INVOICE_MATCH_DUPLICATE",
      message:"This supplier invoice or goods receipt is already linked to a matching document"});
  req.log.error(error);
  return reply.code(500).send({error:"INVOICE_MATCH_FAILED",
    message:"Supplier invoice could not be reconciled safely"});
}
export function registerSupplierInvoiceMatchRoutes(app:FastifyInstance,pool:DatabasePool):void {
  app.get<{Params:{orderId:string};Querystring:{businessId?:string}}>(
    "/v1/purchase-orders/:orderId/invoice-matches",async(request,reply)=>{
      try {
        const businessId=id(request.query.businessId,"business ID");
        const orderId=id(request.params.orderId,"purchase order ID");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,READ_ROLES);
        const found=(await pool.query<{id:string}>(
          `SELECT id FROM supplier_purchase_orders
           WHERE business_id=$1 AND id=$2`,[businessId,orderId])).rows[0];
        if(!found)throw new InvoiceMatchError("Purchase order not found",
          "PURCHASE_ORDER_NOT_FOUND",404);
        const rows=(await pool.query<MatchRow>(
          SELECT_MATCH+` WHERE business_id=$1 AND purchase_order_id=$2
          ORDER BY created_at DESC,id DESC LIMIT 100`,[businessId,orderId])).rows;
        return {matches:await Promise.all(rows.map(row=>
          detail(pool,businessId,row.id)))};
      }catch(error){return failure(request,reply,error);}
    });

  app.post<{Params:{orderId:string};Body:MatchInput}>(
    "/v1/purchase-orders/:orderId/invoice-matches",async(request,reply)=>{
      try{
        const orderId=id(request.params.orderId,"purchase order ID");
        const data=inputOf(request.body);
        const access=await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          data.businessId,CREATE_ROLES);
        if(!access.staffId)throw new InvoiceMatchError(
          "An active staff identity is required to register a supplier invoice",
          "INVOICE_MATCH_STAFF_REQUIRED",403);
        const staffId=access.staffId;
        const fingerprint=createHash("sha256")
          .update(JSON.stringify({orderId,...data})).digest("hex");
        const created=await withTransaction(pool,async tx=>{
          // Lock the PO first. Receipts also lock this row before posting.
          // This stabilizes selected receipt amounts while we claim them.
          const po=(await tx.query<{
            id:string;branch_id:string;supplier_id:string;currency_code:string;
            status:string;
          }>(
            `SELECT id,branch_id,supplier_id,currency_code,status
             FROM supplier_purchase_orders WHERE business_id=$1 AND id=$2 FOR UPDATE`,
            [data.businessId,orderId])).rows[0];
          if(!po)throw new InvoiceMatchError("Purchase order not found",
            "PURCHASE_ORDER_NOT_FOUND",404);
          const prior=(await tx.query<{id:string;request_fingerprint:string}>(
            `SELECT id,request_fingerprint FROM supplier_invoice_matches
             WHERE business_id=$1 AND client_request_id=$2`,
            [data.businessId,data.clientRequestId])).rows[0];
          if(prior){
            if(prior.request_fingerprint!==fingerprint)
              throw new InvoiceMatchError("Request ID already used for different invoice information",
                "INVOICE_MATCH_REQUEST_CONFLICT",409);
            return {id:prior.id,replayed:true};
          }
          if(po.status!=="ISSUED"&&po.status!=="CANCELLED")
            throw new InvoiceMatchError("Issue the purchase order before matching supplier invoices",
              "INVOICE_MATCH_ORDER_NOT_ISSUED",409);
          const already=(await tx.query<{id:string}>(
            `SELECT id FROM supplier_invoice_matches WHERE business_id=$1
               AND supplier_id=$2 AND lower(invoice_reference)=lower($3)
               AND status<>'CANCELLED' LIMIT 1`,
            [data.businessId,po.supplier_id,data.invoiceReference])).rows[0];
          if(already)throw new InvoiceMatchError("Invoice number is already registered for this supplier",
            "INVOICE_MATCH_DUPLICATE",409);
          const checked=await snapshot(tx,data.businessId,orderId,data.receiptIds);
          for(const receipt of checked.receipts){
            if(receipt.branch_id!==po.branch_id||receipt.supplier_id!==po.supplier_id)
              throw new InvoiceMatchError("Receipt supplier or branch does not match this order",
                "INVOICE_MATCH_RECEIPT_SCOPE",409);
          }
          const claims=(await tx.query<{purchase_id:string}>(
            `SELECT purchase_id FROM supplier_invoice_match_receipts
             WHERE business_id=$1 AND purchase_id=ANY($2::uuid[])`,
            [data.businessId,data.receiptIds])).rows;
          if(claims.length)
            throw new InvoiceMatchError("A selected receipt is already matched to another invoice",
              "INVOICE_MATCH_RECEIPT_CLAIMED",409);
          const invoiceVariance=signedMinor(data.invoiceTotalMinor-checked.receiptTotalMinor);
          const inserted=(await tx.query<{id:string}>(
            `INSERT INTO supplier_invoice_matches(
                business_id,branch_id,supplier_id,purchase_order_id,
                created_by_staff_id,client_request_id,request_fingerprint,
                invoice_reference,invoice_date,currency_code,invoice_total_minor,
                receipt_total_minor,invoice_variance_minor,po_price_variance_minor,
                receipt_count,notes)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
               RETURNING id`,
            [data.businessId,po.branch_id,po.supplier_id,orderId,staffId,
              data.clientRequestId,fingerprint,data.invoiceReference,data.invoiceDate,
              po.currency_code,data.invoiceTotalMinor,checked.receiptTotalMinor,
              invoiceVariance,checked.poPriceVarianceMinor,data.receiptIds.length,
              data.notes])).rows[0]!;
          for(const receipt of checked.receipts){
            await tx.query(
              `INSERT INTO supplier_invoice_match_receipts(
                business_id,invoice_match_id,purchase_id,purchase_total_minor)
               VALUES($1,$2,$3,$4)`,
              [data.businessId,inserted.id,receipt.id,Number(receipt.total_minor)]);
          }
          await audit(tx,{businessId:data.businessId,branchId:po.branch_id,
            staffId,matchId:inserted.id,
            eventType:"SUPPLIER_INVOICE_MATCH_CREATED",
            invoiceReference:data.invoiceReference});
          return {id:inserted.id,replayed:false};
        });
        return reply.code(created.replayed?200:201).send({
          match:await detail(pool,data.businessId,created.id),
          idempotentReplay:created.replayed,
        });
      }catch(error){return failure(request,reply,error);}
    });

  for(const action of ["approve","cancel"] as const){
    app.post<{Params:{matchId:string};Body:{businessId?:string;approvalNote?:string}}>(
      `/v1/supplier-invoice-matches/:matchId/${action}`,async(request,reply)=>{
        try{
          const businessId=id(request.body?.businessId,"business ID");
          const matchId=id(request.params.matchId,"invoice match ID");
          const approvalNote=optional(request.body?.approvalNote,"Approval note",2000);
          const access=await requireBusinessRole(pool,
            await authenticateAccessToken(pool,request.headers.authorization),
            businessId,action==="approve"?APPROVE_ROLES:CREATE_ROLES);
          if(!access.staffId)throw new InvoiceMatchError(
            "An active staff identity is required for invoice review",
            "INVOICE_MATCH_STAFF_REQUIRED",403);
          const staffId=access.staffId;
          await withTransaction(pool,async tx=>{
            const row=(await tx.query<MatchRow>(
              SELECT_MATCH+` WHERE business_id=$1 AND id=$2 FOR UPDATE`,
              [businessId,matchId])).rows[0];
            if(!row)throw new InvoiceMatchError("Invoice match not found",
              "INVOICE_MATCH_NOT_FOUND",404);
            const target:MatchStatus=action==="approve"?"APPROVED":"CANCELLED";
            if(row.status===target)return;
            if(row.status!=="DRAFT")
              throw new InvoiceMatchError("Only draft invoice matches may be approved or cancelled",
                "INVOICE_MATCH_STATE_CONFLICT",409);
            if(action==="approve"){
              const variance=Number(row.invoice_variance_minor)!==0||
                Number(row.po_price_variance_minor)!==0;
              if(variance&&approvalNote.length<12)
                throw new InvoiceMatchError(
                  "A manager justification of at least 12 characters is required for invoice or PO price differences",
                  "INVOICE_MATCH_EXCEPTION_NOTE_REQUIRED",409);
              // Match is a reviewed reconciliation only: it must NOT post a
              // second payable, revalue stock or mark any supplier payment.
              await tx.query(
                `UPDATE supplier_invoice_matches SET status='APPROVED',
                 approved_by_staff_id=$3,approved_at=now(),approval_note=$4,
                 updated_at=now() WHERE business_id=$1 AND id=$2`,
                [businessId,matchId,staffId,approvalNote]);
            }else{
              // Cancelled drafts release their receipt claims for corrected
              // registration. Approved history is immutable.
              await tx.query(
                `DELETE FROM supplier_invoice_match_receipts
                 WHERE business_id=$1 AND invoice_match_id=$2`,
                [businessId,matchId]);
              await tx.query(
                `UPDATE supplier_invoice_matches SET status='CANCELLED',
                 cancelled_at=now(),updated_at=now()
                 WHERE business_id=$1 AND id=$2`,[businessId,matchId]);
            }
            await audit(tx,{businessId,branchId:row.branch_id,staffId,
              matchId,eventType:target==="APPROVED"?
                "SUPPLIER_INVOICE_MATCH_APPROVED":"SUPPLIER_INVOICE_MATCH_CANCELLED",
              invoiceReference:row.invoice_reference,note:approvalNote});
          });
          return {match:await detail(pool,businessId,matchId)};
        }catch(error){return failure(request,reply,error);}
      });
  }
}
