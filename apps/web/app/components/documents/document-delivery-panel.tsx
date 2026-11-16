"use client";

import {useEffect,useRef,useState} from "react";
import {useWorkspace} from "../workspace/use-workspace";
import {useApiFetch} from "../../../lib/use-api-fetch";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import styles from "./document-delivery-panel.module.css";

type Kind="PURCHASE_ORDER"|"COMMERCIAL_DOCUMENT";
type Delivery={
  id:string;documentNumber:string;recipientEmail:string;recipientName:string;
  status:"QUEUED"|"SENDING"|"ACCEPTED"|"FAILED"|"REVIEW_REQUIRED";
  attemptCount:number;createdAt:string;acceptedAt:string|null;
  lastErrorCode:string|null;channel:"EMAIL";
};
export function DocumentDeliveryPanel(props:{
  kind:Kind;documentId:string;documentNumber:string;
  contactEmail:string|null;recipientName:string;status:string;
}){
  const {session,role,queue}=useWorkspace();
  const [email,setEmail]=useState(props.contactEmail??"");
  const [reason,setReason]=useState("");
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const requestId=useRef<string|null>(null);
  const canSend=["OWNER","ADMIN","MANAGER"].includes(role);
  const readyUrl=session?
    "/v1/document-deliveries/readiness?businessId="+encodeURIComponent(session.businessId):null;
  const listUrl=session?
    "/v1/document-deliveries?businessId="+encodeURIComponent(session.businessId)+
    "&documentKind="+encodeURIComponent(props.kind)+
    "&documentId="+encodeURIComponent(props.documentId):null;
  const {data:readiness}=useApiFetch<{emailEnabled:boolean;whatsappEnabled:boolean}>(readyUrl);
  const {data,loading,error:loadError,refetch}=useApiFetch<{deliveries:Delivery[]}>(listUrl);
  const enabled=readiness?.emailEnabled===true;
  const override=email.trim().toLowerCase()!==(
    props.contactEmail?.trim().toLowerCase()??"");
  const prepared=data?.deliveries??[];
  useEffect(()=>{
    setEmail(props.contactEmail??"");
    setReason("");setConfirmed(false);requestId.current=null;
    setError(null);setNotice(null);
  },[props.contactEmail,props.documentId]);
  const dirty=()=>{requestId.current=null;setConfirmed(false);};
  async function create(){
    if(!session||!queue.online||!canSend||!confirmed||busy)return;
    requestId.current??=crypto.randomUUID();
    setBusy(true);setError(null);setNotice(null);
    try{
      const res=await getOfflineQueue().authenticatedFetch("/v1/document-deliveries",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          businessId:session.businessId,documentId:props.documentId,
          documentKind:props.kind,channel:"EMAIL",
          clientRequestId:requestId.current,
          recipientEmail:email.trim(),recipientConfirmed:true,
          ...(override?{recipientOverrideReason:reason.trim()}:{}),
        }),
      });
      if(!res.ok)throw new Error(await readApiErrorMessage(res));
      const result=await res.json() as {delivery:Delivery};
      setNotice("Email prepared for "+result.delivery.recipientEmail+
        ". Review the recipient, then send once email service is ready.");
      setConfirmed(false);requestId.current=null;refetch();
    }catch(e){setError(e instanceof Error?e.message:"Could not prepare email");}
    finally{setBusy(false);}
  }
  async function send(delivery:Delivery){
    if(!session||!queue.online||!canSend||busy||!enabled||
      !["QUEUED","FAILED"].includes(delivery.status))return;
    if(!window.confirm("Send "+props.documentNumber+" to "+delivery.recipientEmail+
      "? The mail server can accept a message without confirming inbox delivery."))return;
    setBusy(true);setError(null);setNotice(null);
    try{
      const res=await getOfflineQueue().authenticatedFetch(
        "/v1/document-deliveries/"+encodeURIComponent(delivery.id)+"/send",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({businessId:session.businessId}),
        });
      if(!res.ok)throw new Error(await readApiErrorMessage(res));
      setNotice("Email accepted by the mail transport. Recipient inbox delivery is not confirmed.");
      refetch();
    }catch(e){setError(e instanceof Error?e.message:"Email could not be sent");refetch();}
    finally{setBusy(false);}
  }
  if(props.status!=="ISSUED")return null;
  return <section className={styles.panel} aria-label="Document email delivery">
    <h2>Email this document</h2>
    <p className={styles.help}>Send a secure itemized summary with a link to the
      authenticated document. This is not an attached PDF. WhatsApp delivery is
      not enabled and no message is marked delivered without provider proof.</p>
    <p className={enabled?styles.enabled:styles.warning}>
      {enabled?"Verified platform mail transport configured":
        "Email sending is not configured or sender verification is incomplete. You may prepare a delivery, but sending is disabled."}
    </p>
    {canSend?<div className={styles.fields}>
      <label>Recipient email
        <input type="email" value={email} placeholder="supplier@example.com"
          disabled={busy||!queue.online}
          onChange={event=>{setEmail(event.target.value);dirty();}}/>
      </label>
      {override?<label>Reason for changing or entering the recipient
        <textarea value={reason} rows={2}
          disabled={busy||!queue.online} minLength={12}
          onChange={event=>{setReason(event.target.value);dirty();}}
          placeholder="Explain why this address is correct (at least 12 characters)"/>
      </label>:null}
      <label className={styles.confirm}>
        <input type="checkbox" checked={confirmed}
          disabled={busy||!queue.online}
          onChange={event=>setConfirmed(event.target.checked)}/>
        I checked this address and confirm it is the intended document recipient.
      </label>
      <button type="button" disabled={busy||!queue.online||!confirmed||
          !email.trim()||(override&&reason.trim().length<12)}
        onClick={()=>void create()}>
        {busy?"Processing…":"Prepare email delivery"}
      </button>
    </div>:<p className={styles.help}>
      Only an owner, administrator or manager may prepare and send documents.</p>}
    {error?<p className={styles.error} role="alert">{error}</p>:null}
    {notice?<p className={styles.notice} role="status">{notice}</p>:null}
    {loadError?<p className={styles.error}>{loadError}</p>:null}
    <h3>Delivery history</h3>
    {loading?<p className={styles.help}>Loading delivery attempts…</p>:
      prepared.length===0?<p className={styles.help}>
        No email has been prepared for this document.</p>:
      <div className={styles.history}>
        {prepared.map(delivery=><div key={delivery.id} className={styles.historyRow}>
          <div>
            <strong>{delivery.recipientEmail}</strong>
            <small>{new Date(delivery.createdAt).toLocaleString("en-GB")}</small>
            <span className={styles.status}>
              {delivery.status==="ACCEPTED"?"Accepted by mail server — delivery not confirmed":
                delivery.status==="REVIEW_REQUIRED"||delivery.status==="SENDING"?
                  "Manual review required — do not resend":
                delivery.status==="FAILED"?"Failed before acceptance":
                "Prepared, not sent"}
            </span>
            {delivery.attemptCount>0?<small>
              Attempts: {delivery.attemptCount}</small>:null}
          </div>
          {canSend&&["QUEUED","FAILED"].includes(delivery.status)?
            <button type="button" onClick={()=>void send(delivery)}
              disabled={!enabled||!queue.online||busy}
              title={!enabled?"Verify the sender in system configuration":undefined}>
              Send email
            </button>:null}
        </div>)}
      </div>}
  </section>;
}
