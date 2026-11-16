import nodemailer from "nodemailer";
import { renderSupplierPurchaseOrderPdf } from "./supplier-document-pdf.js";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import type { DatabasePool, DatabaseClient } from "./db.js";
import { withTransaction } from "./db.js";

export interface DocumentEmailConfig {
  enabled: boolean;
  ready: boolean;
  senderEmail: string | null;
  senderName: string;
  issue: "DISABLED"|"NOT_VERIFIED"|"NOT_CONFIGURED"|null;
}
const EMAIL=/^[^\s@\r\n<>]+@[^\s@\r\n<>]+\.[^\s@\r\n<>]+$/;
export function documentEmailConfig():DocumentEmailConfig {
  const enabled=process.env.TRADEOS_DOC_DELIVERY_ENABLED==="true";
  const verified=process.env.TRADEOS_DOC_SMTP_VERIFIED==="true";
  const sender=process.env.TRADEOS_DOC_SMTP_FROM?.trim()??"";
  const host=process.env.TRADEOS_DOC_SMTP_HOST?.trim()??"";
  const port=Number(process.env.TRADEOS_DOC_SMTP_PORT??"587");
  const user=process.env.TRADEOS_DOC_SMTP_USER??"";
  const pass=process.env.TRADEOS_DOC_SMTP_PASS??"";
  const ready=enabled&&verified&&EMAIL.test(sender)&&
    Boolean(host&&user&&pass)&&Number.isInteger(port)&&port>=1&&port<=65535;
  const senderName=process.env.TRADEOS_DOC_SMTP_FROM_NAME?.trim().slice(0,120)||
    "TradeOS Africa";
  return {enabled,ready,senderEmail:EMAIL.test(sender)?sender:null,senderName,
    issue:!enabled?"DISABLED":!verified?"NOT_VERIFIED":!ready?"NOT_CONFIGURED":null};
}
export interface DeliveryJob {
  id:string;business_id:string;branch_id:string;
  purchase_order_id:string;recipient_email:string;recipient_name:string;
  sender_email:string;subject:string;body_text:string;
  attempt_count:number;document_number:string;payload_snapshot:unknown;
}
export interface SendResult {
  messageId:string;accepted:boolean;
}
export type DocumentEmailSender=(job:DeliveryJob)=>Promise<SendResult>;
export async function smtpSendSupplierDocument(job:DeliveryJob):Promise<SendResult>{
  const config=documentEmailConfig();
  if(!config.ready||!config.senderEmail||job.sender_email!==config.senderEmail)
    throw new Error("DOC_SMTP_NOT_READY");
  const port=Number(process.env.TRADEOS_DOC_SMTP_PORT??"587");
  const transporter=nodemailer.createTransport({
    host:process.env.TRADEOS_DOC_SMTP_HOST!,
    port,secure:port===465,
    requireTLS:port!==465,
    auth:{user:process.env.TRADEOS_DOC_SMTP_USER!,
      pass:process.env.TRADEOS_DOC_SMTP_PASS!},
    tls:{minVersion:"TLSv1.2",rejectUnauthorized:true},
    connectionTimeout:10_000,greetingTimeout:10_000,socketTimeout:20_000,
    pool:false,
  } as SMTPTransport.Options);
  try{
    const pdf = await renderSupplierPurchaseOrderPdf(job.payload_snapshot);
    const filename = "PO-" + job.document_number.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) + ".pdf";
    const result=await transporter.sendMail({
      from:{name:config.senderName,address:config.senderEmail},
      to:{name:job.recipient_name,address:job.recipient_email},
      subject:job.subject,text:job.body_text,
      attachments:[{filename,content:pdf,contentType:"application/pdf",
        contentDisposition:"attachment"}],
      headers:{"X-TradeOS-Delivery-Id":job.id},
      disableFileAccess:true,disableUrlAccess:true,
    });
    return {messageId:String(result.messageId??"").slice(0,255),
      accepted:result.accepted.some(address=>
        (typeof address==="string"?address:address.address).toLowerCase()===
        job.recipient_email.toLowerCase())};
  }finally{transporter.close();}
}
async function audit(tx:DatabaseClient,job:DeliveryJob,eventType:string) {
  await tx.query(`INSERT INTO audit_events(
    business_id,branch_id,event_type,entity_type,entity_id,payload)
    VALUES($1,$2,$3,'SUPPLIER_DOCUMENT_DELIVERY',$4,$5::jsonb)`,
    [job.business_id,job.branch_id,eventType,job.id,
      JSON.stringify({orderId:job.purchase_order_id,
        documentNumber:job.document_number,attempt:job.attempt_count})]);
}

/**
 * The outbox has at-most-one *automatic* attempt per explicit authorization.
 * If SMTP fails ambiguously, it requires human review instead of blindly
 * repeating a message that may already have reached the supplier.
 */
export async function processSupplierDeliveryOnce(
  pool:DatabasePool,sender:DocumentEmailSender=smtpSendSupplierDocument
):Promise<"EMPTY"|"ACCEPTED"|"REVIEW_REQUIRED">{
  // Queued messages are only usable for a short confirmation window.
  // Do not silently send old drafts, cancelled POs or changed supplier contacts.
  await pool.query(`UPDATE supplier_document_deliveries d SET
    status='REVIEW_REQUIRED',last_error_code='DELIVERY_RECONFIRM_REQUIRED',
    updated_at=now()
    WHERE status='QUEUED'
      AND (d.authorized_at<now()-interval '24 hours' OR
        NOT EXISTS(
          SELECT 1 FROM supplier_purchase_orders po
          JOIN suppliers s ON s.id=po.supplier_id AND s.business_id=po.business_id
          WHERE po.id=d.purchase_order_id AND po.business_id=d.business_id
            AND po.status='ISSUED' AND s.is_active=true
            AND lower(s.email)=lower(d.recipient_email)
        )
      )`);
  // Crash recovery: a stale SENDING row may have reached SMTP. Never resend.
  await pool.query(`WITH stale AS (
    UPDATE supplier_document_deliveries
      SET status='REVIEW_REQUIRED',last_error_code='SMTP_OUTCOME_UNKNOWN',
        updated_at=now()
      WHERE status='SENDING' AND last_attempt_at<now()-interval '5 minutes'
      RETURNING business_id,id,attempt_count
    )
    UPDATE supplier_document_delivery_attempts a
      SET status='REVIEW_REQUIRED',error_code='SMTP_OUTCOME_UNKNOWN',
        finished_at=now()
      FROM stale s WHERE a.business_id=s.business_id AND a.delivery_id=s.id
        AND a.attempt_number=s.attempt_count AND a.status='STARTED'`);
  const job=await withTransaction(pool,async tx=>{
    const row=(await tx.query<DeliveryJob>(
      `SELECT id,business_id,branch_id,purchase_order_id,recipient_email,
        recipient_name,sender_email,subject,body_text,attempt_count,document_number,
        payload_snapshot
       FROM supplier_document_deliveries
       WHERE status='QUEUED' AND next_attempt_at<=now()
         AND attempt_count<3 AND authorized_at IS NOT NULL
       ORDER BY next_attempt_at,created_at,id
       FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if(!row)return null;
    const attempt=row.attempt_count+1;
    await tx.query(`UPDATE supplier_document_deliveries SET
      status='SENDING',attempt_count=$2,last_attempt_at=now(),updated_at=now()
      WHERE id=$1 AND business_id=$3`,
      [row.id,attempt,row.business_id]);
    await tx.query(`INSERT INTO supplier_document_delivery_attempts(
      business_id,delivery_id,attempt_number,status)
      VALUES($1,$2,$3,'STARTED')`,[row.business_id,row.id,attempt]);
    return {...row,attempt_count:attempt};
  });
  if(!job)return "EMPTY";
  let accepted=false,providerId="",errorCode="SMTP_OUTCOME_UNKNOWN";
  try{
    const result=await sender(job);
    accepted=result.accepted;
    providerId=result.messageId.slice(0,255);
    if(!accepted)errorCode="SMTP_RECIPIENT_NOT_ACCEPTED";
  }catch{
    // SMTP failures after DATA are ambiguous. No raw server response,
    // credentials or recipient contents are logged or stored.
  }
  const state=accepted?"ACCEPTED":"REVIEW_REQUIRED";
  await withTransaction(pool,async tx=>{
    await tx.query(`UPDATE supplier_document_deliveries SET status=$3,
      provider_message_id=$4,last_error_code=$5,updated_at=now(),
      accepted_at=CASE WHEN $3='ACCEPTED' THEN now() ELSE accepted_at END
      WHERE business_id=$1 AND id=$2 AND status='SENDING'`,
      [job.business_id,job.id,state,providerId||null,
        accepted?null:errorCode]);
    await tx.query(`UPDATE supplier_document_delivery_attempts
      SET status=$4,provider_message_id=$5,error_code=$6,finished_at=now()
      WHERE business_id=$1 AND delivery_id=$2 AND attempt_number=$3
        AND status='STARTED'`,
      [job.business_id,job.id,job.attempt_count,state,providerId||null,
        accepted?null:errorCode]);
    await audit(tx,job,accepted?
      "SUPPLIER_DOCUMENT_EMAIL_ACCEPTED":"SUPPLIER_DOCUMENT_EMAIL_REVIEW_REQUIRED");
  });
  return state;
}
export function startSupplierDeliveryScheduler(pool:DatabasePool){
  const config=documentEmailConfig();
  if(!config.ready)return {stop(){}};
  let running=false;
  const tick=async()=>{
    if(running||!documentEmailConfig().ready)return;
    running=true;
    try {
      for(let n=0;n<4;n++){
        if(await processSupplierDeliveryOnce(pool)==="EMPTY")break;
      }
    }catch(error){
      // Do not write secrets, SMTP payloads or full recipient details to logs.
      console.error("Supplier delivery scheduler encountered an error",
        error instanceof Error?error.name:"UNKNOWN");
    }finally{running=false;}
  };
  const timer=setInterval(()=>void tick(),15_000);
  timer.unref();
  void tick();
  return {stop(){clearInterval(timer);}};
}
