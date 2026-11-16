"use client";

import { useRef, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import styles from "./supplier-document-delivery.module.css";

type Status="PREPARED"|"QUEUED"|"SENDING"|"ACCEPTED"|"REVIEW_REQUIRED"|"CANCELLED";
interface Delivery {
  id:string;status:Status;recipientEmail:string;recipientName:string;
  subject:string;bodyText:string;documentNumber:string;senderEmail:string|null;
  attemptCount:number;lastErrorCode:string|null;createdAt:string;acceptedAt:string|null;
  deliveryConfirmed:boolean;
}
interface ChannelStatus {
  ready:boolean;issue:string|null;senderEmail:string|null;
  senderName:string;acceptanceOnly:boolean;deliveryReceiptsAvailable:boolean;
}
interface ManualWhatsApp {
  orderId:string;orderNumber:string;recipientName:string;
  recipientPhone:string;message:string;providerConnected:false;delivered:false;
}
interface Props {
  orderId:string;orderNumber:string;status:string;
}
const DATE=new Intl.DateTimeFormat("en-GB",{
  day:"2-digit",month:"2-digit",year:"numeric",timeZone:"Africa/Accra",
});
const CONTROL=["OWNER","ADMIN","MANAGER"];
const ACCESS=["OWNER","ADMIN","MANAGER","ACCOUNTANT","INVENTORY"];
function formatDate(value:string){return DATE.format(new Date(value));}
function label(status:Status){
  switch(status){
    case "PREPARED":return "Awaiting approval";
    case "QUEUED":return "Queued to send";
    case "SENDING":return "Contacting email provider";
    case "ACCEPTED":return "Accepted by email provider";
    case "REVIEW_REQUIRED":return "Manual review required";
    case "CANCELLED":return "Cancelled";
  }
}
export function SupplierDocumentDelivery({orderId,orderNumber,status}:Props){
  const {session,role,queue}=useWorkspace();
  const businessId=session?.businessId;
  const active=status==="ISSUED";
  const canManage=CONTROL.includes(role);
  const canView=ACCESS.includes(role);
  const canPrepare=canView;
  const base=businessId&&active&&canView?
    `/v1/purchase-orders/${encodeURIComponent(orderId)}/deliveries?businessId=${encodeURIComponent(businessId)}`:null;
  const {data,loading,error:loadError,refetch}=
    useApiFetch<{currentSupplierEmail:string|null;deliveries:Delivery[]}>(base);
  const {data:configuration}=useApiFetch<{email:ChannelStatus;
    whatsapp:{ready:boolean;issue:string}}>(
      businessId&&active&&canView?
        `/v1/supplier-document-delivery/config?businessId=${encodeURIComponent(businessId)}`:null);
  const manualSharePath=businessId&&active&&canManage?
    "/v1/purchase-orders/"+encodeURIComponent(orderId)+
    "/manual-whatsapp?businessId="+encodeURIComponent(businessId):null;
  const {data:manualWhatsApp,error:manualShareError,refetch:refreshManualShare}=
    useApiFetch<ManualWhatsApp>(manualSharePath);
  const [recipient,setRecipient]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [confirmedRecipients,setConfirmedRecipients]=useState<Record<string,boolean>>({});
  const [confirmedConsent,setConfirmedConsent]=useState<Record<string,boolean>>({});
  const [confirmedNoDelivery,setConfirmedNoDelivery]=useState<Record<string,boolean>>({});
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const requestId=useRef<string|null>(null);
  if(!active||!canView)return null;
  const email=configuration?.email;
  const supplierEmail=data?.currentSupplierEmail??"";
  const draftRecipient=recipient??supplierEmail;
  const online=queue.online;
  async function post(path:string,body:unknown){
    const response=await getOfflineQueue().authenticatedFetch(path,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
    });
    if(!response.ok)throw new Error(await readApiErrorMessage(response));
    return response.json();
  }
  async function create(){
    if(!businessId||!online||!canManage||busy||!draftRecipient.trim())return;
    setBusy(true);setError(null);setNotice(null);
    requestId.current??=crypto.randomUUID();
    try{
      await post(`/v1/purchase-orders/${encodeURIComponent(orderId)}/deliveries`,{
        businessId,clientRequestId:requestId.current,
        recipientEmail:draftRecipient.trim(),
      });
      setNotice("Delivery draft prepared. Review the recipient and content before sending.");
      requestId.current=null;refetch();
    }catch(err){setError(err instanceof Error?err.message:"Could not prepare supplier email");}
    finally{setBusy(false);}
  }
  async function action(row:Delivery,task:"authorize"|"retry"|"cancel"){
    if(!businessId||!online||busy||!canManage)return;
    if(task==="cancel"&&!window.confirm(
      `Cancel the email request for ${row.documentNumber} to ${row.recipientEmail}?`))return;
    setBusy(true);setError(null);setNotice(null);
    try{
      await post(`/v1/supplier-document-deliveries/${encodeURIComponent(row.id)}/${task}`,{
        businessId,
        ...(task==="authorize"?{
          recipientEmail:row.recipientEmail,recipientConfirmed:confirmedRecipients[row.id]===true,
          consentConfirmed:confirmedConsent[row.id]===true,
        }:{}),
        ...(task==="retry"?{
          confirmedNoDelivery:confirmedNoDelivery[row.id]===true,
        }:{}),
      });
      setNotice(task==="cancel"?"Email request cancelled":
        task==="retry"?"New attempt queued after explicit supplier confirmation":
        "Email queued. Check its status; provider acceptance does not prove delivery.");
      refetch();
    }catch(err){setError(err instanceof Error?err.message:"Could not update delivery");}
    finally{setBusy(false);}
  }
  async function downloadPdf(row:Delivery){
    if(!businessId||!online||busy)return;
    setBusy(true);setError(null);setNotice(null);
    try{
      const path="/v1/supplier-document-deliveries/"+
        encodeURIComponent(row.id)+"/pdf?businessId="+encodeURIComponent(businessId);
      const response=await getOfflineQueue().authenticatedFetch(path,{method:"GET"});
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      if(!(response.headers.get("content-type")??"").includes("application/pdf"))
        throw new Error("The server did not return a PDF document.");
      const pdf=await response.blob();
      const url=URL.createObjectURL(pdf);
      try{
        const anchor=document.createElement("a");
        anchor.href=url;
        anchor.download="PO-"+row.documentNumber.replace(/[^A-Za-z0-9._-]/g,"-")+".pdf";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }finally{window.setTimeout(()=>URL.revokeObjectURL(url),10_000);}
      setNotice("Exact purchase-order PDF downloaded from this delivery draft.");
    }catch(err){
      setError(err instanceof Error?err.message:"Could not download the PDF");
    }finally{setBusy(false);}
  }
  function openManualWhatsApp(){
    if(!online||busy||!canManage||!manualWhatsApp)return;
    const {recipientPhone,recipientName,message}=manualWhatsApp;
    if(!/^[1-9]\d{7,14}$/.test(recipientPhone)||message.length>1800){
      setError("The supplier contact or prepared message is invalid. Refresh it.");
      return;
    }
    const confirmed=window.confirm(
      "Open WhatsApp for "+recipientName+" (+"+recipientPhone+")?\n\n"+
      "This will open a prefilled message, not send it. "+
      "You must review the recipient, press Send yourself, and attach "+
      "the purchase-order PDF separately. TradeOS cannot verify delivery."
    );
    if(!confirmed)return;
    const link=document.createElement("a");
    link.href="https://wa.me/"+recipientPhone+"?text="+encodeURIComponent(message);
    link.target="_blank";
    link.rel="noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setNotice("WhatsApp compose was requested. No message or delivery "+
      "has been recorded by TradeOS. Attach the PDF separately.");
    setError(null);
  }
  async function downloadManualPdf(){
    if(!businessId||!online||!canManage||busy)return;
    setBusy(true);setNotice(null);setError(null);
    try{
      const path="/v1/purchase-orders/"+encodeURIComponent(orderId)+
        "/manual-share-pdf?businessId="+encodeURIComponent(businessId);
      const response=await getOfflineQueue().authenticatedFetch(path,{method:"GET"});
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      if(!(response.headers.get("content-type")??"").includes("application/pdf"))
        throw new Error("The server did not return a PDF.");
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      try{
        const link=document.createElement("a");
        link.href=url;
        link.download="PO-"+orderNumber.replace(/[^A-Za-z0-9._-]/g,"-")+".pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }finally{window.setTimeout(()=>URL.revokeObjectURL(url),10_000);}
      setNotice("Purchase-order PDF downloaded. Attach it manually to "+
        "the correct WhatsApp conversation.");
    }catch(err){setError(err instanceof Error?err.message:
      "The purchase order could not be downloaded.");
    }finally{setBusy(false);}
  }
  async function copyForManualSharing(row:Delivery){
    try{
      await navigator.clipboard.writeText(row.bodyText);
      setNotice("Purchase-order text copied for manual sharing. No delivery was tracked.");
      setError(null);
    }catch{setError("Your browser could not copy the purchase order text.");}
  }
  return <section className={styles.shell} aria-label="Supplier purchase order delivery">
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Supplier communication</p>
        <h2>Supplier document delivery</h2>
        <p>Send approved supplier emails with permanent delivery history,
          or prepare a WhatsApp message for manual sharing.</p>
      </div>
      <button type="button" className={styles.secondary}
        disabled={busy} onClick={()=>refetch()}>Refresh history</button>
    </header>
    {notice?<p className={styles.success} role="status">{notice}</p>:null}
    {error?<p className={styles.error} role="alert">{error}</p>:null}
    {loadError?<p className={styles.error} role="alert">{loadError}</p>:null}
    <div className={styles.readiness}>
      <strong>{email?.ready?
        "Verified SMTP sender configured":"Email sending is not yet configured"}</strong>
      <p>{email?.ready?
        `Sender: ${email.senderName} <${email.senderEmail}>. Only SMTP acceptance is confirmed.`:
        "You can prepare and review delivery drafts. Sending stays disabled until the verified SMTP provider is configured on the server."}</p>
      <p>WhatsApp provider sending is not connected. Manual copy is available,
        but it is not counted as a sent message.</p>
      {canManage?<section className={styles.manualShare}
          aria-label="Manual WhatsApp purchase-order sharing">
        <h3>Share purchase order via WhatsApp</h3>
        <p>Uses the supplier’s currently saved phone number. No API sending,
          automatic confirmation or delivery tracking. Review the contact
          and attach the PDF yourself.</p>
        {manualWhatsApp?
          <p>Supplier: <strong>{manualWhatsApp.recipientName}</strong>
            {" "}· WhatsApp: <strong>+{manualWhatsApp.recipientPhone}</strong></p>:
          <p>WhatsApp contact unavailable. Save a valid Ghana mobile or
            international phone number under the supplier’s details, then refresh.
          </p>}
        {manualShareError?<p className={styles.muted} role="status">
          {manualShareError}</p>:null}
        <div className={styles.actions}>
          <button type="button" className={styles.secondary}
            disabled={!online||busy} onClick={()=>void downloadManualPdf()}>
            Download purchase-order PDF
          </button>
          <button type="button" className={styles.primary}
            disabled={!online||busy||!manualWhatsApp}
            onClick={openManualWhatsApp}>
            Open WhatsApp (manual)
          </button>
          <button type="button" className={styles.secondary}
            disabled={!online||busy} onClick={()=>refreshManualShare()}>
            Refresh supplier contact
          </button>
        </div>
      </section>:null}
    </div>
    <div className={styles.columns}>
      <div className={styles.panel}>
        <h3>Prepare supplier email</h3>
        <p className={styles.muted}>The recipient must match the email saved on
          this purchase order’s active supplier record. Update the supplier’s
          details first if the address is incorrect.</p>
        <label className={styles.field}>
          Supplier email
          <input type="email" value={draftRecipient}
            placeholder="supplier@example.com" maxLength={254}
            disabled={!canPrepare||busy}
            onChange={e=>{requestId.current=null;setRecipient(e.target.value);}}/>
        </label>
        <p className={styles.muted}>Purchase order: <strong>{orderNumber}</strong>.
          Every authorized email includes the server-generated purchase-order
          PDF attachment as well as a plain-text summary. Preview the exact
          saved PDF from the delivery history before authorizing.</p>
        {canPrepare?<button type="button" className={styles.primary}
          disabled={!online||busy||!draftRecipient.trim()}
          onClick={()=>void create()}>
          {busy?"Working…":"Prepare email for review"}
        </button>:null}
        {!online?<p className={styles.muted}>Go online to check current supplier
          details before preparing or authorizing delivery.</p>:null}
      </div>
      <div className={styles.panel}>
        <h3>Delivery history</h3>
        {loading?<p className={styles.muted}>Loading delivery records…</p>:
          data?.deliveries.length===0?<p className={styles.muted}>
            No supplier emails have been prepared for this order yet.</p>:
          <div className={styles.history}>
            {data?.deliveries.map(row=><article key={row.id} className={styles.delivery}>
              <div className={styles.deliveryHeader}>
                <div><strong>{row.recipientEmail}</strong>
                  <small>{formatDate(row.createdAt)} ·
                    {" "}Attempt {row.attemptCount}/3</small></div>
                <span className={styles.status}>{label(row.status)}</span>
              </div>
              <p className={styles.muted}>Subject: {row.subject}</p>
              <div className={styles.actions}>
                <button type="button" className={styles.secondary}
                  onClick={()=>setExpanded(v=>({...v,[row.id]:!v[row.id]}))}>
                  {expanded[row.id]?"Hide":"Review"} exact email
                </button>
                <button type="button" className={styles.secondary}
                  disabled={!online||busy}
                  onClick={()=>void downloadPdf(row)}>
                  Download exact PDF
                </button>
                <button type="button" className={styles.secondary}
                  onClick={()=>void copyForManualSharing(row)}>
                  Copy for manual sharing
                </button>
              </div>
              {expanded[row.id]?<pre className={styles.preview}>{row.bodyText}</pre>:null}
              {row.status==="PREPARED"&&canManage?<>
                <div className={styles.confirmations}>
                  <label><input type="checkbox"
                    checked={confirmedRecipients[row.id]===true}
                    onChange={e=>setConfirmedRecipients(v=>({
                      ...v,[row.id]:e.target.checked}))}/>
                    I verified this supplier email address is correct</label>
                  <label><input type="checkbox"
                    checked={confirmedConsent[row.id]===true}
                    onChange={e=>setConfirmedConsent(v=>({
                      ...v,[row.id]:e.target.checked}))}/>
                    I confirm this supplier expects this purchasing message</label>
                </div>
                <div className={styles.actions}>
                  <button type="button" className={styles.primary}
                    disabled={!online||busy||!email?.ready||
                      !confirmedRecipients[row.id]||!confirmedConsent[row.id]}
                    onClick={()=>void action(row,"authorize")}>Authorize email send</button>
                  <button type="button" className={styles.danger}
                    disabled={!online||busy} onClick={()=>void action(row,"cancel")}>
                    Cancel draft</button>
                </div>
              </>:null}
              {row.status==="QUEUED"&&canManage?
                <button type="button" className={styles.danger}
                  disabled={!online||busy}
                  onClick={()=>void action(row,"cancel")}>Cancel queued email</button>:null}
              {row.status==="REVIEW_REQUIRED"?<>
                <p className={styles.warning}>SMTP outcome is uncertain.
                  Contact the supplier before authorizing another attempt.
                  An automatic resend could create a duplicate email.</p>
                {canManage&&row.attemptCount<3?<div className={styles.confirmations}>
                  <label><input type="checkbox"
                    checked={confirmedNoDelivery[row.id]===true}
                    onChange={e=>setConfirmedNoDelivery(v=>({
                      ...v,[row.id]:e.target.checked}))}/>
                    I checked with the supplier and confirmed non-receipt</label>
                  <button type="button" className={styles.primary}
                    disabled={!online||busy||!email?.ready||
                      !confirmedNoDelivery[row.id]}
                    onClick={()=>void action(row,"retry")}>Authorize retry</button>
                </div>:null}
              </>:null}
              {row.status==="ACCEPTED"?<p className={styles.accepted}>
                Email provider accepted the message
                {row.acceptedAt?` on ${formatDate(row.acceptedAt)}`:""}.
                This does not guarantee inbox delivery.</p>:null}
            </article>)}
          </div>}
      </div>
    </div>
  </section>;
}
