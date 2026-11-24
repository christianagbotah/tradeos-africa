"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { formatMoney } from "@tradeos/contracts";
import { useApiFetch } from "../../../../lib/use-api-fetch";
import { useWorkspace } from "../../../components/workspace/use-workspace";
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
  const {session,businessContext}=useWorkspace();
  const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.documentId);
  const path=session && valid?
    `/v1/commercial-documents/${encodeURIComponent(params.documentId)}?businessId=${encodeURIComponent(session.businessId)}`:null;
  const {data,loading,error}=useApiFetch<{document:Document}>(path);
  const document=data?.document;
  const business=businessContext?.business;
  const branch=businessContext?.branches.find(b=>b.id===document?.branchId);
  const tz=branch?.timezone||business?.timezone||"Africa/Accra";
  const money=(minor:number)=>formatMoney(minor,document?.currencyCode??session?.currencyCode??"GHS");
  const isQuote=document?.kind==="QUOTATION";
  const expiry=document?.expiresAt&&new Date(document.expiresAt).getTime()<Date.now();
  if(!valid)return <div className={styles.failure}>Invalid document identifier.</div>;
  if(loading)return <div className={styles.failure}>Loading document…</div>;
  if(error||!document)return <div className={styles.failure} role="alert">{error||"Document could not be found."}</div>;
  return <main className={styles.wrapper}>
    <div className={styles.actions}>
      <Link href="/documents">Back to quotations & proformas</Link>
      {document.status==="DRAFT"&&["OWNER","ADMIN","MANAGER","CASHIER","SALES"].includes(session?.role??"")&&document.branchId===session?.branchId?<Link href={`/documents?edit=${document.id}`}>Edit draft</Link>:null}
      {document.status==="ISSUED"?<button type="button" onClick={()=>window.print()}>Print / Save as PDF</button>:null}
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
