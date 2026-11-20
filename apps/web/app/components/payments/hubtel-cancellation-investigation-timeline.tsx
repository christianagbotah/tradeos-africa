"use client";

import { useRef, useState } from "react";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import styles from "./hubtel-reconciliation-workspace.module.css";

type Kind="PROVIDER_CONTACTED"|"PROVIDER_REPLY_RECORDED"|"CUSTOMER_FOLLOWUP"|"INTERNAL_NOTE";
type ProviderReport="NOT_APPLICABLE"|"UNPAID_REPORTED"|"PAID_REPORTED"|"INCONCLUSIVE";
type Event={
  eventId:string;investigationId:string;actorUserId:string;
  recordedAt:string;eventKind:Kind;providerReport:ProviderReport;
  evidenceReference:string|null;note:string;
  providerFinality:"NOT_ESTABLISHED";canReleaseStock:false;
};
type Timeline={
  investigationId:string;events:Event[];total:number;limit:number;
  offset:number;hasMore:boolean;providerFinality:"NOT_ESTABLISHED";
  canReleaseStock:false;
};
const kinds:Record<Kind,string>={
  PROVIDER_CONTACTED:"Contacted Hubtel support",
  PROVIDER_REPLY_RECORDED:"Recorded provider-reported information",
  CUSTOMER_FOLLOWUP:"Customer follow-up",
  INTERNAL_NOTE:"Internal note",
};
const reports:Record<Exclude<ProviderReport,"NOT_APPLICABLE">,string>={
  UNPAID_REPORTED:"Hubtel representative reports unpaid (not finality)",
  PAID_REPORTED:"Hubtel representative reports paid (verify independently)",
  INCONCLUSIVE:"No conclusive provider response",
};
const LIMIT=10;
function date(value:string) {
  const parsed=new Date(value);
  if(!Number.isFinite(parsed.getTime()))return "Time unavailable";
  return new Intl.DateTimeFormat("en-GB",{
    timeZone:"Africa/Accra",day:"2-digit",month:"short",year:"numeric",
    hour:"2-digit",minute:"2-digit",
  }).format(parsed);
}

export function HubtelCancellationInvestigationTimeline({
  businessId,investigationId,online,onNewEvent,
}:{
  businessId:string;investigationId:string;online:boolean;
  onNewEvent?:()=>void;
}) {
  const [kind,setKind]=useState<Kind>("PROVIDER_CONTACTED");
  const [providerReport,setProviderReport]=useState<ProviderReport>("INCONCLUSIVE");
  const [reference,setReference]=useState("");
  const [note,setNote]=useState("");
  const [offset,setOffset]=useState(0);
  const [busy,setBusy]=useState(false);
  const [submitError,setSubmitError]=useState<string|null>(null);
  const [submitSuccess,setSubmitSuccess]=useState<string|null>(null);
  const requestId=useRef<string|null>(null);
  const url="/v1/payments/hubtel/cancellation-investigations/"+
    encodeURIComponent(investigationId)+"/events";
  const {data,error,loading,refetch}=useApiFetch<Timeline>(
    url+"?businessId="+encodeURIComponent(businessId)+
    "&limit="+LIMIT+"&offset="+offset);
  const valid=data?.investigationId===investigationId &&
    data?.providerFinality==="NOT_ESTABLISHED" &&
    data?.canReleaseStock===false && data.limit===LIMIT &&
    data.offset===offset && Array.isArray(data.events) &&
    Number.isSafeInteger(data.total) && data.total>=0 &&
    data.events.every(event=>event.providerFinality==="NOT_ESTABLISHED" &&
      event.canReleaseStock===false && typeof event.note==="string");
  const needsProvider=kind==="PROVIDER_REPLY_RECORDED";
  const referenceValid=!needsProvider||
    (/^[A-Za-z0-9][A-Za-z0-9 _.:/-]{5,159}$/.test(reference.trim()) &&
      !reference.includes("://"));
  const canSubmit=online&&!busy&&note.trim().length>=20&&note.trim().length<=700&&
    referenceValid && (!reference.trim()||
    /^[A-Za-z0-9][A-Za-z0-9 _.:/-]{5,159}$/.test(reference.trim()));
  const resetRetry=()=>{requestId.current=null;setSubmitError(null);setSubmitSuccess(null);};
  async function submit(){
    if(!canSubmit)return;
    setBusy(true);setSubmitError(null);setSubmitSuccess(null);
    try{
      const id=requestId.current??crypto.randomUUID();
      requestId.current=id;
      const response=await getOfflineQueue().authenticatedFetch(url,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          businessId,clientRequestId:id,eventKind:kind,
          providerReport:needsProvider?providerReport:"NOT_APPLICABLE",
          evidenceReference:reference.trim()||null,note:note.trim(),
        }),
      });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const result=await response.json() as {event:Event};
      if(result.event.investigationId!==investigationId ||
        result.event.providerFinality!=="NOT_ESTABLISHED" ||
        result.event.canReleaseStock!==false)
        throw new Error("The investigation update acknowledgement could not be verified.");
      setSubmitSuccess("Update saved to the audit history. No checkout or stock status changed.");
      setNote("");setReference("");requestId.current=null;
      setOffset(0);refetch();onNewEvent?.();
    }catch(e){
      setSubmitError(e instanceof Error?e.message:"Investigation update could not be recorded.");
    }finally{setBusy(false);}
  }
  return <section className={styles.investigationTimeline}
    aria-label="Investigation activity and provider correspondence">
    <h3>Investigation history</h3>
    <p className={styles.investigationDisclaimer}>
      Support correspondence is manually entered, not authenticated payment evidence.
      Even a provider-reported unpaid response does not authorise cancellation or stock restoration.
    </p>
    <div className={styles.investigationUpdateForm}>
      <label htmlFor={"hubtel-investigation-event-kind-"+investigationId}>Update type</label>
      <select id={"hubtel-investigation-event-kind-"+investigationId}
        value={kind} disabled={!online||busy}
        onChange={e=>{setKind(e.target.value as Kind);resetRetry();}}>
        {(Object.keys(kinds) as Kind[]).map(value=>
          <option key={value} value={value}>{kinds[value]}</option>)}
      </select>
      {needsProvider?<>
        <label htmlFor={"hubtel-investigation-report-"+investigationId}>
          What did the provider representative report?
        </label>
        <select id={"hubtel-investigation-report-"+investigationId}
          value={providerReport} disabled={!online||busy}
          onChange={e=>{setProviderReport(e.target.value as ProviderReport);resetRetry();}}>
          {(Object.keys(reports) as Exclude<ProviderReport,"NOT_APPLICABLE">[]).map(value=>
            <option key={value} value={value}>{reports[value]}</option>)}
        </select>
      </>:null}
      <label htmlFor={"hubtel-investigation-reference-"+investigationId}>
        External Hubtel support case or document reference
        {needsProvider?" (required)":" (optional)"}
      </label>
      <input id={"hubtel-investigation-reference-"+investigationId}
        type="text" maxLength={160} value={reference}
        autoComplete="off" disabled={!online||busy}
        placeholder="e.g. HUBTEL-SUPPORT-1234"
        onChange={e=>{setReference(e.target.value);resetRetry();}}/>
      <label htmlFor={"hubtel-investigation-note-"+investigationId}>
        Follow-up notes (20–700 characters)
      </label>
      <textarea id={"hubtel-investigation-note-"+investigationId}
        value={note} maxLength={700} rows={3}
        placeholder="Document the contact, response, time and next action; do not include API keys or passwords."
        disabled={!online||busy}
        onChange={e=>{setNote(e.target.value);resetRetry();}}/>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary}
          disabled={!canSubmit} onClick={()=>void submit()}>
          {busy?"Saving update…":"Record investigation update"}
        </button>
        <small>{note.length}/700</small>
      </div>
      {!online?<p>Connect to the internet before recording case notes.</p>:null}
      {submitError?<p role="alert" className={styles.error}>{submitError}</p>:null}
      {submitSuccess?<p role="status" className={styles.success}>{submitSuccess}</p>:null}
    </div>
    {loading?<p role="status">Loading investigation history…</p>:null}
    {error?<p role="alert" className={styles.error}>{error}</p>:null}
    {data&&!valid?<p role="alert" className={styles.error}>
      Investigation history could not be verified. No payment cancellation is implied.
    </p>:null}
    {valid&&data&&!loading?<>
      <div className={styles.investigationHistory}>
        {data.events.length===0?<p className={styles.empty}>No follow-up notes recorded yet.</p>:
          data.events.map(event=><article className={styles.investigationHistoryItem}
            key={event.eventId}>
            <div className={styles.itemHeader}>
              <strong>{kinds[event.eventKind]??"Investigation update"}</strong>
              <span className={styles.itemDate}>{date(event.recordedAt)}</span>
            </div>
            {event.providerReport!=="NOT_APPLICABLE"?<p className={styles.warning}>
              {reports[event.providerReport]??"Unverified provider-reported outcome"}
            </p>:null}
            {event.evidenceReference?<p>External reference: {event.evidenceReference}</p>:null}
            <p>{event.note}</p>
          </article>)}
      </div>
      <div className={styles.investigationPagination}>
        <span>{data.events.length?offset+1:0}–{offset+data.events.length} of {data.total} updates</span>
        <div className={styles.actions}>
          <button className={styles.secondary} type="button"
            disabled={offset===0||loading}
            onClick={()=>setOffset(value=>Math.max(0,value-LIMIT))}>Previous</button>
          <button className={styles.secondary} type="button"
            disabled={!data.hasMore||loading}
            onClick={()=>setOffset(value=>value+LIMIT)}>Next</button>
        </div>
      </div>
    </>:null}
  </section>;
}
