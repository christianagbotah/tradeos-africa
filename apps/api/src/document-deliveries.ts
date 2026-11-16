import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import type {FastifyInstance} from "fastify";
import {authenticateAccessToken,AuthError} from "./auth/security.js";
import {requireBusinessRole,type BusinessRole} from "./auth/authorization.js";
import {withTransaction,type DatabasePool,type DatabaseClient} from "./db.js";

type Kind="PURCHASE_ORDER"|"COMMERCIAL_DOCUMENT";
type Status="QUEUED"|"SENDING"|"ACCEPTED"|"FAILED"|"REVIEW_REQUIRED";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL=/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const VIEW_ROLES:readonly BusinessRole[]=[
  "OWNER","ADMIN","MANAGER","ACCOUNTANT","INVENTORY","SALES","CASHIER",
];
const SEND_ROLES:readonly BusinessRole[]=["OWNER","ADMIN","MANAGER"];

interface DeliveryRow {
  id:string;business_id:string;branch_id:string;document_kind:Kind;
  document_id:string;document_number:string;document_currency_code:string;
  document_total_minor:string;channel:"EMAIL";recipient_name:string;
  recipient_email:string;recipient_override_reason:string|null;
  sender_email:string|null;status:Status;attempt_count:number;
  last_error_code:string|null;accepted_at:Date|null;created_at:Date;
}
interface DocumentSnapshot {
  businessId:string;branchId:string;id:string;kind:Kind;number:string;
  status:string;businessName:string;recipientName:string;
  contactEmail:string|null;currency:string;totalMinor:number;
  lines:Array<{name:string;quantity:number;unit:string;totalMinor:number}>;
}
export interface TransactionalEmail {
  from:string;to:string;subject:string;body:string;
}
class DeliveryError extends Error {
  constructor(message:string,readonly code="DELIVERY_INVALID",
    readonly statusCode=400){super(message);}
}
function uuid(value:unknown,name:string):string {
  if(typeof value!=="string"||!UUID.test(value))
    throw new DeliveryError("A valid "+name+" is required","DELIVERY_ID_INVALID");
  return value;
}
function email(value:unknown):string {
  if(typeof value!=="string"||value.length>254||!EMAIL.test(value.trim()))
    throw new DeliveryError("Enter a valid recipient email address",
      "DELIVERY_EMAIL_INVALID");
  return value.trim().toLowerCase();
}
function clean(value:unknown,max:number,name:string):string {
  if(typeof value!=="string"||value.trim().length>max)
    throw new DeliveryError(name+" must be valid text","DELIVERY_TEXT_INVALID");
  return value.trim();
}
function safeInline(value:string):string {
  return value.replace(/[\r\n\t\u0000-\u001f]+/g," ").slice(0,180);
}
export function documentMailSettings(env:NodeJS.ProcessEnv=process.env) {
  const from=env.TRADEOS_DOCUMENT_EMAIL_FROM?.trim()??"";
  const sendmailPath=env.TRADEOS_SENDMAIL_PATH?.trim()||"/usr/sbin/sendmail";
  if(env.TRADEOS_DOCUMENT_EMAIL_ENABLED!=="true"||
    env.TRADEOS_DOCUMENT_EMAIL_VERIFIED!=="true"||
    !EMAIL.test(from)||!/^\/[A-Za-z0-9_./-]+$/.test(sendmailPath))
    return null;
  return {from,sendmailPath};
}
export async function sendDocumentEmail(
  message:TransactionalEmail,sendmailPath:string):Promise<void> {
  if(!EMAIL.test(message.from)||!EMAIL.test(message.to)||
    !/^\/[A-Za-z0-9_./-]+$/.test(sendmailPath))
    throw new DeliveryError("Email provider is not ready",
      "DELIVERY_PROVIDER_UNAVAILABLE",409);
  const source=[
    "From: TradeOS Africa <"+message.from+">",
    "To: <"+message.to+">",
    "Subject: "+safeInline(message.subject),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Auto-Submitted: auto-generated",
    "",
    message.body,
  ].join("\r\n");
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(sendmailPath,["-i","-t","-f",message.from],{
      shell:false,stdio:["pipe","ignore","ignore"],env:{PATH:"/usr/bin:/bin"},
    });
    let settled=false;
    const timeout=setTimeout(()=>{
      child.kill();
      done(new Error("Document email transport timed out"));
    },10_000);
    function done(error?:Error){
      if(settled)return;
      settled=true;clearTimeout(timeout);
      if(error)reject(error);else resolve();
    }
    child.once("error",err=>done(err));
    child.once("close",code=>done(
      code===0?undefined:new Error("Document email transport did not accept message")));
    child.stdin.on("error",err=>done(err));
    child.stdin.end(source);
  });
}

async function documentSnapshot(db:Pick<DatabasePool,"query">|Pick<DatabaseClient,"query">,
  businessId:string,kind:Kind,documentId:string):Promise<DocumentSnapshot>{
  if(kind==="PURCHASE_ORDER"){
    const order=(await db.query<{
      id:string;branch_id:string;order_number:string;status:string;
      business_name_snapshot:string;supplier_name_snapshot:string;
      supplier_email_snapshot:string|null;currency_code:string;total_minor:string
    }>(`SELECT id,branch_id,order_number,status,business_name_snapshot,
        supplier_name_snapshot,supplier_email_snapshot,currency_code,total_minor::text
        FROM supplier_purchase_orders WHERE business_id=$1 AND id=$2`,
      [businessId,documentId])).rows[0];
    if(!order)throw new DeliveryError("Document not found in this business",
      "DELIVERY_DOCUMENT_NOT_FOUND",404);
    const lines=(await db.query<{item_name_snapshot:string;quantity:string;
      purchase_unit_code:string;line_total_minor:string}>(`
      SELECT item_name_snapshot,quantity::text,purchase_unit_code,line_total_minor::text
      FROM supplier_purchase_order_lines
      WHERE business_id=$1 AND order_id=$2 ORDER BY sort_order`,
      [businessId,documentId])).rows;
    return {
      businessId,branchId:order.branch_id,id:order.id,kind,
      number:order.order_number,status:order.status,
      businessName:order.business_name_snapshot,
      recipientName:order.supplier_name_snapshot,
      contactEmail:order.supplier_email_snapshot,
      currency:order.currency_code,totalMinor:Number(order.total_minor),
      lines:lines.map(l=>({name:l.item_name_snapshot,quantity:Number(l.quantity),
        unit:l.purchase_unit_code,totalMinor:Number(l.line_total_minor)})),
    };
  }
  const doc=(await db.query<{
    id:string;branch_id:string;document_number:string;kind:string;status:string;
    customer_name_snapshot:string;customer_email_snapshot:string|null;
    currency_code:string;total_minor:string;business_name:string
  }>(`SELECT d.id,d.branch_id,d.document_number,d.kind,d.status,
      d.customer_name_snapshot,d.customer_email_snapshot,
      d.currency_code,d.total_minor::text,b.name AS business_name
      FROM commercial_documents d JOIN businesses b ON b.id=d.business_id
      WHERE d.business_id=$1 AND d.id=$2`,
    [businessId,documentId])).rows[0];
  if(!doc)throw new DeliveryError("Document not found in this business",
    "DELIVERY_DOCUMENT_NOT_FOUND",404);
  const lines=(await db.query<{item_name_snapshot:string;quantity:string;
    sale_unit_code:string;line_total_minor:string}>(`
    SELECT item_name_snapshot,quantity::text,sale_unit_code,line_total_minor::text
    FROM commercial_document_lines
    WHERE business_id=$1 AND document_id=$2 ORDER BY sort_order`,
    [businessId,documentId])).rows;
  return {
    businessId,branchId:doc.branch_id,id:doc.id,kind,
    number:doc.document_number,status:doc.status,
    businessName:doc.business_name,recipientName:doc.customer_name_snapshot,
    contactEmail:doc.customer_email_snapshot,
    currency:doc.currency_code,totalMinor:Number(doc.total_minor),
    lines:lines.map(l=>({name:l.item_name_snapshot,quantity:Number(l.quantity),
      unit:l.sale_unit_code,totalMinor:Number(l.line_total_minor)})),
  };
}
function validateIssued(snapshot:DocumentSnapshot){
  if(snapshot.status!=="ISSUED"||snapshot.lines.length===0)
    throw new DeliveryError(
      "Only issued documents with item lines can be prepared or emailed",
      "DELIVERY_DOCUMENT_NOT_ISSUED",409);
}
function formatCedis(minor:number,currency:string){
  const symbol=currency==="GHS"?"₵":currency+" ";
  return symbol+new Intl.NumberFormat("en-GH",{
    minimumFractionDigits:2,maximumFractionDigits:2,
  }).format(minor/100);
}
function emailMessage(doc:DocumentSnapshot,to:string,from:string):TransactionalEmail{
  const category=doc.kind==="PURCHASE_ORDER"?"purchase order":"quotation / proforma";
  const path=doc.kind==="PURCHASE_ORDER"?"purchase-orders":"documents";
  const authenticatedUrl="https://tradeosafrica.lightworldtech.com/"+
    path+"/"+encodeURIComponent(doc.id);
  const lines=doc.lines.slice(0,50).map((line,index)=>
    String(index+1)+". "+safeInline(line.name)+" — "+
    line.quantity.toLocaleString("en-GH",{maximumFractionDigits:8})+
    " "+safeInline(line.unit)+" — "+formatCedis(line.totalMinor,doc.currency));
  const body=[
    "TradeOS Africa — "+safeInline(doc.businessName),
    "",
    "Document: "+safeInline(doc.number),
    "Type: "+category,
    "For: "+safeInline(doc.recipientName),
    "",
    ...lines,
    "",
    "Document total: "+formatCedis(doc.totalMinor,doc.currency),
    "",
    "Sign in to TradeOS Africa to view and print the verified document:",
    authenticatedUrl,
    "",
    "This email is a notification and itemized summary, not an attached PDF.",
    "An issued purchase order is not proof of delivery or payment.",
    "A quotation or proforma is not proof of payment or a tax invoice.",
    "Please contact the merchant directly to discuss this document.",
  ].join("\r\n");
  return {to,from,subject:"TradeOS "+safeInline(doc.number)+" — "+category,body};
}
function asDelivery(row:DeliveryRow){
  return {id:row.id,businessId:row.business_id,branchId:row.branch_id,
    documentKind:row.document_kind,documentId:row.document_id,
    documentNumber:row.document_number,currencyCode:row.document_currency_code,
    totalMinor:Number(row.document_total_minor),channel:row.channel,
    recipientName:row.recipient_name,recipientEmail:row.recipient_email,
    recipientOverrideReason:row.recipient_override_reason,
    senderEmail:row.sender_email,status:row.status,
    attemptCount:row.attempt_count,lastErrorCode:row.last_error_code,
    acceptedAt:row.accepted_at?.toISOString()??null,
    createdAt:row.created_at.toISOString()};
}
const DELIVERY_SELECT=`SELECT id,business_id,branch_id,document_kind,document_id,
  document_number,document_currency_code,document_total_minor::text,
  channel,recipient_name,recipient_email,recipient_override_reason,
  sender_email,status,attempt_count,last_error_code,accepted_at,created_at
  FROM document_deliveries`;
async function audit(tx:DatabaseClient,row:{
  businessId:string;branchId:string;deliveryId:string;staffId:string|null;
  action:string;documentNumber:string;
},extra:Record<string,unknown>={}){
  await tx.query(`INSERT INTO audit_events(business_id,branch_id,actor_staff_id,
      event_type,entity_type,entity_id,payload)
      VALUES($1,$2,$3,$4,'DOCUMENT_DELIVERY',$5,$6::jsonb)`,[
    row.businessId,row.branchId,row.staffId,row.action,row.deliveryId,
    JSON.stringify({documentNumber:row.documentNumber,...extra}),
  ]);
}
function errorResponse(request:{log:{error:(e:unknown)=>void}},
  reply:{code:(status:number)=>{send:(payload:unknown)=>unknown}},
  error:unknown){
  if(error instanceof DeliveryError||error instanceof AuthError)
    return reply.code(error.statusCode).send({error:error.code,message:error.message});
  request.log.error(error);
  return reply.code(500).send({error:"DOCUMENT_DELIVERY_FAILED",
    message:"Document delivery could not be completed safely."});
}

interface DeliveryPrepareBody {
  businessId?:string;documentKind?:Kind;documentId?:string;
  clientRequestId?:string;channel?:string;recipientEmail?:string;
  recipientConfirmed?:boolean;recipientOverrideReason?:string;
}
export function registerDocumentDeliveryRoutes(app:FastifyInstance,
  pool:DatabasePool,options?:{
    env?:NodeJS.ProcessEnv;send?: (message:TransactionalEmail)=>Promise<void>
  }):void {
  const env=options?.env??process.env;
  app.get<{Querystring:{businessId?:string}}>(
    "/v1/document-deliveries/readiness",async(request,reply)=>{
      try{
        const businessId=uuid(request.query.businessId,"business ID");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,VIEW_ROLES);
        return {emailEnabled:documentMailSettings(env)!==null,
          whatsappEnabled:false,
          note:"Email accepted by the mail transfer agent is not verified inbox delivery."};
      }catch(error){return errorResponse(request,reply,error);}
    });

  app.get<{Querystring:{businessId?:string;documentKind?:string;
    documentId?:string}}>(
    "/v1/document-deliveries",async(request,reply)=>{
      try{
        const businessId=uuid(request.query.businessId,"business ID");
        await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,VIEW_ROLES);
        const kind=request.query.documentKind;
        if(kind!=="PURCHASE_ORDER"&&kind!=="COMMERCIAL_DOCUMENT")
          throw new DeliveryError("Unknown delivery document type");
        const documentId=uuid(request.query.documentId,"document ID");
        // The business filter is mandatory; no unscoped or cross-tenant history.
        const found=await pool.query<DeliveryRow>(DELIVERY_SELECT+
          " WHERE business_id=$1 AND document_kind=$2 AND document_id=$3"+
          " ORDER BY created_at DESC,id DESC LIMIT 50",
          [businessId,kind,documentId]);
        return {deliveries:found.rows.map(asDelivery)};
      }catch(error){return errorResponse(request,reply,error);}
    });

  app.post<{Body:DeliveryPrepareBody}>(
    "/v1/document-deliveries",async(request,reply)=>{
      try{
        const input=request.body;
        const businessId=uuid(input?.businessId,"business ID");
        const documentId=uuid(input?.documentId,"document ID");
        const requestId=uuid(input?.clientRequestId,"client request ID");
        const kind=input?.documentKind;
        if(kind!=="PURCHASE_ORDER"&&kind!=="COMMERCIAL_DOCUMENT")
          throw new DeliveryError("Choose a supported document");
        if(input?.channel!=="EMAIL")
          throw new DeliveryError(
            "WhatsApp delivery is not configured; no message has been sent",
            "DELIVERY_CHANNEL_UNAVAILABLE",409);
        if(input?.recipientConfirmed!==true)
          throw new DeliveryError("Confirm the exact email recipient before preparing",
            "DELIVERY_RECIPIENT_NOT_CONFIRMED");
        const to=email(input.recipientEmail);
        const reason=input?.recipientOverrideReason===undefined?"":clean(
          input.recipientOverrideReason,500,"Recipient override reason");
        const actor=await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,SEND_ROLES);
        if(!actor.staffId)throw new DeliveryError("Active staff is required",
          "DELIVERY_STAFF_REQUIRED",403);
        const fingerprint=createHash("sha256").update(JSON.stringify({
          kind,documentId,to,reason,recipientConfirmed:true,
        })).digest("hex");
        const result=await withTransaction(pool,async tx=>{
          // Serialize both repeated idempotency keys and document state checks.
          await tx.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE",
            [businessId]);
          const prior=(await tx.query<{id:string;request_fingerprint:string}>(
            "SELECT id,request_fingerprint FROM document_deliveries"+
            " WHERE business_id=$1 AND client_request_id=$2",
            [businessId,requestId])).rows[0];
          if(prior){
            if(prior.request_fingerprint!==fingerprint)
              throw new DeliveryError("Request ID reused with different content",
                "DELIVERY_REQUEST_CONFLICT",409);
            return {id:prior.id,replay:true};
          }
          const rate=(await tx.query<{total:string}>(
            `SELECT COUNT(*)::text AS total FROM document_deliveries
             WHERE business_id=$1 AND created_at>now()-interval '1 hour'`,
            [businessId])).rows[0];
          if(Number(rate?.total??0)>=20)
            throw new DeliveryError(
              "Hourly document delivery preparation limit reached",
              "DELIVERY_RATE_LIMIT",429);
          const snapshot=await documentSnapshot(tx,businessId,kind,documentId);
          validateIssued(snapshot);
          const known=snapshot.contactEmail?.trim().toLowerCase()??"";
          const override=known!==to;
          if(override&&reason.length<12)
            throw new DeliveryError(
              "A recipient different from the saved contact requires a 12-character explanation",
              "DELIVERY_RECIPIENT_OVERRIDE_REASON",409);
          // Consent is explicit user confirmation. This is transactional
          // email only; no inferred marketing/WhatsApp opt-in.
          const created=(await tx.query<{id:string}>(`
            INSERT INTO document_deliveries(
              business_id,branch_id,document_kind,document_id,
              document_number,document_currency_code,document_total_minor,
              client_request_id,request_fingerprint,recipient_name,
              recipient_email,recipient_override_reason,recipient_confirmed,
              created_by_staff_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13)
            RETURNING id`,[
            businessId,snapshot.branchId,kind,documentId,snapshot.number,
            snapshot.currency,snapshot.totalMinor,requestId,fingerprint,
            snapshot.recipientName,to,override?reason:null,actor.staffId,
          ])).rows[0]!;
          await audit(tx,{businessId,branchId:snapshot.branchId,
            deliveryId:created.id,staffId:actor.staffId,
            action:"DOCUMENT_DELIVERY_PREPARED",
            documentNumber:snapshot.number},{channel:"EMAIL",override});
          return {id:created.id,replay:false};
        });
        const row=(await pool.query<DeliveryRow>(DELIVERY_SELECT+
          " WHERE business_id=$1 AND id=$2",[businessId,result.id])).rows[0]!;
        return reply.code(result.replay?200:201).send({
          delivery:asDelivery(row),idempotentReplay:result.replay,
        });
      }catch(error){return errorResponse(request,reply,error);}
    });

  app.post<{Params:{deliveryId:string};Body:{businessId?:string}}>(
    "/v1/document-deliveries/:deliveryId/send",async(request,reply)=>{
      try{
        const businessId=uuid(request.body?.businessId,"business ID");
        const deliveryId=uuid(request.params.deliveryId,"delivery ID");
        const access=await requireBusinessRole(pool,
          await authenticateAccessToken(pool,request.headers.authorization),
          businessId,SEND_ROLES);
        if(!access.staffId)throw new DeliveryError("Active staff is required",
          "DELIVERY_STAFF_REQUIRED",403);
        const staffId=access.staffId;
        const settings=documentMailSettings(env);
        if(!settings)throw new DeliveryError(
          "Document email is not enabled with a verified sender. No email was sent.",
          "DELIVERY_EMAIL_NOT_READY",409);
        const claimed=await withTransaction(pool,async tx=>{
          // Serialize per-business send-rate checks, including concurrent
          // deliveries to different recipients/documents.
          await tx.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE",
            [businessId]);
          const row=(await tx.query<DeliveryRow>(DELIVERY_SELECT+
            " WHERE business_id=$1 AND id=$2 FOR UPDATE",
            [businessId,deliveryId])).rows[0];
          if(!row)throw new DeliveryError("Delivery not found",
            "DELIVERY_NOT_FOUND",404);
          if(row.status==="ACCEPTED")return {replay:true,row,message:null};
          if(row.status==="SENDING"||row.status==="REVIEW_REQUIRED")
            throw new DeliveryError(
              "This message may already have reached the provider; review delivery manually before retrying",
              "DELIVERY_MANUAL_REVIEW_REQUIRED",409);
          if(row.attempt_count>=5)
            throw new DeliveryError("Delivery reached the attempt limit",
              "DELIVERY_ATTEMPT_LIMIT",409);
          const recent=(await tx.query<{total:string}>(
            `SELECT COUNT(*)::text AS total FROM document_delivery_attempts
             WHERE business_id=$1 AND started_at>now()-interval '1 hour'`,
            [businessId])).rows[0];
          if(Number(recent?.total??0)>=20)
            throw new DeliveryError(
              "Hourly document email limit reached; retry later",
              "DELIVERY_RATE_LIMIT",429);
          const snapshot=await documentSnapshot(
            tx,businessId,row.document_kind,row.document_id);
          validateIssued(snapshot);
          if(snapshot.branchId!==row.branch_id||
            snapshot.number!==row.document_number||
            snapshot.totalMinor!==Number(row.document_total_minor))
            throw new DeliveryError(
              "Document changed since this delivery was prepared; review before sending",
              "DELIVERY_DOCUMENT_CHANGED",409);
          const message=emailMessage(snapshot,row.recipient_email,settings.from);
          const attemptNumber=row.attempt_count+1;
          await tx.query(`UPDATE document_deliveries
            SET status='SENDING',attempt_count=$3,last_error_code=NULL,
            sender_email=$4,updated_at=now()
            WHERE business_id=$1 AND id=$2`,
            [businessId,deliveryId,attemptNumber,settings.from]);
          await tx.query(`INSERT INTO document_delivery_attempts(
            business_id,delivery_id,attempt_number,status)
            VALUES($1,$2,$3,'STARTED')`,
            [businessId,deliveryId,attemptNumber]);
          await audit(tx,{businessId,branchId:row.branch_id,
            deliveryId,staffId,documentNumber:row.document_number,
            action:"DOCUMENT_DELIVERY_SEND_STARTED"},
            {channel:"EMAIL",attemptNumber});
          return {replay:false,row,message,attemptNumber};
        });
        if(claimed.replay)return {delivery:asDelivery(claimed.row),idempotentReplay:true};
        // The SENDING state is committed BEFORE calling the external MTA.
        // An interruption or uncertain response MUST NOT automatically resend.
        try{
          if(options?.send)await options.send(claimed.message!);
          else await sendDocumentEmail(claimed.message!,settings.sendmailPath);
        }catch{
          const reviewed=await withTransaction(pool,async tx=>{
            await tx.query(`UPDATE document_deliveries
              SET status='REVIEW_REQUIRED',last_error_code='MTA_UNCERTAIN',
                updated_at=now()
              WHERE business_id=$1 AND id=$2 AND status='SENDING'`,
              [businessId,deliveryId]);
            await tx.query(`UPDATE document_delivery_attempts
              SET status='REVIEW_REQUIRED',error_code='MTA_UNCERTAIN',
                finished_at=now()
              WHERE business_id=$1 AND delivery_id=$2 AND attempt_number=$3`,
              [businessId,deliveryId,claimed.attemptNumber]);
            await audit(tx,{businessId,branchId:claimed.row.branch_id,
              deliveryId,staffId,documentNumber:claimed.row.document_number,
              action:"DOCUMENT_DELIVERY_REVIEW_REQUIRED"},
              {channel:"EMAIL",reason:"MTA_UNCERTAIN"});
            return (await tx.query<DeliveryRow>(DELIVERY_SELECT+
              " WHERE business_id=$1 AND id=$2",
              [businessId,deliveryId])).rows[0]!;
          });
          return reply.code(502).send({
            error:"DELIVERY_PROVIDER_UNCERTAIN",
            message:"The mail transport did not confirm acceptance. Review required; automatic retry is blocked.",
            delivery:asDelivery(reviewed),
          });
        }
        // Local mail queue acceptance != recipient delivery. Never claim
        // inbox delivery, do not auto-mark DELIVERED without signed evidence.
        const accepted=await withTransaction(pool,async tx=>{
          await tx.query(`UPDATE document_deliveries SET
            status='ACCEPTED',last_error_code=NULL,accepted_at=now(),updated_at=now()
            WHERE business_id=$1 AND id=$2 AND status='SENDING'`,
            [businessId,deliveryId]);
          await tx.query(`UPDATE document_delivery_attempts SET
            status='ACCEPTED',finished_at=now()
            WHERE business_id=$1 AND delivery_id=$2 AND attempt_number=$3`,
            [businessId,deliveryId,claimed.attemptNumber]);
          await audit(tx,{businessId,branchId:claimed.row.branch_id,
            deliveryId,staffId,documentNumber:claimed.row.document_number,
            action:"DOCUMENT_DELIVERY_ACCEPTED_BY_MTA"},
            {channel:"EMAIL",attemptNumber:claimed.attemptNumber});
          return (await tx.query<DeliveryRow>(DELIVERY_SELECT+
            " WHERE business_id=$1 AND id=$2",
            [businessId,deliveryId])).rows[0]!;
        });
        return {delivery:asDelivery(accepted),idempotentReplay:false,
          notice:"Email was accepted by the mail transport. Inbox delivery is not confirmed."};
      }catch(error){return errorResponse(request,reply,error);}
    });
}
