"use client";
import { useActionFeedbackMessages } from "../../components/action-feedback";

import { confirmAction } from "../../components/action-dialog";

import {useMemo,useState,type FormEvent} from "react";
import Link from "next/link";
import {PageHeader,Banner,Section} from
  "../../components/admin-ui";
import {IconInfo,IconRefresh} from
  "../../components/icons";
import {usePlatformAdminSession,useAdminResource} from
  "../../components/platform-admin-session";

type ReviewStatus="APPROVED"|"REJECTED"|"PENDING";
type Review={
  businessId:string;businessName:string;countryCode:string;
  currencyCode:string;providerCode:"HUBTEL";
  merchantCredentialStatus:string;credentialRevision:number;
  collectionAccount:string|null;activationRequested:boolean;
  legacyCollectionAccount:string|null;legacyAccountApproval:string|null;
  reviewVersion:number;reviewStatus:ReviewStatus;
  evidenceReference:string|null;reviewRationale:string|null;
  beneficiaryOwnershipConfirmed:boolean;reviewedAt:string|null;
  collectionEnabled:false;
};
type ResponseBody={reviews:Review[];collectionEnabled:false};
type Decision="APPROVED"|"REJECTED";
const COLORED:Record<ReviewStatus,string>={
  PENDING:"Awaiting review",APPROVED:"Evidence approved",
  REJECTED:"Not approved",
};
export default function HubtelMerchantReviewsPage(){
  const {apiFetch,adminUser}=usePlatformAdminSession();
  const resource=useAdminResource<ResponseBody>(
    "/api/admin/payments/hubtel/merchant-accounts");
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState<"ALL"|ReviewStatus>("ALL");
  const [selected,setSelected]=useState<string|null>(null);
  const [decision,setDecision]=useState<Decision>("APPROVED");
  const [evidence,setEvidence]=useState("");
  const [rationale,setRationale]=useState("");
  const [beneficiaryConfirmed,setBeneficiaryConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  useActionFeedbackMessages(success,error);
  const canReview=adminUser?.role==="SUPER_ADMIN"||
    adminUser?.role==="PLATFORM_ADMIN";
  const all=resource.data?.reviews??[];
  const rows=useMemo(()=>all.filter(item=>{
    const match=filter==="ALL"||item.reviewStatus===filter;
    const term=search.trim().toLowerCase();
    return match&&(!term||
      item.businessName.toLowerCase().includes(term)||
      item.businessId.toLowerCase().includes(term)||
      (item.collectionAccount??"").includes(term));
  }),[all,filter,search]);
  const counts={
    pending:all.filter(r=>r.reviewStatus==="PENDING").length,
    approved:all.filter(r=>r.reviewStatus==="APPROVED").length,
    rejected:all.filter(r=>r.reviewStatus==="REJECTED").length,
  };
  const current=all.find(r=>r.businessId===selected);
  function choose(row:Review){
    setSelected(row.businessId);
    setDecision("APPROVED");
    setEvidence("");
    setRationale("");
    setBeneficiaryConfirmed(false);
    setError(null);setSuccess(null);
  }
  async function submit(event:FormEvent){
    event.preventDefault();
    if(!current||!canReview||busy||!evidence.trim()||
       rationale.trim().length<12||
       (decision==="APPROVED"&&!beneficiaryConfirmed))return;
    const action=decision==="APPROVED"?"approve":"reject";
    if(!await confirmAction("Confirm that you want to "+action+
      " this merchant's Hubtel beneficiary evidence? "+
      "This creates an immutable audit record. It does not activate payments."))
      return;
    setBusy(true);setError(null);setSuccess(null);
    try{
      const response=await apiFetch(
        "/api/admin/payments/hubtel/merchant-accounts/"+
          encodeURIComponent(current.businessId)+"/review",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          decision,evidenceReference:evidence.trim(),
          rationale:rationale.trim(),
          beneficiaryOwnershipConfirmed:decision==="APPROVED"?
            beneficiaryConfirmed:false,
          expectedCredentialRevision:current.credentialRevision,
          expectedReviewVersion:current.reviewVersion,
        }),
      });
      const body=await response.json().catch(()=>({})) as {
        review?:{reviewStatus:ReviewStatus};message?:string;
      };
      if(!response.ok||!body.review)throw new Error(
        body.message??"The account review was not recorded.");
      setSuccess("Account review recorded as "+COLORED[body.review.reviewStatus]+
        ". Live collections remain disabled.");
      setSelected(null);setEvidence("");setRationale("");
      setBeneficiaryConfirmed(false);
      await resource.reload();
    }catch(cause){
      setError(cause instanceof Error?cause.message:
        "Could not record the account review.");
    }finally{setBusy(false);}
  }
  return <div className="admin-page">
    <PageHeader eyebrow="Merchant payment oversight"
      title="Hubtel merchant accounts"
      subtitle="Review business-owned collection-account evidence before a separate payment-activation release."/>
    <Banner tone="warning" icon={IconInfo}
      title="Approval is not payment activation">
      <span className="admin-banner__text">
        Saving or verifying API credentials does not authorize checkout.
        Confirm the exact collection beneficiary from independent merchant
        documentation. Approval only records your decision; live collections
        remain disabled.
      </span>
    </Banner>
    <Section title="Merchant review queue"
      sub="Only verified Hubtel LIVE accounts that have requested activation appear here. No API keys or secrets are displayed."
      actions={<button className="admin-secondary-button" type="button"
        disabled={resource.loading||busy}
        onClick={()=>void resource.reload()}>
        <IconRefresh style={{width:16,height:16,verticalAlign:"middle",marginRight:6}}/>
        Refresh
      </button>}>
      <div className="admin-billing-toolbar">
        <input className="admin-field__input" type="search"
          aria-label="Find a business or collection account"
          placeholder="Business name or collection account…"
          value={search} onChange={e=>setSearch(e.target.value)}/>
        <label style={{display:"flex",gap:8,alignItems:"center"}}>
          <span>Review status</span>
          <select className="admin-field__input" value={filter}
            onChange={e=>setFilter(e.target.value as "ALL"|ReviewStatus)}>
            <option value="ALL">All</option>
            <option value="PENDING">Awaiting review</option>
            <option value="APPROVED">Approved evidence</option>
            <option value="REJECTED">Not approved</option>
          </select>
        </label>
        <span>{counts.pending} pending · {counts.approved} approved ·
          {" "}{counts.rejected} rejected</span>
      </div>
      {resource.loading?<div className="admin-api-state" role="status">
        Loading merchant account reviews…</div>:null}
      {resource.error?<div className="admin-api-state admin-api-state--error"
        role="alert">{resource.error}</div>:null}
      {!resource.loading&&!resource.error&&rows.length===0?
        <div className="admin-api-state">No merchant accounts match this
          filter. An owner must verify Hubtel API access and request activation
          before their account appears here.</div>:null}
      <div className="admin-billing-grid">
        {rows.map(row=><article className="admin-billing-card" key={row.businessId}>
          <div className="admin-billing-card__head">
            <div><strong>{row.businessName}</strong>
              <small>{row.countryCode} ·
                {" "+row.currencyCode} · Hubtel LIVE</small></div>
            <span className="admin-ai-role">{COLORED[row.reviewStatus]}</span>
          </div>
          <div className="admin-billing-detail">
            <div><span>Collection account</span>
              <strong>{row.collectionAccount??"Not saved"}</strong></div>
            <div><span>Credential revision</span>
              <strong>{row.credentialRevision}</strong></div>
            <div><span>Activation request</span>
              <strong>{row.activationRequested?"Received":"Missing"}</strong>
            </div>
          </div>
          <p>Independent API access:
            <strong>{" "+row.merchantCredentialStatus.replaceAll("_"," ")}</strong>
          </p>
          {row.reviewedAt&&row.reviewStatus!=="PENDING"?
            <p>Review recorded {new Date(row.reviewedAt).toLocaleString()}.
              {" "}Evidence reference: {row.evidenceReference}</p>:null}
          {row.legacyCollectionAccount&&
            row.legacyCollectionAccount!==row.collectionAccount?
            <p role="alert" className="admin-billing-error">
              Previous Hubtel collection account differs. Existing payments
              require original-account reconciliation before a new approval.
            </p>:null}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <Link className="admin-secondary-button"
              href={"/console/tenants/"+row.businessId}>
              View tenant
            </Link>
            {canReview?<button className="admin-primary-button" type="button"
              disabled={busy} onClick={()=>choose(row)}>
              Review evidence
            </button>:null}
          </div>
        </article>)}
      </div>
      {current&&canReview?<form className="admin-admin-card"
        onSubmit={e=>void submit(e)} style={{marginTop:16}}>
        <div className="admin-admin-card__head">
          <div><strong>Review: {current.businessName}</strong>
            <small>Collection account {current.collectionAccount} ·
              Credential revision {current.credentialRevision}</small></div>
        </div>
        <p>You must personally review independent merchant beneficiary
          evidence. An API balance check is not proof of account ownership.</p>
        <div className="admin-billing-form">
          <label className="admin-auth-field">
            <span>Decision</span>
            <select className="admin-field__input" value={decision}
              onChange={e=>{setDecision(e.target.value as Decision);
                setBeneficiaryConfirmed(false);}}>
              <option value="APPROVED">Approve evidence</option>
              <option value="REJECTED">Reject evidence</option>
            </select>
          </label>
          <label className="admin-auth-field">
            <span>Internal evidence or case reference</span>
            <input className="admin-field__input" value={evidence}
              maxLength={180} required
              placeholder="Approved document / review case ID"
              onChange={e=>setEvidence(e.target.value)}/>
          </label>
          <label className="admin-auth-field admin-billing-form__wide">
            <span>Review rationale (at least 12 characters)</span>
            <textarea className="admin-field__input admin-billing-textarea"
              required minLength={12} maxLength={500} value={rationale}
              onChange={e=>setRationale(e.target.value)}
              placeholder="Record the beneficiary checks completed and why this decision was reached."/>
          </label>
        </div>
        {decision==="APPROVED"?<label className="admin-billing-checks">
          <input type="checkbox" checked={beneficiaryConfirmed}
            onChange={e=>setBeneficiaryConfirmed(e.target.checked)}/>
          I have independently checked the merchant's beneficial ownership
          and the exact Hubtel collection-account number against evidence.
        </label>:null}
        {error?<p className="admin-billing-error" role="alert">{error}</p>:null}
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button type="submit" className="admin-primary-button"
            disabled={busy||!evidence.trim()||rationale.trim().length<12||
              (decision==="APPROVED"&&!beneficiaryConfirmed)}>
            {busy?"Recording review…":
              decision==="APPROVED"?"Record approval (no charging)":
              "Record rejection"}
          </button>
          <button type="button" className="admin-secondary-button"
            disabled={busy} onClick={()=>{setSelected(null);setError(null);}}>
            Cancel
          </button>
        </div>
      </form>:null}
      {!canReview?<div className="admin-api-state">
        Your platform role has read-only access. Only Super Admins and
        Platform Admins may record beneficiary evidence decisions.</div>:null}
      {success?<p className="admin-api-state" role="status">{success}</p>:null}
    </Section>
  </div>;
}
