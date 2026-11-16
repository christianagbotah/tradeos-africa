import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { withTransaction, type DatabasePool, type DatabaseClient } from "./db.js";
import { documentEmailConfig } from "./supplier-document-delivery-worker.js";
import { renderSupplierPurchaseOrderPdf } from "./supplier-document-pdf.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@\r\n<>]+@[^\s@\r\n<>]+\.[^\s@\r\n<>]+$/;
const ACCESS:readonly BusinessRole[]=["OWNER","ADMIN","MANAGER","ACCOUNTANT","INVENTORY"];
const AUTHORIZE:readonly BusinessRole[]=["OWNER","ADMIN","MANAGER"];
class DeliveryError extends Error {
  constructor(message:string,readonly code="DOCUMENT_DELIVERY_INVALID",
    readonly statusCode=400){super(message);}
}
function id(value:unknown,label:string){
  if(typeof value!=="string"||!UUID.test(value))
    throw new DeliveryError(`Valid ${label} required`,"DELIVERY_ID_INVALID");
  return value;
}
function email(value:unknown){
  if(typeof value!=="string"||value.length>254||
    !EMAIL.test(value.trim())||value.includes("\r")||value.includes("\n"))
    throw new DeliveryError("A valid supplier email address is required",
      "SUPPLIER_EMAIL_INVALID");
  return value.trim().toLowerCase();
}
function clean(value:string){return value.replace(/[\r\n\t]+/g," ").trim();}
type DeliveryStatus="PREPARED"|"QUEUED"|"SENDING"|"ACCEPTED"|"REVIEW_REQUIRED"|"CANCELLED";
interface PORecord {
  id:string;business_id:string;branch_id:string;supplier_id:string;
  order_number:string;status:string;currency_code:string;
  business_name_snapshot:string;branch_name_snapshot:string;
  supplier_name_snapshot:string;expected_delivery_at:Date|null;
  notes:string;total_minor:string;
  supplier_email:string|null;current_email:string|null;current_active:boolean;
}
interface POLine {
  item_name_snapshot:string;purchase_unit_label_snapshot:string;
  quantity:string;unit_cost_minor:string;line_total_minor:string;
}
interface DeliveryRow {
  id:string;business_id:string;branch_id:string;supplier_id:string;
  purchase_order_id:string;document_number:string;
  recipient_email:string;recipient_name:string;sender_email:string|null;
  subject:string;body_text:string;status:DeliveryStatus;
  recipient_confirmed:boolean;consent_confirmed:boolean;
  attempt_count:number;last_error_code:string|null;
  provider_message_id:string|null;created_at:Date;authorized_at:Date|null;
  accepted_at:Date|null;
}
const SELECT=`SELECT id,business_id,branch_id,supplier_id,purchase_order_id,
  document_number,recipient_email,recipient_name,sender_email,subject,body_text,
  status,recipient_confirmed,consent_confirmed,attempt_count,last_error_code,
  provider_message_id,created_at,authorized_at,accepted_at
  FROM supplier_document_deliveries`;
function view(row:DeliveryRow){
  return {id:row.id,businessId:row.business_id,
    branchId:row.branch_id,supplierId:row.supplier_id,
    purchaseOrderId:row.purchase_order_id,documentNumber:row.document_number,
    recipientEmail:row.recipient_email,recipientName:row.recipient_name,
    senderEmail:row.sender_email,subject:row.subject,bodyText:row.body_text,
    status:row.status,recipientConfirmed:row.recipient_confirmed,
    consentConfirmed:row.consent_confirmed,attemptCount:row.attempt_count,
    lastErrorCode:row.last_error_code,
    providerMessageId:row.provider_message_id,
    createdAt:row.created_at.toISOString(),
    authorizedAt:row.authorized_at?.toISOString()??null,
    acceptedAt:row.accepted_at?.toISOString()??null,
    deliveryConfirmed:false,
  };
}
function formatMinor(minor:number,currency:string){
  // Preserve Ghana cedi and two decimal places in the exact document snapshot.
  const formatted=new Intl.NumberFormat("en-GH",{minimumFractionDigits:2,
    maximumFractionDigits:2}).format(minor/100);
  return currency==="GHS"?`₵${formatted}`:`${currency} ${formatted}`;
}
async function loadPO(tx:DatabaseClient,businessId:string,orderId:string,locked=false){
  const row=(await tx.query<PORecord>(
    `SELECT o.id,o.business_id,o.branch_id,o.supplier_id,o.order_number,
      o.status,o.currency_code,o.business_name_snapshot,o.branch_name_snapshot,
      o.supplier_name_snapshot,o.expected_delivery_at,o.notes,o.total_minor::text,
      o.supplier_email_snapshot AS supplier_email,
      s.email AS current_email,s.is_active AS current_active
      FROM supplier_purchase_orders o
      JOIN suppliers s ON s.id=o.supplier_id AND s.business_id=o.business_id
      WHERE o.business_id=$1 AND o.id=$2
      ${locked?"FOR UPDATE OF o":""}`,[businessId,orderId])).rows[0];
  if(!row)throw new DeliveryError("Supplier purchase order unavailable",
    "DELIVERY_ORDER_NOT_FOUND",404);
  return row;
}
async function buildSnapshot(tx:DatabaseClient,po:PORecord){
  const lines=(await tx.query<POLine>(
    `SELECT item_name_snapshot,purchase_unit_label_snapshot,quantity::text,
      unit_cost_minor::text,line_total_minor::text
     FROM supplier_purchase_order_lines WHERE business_id=$1 AND order_id=$2
     ORDER BY sort_order`,[po.business_id,po.id])).rows;
  if(lines.length===0)throw new DeliveryError("Purchase order has no item lines",
    "DELIVERY_EMPTY_PO",409);
  const subject=clean(`Purchase order ${po.order_number} - ${po.business_name_snapshot}`)
    .slice(0,240);
  const data={
    number:po.order_number,businessName:po.business_name_snapshot,
    branchName:po.branch_name_snapshot,supplierName:po.supplier_name_snapshot,
    currency:po.currency_code,expectedDate:po.expected_delivery_at?.toISOString().slice(0,10)??null,
    totalMinor:Number(po.total_minor),notes:po.notes,
    lines:lines.map(l=>({name:l.item_name_snapshot,
      unit:l.purchase_unit_label_snapshot,quantity:Number(l.quantity),
      unitCostMinor:Number(l.unit_cost_minor),
      lineTotalMinor:Number(l.line_total_minor)})),
  };
  const text=[
    `PURCHASE ORDER ${data.number}`,
    `From: ${data.businessName} - ${data.branchName}`,
    `Supplier: ${data.supplierName}`,
    `Expected delivery: ${data.expectedDate?
      data.expectedDate.split("-").reverse().join("/"):"To be confirmed"}`,
    "",
    "Item | Quantity | Unit price | Line total",
    ...data.lines.map((l,i)=>`${i+1}. ${clean(l.name)} | ${l.quantity} ${clean(l.unit)} | ${formatMinor(l.unitCostMinor,data.currency)} | ${formatMinor(l.lineTotalMinor,data.currency)}`),
    "",`TOTAL: ${formatMinor(data.totalMinor,data.currency)}`,
    data.notes?`Notes: ${data.notes}`:"",
    "",
    "This is an issued purchase order, not proof of goods receipt or payment.",
    "Please confirm availability, delivery dates and any discrepancies with the issuing business.",
    "Sent through TradeOS Africa on behalf of the named merchant.",
  ].filter(x=>x!==undefined).join("\n");
  return {subject,bodyText:text,metadata:data,
    hash:createHash("sha256").update(JSON.stringify(data)).digest("hex")};
}
async function audit(tx:DatabaseClient,args:{businessId:string;branchId:string;
  staffId:string;deliveryId:string;eventType:string;orderNumber:string}){
  await tx.query(`INSERT INTO audit_events(
    business_id,branch_id,actor_staff_id,event_type,
    entity_type,entity_id,payload)
    VALUES($1,$2,$3,$4,'SUPPLIER_DOCUMENT_DELIVERY',$5,$6::jsonb)`,
    [args.businessId,args.branchId,args.staffId,args.eventType,args.deliveryId,
      JSON.stringify({documentNumber:args.orderNumber})]);
}
function errorResult(request:{log:{error:(e:unknown)=>void}},
  reply:{code:(s:number)=>{send:(x:unknown)=>unknown}},err:unknown){
  if(err instanceof DeliveryError||err instanceof AuthError)
    return reply.code(err.statusCode).send({error:err.code,message:err.message});
  if((err as {code?:string})?.code==="23505")return reply.code(409).send({
    error:"DELIVERY_CONFLICT",message:"This delivery request already exists"});
  request.log.error(err);
  return reply.code(500).send({error:"DELIVERY_FAILED",
    message:"Supplier document delivery could not be processed safely"});
}
async function getOne(pool:DatabasePool,businessId:string,deliveryId:string) {
  const row=(await pool.query<DeliveryRow>(
    SELECT+" WHERE business_id=$1 AND id=$2",[businessId,deliveryId])).rows[0];
  if(!row)throw new DeliveryError("Delivery request unavailable",
    "DELIVERY_NOT_FOUND",404);
  return view(row);
}
export function registerSupplierDocumentDeliveryRoutes(app:FastifyInstance,pool:DatabasePool){
  app.get<{Querystring:{businessId?:string}}>(
    "/v1/supplier-document-delivery/config",async(request,reply)=>{
      try{
        const businessId=id(request.query.businessId,"businessId");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,ACCESS);
        const c=documentEmailConfig();
        return {email:{ready:c.ready,issue:c.issue,senderEmail:c.senderEmail,
          senderName:c.senderName,
          acceptanceOnly:true,deliveryReceiptsAvailable:false},
          whatsapp:{ready:false,issue:"PROVIDER_NOT_CONNECTED"}};
      }catch(err){return errorResult(request,reply,err);}
    });
  app.get<{Params:{orderId:string};Querystring:{businessId?:string}}>(
    "/v1/purchase-orders/:orderId/deliveries",async(request,reply)=>{
      try{
        const businessId=id(request.query.businessId,"businessId");
        const orderId=id(request.params.orderId,"orderId");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,ACCESS);
        const po=(await pool.query<{id:string;current_email:string|null}>(
          `SELECT o.id,s.email AS current_email
           FROM supplier_purchase_orders o JOIN suppliers s
             ON s.id=o.supplier_id AND s.business_id=o.business_id
           WHERE o.business_id=$1 AND o.id=$2`,[businessId,orderId])).rows[0];
        if(!po)throw new DeliveryError("Supplier purchase order unavailable",
          "DELIVERY_ORDER_NOT_FOUND",404);
        const rows=(await pool.query<DeliveryRow>(
          SELECT+` WHERE business_id=$1 AND purchase_order_id=$2
            ORDER BY created_at DESC,id DESC LIMIT 100`,[businessId,orderId])).rows;
        return {currentSupplierEmail:po.current_email,
          deliveries:rows.map(view)};
      }catch(err){return errorResult(request,reply,err);}
    });
  // The downloadable preview uses the same persisted, tenant-scoped draft
  // snapshot that will be attached by the SMTP worker. Never query live prices.
  app.get<{Params:{deliveryId:string};Querystring:{businessId?:string}}>(
    "/v1/supplier-document-deliveries/:deliveryId/pdf", async(request,reply)=>{
      try{
        const businessId=id(request.query.businessId,"businessId");
        const deliveryId=id(request.params.deliveryId,"deliveryId");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,ACCESS);
        const record=(await pool.query<{
          document_number:string;payload_snapshot:unknown
        }>("SELECT document_number,payload_snapshot FROM supplier_document_deliveries WHERE business_id=$1 AND id=$2",
          [businessId,deliveryId])).rows[0];
        if(!record)throw new DeliveryError("Delivery request unavailable",
          "DELIVERY_NOT_FOUND",404);
        const pdf=await renderSupplierPurchaseOrderPdf(record.payload_snapshot);
        const filename="PO-"+record.document_number.replace(/[^A-Za-z0-9._-]/g,"-")
          .slice(0,80)+".pdf";
        return reply.header("Content-Type","application/pdf")
          .header("Content-Disposition",'attachment; filename="'+filename+'"')
          .header("Cache-Control","private, no-store")
          .header("X-Content-Type-Options","nosniff")
          .send(pdf);
      }catch(err){return errorResult(request,reply,err);}
    });
  app.post<{Params:{orderId:string};Body:{
    businessId?:string;clientRequestId?:string;recipientEmail?:string
  }}>(
    "/v1/purchase-orders/:orderId/deliveries",async(request,reply)=>{
      try{
        const businessId=id(request.body?.businessId,"businessId");
        const orderId=id(request.params.orderId,"orderId");
        const requestId=id(request.body?.clientRequestId,"clientRequestId");
        const destination=email(request.body?.recipientEmail);
        const access=await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,ACCESS);
        if(!access.staffId)throw new DeliveryError("Active staff actor required",
          "DELIVERY_STAFF_REQUIRED",403);
        const staffId=access.staffId;
        const fingerprint=createHash("sha256").update(
          JSON.stringify({businessId,orderId,destination})).digest("hex");
        const result=await withTransaction(pool,async tx=>{
          const po=await loadPO(tx,businessId,orderId,true);
          const existing=(await tx.query<{id:string;request_fingerprint:string}>(
            `SELECT id,request_fingerprint FROM supplier_document_deliveries
             WHERE business_id=$1 AND client_request_id=$2`,
            [businessId,requestId])).rows[0];
          if(existing){
            if(existing.request_fingerprint!==fingerprint)
              throw new DeliveryError("Request ID reused for different content",
                "DELIVERY_REQUEST_CONFLICT",409);
            return {id:existing.id,replayed:true};
          }
          if(po.status!=="ISSUED")
            throw new DeliveryError("Only issued purchase orders can be prepared for email",
              "DELIVERY_PO_NOT_ISSUED",409);
          if(!po.current_active||!po.current_email||
            email(po.current_email)!==destination)
            throw new DeliveryError(
              "Recipient must exactly match the active supplier's saved email address",
              "DELIVERY_SUPPLIER_EMAIL_MISMATCH",409);
          const latest=(await tx.query<{count:string}>(
            `SELECT COUNT(*)::text AS count FROM supplier_document_deliveries
             WHERE business_id=$1 AND purchase_order_id=$2
               AND created_at>now()-interval '1 day'`,
            [businessId,orderId])).rows[0];
          if(Number(latest?.count??0)>=10)
            throw new DeliveryError("Daily document delivery limit reached for this order",
              "DELIVERY_RATE_LIMIT",429);
          const snapshot=await buildSnapshot(tx,po);
          const draft=(await tx.query<{id:string}>(
            `INSERT INTO supplier_document_deliveries(
              business_id,branch_id,supplier_id,purchase_order_id,
              created_by_staff_id,client_request_id,request_fingerprint,
              recipient_email,recipient_name,document_number,
              subject,body_text,payload_snapshot,content_sha256)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING id`,
            [businessId,po.branch_id,po.supplier_id,orderId,staffId,requestId,
              fingerprint,destination,po.supplier_name_snapshot,po.order_number,
              snapshot.subject,snapshot.bodyText,JSON.stringify(snapshot.metadata),
              snapshot.hash])).rows[0]!;
          await audit(tx,{businessId,branchId:po.branch_id,staffId,
            deliveryId:draft.id,eventType:"SUPPLIER_DOCUMENT_PREPARED",
            orderNumber:po.order_number});
          return {id:draft.id,replayed:false};
        });
        return reply.code(result.replayed?200:201).send({
          delivery:await getOne(pool,businessId,result.id),
          idempotentReplay:result.replayed});
      }catch(err){return errorResult(request,reply,err);}
    });
  for(const action of ["authorize","retry","cancel"] as const){
    app.post<{Params:{deliveryId:string};Body:{
      businessId?:string;recipientEmail?:string;recipientConfirmed?:boolean;
      consentConfirmed?:boolean;confirmedNoDelivery?:boolean
    }}>(
      `/v1/supplier-document-deliveries/:deliveryId/${action}`,
      async(request,reply)=>{
        try{
          const businessId=id(request.body?.businessId,"businessId");
          const deliveryId=id(request.params.deliveryId,"deliveryId");
          const access=await requireBusinessRole(pool,
            await authenticateAccessToken(pool,request.headers.authorization),
            businessId,AUTHORIZE);
          if(!access.staffId)throw new DeliveryError("Active manager staff actor required",
            "DELIVERY_STAFF_REQUIRED",403);
          const staffId=access.staffId;
          if(action!=="cancel"&&!documentEmailConfig().ready)
            throw new DeliveryError("Email sender is not verified and enabled",
              "DELIVERY_SENDER_NOT_READY",503);
          if(action==="authorize"&&(request.body?.recipientConfirmed!==true||
            request.body?.consentConfirmed!==true))
            throw new DeliveryError("Confirm supplier recipient and consent before sending",
              "DELIVERY_CONFIRMATION_REQUIRED",409);
          if(action==="retry"&&request.body?.confirmedNoDelivery!==true)
            throw new DeliveryError(
              "Confirm with the supplier that the previous email was not received before retrying",
              "DELIVERY_RETRY_REVIEW_REQUIRED",409);
          const result=await withTransaction(pool,async tx=>{
            const row=(await tx.query<DeliveryRow>(
              SELECT+" WHERE business_id=$1 AND id=$2 FOR UPDATE",
              [businessId,deliveryId])).rows[0];
            if(!row)throw new DeliveryError("Delivery request unavailable",
              "DELIVERY_NOT_FOUND",404);
            const po=await loadPO(tx,businessId,row.purchase_order_id);
            if(action==="cancel"){
              if(row.status==="CANCELLED")return row.id;
              if(row.status!=="PREPARED"&&row.status!=="QUEUED")
                throw new DeliveryError("An email already handed to the sender cannot be cancelled",
                  "DELIVERY_STATE_CONFLICT",409);
              await tx.query(`UPDATE supplier_document_deliveries SET status='CANCELLED',
                next_attempt_at=NULL,authorized_at=NULL,updated_at=now()
                WHERE business_id=$1 AND id=$2`,[businessId,deliveryId]);
            }else{
              if(po.status!=="ISSUED")
                throw new DeliveryError("Only issued orders can be emailed",
                  "DELIVERY_PO_NOT_ISSUED",409);
              if(!po.current_active||!po.current_email||
                email(po.current_email)!==row.recipient_email)
                throw new DeliveryError("Supplier email changed. Prepare a new delivery draft",
                  "DELIVERY_SUPPLIER_EMAIL_CHANGED",409);
              if(action==="authorize"){
                if(row.status==="QUEUED"||row.status==="ACCEPTED")return row.id;
                if(row.status!=="PREPARED")
                  throw new DeliveryError("Only prepared email drafts may be authorized",
                    "DELIVERY_STATE_CONFLICT",409);
                if(email(request.body?.recipientEmail)!==row.recipient_email)
                  throw new DeliveryError("Supplier recipient confirmation does not match",
                    "DELIVERY_CONFIRMATION_MISMATCH",409);
              }else{
                if(row.status!=="REVIEW_REQUIRED"||row.attempt_count>=3)
                  throw new DeliveryError(
                    "Only uncertain deliveries with fewer than three attempts can be retried",
                    "DELIVERY_RETRY_NOT_ALLOWED",409);
              }
              const config=documentEmailConfig();
              await tx.query(`UPDATE supplier_document_deliveries SET
                status='QUEUED',sender_email=$3,recipient_confirmed=true,
                consent_confirmed=true,authorized_by_staff_id=$4,
                authorized_at=now(),next_attempt_at=now(),
                last_error_code=NULL,updated_at=now()
                WHERE business_id=$1 AND id=$2`,
                [businessId,deliveryId,config.senderEmail,staffId]);
            }
            await audit(tx,{businessId,branchId:row.branch_id,staffId,
              deliveryId,eventType:action==="cancel"?
                "SUPPLIER_DOCUMENT_DELIVERY_CANCELLED":action==="retry"?
                "SUPPLIER_DOCUMENT_RETRY_AUTHORIZED":"SUPPLIER_DOCUMENT_SEND_AUTHORIZED",
              orderNumber:row.document_number});
            return row.id;
          });
          return {delivery:await getOne(pool,businessId,result)};
        }catch(err){return errorResult(request,reply,err);}
      });
  }
}
