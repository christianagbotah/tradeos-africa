import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "./db.js";
import {
  proportionalMinor, safeMinor, signedMinor, quantityUnits, quantityFromUnits,
} from "./commerce/valuation.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
// Invoice costs, supplier documents and attachments are financial records.
const READ_ROLES:readonly BusinessRole[]=[
  "OWNER","ADMIN","MANAGER","ACCOUNTANT","INVENTORY",
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
  invoiceLines?:Array<{
    purchaseOrderLineId?:string;invoiceQuantity?:number;invoiceUnitCostMinor?:number
  }>;
  notes?:string;
}
interface MatchRow {
  id:string;business_id:string;branch_id:string;supplier_id:string;
  purchase_order_id:string;invoice_reference:string;invoice_date:Date|string;
  currency_code:string;invoice_total_minor:string;receipt_total_minor:string;
  invoice_variance_minor:string;po_price_variance_minor:string;receipt_count:number;
  status:MatchStatus;itemized:boolean;invoice_lines_subtotal_minor:string;
  invoice_adjustment_minor:string;line_discrepancy_count:number;
  notes:string;approval_note:string;approved_at:Date|null;
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
  // Optional only for backwards compatibility with existing header-only invoice
  // matches. The merchant UI always supplies one line per received PO item.
  let invoiceLines: Array<{
    purchaseOrderLineId:string;invoiceQuantity:number;invoiceUnitCostMinor:number
  }> | null = null;
  if(raw.invoiceLines!==undefined){
    if(!Array.isArray(raw.invoiceLines)||raw.invoiceLines.length<1||
      raw.invoiceLines.length>100)
      throw new InvoiceMatchError("Provide 1 to 100 invoice item lines");
    invoiceLines=raw.invoiceLines.map((line,index)=>{
      const purchaseOrderLineId=id(line?.purchaseOrderLineId,
        `purchase order line ${index+1}`);
      const invoiceQuantity=line?.invoiceQuantity;
      if(typeof invoiceQuantity!=="number"||!Number.isFinite(invoiceQuantity)||
        invoiceQuantity<0||invoiceQuantity>1_000_000||
        Math.abs(invoiceQuantity*1e8-Math.round(invoiceQuantity*1e8))>.001)
        throw new InvoiceMatchError("Invoice item quantity must have at most 8 decimals");
      const invoiceUnitCostMinor=line?.invoiceUnitCostMinor;
      if(typeof invoiceUnitCostMinor!=="number"||
        !Number.isSafeInteger(invoiceUnitCostMinor)||invoiceUnitCostMinor<0)
        throw new InvoiceMatchError("Invoice item unit cost must be in nonnegative pesewas");
      return {purchaseOrderLineId,invoiceQuantity,invoiceUnitCostMinor};
    }).sort((a,b)=>a.purchaseOrderLineId.localeCompare(b.purchaseOrderLineId));
    if(new Set(invoiceLines.map(line=>line.purchaseOrderLineId)).size!==invoiceLines.length)
      throw new InvoiceMatchError("One invoice item per received purchase-order line is required");
  }
  return {businessId,clientRequestId,invoiceReference,invoiceDate,
    invoiceTotalMinor,receiptIds:receipts.sort(),invoiceLines,notes};
}
const SELECT_MATCH=`SELECT id,business_id,branch_id,supplier_id,purchase_order_id,
  invoice_reference,invoice_date,currency_code,invoice_total_minor::text,
  receipt_total_minor::text,invoice_variance_minor::text,po_price_variance_minor::text,
  receipt_count,status,itemized,invoice_lines_subtotal_minor::text,
  invoice_adjustment_minor::text,line_discrepancy_count,
  notes,approval_note,approved_at,cancelled_at,created_at
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
    receiptCount:row.receipt_count,itemized:row.itemized,
    invoiceLinesSubtotalMinor:Number(row.invoice_lines_subtotal_minor),
    invoiceAdjustmentMinor:Number(row.invoice_adjustment_minor),
    lineDiscrepancyCount:row.line_discrepancy_count,
    notes:row.notes,approvalNote:row.approval_note,
    approvedAt:row.approved_at?.toISOString()??null,
    cancelledAt:row.cancelled_at?.toISOString()??null,
    createdAt:row.created_at.toISOString(),
    hasException:Number(row.invoice_variance_minor)!==0||
      Number(row.po_price_variance_minor)!==0||
      (row.itemized&&(Number(row.invoice_adjustment_minor)!==0||
        row.line_discrepancy_count>0)),
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
type ReceivedLine=Awaited<ReturnType<typeof snapshot>>["lines"][number];
type InvoiceLineInput=NonNullable<ReturnType<typeof inputOf>["invoiceLines"]>[number];
function matchInvoiceItems(
  receivedLines:ReceivedLine[],invoiceLines:InvoiceLineInput[],invoiceTotalMinor:number
){
  if(receivedLines.length!==invoiceLines.length)
    throw new InvoiceMatchError(
      "Enter one supplier invoice item for every product in the selected delivery receipts",
      "INVOICE_MATCH_LINE_COUNT",409);
  const receivedById=new Map(receivedLines.map(line=>[line.purchaseOrderLineId,line]));
  let subtotal=0;
  let lineDiscrepancyCount=0;
  const lines=invoiceLines.map((line,index)=>{
    const received=receivedById.get(line.purchaseOrderLineId);
    if(!received)
      throw new InvoiceMatchError(
        "Invoice item does not belong to selected purchase-order delivery receipts",
        "INVOICE_MATCH_LINE_SCOPE",409);
    const invoiceLineTotalMinor=proportionalMinor(
      safeMinor(line.invoiceUnitCostMinor),line.invoiceQuantity,1);
    const quantityVarianceUnits=quantityUnits(line.invoiceQuantity)-
      quantityUnits(received.quantity);
    const quantityVariance=quantityFromUnits(quantityVarianceUnits);
    const valueVarianceMinor=signedMinor(invoiceLineTotalMinor-received.receiptTotalMinor);
    if(quantityVarianceUnits!==0n||valueVarianceMinor!==0)lineDiscrepancyCount++;
    subtotal=safeMinor(subtotal+invoiceLineTotalMinor);
    return {
      ...line,
      sortOrder:index,
      itemName:received.itemName,purchaseUnitCode:received.purchaseUnitCode,
      receivedQuantity:received.quantity,receivedCostMinor:received.receiptTotalMinor,
      poUnitCostMinor:received.poUnitCostMinor,
      poExpectedTotalMinor:received.expectedAtOrderPriceMinor,
      invoiceLineTotalMinor,quantityVariance,valueVarianceMinor,
    };
  });
  const invoiceAdjustmentMinor=signedMinor(invoiceTotalMinor-subtotal);
  return {lines,invoiceLinesSubtotalMinor:subtotal,
    invoiceAdjustmentMinor,lineDiscrepancyCount};
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
  const itemRows=match.itemized?(await db.query<{
    id:string;purchase_order_line_id:string;item_name_snapshot:string;
    purchase_unit_code:string;invoice_quantity:string;
    invoice_unit_cost_minor:string;invoice_line_total_minor:string;
    received_quantity:string;received_cost_minor:string;
    po_unit_cost_minor:string;po_expected_total_minor:string;
    quantity_variance:string;value_variance_minor:string
  }>(
    `SELECT id,purchase_order_line_id,item_name_snapshot,purchase_unit_code,
      invoice_quantity::text,invoice_unit_cost_minor::text,
      invoice_line_total_minor::text,received_quantity::text,
      received_cost_minor::text,po_unit_cost_minor::text,
      po_expected_total_minor::text,quantity_variance::text,
      value_variance_minor::text
     FROM supplier_invoice_match_lines
     WHERE business_id=$1 AND invoice_match_id=$2 ORDER BY sort_order,id`,
    [businessId,matchId])).rows:[];
  const evidence=(await db.query<{
    id:string;filename:string;mime_type:string;size_bytes:number;created_at:Date
  }>(
    `SELECT id,filename,mime_type,size_bytes,created_at
     FROM supplier_invoice_evidence WHERE business_id=$1 AND invoice_match_id=$2
     ORDER BY created_at,id`,[businessId,matchId])).rows;
  return {...match,lines:derived.lines,
    evidence:evidence.map(file=>({
      id:file.id,filename:file.filename,mimeType:file.mime_type,
      sizeBytes:file.size_bytes,createdAt:file.created_at.toISOString(),
    })),
    invoiceItemLines:itemRows.map(item=>({
      id:item.id,purchaseOrderLineId:item.purchase_order_line_id,
      itemName:item.item_name_snapshot,purchaseUnitCode:item.purchase_unit_code,
      invoiceQuantity:Number(item.invoice_quantity),
      invoiceUnitCostMinor:Number(item.invoice_unit_cost_minor),
      invoiceLineTotalMinor:Number(item.invoice_line_total_minor),
      receivedQuantity:Number(item.received_quantity),
      receivedCostMinor:Number(item.received_cost_minor),
      poUnitCostMinor:Number(item.po_unit_cost_minor),
      poExpectedTotalMinor:Number(item.po_expected_total_minor),
      quantityVariance:Number(item.quantity_variance),
      valueVarianceMinor:Number(item.value_variance_minor),
    })),
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
const EVIDENCE_MAX_BYTES=3*1024*1024;
function receiveEvidence(value:unknown):{
  filename:string;mimeType:"application/pdf"|"image/png"|"image/jpeg";
  bytes:Buffer;sizeBytes:number;sha256:string
}{
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new InvoiceMatchError("A PDF, PNG or JPEG invoice file is required");
  const raw=value as Record<string,unknown>;
  const filename=plain(raw.filename,"File name",120)
    .replace(/[^a-zA-Z0-9._() -]/g,"_").replace(/^\.+/,"");
  if(!filename)throw new InvoiceMatchError("File name is invalid");
  const base64=raw.base64;
  if(typeof base64!=="string"||base64.length>4_194_304||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
    throw new InvoiceMatchError("Invoice document must be a valid file up to 3 MiB");
  const bytes=Buffer.from(base64,"base64");
  if(bytes.length===0||bytes.length>EVIDENCE_MAX_BYTES||
    bytes.toString("base64")!==base64)
    throw new InvoiceMatchError("Invoice document is empty, invalid or too large");
  const detected: "application/pdf"|"image/png"|"image/jpeg"|null=
    bytes.subarray(0,5).toString("ascii")==="%PDF-"?"application/pdf":
    bytes.length>=8&&bytes.subarray(0,8)
      .equals(Buffer.from("89504e470d0a1a0a","hex"))?"image/png":
    bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255?
      "image/jpeg":null;
  if(!detected||raw.mimeType!==detected)
    throw new InvoiceMatchError(
      "Invoice evidence must be a real PDF, PNG or JPEG matching its file type",
      "INVOICE_EVIDENCE_TYPE_INVALID",415);
  return {filename,mimeType:detected,bytes,sizeBytes:bytes.length,
    sha256:createHash("sha256").update(bytes).digest("hex")};
}

export function registerSupplierInvoiceMatchRoutes(app:FastifyInstance,pool:DatabasePool):void {
  // Private invoice evidence; deliberately NOT routed through the public logo
  // media API. Max 3 files, 3 MiB each, draft-only, authenticated on each read.
  app.post<{Params:{matchId:string};Body:{
    businessId?:string;filename?:string;mimeType?:string;base64?:string
  }}>(
    "/v1/supplier-invoice-matches/:matchId/evidence",
    {bodyLimit:4_700_000},
    async(request,reply)=>{
      try{
        const businessId=id(request.body?.businessId,"business ID");
        const matchId=id(request.params.matchId,"invoice match ID");
        const access=await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,CREATE_ROLES);
        if(!access.staffId)throw new InvoiceMatchError(
          "An active staff identity is required to upload evidence",
          "INVOICE_MATCH_STAFF_REQUIRED",403);
        const staffId=access.staffId;
        const file=receiveEvidence(request.body);
        const result=await withTransaction(pool,async tx=>{
          const match=(await tx.query<{id:string;status:MatchStatus;
            branch_id:string;invoice_reference:string}>(
            `SELECT id,status,branch_id,invoice_reference
             FROM supplier_invoice_matches WHERE business_id=$1 AND id=$2 FOR UPDATE`,
            [businessId,matchId])).rows[0];
          if(!match)throw new InvoiceMatchError("Invoice match not found",
            "INVOICE_MATCH_NOT_FOUND",404);
          if(match.status!=="DRAFT")
            throw new InvoiceMatchError("Evidence may be added only to draft invoice matches",
              "INVOICE_EVIDENCE_DRAFT_ONLY",409);
          const existing=(await tx.query<{id:string}>(
            `SELECT id FROM supplier_invoice_evidence
             WHERE business_id=$1 AND invoice_match_id=$2 AND sha256=$3`,
            [businessId,matchId,file.sha256])).rows[0];
          if(existing)return {id:existing.id,replay:true};
          const count=(await tx.query<{count:string}>(
            `SELECT COUNT(*)::text AS count FROM supplier_invoice_evidence
             WHERE business_id=$1 AND invoice_match_id=$2`,
            [businessId,matchId])).rows[0];
          if(Number(count?.count??0)>=3)
            throw new InvoiceMatchError("A supplier invoice can hold up to three evidence files",
              "INVOICE_EVIDENCE_LIMIT",409);
          const inserted=(await tx.query<{id:string}>(
            `INSERT INTO supplier_invoice_evidence(
              business_id,invoice_match_id,created_by_staff_id,
              filename,mime_type,size_bytes,sha256,file_bytes)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [businessId,matchId,staffId,file.filename,file.mimeType,
              file.sizeBytes,file.sha256,file.bytes])).rows[0]!;
          await audit(tx,{businessId,branchId:match.branch_id,
            staffId,matchId,
            eventType:"SUPPLIER_INVOICE_EVIDENCE_ADDED",
            invoiceReference:match.invoice_reference,
            note:`${file.filename} · ${file.sizeBytes} bytes`});
          return {id:inserted.id,replay:false};
        });
        return reply.code(result.replay?200:201).send({
          evidenceId:result.id,idempotentReplay:result.replay,
        });
      }catch(error){return failure(request,reply,error);}
    });

  app.delete<{Params:{matchId:string;fileId:string};Querystring:{
    businessId?:string
  }}>(
    "/v1/supplier-invoice-matches/:matchId/evidence/:fileId",
    async(request,reply)=>{
      try{
        const businessId=id(request.query.businessId,"business ID");
        const matchId=id(request.params.matchId,"invoice match ID");
        const fileId=id(request.params.fileId,"evidence ID");
        const access=await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,CREATE_ROLES);
        if(!access.staffId)throw new InvoiceMatchError(
          "Active staff identity is required to remove evidence",
          "INVOICE_MATCH_STAFF_REQUIRED",403);
        const staffId=access.staffId;
        await withTransaction(pool,async tx=>{
          const match=(await tx.query<{status:MatchStatus;branch_id:string;
            invoice_reference:string}>(
            `SELECT status,branch_id,invoice_reference FROM supplier_invoice_matches
             WHERE business_id=$1 AND id=$2 FOR UPDATE`,[businessId,matchId])).rows[0];
          if(!match)throw new InvoiceMatchError("Invoice match not found",
            "INVOICE_MATCH_NOT_FOUND",404);
          if(match.status!=="DRAFT")
            throw new InvoiceMatchError("Evidence can only be removed from draft invoices",
              "INVOICE_EVIDENCE_DRAFT_ONLY",409);
          const removed=(await tx.query<{filename:string}>(
            `DELETE FROM supplier_invoice_evidence
             WHERE business_id=$1 AND invoice_match_id=$2 AND id=$3
             RETURNING filename`,[businessId,matchId,fileId])).rows[0];
          if(!removed)throw new InvoiceMatchError("Evidence not found",
            "INVOICE_EVIDENCE_NOT_FOUND",404);
          await audit(tx,{businessId,branchId:match.branch_id,staffId,
            matchId,eventType:"SUPPLIER_INVOICE_EVIDENCE_REMOVED",
            invoiceReference:match.invoice_reference,note:removed.filename});
        });
        return reply.code(204).send();
      }catch(error){return failure(request,reply,error);}
    });

  app.get<{Params:{matchId:string;fileId:string};Querystring:{
    businessId?:string
  }}>(
    "/v1/supplier-invoice-matches/:matchId/evidence/:fileId",
    async(request,reply)=>{
      try{
        const businessId=id(request.query.businessId,"business ID");
        const matchId=id(request.params.matchId,"invoice match ID");
        const fileId=id(request.params.fileId,"evidence ID");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,READ_ROLES);
        const row=(await pool.query<{filename:string;mime_type:string;
          size_bytes:number;file_bytes:Buffer}>(
          `SELECT e.filename,e.mime_type,e.size_bytes,e.file_bytes
           FROM supplier_invoice_evidence e
           JOIN supplier_invoice_matches im
             ON im.id=e.invoice_match_id AND im.business_id=e.business_id
           WHERE e.business_id=$1 AND e.invoice_match_id=$2 AND e.id=$3`,
          [businessId,matchId,fileId])).rows[0];
        if(!row)throw new InvoiceMatchError("Invoice evidence not found",
          "INVOICE_EVIDENCE_NOT_FOUND",404);
        const filename=row.filename.replace(/[\\\r\n"]/g,"_");
        return reply
          .header("Content-Type",row.mime_type)
          .header("Content-Length",String(row.size_bytes))
          .header("Content-Disposition",`attachment; filename="${filename}"`)
          .header("Cache-Control","private, no-store")
          .header("X-Content-Type-Options","nosniff")
          .header("Content-Security-Policy","sandbox")
          .send(row.file_bytes);
      }catch(error){return failure(request,reply,error);}
    });


  // Preview is read-only: quantities and unit costs are derived only from
  // already posted physical deliveries and scoped to the authenticated PO.
  app.post<{Params:{orderId:string};Body:{
    businessId?:string;receiptIds?:string[]
  }}>(
    "/v1/purchase-orders/:orderId/invoice-item-preview",
    async(request,reply)=>{
      try{
        const businessId=id(request.body?.businessId,"business ID");
        const orderId=id(request.params.orderId,"purchase order ID");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,READ_ROLES);
        const ids=request.body?.receiptIds;
        if(!Array.isArray(ids)||ids.length<1||ids.length>100)
          throw new InvoiceMatchError("Select 1 to 100 posted deliveries");
        const receiptIds=ids.map(value=>id(value,"receipt ID"));
        if(new Set(receiptIds).size!==receiptIds.length)
          throw new InvoiceMatchError("Each receipt may only be selected once");
        const po=(await pool.query<{id:string;branch_id:string;supplier_id:string}>(
          `SELECT id,branch_id,supplier_id FROM supplier_purchase_orders
           WHERE business_id=$1 AND id=$2`,[businessId,orderId])).rows[0];
        if(!po)throw new InvoiceMatchError("Purchase order not found",
          "PURCHASE_ORDER_NOT_FOUND",404);
        const checked=await snapshot(pool,businessId,orderId,receiptIds);
        if(checked.receipts.some(r=>r.branch_id!==po.branch_id||
          r.supplier_id!==po.supplier_id))
          throw new InvoiceMatchError("Selected deliveries do not belong to this branch and supplier",
            "INVOICE_MATCH_RECEIPT_SCOPE",409);
        return {receiptTotalMinor:checked.receiptTotalMinor,
          poPriceVarianceMinor:checked.poPriceVarianceMinor,lines:checked.lines};
      }catch(error){return failure(request,reply,error);}
    });

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
          const itemized=data.invoiceLines?
            matchInvoiceItems(checked.lines,data.invoiceLines,data.invoiceTotalMinor):null;
          const invoiceVariance=signedMinor(data.invoiceTotalMinor-checked.receiptTotalMinor);
          const inserted=(await tx.query<{id:string}>(
            `INSERT INTO supplier_invoice_matches(
                business_id,branch_id,supplier_id,purchase_order_id,
                created_by_staff_id,client_request_id,request_fingerprint,
                invoice_reference,invoice_date,currency_code,invoice_total_minor,
                receipt_total_minor,invoice_variance_minor,po_price_variance_minor,
                receipt_count,notes,itemized,invoice_lines_subtotal_minor,
                invoice_adjustment_minor,line_discrepancy_count)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 $15,$16,$17,$18,$19,$20)
               RETURNING id`,
            [data.businessId,po.branch_id,po.supplier_id,orderId,staffId,
              data.clientRequestId,fingerprint,data.invoiceReference,data.invoiceDate,
              po.currency_code,data.invoiceTotalMinor,checked.receiptTotalMinor,
              invoiceVariance,checked.poPriceVarianceMinor,data.receiptIds.length,
              data.notes,Boolean(itemized),itemized?.invoiceLinesSubtotalMinor??0,
              itemized?.invoiceAdjustmentMinor??0,
              itemized?.lineDiscrepancyCount??0])).rows[0]!;
          for(const receipt of checked.receipts){
            await tx.query(
              `INSERT INTO supplier_invoice_match_receipts(
                business_id,invoice_match_id,purchase_id,purchase_total_minor)
               VALUES($1,$2,$3,$4)`,
              [data.businessId,inserted.id,receipt.id,Number(receipt.total_minor)]);
          }
          if(itemized){
            for(const line of itemized.lines){
              await tx.query(
                `INSERT INTO supplier_invoice_match_lines(
                  business_id,invoice_match_id,purchase_order_line_id,sort_order,
                  item_name_snapshot,purchase_unit_code,invoice_quantity,
                  invoice_unit_cost_minor,invoice_line_total_minor,
                  received_quantity,received_cost_minor,po_unit_cost_minor,
                  po_expected_total_minor,quantity_variance,value_variance_minor
                ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
                [data.businessId,inserted.id,line.purchaseOrderLineId,line.sortOrder,
                  line.itemName,line.purchaseUnitCode,line.invoiceQuantity,
                  line.invoiceUnitCostMinor,line.invoiceLineTotalMinor,
                  line.receivedQuantity,line.receivedCostMinor,line.poUnitCostMinor,
                  line.poExpectedTotalMinor,line.quantityVariance,line.valueVarianceMinor]);
            }
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
                Number(row.po_price_variance_minor)!==0||
                (row.itemized&&(Number(row.invoice_adjustment_minor)!==0||
                  row.line_discrepancy_count>0));
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
