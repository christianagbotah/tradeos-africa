"use client";
import { useActionFeedbackMessages } from "../ui/action-feedback";

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
interface InvoicePreviewLine {
  purchaseOrderLineId:string;itemName:string;purchaseUnitCode:string;
  quantity:number;poUnitCostMinor:number;receiptTotalMinor:number;
  expectedAtOrderPriceMinor:number;poPriceVarianceMinor:number;
}
interface InvoiceMatch {
  id:string;invoiceReference:string;invoiceDate:string;
  status:"DRAFT"|"APPROVED"|"CANCELLED";
  invoiceTotalMinor:number;receiptTotalMinor:number;
  invoiceVarianceMinor:number;poPriceVarianceMinor:number;
  receiptCount:number;notes:string;approvalNote:string;
  itemized:boolean;invoiceLinesSubtotalMinor:number;
  invoiceAdjustmentMinor:number;lineDiscrepancyCount:number;
  evidence:Array<{id:string;filename:string;mimeType:string;
    sizeBytes:number;createdAt:string}>;
  invoiceItemLines:Array<{
    id:string;purchaseOrderLineId:string;itemName:string;
    purchaseUnitCode:string;invoiceQuantity:number;
    invoiceUnitCostMinor:number;invoiceLineTotalMinor:number;
    receivedQuantity:number;receivedCostMinor:number;
    poUnitCostMinor:number;poExpectedTotalMinor:number;
    quantityVariance:number;valueVarianceMinor:number;
  }>;
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
  const [lineOverrides,setLineOverrides]=useState<Record<string,{
    quantity?:string;unitCostMinor?:number
  }>>({});
  const [reference,setReference]=useState("");
  const [invoiceDate,setInvoiceDate]=useState(()=>new Date().toISOString().slice(0,10));
  const [invoiceTotalMinor,setInvoiceTotalMinor]=useState<number|null>(null);
  const [notes,setNotes]=useState("");
  const [approvalNotes,setApprovalNotes]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  useActionFeedbackMessages(notice,error);
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
  const previewPath=session&&selectedReceipts.length>0?
    `/v1/purchase-orders/${encodeURIComponent(purchaseOrderId)}/invoice-item-preview`:null;
  const previewBody=useMemo(()=>({
    businessId:session?.businessId,
    receiptIds:selectedReceipts.map(r=>r.id).sort(),
  }),[session?.businessId,selected.join(","),
    available.map(r=>r.id).join(",")]);
  const {data:previewData,loading:previewLoading,error:previewError}=
    useApiFetch<{lines:InvoicePreviewLine[];receiptTotalMinor:number;
      poPriceVarianceMinor:number}>(previewPath,{method:"POST",body:previewBody});
  const invoiceLines=previewData?.lines.map(line=>({
    purchaseOrderLineId:line.purchaseOrderLineId,
    invoiceQuantity:Number(lineOverrides[line.purchaseOrderLineId]?.quantity??line.quantity),
    invoiceUnitCostMinor:lineOverrides[line.purchaseOrderLineId]?.unitCostMinor??
      line.poUnitCostMinor,
  }))??[];
  const invoiceLinesValid=previewData!==null&&!previewLoading&&
    invoiceLines.length>0&&invoiceLines.every(line=>
      Number.isFinite(line.invoiceQuantity)&&line.invoiceQuantity>=0&&
      line.invoiceQuantity<=1_000_000&&
      Math.abs(line.invoiceQuantity*1e8-Math.round(line.invoiceQuantity*1e8))<.001&&
      Number.isSafeInteger(line.invoiceUnitCostMinor)&&line.invoiceUnitCostMinor>=0);
  const invoiceItemSubtotalMinor=invoiceLinesValid?invoiceLines.reduce((sum,line)=>{
    const unitAmount=BigInt(line.invoiceUnitCostMinor);
    const scaled=BigInt(Math.round(line.invoiceQuantity*1e8));
    const total=Number((unitAmount*scaled+50_000_000n)/100_000_000n);
    return sum+total;
  },0):0;
  const invoiceAdjustmentMinor=invoiceTotalMinor===null?null:
    invoiceTotalMinor-invoiceItemSubtotalMinor;
  const lineDifferences=invoiceLinesValid?
    invoiceLines.filter(line=>{
      const received=previewData?.lines.find(p=>
        p.purchaseOrderLineId===line.purchaseOrderLineId);
      const expected=received?.receiptTotalMinor??0;
      const priceTotal=Number(
        (BigInt(line.invoiceUnitCostMinor)*
          BigInt(Math.round(line.invoiceQuantity*1e8))+
          50_000_000n)/100_000_000n);
      return received&&(line.invoiceQuantity!==received.quantity||
        priceTotal!==expected);
    }).length:0;
  const canCreate=CREATE_ROLES.includes(role);
  const canApprove=APPROVE_ROLES.includes(role);
  const online=queue.online;
  const invalidate=()=>{requestId.current=null;setError(null);setNotice(null);};
  function toggle(receiptId:string,checked:boolean) {
    invalidate();
    setSelected(previous=>checked?[...previous,receiptId]:
      previous.filter(id=>id!==receiptId));
    setLineOverrides({});
  }
  async function mutate(url:string,payload:unknown):Promise<unknown> {
    const response=await getOfflineQueue().authenticatedFetch(url,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),
    });
    if(!response.ok)throw new Error(await readApiErrorMessage(response));
    return response.json();
  }
  async function uploadEvidence(match:InvoiceMatch,file:File) {
    if(!session||!online||!canCreate||busy)return;
    // Some Android document pickers omit MIME even for valid PDF or photos.
    // Derive a declared type from the extension; the API separately verifies
    // the actual file signature and rejects mismatches.
    const declaredMime=file.type||(/\.pdf$/i.test(file.name)?"application/pdf":
      /\.png$/i.test(file.name)?"image/png":
      /\.jpe?g$/i.test(file.name)?"image/jpeg":"");
    if(file.size<1||file.size>3*1024*1024||
      !["application/pdf","image/png","image/jpeg"].includes(declaredMime)){
      setError("Choose a PDF, PNG or JPEG invoice document up to 3 MB.");
      return;
    }
    setBusy(true);setError(null);setNotice(null);
    try{
      const base64=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();
        reader.onerror=()=>reject(new Error("Could not read the selected invoice document"));
        reader.onload=()=>{
          const result=String(reader.result??"");
          const encoded=result.split(",")[1];
          if(!encoded)reject(new Error("The selected document contains no readable data"));
          else resolve(encoded);
        };
        reader.readAsDataURL(file);
      });
      await mutate(`/v1/supplier-invoice-matches/${encodeURIComponent(match.id)}/evidence`,{
        businessId:session.businessId,filename:file.name,
        mimeType:declaredMime,base64,
      });
      setNotice(`Invoice evidence ${file.name} uploaded privately.`);
      refetch();
    }catch(e){setError(e instanceof Error?e.message:"Could not upload invoice evidence");}
    finally{setBusy(false);}
  }
  async function downloadEvidence(matchId:string,file:{
    id:string;filename:string
  }){
    if(!session||!online)return;
    setError(null);
    try{
      const res=await getOfflineQueue().authenticatedFetch(
        `/v1/supplier-invoice-matches/${encodeURIComponent(matchId)}/evidence/${encodeURIComponent(file.id)}?businessId=${encodeURIComponent(session.businessId)}`);
      if(!res.ok)throw new Error(await readApiErrorMessage(res));
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");
      link.href=url;link.download=file.filename;document.body.appendChild(link);
      link.click();link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch(e){setError(e instanceof Error?e.message:"Could not download invoice evidence");}
  }
  async function removeEvidence(match:InvoiceMatch,file:{
    id:string;filename:string
  }) {
    if(!session||!online||!canCreate||busy||match.status!=="DRAFT")return;
    if(!window.confirm(`Remove ${file.filename} from this draft invoice match?`))return;
    setBusy(true);setError(null);setNotice(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(
        `/v1/supplier-invoice-matches/${encodeURIComponent(match.id)}/evidence/${encodeURIComponent(file.id)}?businessId=${encodeURIComponent(session.businessId)}`,
        {method:"DELETE"});
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      setNotice(`Removed ${file.filename} from draft invoice evidence.`);
      refetch();
    }catch(e){setError(e instanceof Error?e.message:"Could not remove invoice evidence");}
    finally{setBusy(false);}
  }
  async function create() {
    if(!session||!online||!canCreate||busy||!reference.trim()||
      selectedReceipts.length<1||!Number.isSafeInteger(invoiceTotalMinor)||
      (invoiceTotalMinor??-1)<0||!invoiceLinesValid||
      !Number.isSafeInteger(invoiceItemSubtotalMinor)||
      !Number.isSafeInteger(invoiceAdjustmentMinor))return;
    setBusy(true);setError(null);setNotice(null);
    requestId.current??=crypto.randomUUID();
    try {
      await mutate(`/v1/purchase-orders/${encodeURIComponent(purchaseOrderId)}/invoice-matches`,{
        businessId:session.businessId,clientRequestId:requestId.current,
        invoiceReference:reference.trim(),invoiceDate,
        invoiceTotalMinor,receiptIds:selectedReceipts.map(r=>r.id),
        invoiceLines,notes,
      });
      setNotice("Supplier invoice captured as draft. Review differences before approval.");
      requestId.current=null;setSelected([]);setLineOverrides({});setReference("");
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
        <div className={styles.lineSection}>
          <h4>Supplier invoice item lines</h4>
          <p className={styles.small}>Enter the quantities and unit prices exactly as
            shown on the supplier invoice. The received quantities and purchase-order
            prices are displayed for comparison. On phones, scroll the table sideways.</p>
          {previewError?<p className={styles.error} role="alert">{previewError}</p>:null}
          {previewLoading&&selectedReceipts.length>0?
            <p className={styles.small}>Checking received items…</p>:null}
          {previewData&&!previewLoading&&previewData.lines.length>0?
            <div className={styles.lineScroller} tabIndex={0}
              role="region" aria-label="Supplier invoice itemized lines — horizontally scrollable">
              <div className={styles.lineGrid}>
                <div className={styles.lineLabels}>
                  <span>Item / unit</span><span>Received</span>
                  <span>Invoice qty</span><span>PO unit cost</span>
                  <span>Invoice unit cost</span><span>Invoice line total</span>
                </div>
                {previewData?.lines.map(line=>{
                  const override=lineOverrides[line.purchaseOrderLineId];
                  const submitted=invoiceLines.find(l=>
                    l.purchaseOrderLineId===line.purchaseOrderLineId);
                  const quantity=submitted?.invoiceQuantity??0;
                  const cost=submitted?.invoiceUnitCostMinor??0;
                  const total=Number((BigInt(cost)*
                    BigInt(Math.round(quantity*1e8))+50_000_000n)/100_000_000n);
                  const changed=quantity!==line.quantity||
                    total!==line.receiptTotalMinor;
                  return <div key={line.purchaseOrderLineId}
                    className={styles.lineRow}>
                    <span><strong>{line.itemName}</strong>
                      <small>{line.purchaseUnitCode}</small></span>
                    <span className={styles.numeric}>{line.quantity.toLocaleString("en-GH",{
                      maximumFractionDigits:8})}</span>
                    <input aria-label={`Invoice quantity for ${line.itemName}`}
                      type="number" step="any" min="0" max="1000000" inputMode="decimal"
                      disabled={!canCreate||!online||busy}
                      value={override?.quantity??String(line.quantity)}
                      onChange={e=>{invalidate();setLineOverrides(prev=>({
                        ...prev,[line.purchaseOrderLineId]:{
                          ...prev[line.purchaseOrderLineId],quantity:e.target.value,
                        },
                      }));}}/>
                    <span className={styles.numeric}>{money(line.poUnitCostMinor)}</span>
                    <div className={styles.lineMoney}>
                      <MoneyInput id={`invoice-cost-${line.purchaseOrderLineId}`}
                        aria-label={`Invoice unit cost for ${line.itemName}`}
                        currencyCode={currencyCode} valueMinor={cost}
                        disabled={!canCreate||!online||busy}
                        onChange={minor=>{invalidate();setLineOverrides(prev=>({
                          ...prev,[line.purchaseOrderLineId]:{
                            ...prev[line.purchaseOrderLineId],unitCostMinor:minor??0,
                          },
                        }));}}/>
                    </div>
                    <strong className={changed?styles.warning:styles.numeric}>
                      {money(total)}</strong>
                  </div>;
                })}
              </div>
            </div>:selectedReceipts.length===0?
              <p className={styles.small}>Select one or more posted deliveries to
                see the actual received items.</p>:null}
          {lineDifferences>0?<p className={styles.exception} role="status">
            {lineDifferences} invoiced item{lineDifferences===1?"":"s"} differ from
            actual delivered quantity or cost. Manager justification will be required.
          </p>:null}
        </div>
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
          <span>Supplier invoice item subtotal</span>
          <strong>{invoiceLinesValid?money(invoiceItemSubtotalMinor):"Select deliveries"}</strong>
          <span>Supplier invoice entered</span>
          <strong>{invoiceTotalMinor===null?"Not entered":money(invoiceTotalMinor)}</strong>
          <span>Invoice difference vs goods received</span>
          <strong className={invoiceTotalMinor!==null&&invoiceTotalMinor!==receiptTotal?
            styles.warning:""}>
            {invoiceTotalMinor===null?"—":money(invoiceTotalMinor-receiptTotal)}
          </strong>
          <span>Other charges or discounts</span>
          <strong className={invoiceAdjustmentMinor!==null&&invoiceAdjustmentMinor!==0?
            styles.warning:""}>
            {invoiceAdjustmentMinor===null||!invoiceLinesValid?
              "—":money(invoiceAdjustmentMinor)}
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
          busy||selectedReceipts.length===0||!reference.trim()||!invoiceLinesValid||
          !Number.isSafeInteger(invoiceItemSubtotalMinor)||
          !Number.isSafeInteger(invoiceAdjustmentMinor)||
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
                {m.itemized?<><span>Invoiced item subtotal</span>
                  <strong>{money(m.invoiceLinesSubtotalMinor)}</strong>
                  <span>Other charges / discounts</span>
                  <strong className={m.invoiceAdjustmentMinor!==0?styles.warning:""}>
                    {money(m.invoiceAdjustmentMinor)}</strong>
                  <span>Item exceptions</span>
                  <strong className={m.lineDiscrepancyCount>0?styles.warning:""}>
                    {m.lineDiscrepancyCount}</strong></>:null}
              </div>
              {m.itemized&&m.invoiceItemLines.length>0?
                <div className={styles.lineScroller} tabIndex={0} role="region"
                  aria-label="Recorded supplier invoice item comparison">
                  <div className={styles.invoiceLineHistory}>
                    <div className={styles.lineLabels}>
                      <span>Product</span><span>Received qty</span>
                      <span>Invoice qty</span><span>Invoice cost</span>
                      <span>PO cost</span><span>Line difference</span>
                    </div>
                    {m.invoiceItemLines.map(line=><div key={line.id}
                      className={styles.lineRow}>
                      <span>{line.itemName} <small>{line.purchaseUnitCode}</small></span>
                      <span className={styles.numeric}>{line.receivedQuantity.toLocaleString("en-GH",{
                        maximumFractionDigits:8})}</span>
                      <span className={line.quantityVariance!==0?styles.warning:styles.numeric}>
                        {line.invoiceQuantity.toLocaleString("en-GH",{
                          maximumFractionDigits:8})}</span>
                      <span className={styles.numeric}>{money(line.invoiceLineTotalMinor)}</span>
                      <span className={styles.numeric}>{money(line.poExpectedTotalMinor)}</span>
                      <strong className={line.valueVarianceMinor!==0||line.quantityVariance!==0?
                        styles.warning:styles.numeric}>
                        {money(line.valueVarianceMinor)}</strong>
                    </div>)}
                  </div>
                </div>:null}
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
              <div className={styles.evidence}>
                <strong>Private invoice attachments</strong>
                <p className={styles.small}>PDF, PNG or JPEG · up to three files,
                  3 MB each. Only authorized business staff can download them.</p>
                {m.evidence.length>0?<div className={styles.evidenceList}>
                  {m.evidence.map(file=><div key={file.id}>
                    <span>{file.filename} ({(file.sizeBytes/1024).toFixed(0)} KB)</span>
                    <div className={styles.evidenceButtons}>
                      <button type="button" className={styles.secondary}
                        disabled={!online}
                        onClick={()=>void downloadEvidence(m.id,file)}>Download</button>
                      {m.status==="DRAFT"&&canCreate?
                        <button type="button" className={styles.danger}
                          disabled={busy||!online}
                          onClick={()=>void removeEvidence(m,file)}>Remove</button>:null}
                    </div>
                  </div>)}
                </div>:<p className={styles.small}>No invoice file attached yet.</p>}
                {m.status==="DRAFT"&&canCreate&&m.evidence.length<3?
                  <label className={styles.filePicker}>
                    Attach supplier invoice file
                    <input type="file" accept="application/pdf,image/png,image/jpeg"
                      disabled={busy||!online}
                      onChange={e=>{
                        const file=e.target.files?.[0];e.target.value="";
                        if(file)void uploadEvidence(m,file);
                      }}/>
                  </label>:null}
              </div>
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
