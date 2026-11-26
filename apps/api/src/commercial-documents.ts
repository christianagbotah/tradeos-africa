import {parseReceiptPaper,renderCommercialDocumentPdf} from "./sale-receipt-pdf.js";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import type { DatabasePool, DatabaseClient } from "./db.js";
import { withTransaction } from "./db.js";
import { proportionalMinor, safeMinor } from "./commerce/valuation.js";

const READ_ROLES: readonly BusinessRole[] = [
  "OWNER","ADMIN","MANAGER","CASHIER","SALES","ACCOUNTANT","INVENTORY","STAFF","VIEWER",
];
const WRITE_ROLES: readonly BusinessRole[] = ["OWNER","ADMIN","MANAGER","CASHIER","SALES"];
const CONTROL_ROLES: readonly BusinessRole[] = ["OWNER","ADMIN","MANAGER"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Kind = "QUOTATION" | "PROFORMA";
type Status = "DRAFT" | "ISSUED" | "CANCELLED";

interface DocumentInput {
  businessId?: string;
  branchId?: string;
  clientRequestId?: string;
  kind?: Kind;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  expiresAt?: string;
  lines?: Array<{ itemId?: string; saleUnitCode?: string; quantity?: number }>;
}
interface DocumentRow {
  id: string; business_id: string; branch_id: string; document_number: string;
  kind: Kind; status: Status; customer_id: string | null;
  customer_name_snapshot: string; customer_phone_snapshot: string | null;
  customer_email_snapshot: string | null; notes: string; currency_code: string;
  subtotal_minor: string; tax_minor: string; total_minor: string;
  expires_at: Date | null; issued_at: Date | null; cancelled_at: Date | null;
  created_at: Date; updated_at: Date;
}
interface LineRow {
  id: string; item_id: string; item_name_snapshot: string; item_kind_snapshot: string;
  quantity: string; sale_unit_code: string; unit_net_minor: string;
  line_net_minor: string; line_tax_minor: string; line_total_minor: string;
}
class DocumentError extends Error {
  constructor(message: string, readonly code = "DOCUMENT_INVALID", readonly statusCode = 400) {
    super(message);
  }
}
function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new DocumentError(`Valid ${label} is required`, "DOCUMENT_ID_INVALID");
  return value;
}
function textValue(value: unknown, max: number, label: string, required = false): string {
  if (value !== undefined && typeof value !== "string")
    throw new DocumentError(`${label} must be text`);
  const result = typeof value === "string" ? value.trim() : "";
  if (result.length > max || (required && !result))
    throw new DocumentError(`${label} must contain 1–${max} characters`);
  return result;
}
function validateInput(input: DocumentInput | undefined) {
  if (!input || typeof input !== "object")
    throw new DocumentError("Document information is required");
  const businessId = id(input.businessId, "businessId");
  const branchId = id(input.branchId, "branchId");
  const requestId = id(input.clientRequestId, "clientRequestId");
  if (input.kind !== "QUOTATION" && input.kind !== "PROFORMA")
    throw new DocumentError("Document kind must be QUOTATION or PROFORMA");
  const customerId = input.customerId ? id(input.customerId, "customerId") : null;
  const customerName = textValue(input.customerName, 180, "Customer name", !customerId);
  const customerPhone = textValue(input.customerPhone, 40, "Customer phone");
  const customerEmail = textValue(input.customerEmail, 180, "Customer email");
  const notes = textValue(input.notes, 2000, "Notes");
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 50)
    throw new DocumentError("Add between 1 and 50 lines");
  const lines = input.lines.map((line) => {
    const itemId = id(line?.itemId, "line.itemId");
    const saleUnitCode = textValue(line?.saleUnitCode, 40, "Sale unit", true);
    const quantity = line?.quantity;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) ||
        quantity <= 0 || quantity > 1_000_000 ||
        Math.abs(quantity * 1e8 - Math.round(quantity * 1e8)) > 0.001)
      throw new DocumentError("Each quantity must be positive with at most 8 decimal places");
    return { itemId, saleUnitCode, quantity };
  });
  let expiresAt: string | null = null;
  if (input.expiresAt !== undefined && input.expiresAt !== "") {
    if (typeof input.expiresAt !== "string") throw new DocumentError("Invalid expiry date");
    const date = new Date(input.expiresAt);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() ||
      date.getTime() > Date.now() + 366 * 86400_000)
      throw new DocumentError("Expiry date must be within the next 366 days");
    expiresAt = date.toISOString();
  }
  return { businessId, branchId, requestId, kind: input.kind,
    customerId, customerName, customerPhone, customerEmail, notes, lines, expiresAt };
}
function asDocument(row: DocumentRow) {
  return {
    id: row.id, businessId: row.business_id, branchId: row.branch_id,
    documentNumber: row.document_number, kind: row.kind, status: row.status,
    customerId: row.customer_id, customerName: row.customer_name_snapshot,
    customerPhone: row.customer_phone_snapshot, customerEmail: row.customer_email_snapshot,
    currencyCode: row.currency_code, notes: row.notes,
    subtotalMinor: Number(row.subtotal_minor), taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor), expiresAt: row.expires_at?.toISOString() ?? null,
    issuedAt: row.issued_at?.toISOString() ?? null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}
async function loadDocument(db: Pick<DatabasePool,"query"> | Pick<DatabaseClient,"query">,
  businessId: string, documentId: string) {
  const result = await db.query<DocumentRow>(
    `SELECT id,business_id,branch_id,document_number,kind,status,customer_id,
      customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,notes,
      currency_code,subtotal_minor::text,tax_minor::text,total_minor::text,
      expires_at,issued_at,cancelled_at,created_at,updated_at
      FROM commercial_documents WHERE id=$1 AND business_id=$2`,
    [documentId,businessId]);
  const doc = result.rows[0];
  if (!doc) throw new DocumentError("Document not found", "DOCUMENT_NOT_FOUND", 404);
  const details = await db.query<LineRow>(
    `SELECT id,item_id,item_name_snapshot,item_kind_snapshot,quantity::text,
      sale_unit_code,unit_net_minor::text,line_net_minor::text,
      line_tax_minor::text,line_total_minor::text
      FROM commercial_document_lines
      WHERE document_id=$1 AND business_id=$2 ORDER BY sort_order`,
    [documentId,businessId]);
  return {
    ...asDocument(doc),
    lines: details.rows.map(line => ({
      id:line.id,itemId:line.item_id,itemName:line.item_name_snapshot,
      itemKind:line.item_kind_snapshot,quantity:Number(line.quantity),
      saleUnitCode:line.sale_unit_code,unitNetMinor:Number(line.unit_net_minor),
      lineNetMinor:Number(line.line_net_minor),lineTaxMinor:Number(line.line_tax_minor),
      lineTotalMinor:Number(line.line_total_minor),
    })),
  };
}
async function audit(tx: DatabaseClient, input: {
  businessId:string; branchId:string; staffId:string | null;
  eventType:string; documentId:string; kind:Kind; number:string;
}) {
  await tx.query(
    `INSERT INTO audit_events (business_id,branch_id,actor_staff_id,event_type,
      entity_type,entity_id,payload)
     VALUES ($1,$2,$3,$4,'COMMERCIAL_DOCUMENT',$5,$6::jsonb)`,
    [input.businessId,input.branchId,input.staffId,input.eventType,input.documentId,
     JSON.stringify({kind:input.kind,documentNumber:input.number})],
  );
}
function sendError(request:{log:{error:(error:unknown)=>void}},
  reply:{code:(status:number)=>{send:(payload:unknown)=>unknown}},error:unknown) {
  if (error instanceof DocumentError || error instanceof AuthError)
    return reply.code(error.statusCode).send({error:error.code,message:error.message});
  request.log.error(error);
  return reply.code(500).send({error:"DOCUMENT_OPERATION_FAILED",
    message:"Could not complete the document operation safely."});
}
export function registerCommercialDocumentRoutes(app:FastifyInstance,pool:DatabasePool):void {
  app.get<{Querystring:{businessId?:string;branchId?:string;kind?:string;limit?:string}}>(
    "/v1/commercial-documents",async(request,reply)=>{
      try {
        const businessId=id(request.query.businessId,"businessId");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,READ_ROLES);
        const branchId=request.query.branchId?id(request.query.branchId,"branchId"):null;
        const kind=request.query.kind;
        if(kind && kind!=="QUOTATION" && kind!=="PROFORMA")
          throw new DocumentError("Unknown document kind");
        const limit=Math.min(Math.max(parseInt(request.query.limit??"40",10)||40,1),100);
        const found=await pool.query<DocumentRow>(
          `SELECT id,business_id,branch_id,document_number,kind,status,customer_id,
            customer_name_snapshot,customer_phone_snapshot,customer_email_snapshot,notes,
            currency_code,subtotal_minor::text,tax_minor::text,total_minor::text,
            expires_at,issued_at,cancelled_at,created_at,updated_at
            FROM commercial_documents
            WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2::uuid)
              AND ($3::text IS NULL OR kind=$3)
            ORDER BY created_at DESC,id DESC LIMIT $4`,
          [businessId,branchId,kind??null,limit]);
        return {documents:found.rows.map(asDocument)};
      }catch(error){return sendError(request,reply,error);}
    });
  app.post<{Body:DocumentInput}>("/v1/commercial-documents",async(request,reply)=>{
    try {
      const input=validateInput(request.body);
      const auth=await authenticateAccessToken(pool,request.headers.authorization);
      const access=await requireBusinessRole(pool,auth,input.businessId,WRITE_ROLES);
      const fingerprint=createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const result=await withTransaction(pool,async tx=>{
        // Document sequences and same-key retries serialize on the business row.
        const business=(await tx.query<{currency_code:string}>(
          "SELECT currency_code FROM businesses WHERE id=$1 FOR UPDATE",
          [input.businessId])).rows[0];
        if(!business)throw new DocumentError("Business not found","BUSINESS_NOT_FOUND",404);
        const prior=await tx.query<{id:string;request_fingerprint:string}>(
          "SELECT id,request_fingerprint FROM commercial_documents WHERE business_id=$1 AND client_request_id=$2",
          [input.businessId,input.requestId]);
        if(prior.rows[0]){
          if(prior.rows[0].request_fingerprint!==fingerprint)
            throw new DocumentError("This request identifier was already used for different content",
              "DOCUMENT_REQUEST_CONFLICT",409);
          return {docId:prior.rows[0].id,replayed:true};
        }
        const branch=await tx.query(
          "SELECT id FROM branches WHERE business_id=$1 AND id=$2 AND is_active=true",
          [input.businessId,input.branchId]);
        if(branch.rowCount!==1)throw new DocumentError(
          "Branch is not active in this business","BRANCH_NOT_FOUND",404);
        let name=input.customerName,phone=input.customerPhone,email=input.customerEmail;
        if(input.customerId){
          const customer=(await tx.query<{name:string;phone:string|null;email:string|null}>(
            "SELECT name,phone,email FROM customers WHERE business_id=$1 AND id=$2 AND is_active=true",
            [input.businessId,input.customerId])).rows[0];
          if(!customer)throw new DocumentError(
            "Customer not found in this business","CUSTOMER_NOT_FOUND",404);
          name=customer.name;phone=customer.phone??"";email=customer.email??"";
        }
        const snapshot: Array<{
          itemId:string;name:string;kind:string;unit:string;quantity:number;price:number;lineTotal:number;
        }> = [];
        let subtotal=0;
        for(const line of input.lines){
          const item=(await tx.query<{name:string;kind:string;default_sale_price_minor:string|null}>(
            `SELECT ci.name,ci.kind,ciu.default_sale_price_minor::text
              FROM catalog_items ci JOIN catalog_item_units ciu
                ON ciu.item_id=ci.id AND ciu.business_id=ci.business_id
              WHERE ci.business_id=$1 AND ci.id=$2 AND ci.is_active=true
                AND ciu.unit_code=$3 AND ciu.can_sell=true FOR SHARE OF ci,ciu`,
            [input.businessId,line.itemId,line.saleUnitCode])).rows[0];
          if(!item || item.default_sale_price_minor===null)
            throw new DocumentError("A selected item/unit is unavailable or unpriced",
              "DOCUMENT_ITEM_NOT_SELLABLE",409);
          const price=safeMinor(Number(item.default_sale_price_minor));
          const lineTotal=proportionalMinor(price,line.quantity,1);
          subtotal=safeMinor(subtotal+lineTotal);
          snapshot.push({itemId:line.itemId,name:item.name,kind:item.kind,
            unit:line.saleUnitCode,quantity:line.quantity,price,lineTotal});
        }
        const year=new Date().getUTCFullYear();
        const sequence=await tx.query<{last_number:number}>(
          `INSERT INTO commercial_document_sequences(business_id,kind,year,last_number)
           VALUES ($1,$2,$3,1) ON CONFLICT(business_id,kind,year)
           DO UPDATE SET last_number=commercial_document_sequences.last_number+1
           RETURNING last_number`,[input.businessId,input.kind,year]);
        const number=`${input.kind==="QUOTATION"?"Q":"PF"}-${year}-${String(sequence.rows[0]!.last_number).padStart(6,"0")}`;
        const inserted=await tx.query<{id:string}>(
          `INSERT INTO commercial_documents(
            business_id,branch_id,customer_id,created_by_staff_id,client_request_id,
            request_fingerprint,kind,document_number,currency_code,customer_name_snapshot,
            customer_phone_snapshot,customer_email_snapshot,notes,expires_at,
            subtotal_minor,tax_minor,total_minor
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,$15)
          RETURNING id`,
          [input.businessId,input.branchId,input.customerId,access.staffId,input.requestId,
           fingerprint,input.kind,number,business.currency_code,name,phone||null,email||null,
           input.notes,input.expiresAt,subtotal]);
        const documentId=inserted.rows[0]!.id;
        for(const [index,line] of snapshot.entries()){
          await tx.query(
            `INSERT INTO commercial_document_lines(
              business_id,document_id,sort_order,item_id,item_name_snapshot,
              item_kind_snapshot,sale_unit_code,quantity,unit_net_minor,
              line_net_minor,line_tax_minor,line_total_minor
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$10)`,
            [input.businessId,documentId,index,line.itemId,line.name,line.kind,line.unit,
             line.quantity,line.price,line.lineTotal]);
        }
        await audit(tx,{businessId:input.businessId,branchId:input.branchId,
          staffId:access.staffId,eventType:"COMMERCIAL_DOCUMENT_CREATED",
          documentId,kind:input.kind,number});
        return {docId:documentId,replayed:false};
      });
      return reply.code(result.replayed?200:201).send({
        document:await loadDocument(pool,input.businessId,result.docId),
        idempotentReplay:result.replayed,
      });
    }catch(error){return sendError(request,reply,error);}
  });
  app.get<{Params:{documentId:string};Querystring:{businessId?:string}}>(
    "/v1/commercial-documents/:documentId",async(request,reply)=>{
      try {
        const businessId=id(request.query.businessId,"businessId");
        const documentId=id(request.params.documentId,"documentId");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,READ_ROLES);
        return {document:await loadDocument(pool,businessId,documentId)};
      }catch(error){return sendError(request,reply,error);}
    });
  app.get<{Params:{documentId:string};Querystring:{businessId?:string;branchId?:string;paper?:string;purpose?:string}}>(
    "/v1/commercial-documents/:documentId/pdf",async(request,reply)=>{
      try{
        const businessId=id(request.query.businessId,"businessId"),branchId=id(request.query.branchId,"branchId"),documentId=id(request.params.documentId,"documentId");
        await requireBusinessRole(pool,await authenticateAccessToken(pool,request.headers.authorization),businessId,READ_ROLES);
        const purpose=request.query.purpose;
        if(purpose!==undefined&&purpose!=="share")throw new DocumentError("Unknown PDF purpose");
        let paper:ReturnType<typeof parseReceiptPaper>;
        try{paper=parseReceiptPaper(request.query.paper??"A5");}catch{throw new DocumentError("Select A5, 80mm or 58mm paper");}
        const snapshot=await withTransaction(pool,async tx=>{
          await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          const d=await loadDocument(tx,businessId,documentId);
          if(d.branchId!==branchId)throw new DocumentError("Document not found in this branch","DOCUMENT_NOT_FOUND",404);
          if(purpose==="share"&&(d.status!=="ISSUED"||(d.expiresAt!==null&&Date.parse(d.expiresAt)<=Date.now())))
            throw new DocumentError("Only issued, unexpired documents can be prepared for customer sharing","DOCUMENT_NOT_SHAREABLE",409);
          const info=(await tx.query<{business_name:string;branch_name:string;address:string;phone:string;timezone:string}>(`SELECT b.name AS business_name,br.name AS branch_name,CONCAT_WS(', ',COALESCE(br.address_line1,b.address_line1),COALESCE(br.city,b.city)) AS address,COALESCE(br.phone,b.phone,'') AS phone,br.timezone FROM businesses b JOIN branches br ON br.business_id=b.id WHERE b.id=$1 AND br.id=$2`,[businessId,branchId])).rows[0];
          if(!info)throw new DocumentError("Branch not found","BRANCH_NOT_FOUND",404);
          return {documentId:d.id,documentNumber:d.documentNumber,kind:d.kind,status:d.status,createdAt:d.issuedAt??d.createdAt,expiresAt:d.expiresAt,customerPhone:d.customerPhone??"",customerEmail:d.customerEmail??"",notes:d.notes,businessName:info.business_name,branchName:info.branch_name,address:info.address,phone:info.phone,timezone:info.timezone,customerName:d.customerName,currencyCode:d.currencyCode,totalMinor:d.totalMinor,lines:d.lines.map(l=>({name:l.itemName,quantity:l.quantity,unitCode:l.saleUnitCode,unitNetMinor:l.unitNetMinor,lineTaxMinor:l.lineTaxMinor,lineTotalMinor:l.lineTotalMinor}))};
        });
        const pdf=await renderCommercialDocumentPdf(snapshot,paper);
        return reply.header("Content-Type","application/pdf").header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").header("Content-Disposition",'attachment; filename="TradeOS-'+snapshot.kind+'-'+documentId.slice(0,8)+'-'+paper+'.pdf"').send(pdf);
      }catch(error){return sendError(request,reply,error);}
    });
  // Draft revisions keep the original reference and creation idempotency key.
  app.patch<{Params:{documentId:string};Body:DocumentInput & {expectedUpdatedAt?:string}}>(
    "/v1/commercial-documents/:documentId",async(request,reply)=>{
      try {
        const input=validateInput(request.body);
        const documentId=id(request.params.documentId,"documentId");
        const expected=request.body.expectedUpdatedAt;
        if(typeof expected!=="string"||!Number.isFinite(Date.parse(expected)))
          throw new DocumentError("The document version is required");
        const access=await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),input.businessId,WRITE_ROLES);
        const result=await withTransaction(pool,async tx=>{
          const current=(await tx.query<DocumentRow>(
            "SELECT * FROM commercial_documents WHERE business_id=$1 AND id=$2 FOR UPDATE",
            [input.businessId,documentId])).rows[0];
          if(!current||current.branch_id!==input.branchId)
            throw new DocumentError("Document not found in this branch","DOCUMENT_NOT_FOUND",404);
          if(current.status!=="DRAFT"||current.kind!==input.kind)
            throw new DocumentError("Only drafts can be edited; document type cannot change","DOCUMENT_STATE_INVALID",409);
          if(current.updated_at.toISOString()!==new Date(expected).toISOString())
            throw new DocumentError("Document changed elsewhere. Reload it before editing.","DOCUMENT_VERSION_CONFLICT",409);
        let name=input.customerName,phone=input.customerPhone,email=input.customerEmail;
        if(input.customerId){
          const customer=(await tx.query<{name:string;phone:string|null;email:string|null}>(
            "SELECT name,phone,email FROM customers WHERE business_id=$1 AND id=$2 AND is_active=true",
            [input.businessId,input.customerId])).rows[0];
          if(!customer)throw new DocumentError(
            "Customer not found in this business","CUSTOMER_NOT_FOUND",404);
          name=customer.name;phone=customer.phone??"";email=customer.email??"";
        }
        const snapshot: Array<{
          itemId:string;name:string;kind:string;unit:string;quantity:number;price:number;lineTotal:number;
        }> = [];
        let subtotal=0;
        for(const line of input.lines){
          const item=(await tx.query<{name:string;kind:string;default_sale_price_minor:string|null}>(
            `SELECT ci.name,ci.kind,ciu.default_sale_price_minor::text
              FROM catalog_items ci JOIN catalog_item_units ciu
                ON ciu.item_id=ci.id AND ciu.business_id=ci.business_id
              WHERE ci.business_id=$1 AND ci.id=$2 AND ci.is_active=true
                AND ciu.unit_code=$3 AND ciu.can_sell=true FOR SHARE OF ci,ciu`,
            [input.businessId,line.itemId,line.saleUnitCode])).rows[0];
          if(!item || item.default_sale_price_minor===null)
            throw new DocumentError("A selected item/unit is unavailable or unpriced",
              "DOCUMENT_ITEM_NOT_SELLABLE",409);
          const price=safeMinor(Number(item.default_sale_price_minor));
          const lineTotal=proportionalMinor(price,line.quantity,1);
          subtotal=safeMinor(subtotal+lineTotal);
          snapshot.push({itemId:line.itemId,name:item.name,kind:item.kind,
            unit:line.saleUnitCode,quantity:line.quantity,price,lineTotal});
        }
          await tx.query(
            `UPDATE commercial_documents SET customer_id=$3,customer_name_snapshot=$4,
              customer_phone_snapshot=$5,customer_email_snapshot=$6,notes=$7,expires_at=$8,
              subtotal_minor=$9,tax_minor=0,total_minor=$9,
              updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
              WHERE business_id=$1 AND id=$2`,
            [input.businessId,documentId,input.customerId,name,phone||null,email||null,
             input.notes,input.expiresAt,subtotal]);
          await tx.query("DELETE FROM commercial_document_lines WHERE business_id=$1 AND document_id=$2",
            [input.businessId,documentId]);
        for(const [index,line] of snapshot.entries()){
          await tx.query(
            `INSERT INTO commercial_document_lines(
              business_id,document_id,sort_order,item_id,item_name_snapshot,
              item_kind_snapshot,sale_unit_code,quantity,unit_net_minor,
              line_net_minor,line_tax_minor,line_total_minor
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$10)`,
            [input.businessId,documentId,index,line.itemId,line.name,line.kind,line.unit,
             line.quantity,line.price,line.lineTotal]);
        }
          await audit(tx,{businessId:input.businessId,branchId:input.branchId,staffId:access.staffId,
            eventType:"COMMERCIAL_DOCUMENT_UPDATED",documentId,kind:current.kind,number:current.document_number});
          return loadDocument(tx,input.businessId,documentId);
        });
        return {document:result};
      }catch(error){return sendError(request,reply,error);}
    });
  for(const action of ["issue","cancel"] as const){
    app.post<{Params:{documentId:string};Body:{businessId?:string}}>(
      `/v1/commercial-documents/:documentId/${action}`,async(request,reply)=>{
        try {
          const businessId=id(request.body?.businessId,"businessId");
          const documentId=id(request.params.documentId,"documentId");
          const access=await requireBusinessRole(pool,
            await authenticateAccessToken(pool,request.headers.authorization),
            businessId,action==="cancel"?CONTROL_ROLES:WRITE_ROLES);
          await withTransaction(pool,async tx=>{
            const document=(await tx.query<{
              branch_id:string;status:Status;kind:Kind;document_number:string;expires_at:Date|null;
            }>(
              "SELECT branch_id,status,kind,document_number,expires_at FROM commercial_documents "+
              "WHERE business_id=$1 AND id=$2 FOR UPDATE",[businessId,documentId])).rows[0];
            if(!document)throw new DocumentError("Document not found","DOCUMENT_NOT_FOUND",404);
            const target=action==="issue"?"ISSUED":"CANCELLED";
            if(document.status===target)return;
            if(action==="issue" && document.status!=="DRAFT")
              throw new DocumentError("Only draft documents can be issued","DOCUMENT_STATE_INVALID",409);
            if(action==="issue" && document.expires_at && document.expires_at.getTime()<=Date.now())
              throw new DocumentError("Expired document cannot be issued","DOCUMENT_EXPIRED",409);
            if(action==="cancel" && document.status==="CANCELLED")return;
            await tx.query(
              `UPDATE commercial_documents SET status=$3,issued_at=
                CASE WHEN $3='ISSUED' THEN now() ELSE issued_at END,
                cancelled_at=CASE WHEN $3='CANCELLED' THEN now() ELSE cancelled_at END,
                updated_at=now() WHERE business_id=$1 AND id=$2`,
              [businessId,documentId,target]);
            await audit(tx,{businessId,branchId:document.branch_id,staffId:access.staffId,
              eventType:action==="issue"?"COMMERCIAL_DOCUMENT_ISSUED":"COMMERCIAL_DOCUMENT_CANCELLED",
              documentId,kind:document.kind,number:document.document_number});
          });
          return {document:await loadDocument(pool,businessId,documentId)};
        }catch(error){return sendError(request,reply,error);}
      });
  }
}
