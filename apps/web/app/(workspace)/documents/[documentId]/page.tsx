"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatMoney } from "@tradeos/contracts";
import { useApiFetch } from "../../../../lib/use-api-fetch";
import { useWorkspace } from "../../../components/workspace/use-workspace";
import { prepareCommercialPdf, sharePreparedCommercialPdf } from "../../../../lib/commercial-document-pdf";
import { downloadReceiptPdfFile, RECEIPT_PAPER_OPTIONS, type ReceiptPaper } from "../../../../lib/receipt-pdf";
import { IconDownload, IconShare, IconPrint } from "../../../components/ui/icons";
import styles from "./document.module.css";

type Kind="QUOTATION"|"PROFORMA";
type Status="DRAFT"|"ISSUED"|"CANCELLED";
type Document={
  id:string;businessId:string;branchId:string;documentNumber:string;kind:Kind;
  status:Status;customerName:string;customerPhone:string|null;
  customerEmail:string|null;currencyCode:string;notes:string;
  expiresAt:string|null;issuedAt:string|null;createdAt:string;
  subtotalMinor:number;taxMinor:number;totalMinor:number;
  lines:Array<{id:string;itemName:string;quantity:number;saleUnitCode:string;
    unitNetMinor:number;lineNetMinor:number;lineTaxMinor:number;lineTotalMinor:number}>;
};
const day=(value:string|null,timezone:string)=>value?
  new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"2-digit",year:"numeric",
    timeZone:timezone}).format(new Date(value)):"—";

export default function CommercialDocumentDetail() {
  const params=useParams<{documentId:string}>();
  const {session,businessContext,account,queue}=useWorkspace();
  const [paper,setPaper]=useState<ReceiptPaper>("A5");
  const [prepared,setPrepared]=useState<{scope:string;file:File;preparedAt:number}|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [pdfError,setPdfError]=useState<string|null>(null);
  const generation=useRef(0);
  const inFlight=useRef(false);
  const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.documentId);
  const path=session && valid?
    `/v1/commercial-documents/${encodeURIComponent(params.documentId)}?businessId=${encodeURIComponent(session.businessId)}`:null;
  const {data,loading,error}=useApiFetch<{document:Document}>(path);
  const candidate=data?.document;
  const document=candidate&&candidate.businessId===session?.businessId&&candidate.id===params.documentId?candidate:undefined;
  const business=businessContext?.business;
  const branch=businessContext?.branches.find(b=>b.id===document?.branchId);
  const tz=branch?.timezone||business?.timezone||"Africa/Accra";
  const money=(minor:number)=>formatMoney(minor,document?.currencyCode??session?.currencyCode??"GHS");
  const isQuote=document?.kind==="QUOTATION";
  const expiry=document?.expiresAt&&new Date(document.expiresAt).getTime()<Date.now();
  const canPrepare=Boolean(account&&session&&queue.online&&document?.status==="ISSUED"&&!expiry);
  const scope=canPrepare&&document&&session&&account
    ? JSON.stringify([account.id,session.businessId,session.branchId,session.role,document.branchId,document.id,document.issuedAt,paper])
    : "";
  const scopeRef=useRef(scope);
  scopeRef.current=scope;
  useEffect(()=>{
    ++generation.current;
    inFlight.current=false;
    setPrepared(null);setBusy(false);setNotice(null);setPdfError(null);
    return ()=>{++generation.current;};
  },[scope]);
  const ready=prepared?.scope===scope&&scope!==""?prepared:null;
  async function prepare(){
    if(inFlight.current||!scope||!document||!session)return;
    inFlight.current=true;setBusy(true);setPrepared(null);setNotice(null);setPdfError(null);
    const attempt=++generation.current;
    const requestScope=scope;
    try{
      const file=await prepareCommercialPdf({documentId:document.id,businessId:session.businessId,branchId:document.branchId,kind:document.kind,paper});
      if(attempt===generation.current&&scopeRef.current===requestScope){
        setPrepared({scope:requestScope,file,preparedAt:Date.now()});
        setNotice("PDF ready. Choose Download or Share to attach the file.");
      }
    }catch(error){
      if(attempt===generation.current&&scopeRef.current===requestScope)setPdfError(error instanceof Error?error.message:"Could not prepare PDF.");
    }finally{if(attempt===generation.current){inFlight.current=false;setBusy(false);}}
  }
  async function deliver(share:boolean){
    if(inFlight.current||!ready||scopeRef.current!==scope)return;
    // A prepared file is short-lived and bound to the current authenticated scope.
    if(Date.now()-ready.preparedAt>60_000||!document||document.status!=="ISSUED"||
        (document.expiresAt!==null&&Date.parse(document.expiresAt)<=Date.now())){
      setPrepared(null);setNotice(null);setPdfError("Prepare a fresh PDF before sharing.");return;
    }
    inFlight.current=true;setBusy(true);setPdfError(null);setNotice(null);
    const attempt=++generation.current;
    try{
      const result=share?await sharePreparedCommercialPdf(ready.file):(downloadReceiptPdfFile(ready.file),"downloaded");
      if(attempt===generation.current&&scopeRef.current===scope){
        setPrepared(null);
        setNotice(result==="shared"?"PDF handed to your chosen app. Delivery is not confirmed.":result==="downloaded"?"PDF downloaded. Attach it in WhatsApp, email or another app.":"Sharing cancelled.");
      }
    }catch(error){if(attempt===generation.current&&scopeRef.current===scope)setPdfError(error instanceof Error?error.message:"Could not share PDF.");}
    finally{if(attempt===generation.current){inFlight.current=false;setBusy(false);}}
  }
  if(!valid)return <div className={styles.failure}>Invalid document identifier.</div>;
  if(loading)return <div className={styles.failure}>Loading document…</div>;
  if(error||!document)return <div className={styles.failure} role="alert">{error||"Document could not be found."}</div>;
  return <main className={styles.wrapper}>
    <div className={styles.actions}>
      <Link href="/documents">Back to quotations & proformas</Link>
      {document.status==="DRAFT"&&["OWNER","ADMIN","MANAGER","CASHIER","SALES"].includes(session?.role??"")&&document.branchId===session?.branchId?<Link href={`/documents?edit=${document.id}`}>Edit draft</Link>:null}
      {document.status==="ISSUED"?<button type="button" onClick={()=>window.print()} aria-label="Print document" title="Print document"><IconPrint aria-hidden="true"/><span>Print</span></button>:null}
      {canPrepare?<div className={styles.pdfControls}>
        <label>PDF paper <select value={paper} disabled={busy} onChange={event=>setPaper(event.target.value as ReceiptPaper)}>{RECEIPT_PAPER_OPTIONS.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        {!ready?<button type="button" disabled={busy} onClick={()=>void prepare()}>{busy?"Preparing…":"Prepare PDF"}</button>:<>
          <button type="button" disabled={busy} onClick={()=>void deliver(false)} aria-label="Download PDF" title="Download PDF"><IconDownload aria-hidden="true"/><span>Download PDF</span></button>
          <button type="button" disabled={busy} onClick={()=>void deliver(true)} aria-label="Share PDF" title="Share PDF"><IconShare aria-hidden="true"/><span>Share PDF</span></button>
        </>}
      </div>:null}
      {document.status==="ISSUED"&&!queue.online?<p role="status">Connect to the internet to prepare a verified PDF.</p>:null}
      {notice?<p role="status" className={styles.pdfNotice}>{notice}</p>:null}
      {pdfError?<p role="alert" className={styles.pdfNotice}>{pdfError}</p>:null}
    </div>
    <article id="tradeos-commercial-document" className={`tos-print-document ${styles.document}`}>
      <header className={styles.header}>
        <h1>{business?.name||session?.businessName||"Business"}</h1>
        {branch?<p>{branch.name} branch</p>:null}
        <p>{[branch?.addressLine1||business?.addressLine1,
          branch?.city||business?.city].filter(Boolean).join(", ")}</p>
        {(branch?.phone||business?.phone)?<p>Tel: {branch?.phone||business?.phone}</p>:null}
        <div className={styles.documentHeading}>
          <h2>{isQuote?"QUOTATION":"PROFORMA INVOICE"}</h2>
          <span>{document.status}{expiry?" · EXPIRED":""}</span>
        </div>
        <p className={styles.disclaimer}>
          {isQuote?"This is an offer, not a receipt or demand for payment.":
            "Proforma only — not a tax invoice, payment confirmation or accounting receivable."}
        </p>
      </header>
      <div className={styles.summary}>
        <div><span>Reference</span><strong>{document.documentNumber}</strong></div>
        <div><span>Customer</span><strong>{document.customerName}</strong></div>
        {document.customerPhone?<div><span>Phone</span><strong>{document.customerPhone}</strong></div>:null}
        {document.customerEmail?<div><span>Email</span><strong>{document.customerEmail}</strong></div>:null}
        <div><span>Created</span><strong>{day(document.createdAt,tz)}</strong></div>
        <div><span>Valid until</span><strong>{day(document.expiresAt,tz)}</strong></div>
      </div>
      <table>
        <thead><tr><th>Item / unit</th><th>Qty.</th><th>Unit price</th><th>Total</th></tr></thead>
        <tbody>{document.lines.map(line=><tr key={line.id}>
          <td><strong>{line.itemName}</strong><small>{line.saleUnitCode}</small></td>
          <td>{line.quantity.toLocaleString("en-GH")}</td>
          <td>{money(line.unitNetMinor)}</td>
          <td>{money(line.lineTotalMinor)}</td>
        </tr>)}</tbody>
      </table>
      <div className={styles.totals}>
        <div><span>Subtotal</span><strong>{money(document.subtotalMinor)}</strong></div>
        {document.taxMinor>0?<div><span>Tax</span><strong>{money(document.taxMinor)}</strong></div>:null}
        <div className={styles.grand}><span>Total quoted</span><strong>{money(document.totalMinor)}</strong></div>
      </div>
      {document.notes?<section className={styles.notes}><h3>Terms & notes</h3><p>{document.notes}</p></section>:null}
      <footer>
        <p>{document.status!=="ISSUED"?
          "DRAFT / CANCELLED — not valid for presentation to customers.":
          expiry?"This document has expired. Request an updated offer.":
          "Prices are quoted at the time of document creation and may be subject to availability."}</p>
        <p>TradeOS Africa · {document.documentNumber} · Issued {day(document.issuedAt,tz)}</p>
      </footer>
    </article>
  </main>;
}
