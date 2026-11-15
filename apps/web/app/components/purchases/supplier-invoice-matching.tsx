"use client";

import { useMemo, useRef, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyInput } from "../ui/money-input";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import styles from "./supplier-invoice-matching.module.css";

interface Receipt {
  id:string;receivedAt:string;totalMinor:number;
  supplierReference:string|null;settlementMethod:string;
}
interface InvoiceMatch {
  id:string;invoiceReference:string;invoiceDate:string;
  status:"DRAFT"|"APPROVED"|"CANCELLED";
  invoiceTotalMinor:number;receiptTotalMinor:number;
  invoiceVarianceMinor:number;poPriceVarianceMinor:number;
  receiptCount:number;notes:string;approvalNote:string;
  hasException:boolean;approvedAt:string|null;createdAt:string;
  receipts:Array<{id:string;receivedAt:string;totalMinor:number;
    supplierReference:string|null}>;
  lines:Array<{purchaseOrderLineId:string;itemName:string;
    purchaseUnitCode:string;quantity:number;
    poUnitCostMinor:number;expectedAtOrderPriceMinor:number;
    receiptTotalMinor:number;poPriceVarianceMinor:number}>;
}
interface Props {
  purchaseOrderId:string;
  orderNumber:string;
  currencyCode:string;
  receipts:Receipt[];
  receiptCount:number;
  onUpdated:()=>void;
}
const date=(value:string)=>new Intl.DateTimeFormat("en-GB",{
  year:"numeric",month:"2-digit",day:"2-digit",timeZone:"Africa/Accra",
}).format(new Date(value));
const CREATE_ROLES=["OWNER","ADMIN","MANAGER","INVENTORY","ACCOUNTANT"];
const APPROVE_ROLES=["OWNER","ADMIN","MANAGER"];

export function SupplierInvoiceMatching({
  purchaseOrderId,orderNumber,currencyCode,receipts,receiptCount,onUpdated,
}:Props) {
  const {session,role,queue}=useWorkspace();
  const [selected,setSelected]=useState<string[]>([]);
  const [reference,setReference]=useState("");
  const [invoiceDate,setInvoiceDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [invoiceTotalMinor,setInvoiceTotalMinor]=useState<number|null>(null);
  const [notes,setNotes]=useState("");
  const [approvalNotes,setApprovalNotes]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const requestId=useRef<string|null>(null);
  const money=(value:number)=>formatMoney(value,currencyCode);
  const path=session?
    `/v1/purchase-orders/${encodeURIComponent(purchaseOrderId)}/invoice-matches?businessId=${encodeURIComponent(session.businessId)}`:null;
  const {data,loading,error:loadError,refetch}=useApiFetch<{matches:InvoiceMatch[]}>(path);
  const matches=data?.matches??[];
  const claimed=useMemo(()=>new Set(matches.filter(m=>m.status!=="CANCELLED")
    .flatMap(m=>m.receipts.map(r=>r.id))),[data]);
  const available=receipts.filter(r=>!claimed.has(r.id));
  const selectedReceipts=available.filter(r=>selected.includes(r.id));
  const receiptTotal=selectedReceipts.reduce((sum,r)=>sum+r.totalMinor,0);
  const canCreate=CREATE_ROLES.includes(role);
  const canApprove=APPROVE_ROLES.includes(role);
  const online=queue.online;
  const invalidate=()=>{requestId.current=null;setError(null);setNotice(null);};
  function toggle(receiptId:string,checked:boolean) {
    invalidate();
    setSelected(previous=>checked?[...previous,receiptId]:
      previous.filter(id=>id!==receiptId));
  }
  async function mutate(url:string,payload:unknown):Promise<unknown> {
    const response=await getOfflineQueue().authenticatedFetch(url,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),
    });
    if(!response.ok)throw new Error(await readApiErrorMessage(response));
    return response.json();
  }
  async function create() {
    if(!session||!online||!canCreate||busy||!reference.trim()||
      selectedReceipts.length<1||!Number.isSafeInteger(invoiceTotalMinor)||
      (invoiceTotalMinor??-1)<0)return;
    setBusy(true);setError(null);setNotice(null);
    requestId.current??=crypto.randomUUID();
    try {
      await mutate(`/v1/purchase-orders/${encodeURIComponent(purchaseOrderId)}/invoice-matches`,{
        businessId:session.businessId,clientRequestId:requestId.current,
        invoiceReference:reference.trim(),invoiceDate,
        invoiceTotalMinor,receiptIds:selectedReceipts.map(r=>r.id),notes,
      });
      setNotice("Supplier invoice captured as draft. Review differences before approval.");
      requestId.current=null;setSelected([]);setReference("");
      setInvoiceTotalMinor(null);setNotes("");refetch();onUpdated();
    }catch(e){setError(e instanceof Error?e.message:"Could not register supplier invoice");}
    finally{setBusy(false);}
  }
  async function transition(match:InvoiceMatch,action:"approve"|"cancel") {
    if(!session||!online||busy||!canCreate)return;
    if(action==="approve"&&!canApprove)return;
    if(action==="cancel"&&!window.confirm(`Cancel draft supplier invoice ${match.invoiceReference}? The selected receipts will become available to match again.`))return;
    const approvalNote=(approvalNotes[match.id]??"").trim();
    if(action==="approve"&&match.hasException&&approvalNote.length<12){
      setError("Enter a manager justification of at least 12 characters to approve a difference.");
      return;
    }
    setBusy(true);setError(null);setNotice(null);
    try {
      await mutate(`/v1/supplier-invoice-matches/${encodeURIComponent(match.id)}/${action}`,{
        businessId:session.businessId,...(action==="approve"?{approvalNote}:{}),
      });
      setNotice(`Supplier invoice ${match.invoiceReference} ${action==="approve"?"reviewed and approved":"draft cancelled"}.`);
      refetch();onUpdated();
    }catch(e){setError(e instanceof Error?e.message:"Could not update the invoice match");}
    finally{setBusy(false);}
  }
  return <section className={styles.workspace} aria-label="Supplier invoice reconciliation">
    <div className={styles.heading}>
      <div><p className={styles.eyebrow}>Purchasing · Invoice control</p>
        <h2>Match supplier invoices</h2>
        <p>Compare the supplier invoice against {orderNumber}, its ordered prices,
          and actual goods receipts. Matching does not post another payable or payment.</p>
      </div>
      <button type="button" className={styles.secondary} onClick={refetch}
        disabled={busy}>Refresh matches</button>
    </div>
    {notice?<p role="status" className={styles.success}>{notice}</p>:null}
    {error?<p role="alert" className={styles.error}>{error}</p>:null}
    {loadError?<p role="alert" className={styles.error}>{loadError}</p>:null}
    <div className={styles.columns}>
      <div className={styles.panel}>
        <h3>Register supplier invoice</h3>
        <p className={styles.small}>Choose the posted delivery receipts covered by
          this invoice. Each receipt can belong to only one active invoice match.</p>
        <div className={styles.receiptList} role="group"
          aria-label="Available posted supplier delivery receipts">
          {available.length===0?<p className={styles.small}>No unmatched deliveries are available.
            Receive goods against the purchase order first, or review existing matches.</p>:
            available.map(r=><label key={r.id} className={styles.receipt}>
              <input type="checkbox" checked={selected.includes(r.id)}
                disabled={!canCreate||!online||busy}
                onChange={e=>toggle(r.id,e.target.checked)}/>
              <span><strong>{r.supplierReference??`Delivery ${r.id.slice(0,8)}`}</strong>
                <small>{date(r.receivedAt)}</small></span>
              <strong>{money(r.totalMinor)}</strong>
            </label>)}
        </div>
        {receiptCount>receipts.length?
          <p className={styles.small}>Showing the latest {receipts.length} of
            {" "}{receiptCount} delivery receipts. Older receipts are not selectable in this view.</p>:null}
        <div className={styles.fields}>
          <label className={styles.field}>Supplier invoice number
            <input type="text" maxLength={120} value={reference}
              placeholder="e.g. INV-2026-0148" disabled={!canCreate||busy}
              onChange={e=>{invalidate();setReference(e.target.value);}}/>
          </label>
          <label className={styles.field}>Invoice date
            <input type="date" value={invoiceDate} disabled={!canCreate||busy}
              onChange={e=>{invalidate();setInvoiceDate(e.target.value);}}/>
          </label>
        </div>
        <div className={styles.inputMoney}>
          <MoneyInput currencyCode={currencyCode} valueMinor={invoiceTotalMinor}
            label="Total shown on supplier invoice"
            hint="Enter the actual supplier invoice total, including any taxes or charges shown."
            disabled={!canCreate||busy}
            onChange={v=>{invalidate();setInvoiceTotalMinor(v);}}/>
          <button type="button" className={styles.secondary}
            disabled={!canCreate||busy||selectedReceipts.length===0}
            onClick={()=>{invalidate();setInvoiceTotalMinor(receiptTotal);}}>
            Use receipt total
          </button>
        </div>
        <div className={styles.comparison}>
          <span>Selected delivery receipts</span><strong>{money(receiptTotal)}</strong>
          <span>Supplier invoice entered</span>
          <strong>{invoiceTotalMinor===null?"Not entered":money(invoiceTotalMinor)}</strong>
          <span>Invoice difference</span>
          <strong className={invoiceTotalMinor!==null&&invoiceTotalMinor!==receiptTotal?
            styles.warning:""}>
            {invoiceTotalMinor===null?"—":money(invoiceTotalMinor-receiptTotal)}
          </strong>
        </div>
        <label className={styles.field}>Invoice notes (optional)
          <textarea rows={2} maxLength={2000} value={notes}
            placeholder="Supplier invoice particulars, tax note or discrepancies"
            disabled={!canCreate||busy}
            onChange={e=>{invalidate();setNotes(e.target.value);}}/>
        </label>
        <p className={styles.small}>An invoice amount different from the value already
          recorded at receiving, or a different price from the original PO,
          requires a manager's documented review. No automatic tax posting occurs.</p>
        <button type="button" className={styles.primary} disabled={!canCreate||!online||
          busy||selectedReceipts.length===0||!reference.trim()||
          !Number.isSafeInteger(invoiceTotalMinor)||(invoiceTotalMinor??-1)<0}
          onClick={()=>void create()}>
          {busy?"Processing…":"Save invoice match draft"}
        </button>
        {!online?<p className={styles.small}>Connect to verify current supplier
          receipts before registering an invoice.</p>:null}
      </div>
      <div className={styles.panel}>
        <h3>Supplier invoice matches</h3>
        {loading?<p className={styles.small}>Loading invoice history…</p>:
          matches.length===0?<p className={styles.small}>No supplier invoices
            have been matched to this purchase order yet.</p>:
          <div className={styles.matches}>
            {matches.map(m=><article className={styles.match} key={m.id}>
              <div className={styles.matchHeader}><div>
                <strong>{m.invoiceReference}</strong>
                <small>{date(m.invoiceDate+"T12:00:00Z")} · {m.receiptCount}
                  {" "}delivery receipt{m.receiptCount===1?"":"s"}</small>
              </div><span className={styles.status}>{m.status}</span></div>
              <div className={styles.comparison}>
                <span>Supplier invoice</span><strong>{money(m.invoiceTotalMinor)}</strong>
                <span>Received stock value</span><strong>{money(m.receiptTotalMinor)}</strong>
                <span>Invoice difference</span>
                <strong className={m.invoiceVarianceMinor!==0?styles.warning:""}>
                  {money(m.invoiceVarianceMinor)}</strong>
                <span>Actual cost − PO cost</span>
                <strong className={m.poPriceVarianceMinor!==0?styles.warning:""}>
                  {money(m.poPriceVarianceMinor)}</strong>
              </div>
              {m.lines.length>0?<div className={styles.lineDetails}>
                <strong>Ordered price versus received cost</strong>
                {m.lines.map(l=><div key={l.purchaseOrderLineId}>
                  <span>{l.itemName} · {l.quantity.toLocaleString("en-GH")}
                    {" "}{l.purchaseUnitCode}</span>
                  <span>{money(l.receiptTotalMinor)}
                    {l.poPriceVarianceMinor!==0?` (diff. ${money(l.poPriceVarianceMinor)})`:""}</span>
                </div>)}
              </div>:null}
              {m.hasException?<p className={styles.exception}>
                <strong>Difference requires review.</strong> Verify the supplier invoice,
                tax treatment and pricing before approval. No ledger adjustment is posted.
              </p>:<p className={styles.small}>Invoice total and received
                costs match the issued order.</p>}
              {m.approvalNote?<p className={styles.small}>
                <strong>Manager's review:</strong> {m.approvalNote}</p>:null}
              {m.status==="DRAFT"&&canApprove&&m.hasException?
                <label className={styles.field}>Manager justification (required for differences)
                  <textarea rows={2} maxLength={2000}
                    value={approvalNotes[m.id]??""} disabled={busy}
                    onChange={e=>setApprovalNotes(v=>({...v,[m.id]:e.target.value}))}
                    placeholder="Explain supplier price or invoice discrepancy"/>
                </label>:null}
              {m.status==="DRAFT"&&canCreate?<div className={styles.matchActions}>
                {canApprove?<button type="button" className={styles.primary}
                  disabled={busy||!online||(m.hasException&&
                    (approvalNotes[m.id]??"").trim().length<12)}
                  onClick={()=>void transition(m,"approve")}>Approve match</button>:null}
                <button type="button" className={styles.danger}
                  disabled={busy||!online}
                  onClick={()=>void transition(m,"cancel")}>Cancel draft</button>
              </div>:null}
            </article>)}
          </div>}
      </div>
    </div>
  </section>;
}
