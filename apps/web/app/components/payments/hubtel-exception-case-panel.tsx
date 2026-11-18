"use client";
import {useState} from "react";
import {useWorkspace} from "../workspace/use-workspace";
import {useApiFetch} from "../../../lib/use-api-fetch";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import styles from "./hubtel-exception-case-panel.module.css";

type Action="ACCOUNTING_REVIEW"|"PROVIDER_INVESTIGATION";
type Status="OPEN"|"AWAITING_APPROVAL"|"APPROVED_ACCOUNTING_REVIEW"|
  "APPROVED_PROVIDER_INVESTIGATION";
type Case={
  exceptionId:string;saleId:string;exceptionKind:string;detectedAt:string;
  status:Status;recommendedAction:Action|null;evidenceReference:string|null;
  investigatorNote:string|null;proposedByUserId:string|null;
  revision:number;submittedAt:string|null;approvedAt:string|null;
};
function date(v:string|null){
  if(!v)return "—";
  return new Intl.DateTimeFormat("en-GB",{
    day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",
    timeZone:"Africa/Accra",
  }).format(new Date(v));
}
function statusText(value:Status){
  return value==="AWAITING_APPROVAL"?"Awaiting independent approval":
    value==="APPROVED_ACCOUNTING_REVIEW"?"Approved for accounting investigation":
    value==="APPROVED_PROVIDER_INVESTIGATION"?"Approved for provider investigation":
      "Evidence needed";
}
export function HubtelExceptionCasePanel(){
  const {session,role,queue,account}=useWorkspace();
  const canRead=["OWNER","ADMIN","MANAGER","ACCOUNTANT"].includes(role);
  const canPropose=canRead;
  const canApprove=["OWNER","ADMIN"].includes(role);
  const query=session&&canRead?
    "/v1/payments/hubtel/exception-cases?businessId="+
    encodeURIComponent(session.businessId)+"&branchId="+encodeURIComponent(session.branchId):null;
  const {data,loading,error:loadError,refetch}=useApiFetch<{cases:Case[]}>(query);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [action,setAction]=useState<Action>("PROVIDER_INVESTIGATION");
  const [evidence,setEvidence]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);

  function choose(id:string|null){
    setSelectedId(id);setAction("PROVIDER_INVESTIGATION");
    setEvidence("");setReason("");setNotice(null);setError(null);
  }
  async function send(item:Case,verb:"submit"|"decide",decision?:"APPROVE"|"RETURN"){
    if(!session||busy||!queue.online||reason.trim().length<20||reason.trim().length>700)return;
    if(verb==="submit"&&(!canPropose||evidence.trim().length<6||evidence.trim().length>160))return;
    if(verb==="decide"&&(!canApprove||item.proposedByUserId===account?.id))return;
    setBusy(true);setError(null);setNotice(null);
    try{
      const path="/v1/payments/hubtel/exception-cases/"+
        encodeURIComponent(item.exceptionId)+"/"+verb;
      const body=verb==="submit"
        ?{businessId:session.businessId,expectedRevision:item.revision,
          recommendedAction:action,evidenceReference:evidence.trim(),note:reason.trim()}
        :{businessId:session.businessId,expectedRevision:item.revision,
          decision,note:reason.trim()};
      const response=await getOfflineQueue().authenticatedFetch(path,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
      });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      setSelectedId(null);setReason("");setEvidence("");
      setNotice(verb==="submit"?
        "Evidence recorded. A different owner or administrator must review the proposal.":
        decision==="APPROVE"?
          "Investigation handoff approved. No refund, stock or accounting transaction was executed.":
          "Proposal returned for further evidence. No financial transaction was executed.");
      refetch();
    }catch(e){
      setError(e instanceof Error?e.message:"Could not save this review.");
    }finally{setBusy(false);}
  }
  if(!canRead)return null;
  return <section className={styles.panel} aria-label="Settlement exception review cases">
    <div className={styles.heading}>
      <div><h2>Settlement investigation approvals</h2>
        <p>Record provider evidence, request a second-person review and track the next
          investigation step. These approvals do not issue refunds or reverse accounting entries.</p>
      </div>
      <button type="button" className={styles.secondary} onClick={refetch}>Refresh cases</button>
    </div>
    {notice?<p role="status" className={styles.success}>{notice}</p>:null}
    {error||loadError?<p role="alert" className={styles.error}>{error??loadError}</p>:null}
    {loading?<p>Loading investigation cases…</p>:
      data?.cases.length===0?<p className={styles.empty}>No post-settlement exceptions require investigation for this branch.</p>:
      <div className={styles.cases}>{data?.cases.map(item=>
        <article key={item.exceptionId} className={styles.card}>
          <div className={styles.cardHeader}>
            <div><strong>Sale {item.saleId.slice(0,8).toUpperCase()}</strong>
              <span>Detected {date(item.detectedAt)}</span></div>
            <span className={item.status==="OPEN"?styles.warning:styles.status}>
              {statusText(item.status)}</span>
          </div>
          <p><strong>Provider finding:</strong> {item.exceptionKind.replaceAll("_"," ").toLowerCase()}</p>
          {item.recommendedAction?<p><strong>Recommended step:</strong> {
            item.recommendedAction==="ACCOUNTING_REVIEW"?
              "Investigate accounting and inventory reconciliation":
              "Investigate the provider transaction with Hubtel"}</p>:null}
          {item.evidenceReference?<p className={styles.evidence}>
            <strong>Evidence reference:</strong> {item.evidenceReference}</p>:null}
          {item.investigatorNote?<p className={styles.note}>{item.investigatorNote}</p>:null}
          <p className={styles.meta}>Case revision {item.revision}
            {item.submittedAt?" · Submitted "+date(item.submittedAt):""}
            {item.approvedAt?" · Approved "+date(item.approvedAt):""}</p>
          {selectedId===item.exceptionId?
            <div className={styles.form}>
              {item.status==="OPEN"?<>
                <label htmlFor={"action-"+item.exceptionId}>Recommended next investigation</label>
                <select id={"action-"+item.exceptionId} value={action}
                  onChange={e=>setAction(e.target.value as Action)}>
                  <option value="PROVIDER_INVESTIGATION">Investigate with Hubtel</option>
                  <option value="ACCOUNTING_REVIEW">Investigate accounting reconciliation</option>
                </select>
                <label htmlFor={"evidence-"+item.exceptionId}>Provider case or document reference</label>
                <input id={"evidence-"+item.exceptionId} value={evidence}
                  maxLength={160} placeholder="E.g. Hubtel support case HD-12345"
                  onChange={e=>setEvidence(e.target.value)}/>
              </>:null}
              <label htmlFor={"reason-"+item.exceptionId}>
                {item.status==="OPEN"?"Why is this next step required?":
                  "Independent review decision and reason"}
              </label>
              <textarea id={"reason-"+item.exceptionId} value={reason}
                maxLength={700} rows={3}
                onChange={e=>setReason(e.target.value)}
                placeholder="Record the findings without pasting API keys, customer card or wallet data."/>
              <div className={styles.actions}>
                {item.status==="OPEN"?
                  <button type="button" className={styles.primary}
                    disabled={!queue.online||busy||evidence.trim().length<6||reason.trim().length<20}
                    onClick={()=>void send(item,"submit")}>Submit for independent approval</button>:
                  <><button type="button" className={styles.primary}
                    disabled={!queue.online||busy||reason.trim().length<20}
                    onClick={()=>void send(item,"decide","APPROVE")}>Approve investigation step</button>
                    <button type="button" className={styles.secondary}
                    disabled={!queue.online||busy||reason.trim().length<20}
                    onClick={()=>void send(item,"decide","RETURN")}>Return for more evidence</button></>}
                <button type="button" className={styles.secondary}
                  disabled={busy} onClick={()=>choose(null)}>Cancel</button>
              </div>
            </div>:
            <div className={styles.actions}>
              {item.status==="OPEN"&&canPropose?
                <button type="button" className={styles.primary}
                  disabled={!queue.online||busy}
                  onClick={()=>choose(item.exceptionId)}>Record evidence</button>:null}
              {item.status==="AWAITING_APPROVAL"&&canApprove&&item.proposedByUserId!==account?.id?
                <button type="button" className={styles.primary}
                  disabled={!queue.online||busy}
                  onClick={()=>choose(item.exceptionId)}>Second-person decision</button>:null}
              {item.status==="AWAITING_APPROVAL"&&(!canApprove||item.proposedByUserId===account?.id)?
                <p className={styles.meta}>An owner or administrator must make the independent decision.</p>:null}
            </div>}
          <p className={styles.disclaimer}>Approving an investigation does not authorize payment to a customer
            or alter the sale, ledger, stock or tax. Any financial correction requires a separate workflow.</p>
        </article>,
      )}</div>}
  </section>;
}
