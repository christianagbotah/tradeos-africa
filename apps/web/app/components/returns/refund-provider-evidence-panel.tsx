"use client";

import { useRef, useState } from "react";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { useWorkspace } from "../workspace/use-workspace";
import { Button } from "../ui/button";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";

type Provider = "HUBTEL"|"PAYSTACK"|"FLUTTERWAVE"|"OTHER";
type ReportedStatus = "CLAIMED_SUCCESS"|"CLAIMED_PENDING"|"CLAIMED_FAILED";
type ReviewDecision = "FIELDS_MATCHED_UNVERIFIED"|
  "DISCREPANCY_RECORDED"|"PROVIDER_CONFIRMATION_NEEDED";
type EvidenceClaim = {
  claimId:string;refundId:string;submittedByUserId:string;
  submittedByName:string;providerCode:Provider;providerReference:string;
  reportedAmountMinor:number;reportedCurrency:string;
  expectedAmountMinor:number;expectedCurrency:string;
  amountMatches:boolean;currencyMatches:boolean;
  recipientLast4:string;reportedStatus:ReportedStatus;
  providerCaseReference:string|null;note:string;reportedAt:string|null;
  submittedAt:string;
  review:null|{
    reviewId:string;reviewerUserId:string;reviewerName:string;
    decision:ReviewDecision;note:string;reviewedAt:string;
    providerAuthenticated:false;providerFinality:"NOT_ESTABLISHED";
  };
  evidenceOrigin:"MERCHANT_SUPPLIED_UNVERIFIED";
  providerAuthenticated:false;refundDestinationAuthenticated:false;
  providerFinality:"NOT_ESTABLISHED";canMarkPaid:false;
  payoutStatusUnchanged:true;
};
type EvidenceHistory={
  refundId:string;refundStatus:"PENDING"|"FAILED"|"SUCCEEDED";
  expectedAmountMinor:number;expectedCurrency:string;electronicRefund:boolean;
  items:EvidenceClaim[];hasMore:boolean;offset:number;
  evidenceOrigin:"MERCHANT_SUPPLIED_UNVERIFIED";
  providerFinality:"NOT_ESTABLISHED";canMarkPaid:false;
};
const PROVIDERS:readonly {value:Provider;label:string}[]=[
  {value:"HUBTEL",label:"Hubtel"},{value:"PAYSTACK",label:"Paystack"},
  {value:"FLUTTERWAVE",label:"Flutterwave"},{value:"OTHER",label:"Other provider"},
];
const STATUSES:readonly {value:ReportedStatus;label:string}[]=[
  {value:"CLAIMED_SUCCESS",label:"Provider document says completed (unverified)"},
  {value:"CLAIMED_PENDING",label:"Provider document says pending"},
  {value:"CLAIMED_FAILED",label:"Provider document says failed"},
];
const REVIEWS:readonly {value:ReviewDecision;label:string}[]=[
  {value:"PROVIDER_CONFIRMATION_NEEDED",label:"Requires independent provider confirmation"},
  {value:"DISCREPANCY_RECORDED",label:"Discrepancy in the submitted evidence"},
  {value:"FIELDS_MATCHED_UNVERIFIED",label:"Amount and currency match (still unverified)"},
];
const PAGE_SIZE=20;

// Monetary values are parsed as exact decimal strings, never floating-point
// multiplication. ISO 4217 currency-specific fraction digits are respected.
export function moneyToMinor(value:string,currencyCode:string):number|null {
  let decimals=2;
  try{
    decimals=new Intl.NumberFormat("en",{style:"currency",
      currency:currencyCode}).resolvedOptions().maximumFractionDigits??2;
  }catch{return null;}
  const match=/^(0|[1-9][0-9]{0,14})(?:\.([0-9]{1,3}))?$/.exec(value.trim());
  if(!match||decimals>3||decimals<0)return null;
  const fraction=match[2]??"";
  if(fraction.length>decimals)return null;
  const scale=10n**BigInt(decimals);
  const amount=BigInt(match[1]!)*scale+
    BigInt(fraction.padEnd(decimals,"0")||"0");
  if(amount<=0n||amount>BigInt(Number.MAX_SAFE_INTEGER))return null;
  return Number(amount);
}
function displayMajor(minor:number,currencyCode:string) {
  try {
    const decimals=new Intl.NumberFormat("en",{style:"currency",
      currency:currencyCode}).resolvedOptions().maximumFractionDigits??2;
    const scale=10**decimals;
    return (minor/scale).toFixed(decimals);
  }catch{return "";}
}
export function RefundProviderEvidencePanel({refundId,onRecorded}:{
  refundId:string;onRecorded?:()=>void;
}){
  const {session,queue,account}=useWorkspace();
  const [offset,setOffset]=useState(0);
  const [provider,setProvider]=useState<Provider>("HUBTEL");
  const [providerRef,setProviderRef]=useState("");
  const [reportedStatus,setReportedStatus]=useState<ReportedStatus>("CLAIMED_PENDING");
  const [sameAmount,setSameAmount]=useState(true);
  const [amountMajor,setAmountMajor]=useState("");
  const [currencyOverride,setCurrencyOverride]=useState("");
  const [recipientLast4,setRecipientLast4]=useState("");
  const [caseRef,setCaseRef]=useState("");
  const [note,setNote]=useState("");
  const [reportedTime,setReportedTime]=useState("");
  const [saving,setSaving]=useState(false);
  const [errorMessage,setErrorMessage]=useState<string|null>(null);
  const [successMessage,setSuccessMessage]=useState<string|null>(null);
  const submissionId=useRef<string|null>(null);
  const [reviewTarget,setReviewTarget]=useState<string|null>(null);
  const [decision,setDecision]=useState<ReviewDecision>("PROVIDER_CONFIRMATION_NEEDED");
  const [reviewNote,setReviewNote]=useState("");
  const [reviewSaving,setReviewSaving]=useState(false);
  const reviewId=useRef<string|null>(null);
  const path=session
    ? `/v1/refunds/provider-evidence?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&refundId=${encodeURIComponent(refundId)}&limit=${PAGE_SIZE}&offset=${offset}`
    : null;
  const {data,loading,error,refetch}=useApiFetch<EvidenceHistory>(path);
  const history=data?.refundId===refundId &&
    data.providerFinality==="NOT_ESTABLISHED" &&
    data.canMarkPaid===false &&
    data.evidenceOrigin==="MERCHANT_SUPPLIED_UNVERIFIED" &&
    Array.isArray(data.items) &&
    Number.isSafeInteger(data.expectedAmountMinor) &&
    data.expectedAmountMinor>0 &&
    /^[A-Z]{3}$/.test(data.expectedCurrency) &&
    data.items.every(item=>item.refundId===refundId &&
      item.evidenceOrigin==="MERCHANT_SUPPLIED_UNVERIFIED" &&
      item.providerAuthenticated===false &&
      item.refundDestinationAuthenticated===false &&
      item.providerFinality==="NOT_ESTABLISHED" &&
      item.canMarkPaid===false && item.payoutStatusUnchanged===true &&
      Number.isSafeInteger(item.reportedAmountMinor) &&
      item.reportedAmountMinor>0 &&
      (!item.review||
        (item.review.providerAuthenticated===false &&
          item.review.providerFinality==="NOT_ESTABLISHED")))
    ? data:null;
  const currency=(currencyOverride||history?.expectedCurrency||"").toUpperCase();
  const claimedMinor=sameAmount?history?.expectedAmountMinor??null:
    moneyToMinor(amountMajor,currency);
  const claimReady=Boolean(
    history?.electronicRefund &&
    history.refundStatus!=="SUCCEEDED" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,139}$/.test(providerRef.trim()) &&
    !providerRef.includes("://") &&
    /^[A-Za-z0-9]{4}$/.test(recipientLast4.trim()) &&
    /^[A-Z]{3}$/.test(currency) &&
    claimedMinor!==null && claimedMinor>0 &&
    note.trim().length>=20 && note.trim().length<=700 &&
    (caseRef.trim()===""||(/^[A-Za-z0-9][A-Za-z0-9 _.:/-]{5,139}$/.test(caseRef.trim()) &&
      !caseRef.includes("://")))
  );
  const idBase="refund-proof-"+refundId;
  function changed(){
    submissionId.current=null;
    setErrorMessage(null);setSuccessMessage(null);
  }
  async function submitClaim(){
    if(!session||!queue.online||saving||!claimReady||!history||!claimedMinor)return;
    const clientRequestId=submissionId.current??crypto.randomUUID();
    submissionId.current=clientRequestId;
    setSaving(true);setErrorMessage(null);setSuccessMessage(null);
    try{
      const resp=await getOfflineQueue().authenticatedFetch(
        "/v1/refunds/provider-evidence",{
          method:"POST",cache:"no-store",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            businessId:session.businessId,branchId:session.branchId,refundId,
            clientRequestId,providerCode:provider,providerReference:providerRef.trim(),
            reportedAmountMinor:claimedMinor,reportedCurrency:currency,
            recipientLast4:recipientLast4.trim(),reportedStatus,
            providerCaseReference:caseRef.trim()||null,note:note.trim(),
            ...(reportedTime?{reportedAt:new Date(reportedTime).toISOString()}:{}),
          }),
        });
      if(!resp.ok)throw new Error(await readApiErrorMessage(resp));
      const result=await resp.json() as {claim?:EvidenceClaim};
      if(result.claim?.refundId!==refundId ||
        result.claim.evidenceOrigin!=="MERCHANT_SUPPLIED_UNVERIFIED" ||
        result.claim.providerAuthenticated!==false ||
        result.claim.canMarkPaid!==false)
        throw new Error("Evidence response could not be verified. Refresh history.");
      submissionId.current=null;
      setProviderRef("");setRecipientLast4("");setCaseRef("");setNote("");
      setReportedTime("");setSameAmount(true);setAmountMajor("");
      setCurrencyOverride("");setReportedStatus("CLAIMED_PENDING");
      setSuccessMessage("Evidence claim recorded for independent review. Not a confirmed payout.");
      if(offset!==0)setOffset(0);else refetch();
      onRecorded?.();
    }catch(e){setErrorMessage(e instanceof Error?e.message:"Could not save evidence claim.");}
    finally{setSaving(false);}
  }
  function selectReview(claimId:string){
    setReviewTarget(claimId);setDecision("PROVIDER_CONFIRMATION_NEEDED");
    setReviewNote("");reviewId.current=null;setErrorMessage(null);
    setSuccessMessage(null);
  }
  async function submitReview(claimId:string){
    if(!session||!queue.online||reviewSaving ||
       reviewNote.trim().length<20||reviewNote.trim().length>700)return;
    const clientRequestId=reviewId.current??crypto.randomUUID();
    reviewId.current=clientRequestId;
    setReviewSaving(true);setErrorMessage(null);setSuccessMessage(null);
    try{
      const resp=await getOfflineQueue().authenticatedFetch(
        "/v1/refunds/provider-evidence-review",{
          method:"POST",cache:"no-store",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            businessId:session.businessId,branchId:session.branchId,refundId,
            claimId,clientRequestId,decision,note:reviewNote.trim(),
          }),
        });
      if(!resp.ok)throw new Error(await readApiErrorMessage(resp));
      const result=await resp.json() as {
        review?:{providerAuthenticated?:boolean;providerFinality?:string};
        providerFinality?:string;canMarkPaid?:boolean;
      };
      if(!result.review||result.review.providerAuthenticated!==false||
          result.providerFinality!=="NOT_ESTABLISHED"||
          result.canMarkPaid!==false)
        throw new Error("Evidence review was not confirmed. Refresh the history.");
      reviewId.current=null;setReviewTarget(null);setReviewNote("");
      setSuccessMessage("Second-person review recorded. Provider settlement remains unverified.");
      refetch();
      onRecorded?.();
    }catch(e){setErrorMessage(e instanceof Error?e.message:"Could not record review.");}
    finally{setReviewSaving(false);}
  }
  return <section className="tos-card tos-card--padded"
    aria-label="Provider payout evidence review" style={{marginTop:14}}>
    <h3 className="tos-section__title">Provider payout evidence review</h3>
    <p className="tos-section__sub">
      Record a reference shown on a provider statement, receipt, or support case.
      This is merchant-submitted information, NOT an authenticated provider payout.
      A separate finance reviewer can examine discrepancies, but cannot mark it paid.
      Never enter full account numbers, card details, API keys, or passwords.
    </p>
    {loading?<p className="tos-section__sub" role="status">Loading evidence records…</p>:null}
    {error?<StatePanel inline variant="error" title="Could not load provider evidence"
      text={error} actionLabel="Retry" onAction={refetch}/>:null}
    {!loading&&!error&&data&&!history?<p role="alert" className="tos-section__sub">
      Evidence response was incomplete or unsafe. Payout verification is unavailable.
    </p>:null}
    {history?<>
      <p className="tos-section__sub" style={{fontWeight:700,marginTop:10}}>
        Expected refund: <MoneyValue minor={history.expectedAmountMinor}
          currencyCode={history.expectedCurrency} /> · {history.refundStatus}
      </p>
      {history.electronicRefund&&history.refundStatus!=="SUCCEEDED"?<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",
          gap:12,marginTop:12}}>
          <div>
            <label htmlFor={idBase+"-provider"}>Payment provider</label>
            <select id={idBase+"-provider"} className="tos-input" value={provider}
              style={{display:"block",width:"100%"}} disabled={saving}
              onChange={e=>{setProvider(e.target.value as Provider);changed();}}>
              {PROVIDERS.map(p=><option value={p.value} key={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={idBase+"-ref"}>Claimed provider refund reference</label>
            <input id={idBase+"-ref"} className="tos-input" type="text" maxLength={140}
              style={{display:"block",width:"100%"}} value={providerRef}
              placeholder="Provider refund transaction ID"
              disabled={saving}
              onChange={e=>{setProviderRef(e.target.value);changed();}}/>
          </div>
          <div>
            <label htmlFor={idBase+"-status"}>Provider document says</label>
            <select id={idBase+"-status"} className="tos-input" value={reportedStatus}
              style={{display:"block",width:"100%"}} disabled={saving}
              onChange={e=>{setReportedStatus(e.target.value as ReportedStatus);changed();}}>
              {STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={idBase+"-last4"}>Recipient destination — final four only</label>
            <input id={idBase+"-last4"} className="tos-input" type="text"
              maxLength={4} style={{display:"block",width:"100%"}}
              placeholder="Last 4 characters" value={recipientLast4}
              disabled={saving} onChange={e=>{setRecipientLast4(e.target.value);changed();}} />
          </div>
        </div>
        <label style={{display:"flex",alignItems:"center",gap:8,marginTop:12}}>
          <input type="checkbox" checked={sameAmount} disabled={saving}
            onChange={e=>{setSameAmount(e.target.checked);changed();}}/>
          Provider document claims the expected refund amount
        </label>
        {!sameAmount?<div style={{display:"grid",
          gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12,marginTop:10}}>
          <div>
            <label htmlFor={idBase+"-amount"}>Claimed amount (e.g. 25.50)</label>
            <input id={idBase+"-amount"} className="tos-input" type="text"
              inputMode="decimal" value={amountMajor} disabled={saving}
              style={{display:"block",width:"100%"}}
              placeholder={displayMajor(history.expectedAmountMinor,history.expectedCurrency)}
              onChange={e=>{setAmountMajor(e.target.value);changed();}}/>
          </div>
          <div>
            <label htmlFor={idBase+"-currency"}>Claimed currency (ISO code)</label>
            <input id={idBase+"-currency"} className="tos-input"
              maxLength={3} type="text" disabled={saving}
              style={{display:"block",width:"100%"}}
              value={currencyOverride||history.expectedCurrency}
              onChange={e=>{setCurrencyOverride(e.target.value.toUpperCase());changed();}}/>
          </div>
        </div>:null}
        <div style={{display:"grid",
          gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12,marginTop:12}}>
          <div>
            <label htmlFor={idBase+"-case"}>Provider support case (optional)</label>
            <input id={idBase+"-case"} className="tos-input"
              style={{display:"block",width:"100%"}} type="text" maxLength={140}
              placeholder="Support case reference — no URL" value={caseRef}
              disabled={saving} onChange={e=>{setCaseRef(e.target.value);changed();}}/>
          </div>
          <div>
            <label htmlFor={idBase+"-date"}>Reported date/time (optional)</label>
            <input id={idBase+"-date"} className="tos-input" type="datetime-local"
              style={{display:"block",width:"100%"}} value={reportedTime}
              disabled={saving} onChange={e=>{setReportedTime(e.target.value);changed();}}/>
          </div>
        </div>
        <label htmlFor={idBase+"-note"} style={{display:"block",marginTop:12}}>
          Where was this reference obtained? (20–700 characters)
        </label>
        <textarea id={idBase+"-note"} className="tos-input" maxLength={700}
          rows={3} style={{display:"block",width:"100%",marginBottom:10}}
          value={note} disabled={saving}
          placeholder="Describe the external statement or support response; do not paste credentials or full recipient details."
          onChange={e=>{setNote(e.target.value);changed();}}/>
        <div className="tos-row" style={{gap:8,flexWrap:"wrap"}}>
          <Button size="sm" variant="primary" loading={saving}
            disabled={!queue.online||!claimReady}
            onClick={()=>void submitClaim()}>Submit unverified evidence</Button>
          <Button size="sm" variant="outline" onClick={refetch}>Refresh evidence</Button>
          {!queue.online?<span className="tos-section__sub" role="status">
            Online connection required. Claims cannot be queued offline.
          </span>:null}
        </div>
      </>:<p className="tos-section__sub">
        This is not an unresolved electronic refund. New provider claims are disabled.
      </p>}
      {errorMessage?<p role="alert" className="tos-section__sub">{errorMessage}</p>:null}
      {successMessage?<p role="status" className="tos-section__sub">{successMessage}</p>:null}
      <div style={{marginTop:16}}>
        <strong>Submitted evidence and independent reviews</strong>
        {history.items.length===0?<p className="tos-section__sub">
          No provider evidence claims have been recorded yet.
        </p>:null}
        {history.items.length>0?<ol className="tos-list-cards">
          {history.items.map(item=>{
            const matched=item.amountMatches&&item.currencyMatches;
            const canReview=!item.review&&
              Boolean(account&&account.id!==item.submittedByUserId)&&
              history.refundStatus!=="SUCCEEDED";
            return <li key={item.claimId} className="tos-returnable-card">
              <div className="tos-row" style={{gap:10,
                alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:0}}>
                  <strong style={{overflowWrap:"anywhere"}}>
                    {item.providerCode} · {item.providerReference}</strong>
                  <p className="tos-section__sub">
                    Reported {new Date(item.submittedAt).toLocaleString()}
                    {" · "}Submitted by {item.submittedByName}</p>
                </div>
                <span className={"tos-badge "+(matched
                  ?"tos-badge--neutral":"tos-badge--danger")}>
                  {matched?"Amount/currency match — unverified":"Mismatch — investigate"}
                </span>
              </div>
              <div className="tos-row" style={{gap:12,flexWrap:"wrap",marginTop:8}}>
                <span>Claimed: <MoneyValue minor={item.reportedAmountMinor}
                  currencyCode={item.reportedCurrency}/></span>
                <span>Recipient: ****{item.recipientLast4}</span>
                <span>{STATUSES.find(s=>s.value===item.reportedStatus)?.label
                  ??"Claimed provider status"}</span>
              </div>
              <p style={{overflowWrap:"anywhere",whiteSpace:"pre-wrap"}}>{item.note}</p>
              {item.providerCaseReference?<span className="tos-section__sub">
                Support case: {item.providerCaseReference}
              </span>:null}
              {item.review?<div className="tos-card tos-card--padded"
                style={{marginTop:10}}>
                <strong>Independent review: {REVIEWS.find(
                  r=>r.value===item.review?.decision)?.label??"Needs verification"}</strong>
                <p className="tos-section__sub">
                  {item.review.reviewerName} · {new Date(item.review.reviewedAt).toLocaleString()}
                </p>
                <p style={{overflowWrap:"anywhere",whiteSpace:"pre-wrap"}}>
                  {item.review.note}</p>
                <strong className="tos-section__sub">
                  Provider-authenticated refund settlement: NOT established
                </strong>
              </div>:canReview?<div style={{marginTop:10}}>
                {reviewTarget!==item.claimId?
                  <Button size="sm" variant="outline" onClick={()=>selectReview(item.claimId)}>
                    Second-person evidence review
                  </Button>:<>
                    <label htmlFor={idBase+"-review-"+item.claimId}>
                      Review decision (not payment approval)
                    </label>
                    <select id={idBase+"-review-"+item.claimId} className="tos-input"
                      value={decision} disabled={reviewSaving}
                      style={{display:"block",width:"100%",marginTop:5,marginBottom:10}}
                      onChange={e=>{setDecision(e.target.value as ReviewDecision);
                        reviewId.current=null;}}>
                      {REVIEWS.filter(r=>r.value!=="FIELDS_MATCHED_UNVERIFIED"||matched)
                        .map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    <label htmlFor={idBase+"-review-note-"+item.claimId}>
                      Independent review notes (20–700 characters)
                    </label>
                    <textarea id={idBase+"-review-note-"+item.claimId}
                      className="tos-input" rows={3} maxLength={700}
                      style={{display:"block",width:"100%",marginTop:5,marginBottom:10}}
                      value={reviewNote} disabled={reviewSaving}
                      onChange={e=>{setReviewNote(e.target.value);reviewId.current=null;}}/>
                    <div className="tos-row" style={{gap:8,flexWrap:"wrap"}}>
                      <Button size="sm" variant="primary" loading={reviewSaving}
                        disabled={!queue.online||reviewNote.trim().length<20}
                        onClick={()=>void submitReview(item.claimId)}>Record review</Button>
                      <Button size="sm" variant="outline" disabled={reviewSaving}
                        onClick={()=>{setReviewTarget(null);reviewId.current=null;}}>
                        Cancel</Button>
                    </div>
                  </>}
              </div>:!item.review?<p className="tos-section__sub">
                This claim must be reviewed by a different authorized team member.
              </p>:null}
            </li>;
          })}
        </ol>:null}
        {offset>0||history.hasMore?<div className="tos-row"
          style={{justifyContent:"space-between",alignItems:"center",marginTop:10}}>
          <Button size="sm" variant="outline" disabled={offset===0||loading}
            onClick={()=>setOffset(v=>Math.max(0,v-PAGE_SIZE))}>Previous</Button>
          <span className="tos-section__sub">Page {Math.floor(offset/PAGE_SIZE)+1}</span>
          <Button size="sm" variant="outline" disabled={!history.hasMore||loading}
            onClick={()=>setOffset(v=>v+PAGE_SIZE)}>Next</Button>
        </div>:null}
      </div>
    </>:null}
    <p className="tos-section__sub" style={{marginTop:12}}>
      Finality rule: these documents and human reviews are untrusted until the
      payout provider independently authenticates this specific refund's
      transaction ID, amount, currency, and intended destination.
    </p>
  </section>;
}
