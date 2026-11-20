"use client";

import { useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { HubtelCancellationPreflightPanel } from "./hubtel-cancellation-preflight-panel";
import styles from "./hubtel-reconciliation-workspace.module.css";

type Outcome = "ALL" | "PENDING" | "PAID" | "OTHER";
type Investigation = {
  reviewId:string;saleId:string;branchId:string;requestedAt:string;
  reason:string;saleStatus:string;paymentStatus:string;checkoutState:string;
  amountMinor:number;currencyCode:string;outcome:Exclude<Outcome,"ALL">;
  providerFinality:"NOT_ESTABLISHED";canReleaseStock:false;
};
type Worklist = {
  scope:"BRANCH_ALL_TIME";
  cases:Investigation[];
  summary:{total:number;pending:number;paid:number;other:number};
  outcome:Outcome;offset:number;limit:number;filteredCount:number;hasMore:boolean;
};
const PAGE_SIZE=10;
const outcomeNames:Record<Outcome,string>={
  ALL:"All investigations",
  PENDING:"Payment still pending",
  PAID:"Payment confirmed after request",
  OTHER:"Other payment status",
};
function shortDate(value:string):string {
  const parsed=new Date(value);
  if(!Number.isFinite(parsed.getTime()))return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB",{
    timeZone:"Africa/Accra",day:"2-digit",month:"short",year:"numeric",
    hour:"2-digit",minute:"2-digit",
  }).format(parsed);
}

/** Older investigation cases are independent of the latest 50 checkout attempts. */
export function HubtelCancellationInvestigationQueue({
  businessId,branchId,online,
}:{businessId:string;branchId:string;online:boolean}) {
  const [outcome,setOutcome]=useState<Outcome>("ALL");
  const [offset,setOffset]=useState(0);
  const [expandedSaleId,setExpandedSaleId]=useState<string|null>(null);
  const path="/v1/payments/hubtel/cancellation-investigations?"+
    `businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}`+
    `&limit=${PAGE_SIZE}&offset=${offset}&outcome=${outcome}`;
  const {data,error,loading,refetch}=useApiFetch<Worklist>(path);
  const valid=data?.scope==="BRANCH_ALL_TIME" &&
    data.outcome===outcome && data.offset===offset &&
    data.limit===PAGE_SIZE && Array.isArray(data.cases) &&
    data.summary && ["total","pending","paid","other"].every(key=>
      Number.isSafeInteger(data.summary[key as keyof Worklist["summary"]]) &&
      data.summary[key as keyof Worklist["summary"]]>=0);
  return <section className={styles.investigations} aria-label="Provider cancellation investigations">
    <header className={styles.impactHead}>
      <div>
        <h2>Provider cancellation investigations</h2>
        <p>All-time branch worklist, including older requests no longer in the recent checkout list.
          Requests do not cancel payments, restore stock or prove a provider void.</p>
      </div>
      <button type="button" className={styles.secondary} onClick={refetch}
        disabled={loading}>Refresh cases</button>
    </header>
    {valid && data ? (
      <div className={styles.investigationStats}>
        <div><span>Total cases</span><strong>{data.summary.total}</strong></div>
        <div><span>Still unpaid</span><strong>{data.summary.pending}</strong></div>
        <div><span>Payment since confirmed</span><strong>{data.summary.paid}</strong></div>
        <div><span>Other states</span><strong>{data.summary.other}</strong></div>
      </div>
    ) : null}
    <div className={styles.investigationFilters}>
      <label htmlFor="hubtel-investigation-outcome">Show</label>
      <select id="hubtel-investigation-outcome" value={outcome}
        onChange={event=>{
          setOutcome(event.target.value as Outcome);
          setOffset(0);
          setExpandedSaleId(null);
        }}>
        {(Object.keys(outcomeNames) as Outcome[]).map(value=>
          <option key={value} value={value}>{outcomeNames[value]}</option>)}
      </select>
    </div>
    {loading ? <p role="status">Loading investigation cases…</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {data && !valid ? <p role="alert" className={styles.error}>
      The provider investigation worklist could not be verified. Do not assume
      older payment holds have cleared.
    </p> : null}
    {valid && data && !loading ? <>
      {data.cases.length===0 ? <p className={styles.empty}>
        No matching cancellation investigations for this branch.
      </p> : (
        <div className={styles.investigationList}>
          {data.cases.map(item=>(
            <article className={styles.investigationCase} key={item.reviewId}>
              <div className={styles.itemHeader}>
                <div>
                  <strong>Case {item.reviewId.slice(0,8).toUpperCase()}</strong>
                  <span className={styles.itemDate}>
                    Sale {item.saleId.slice(0,8).toUpperCase()} · {shortDate(item.requestedAt)}
                  </span>
                </div>
                <span className={item.outcome==="PENDING" ? styles.warning : styles.state}>
                  {item.outcome==="PAID"?"Payment confirmed" :
                    item.outcome==="PENDING"?"Unresolved payment":"Needs status review"}
                </span>
              </div>
              <div className={styles.investigationDetails}>
                <span><strong>{formatMoney(item.amountMinor,item.currencyCode)}</strong>
                  {" · "}{item.saleStatus} sale / {item.paymentStatus} payment</span>
                <span>Checkout: {item.checkoutState.replaceAll("_"," ").toLowerCase()}</span>
              </div>
              <p className={styles.investigationReason}>{item.reason}</p>
              <p className={styles.review}>
                {item.outcome==="PAID"?
                  "The payment was independently confirmed after this investigation was requested. Keep the case for audit; no stock restoration is authorised.":
                  "The provider has not established irreversible cancellation. Do not return stock or adjust payments based on this request."}
              </p>
              <div className={styles.actions}>
                <button type="button" className={styles.secondary}
                  onClick={()=>setExpandedSaleId(current=>
                    current===item.saleId?null:item.saleId)}>
                  {expandedSaleId===item.saleId?"Close stock review":"Review sale and stock"}
                </button>
              </div>
              {expandedSaleId===item.saleId ? (
                <HubtelCancellationPreflightPanel
                  businessId={businessId} saleId={item.saleId} online={online}
                  onClose={()=>setExpandedSaleId(null)}
                  onInvestigationSubmitted={refetch}/>
              ) : null}
            </article>
          ))}
        </div>
      )}
      <div className={styles.investigationPagination}>
        <span>Showing {data.cases.length===0?0:offset+1}–
          {offset+data.cases.length} of {data.filteredCount} matching cases</span>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary}
            disabled={offset===0 || loading}
            onClick={()=>{setOffset(n=>Math.max(0,n-PAGE_SIZE));setExpandedSaleId(null);}}>
            Previous
          </button>
          <button type="button" className={styles.secondary}
            disabled={!data.hasMore || loading}
            onClick={()=>{setOffset(n=>n+PAGE_SIZE);setExpandedSaleId(null);}}>
            Next
          </button>
        </div>
      </div>
    </> : null}
  </section>;
}
