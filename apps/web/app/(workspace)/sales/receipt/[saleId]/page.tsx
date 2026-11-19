"use client";

import { useParams } from "next/navigation";
import { useEffect,useState } from "react";
import { notifyAction } from "../../../../components/ui/action-feedback";
import {
  RECEIPT_PAPER_OPTIONS,loadReceiptPaper,saveReceiptPaper,
  downloadVerifiedReceiptPdf,shareVerifiedReceiptPdf,type ReceiptPaper,
} from "../../../../../lib/receipt-pdf";
import { formatMoney } from "@tradeos/contracts";
import { useWorkspace } from "../../../../components/workspace/use-workspace";
import { useApiFetch } from "../../../../../lib/use-api-fetch";
import {
  canIssueReceipt, receiptTimestamp, receiptTotals, receiptUrl,
  type ReceiptSale,
} from "../../../../../lib/receipt-document";
import { StatePanel } from "../../../../components/ui/state-panel";
import { IconPrint,IconDownload,IconShare } from "../../../../components/ui/icons";
import styles from "./receipt.module.css";

type SaleDetailResponse = { sale: ReceiptSale };

export default function VerifiedSaleReceiptPage() {
  const params = useParams<{ saleId: string }>();
  const { session, businessContext } = useWorkspace();
  const saleId = params.saleId;
  const valid = receiptUrl(saleId) !== null;
  const path = valid && session
    ? `/v1/sales/${encodeURIComponent(saleId)}?businessId=${encodeURIComponent(session.businessId)}`
    : null;
  const { data, loading, error } = useApiFetch<SaleDetailResponse>(path);
  const sale = data?.sale;
  const business = businessContext?.business;
  const branch = businessContext?.branches.find(item => item.id === sale?.branchId);
  const complete = canIssueReceipt(sale);
  const [paper,setPaper] = useState<ReceiptPaper>("80mm");
  const [busy,setBusy] = useState(false);
  const [pdfError,setPdfError] = useState<string|null>(null);
  const receiptBranchId=sale?.branchId || session?.branchId || "";
  useEffect(()=>{
    setPaper(loadReceiptPaper(session?.businessId || "",receiptBranchId));
  },[session?.businessId,receiptBranchId]);
  function selectPaper(value:ReceiptPaper){
    setPaper(value);
    if(session)saveReceiptPaper(value,session.businessId,receiptBranchId);
  }
  async function pdfAction(share:boolean){
    if(!session || !complete || busy)return;
    setBusy(true);setPdfError(null);
    try {
      if(share){
        const outcome=await shareVerifiedReceiptPdf(sale!.id,session.businessId,paper);
        if(outcome==="downloaded")notifyAction({tone:"info",title:"PDF downloaded",
          message:"Your device cannot share PDF files directly. Attach the downloaded PDF in WhatsApp, email or another app."});
        else if(outcome==="shared")notifyAction({tone:"success",title:"PDF handed to sharing app",
          message:"The receipt PDF was handed to your chosen sharing app."});
      } else {
        await downloadVerifiedReceiptPdf(sale!.id,session.businessId,paper);
        notifyAction({tone:"success",title:"PDF ready",
          message:"Receipt downloaded in "+paper+" paper format."});
      }
    }catch(error){
      const message=error instanceof Error?error.message:"Could not prepare receipt PDF.";
      setPdfError(message);notifyAction({tone:"error",message});
    }finally{setBusy(false);}
  }
  const date = sale?.completedAt ? receiptTimestamp(sale.completedAt, branch?.timezone || session?.timezone) : "—";

  if (!valid) return <StatePanel variant="error" title="Invalid receipt reference" text="Open a completed sale from Sales." />;
  if (loading) return <StatePanel variant="loading" title="Verifying sales receipt…" />;
  if (error || !sale) return (
    <StatePanel variant="error" title="Receipt unavailable" text={error || "Could not find the sale. Sign in and try again."} />
  );
  if (!complete) return (
    <div className={styles.blocked} role="alert">
      <h1>Final receipt not available</h1>
      <p>This sale has not been verified as fully completed, or a payment is still pending. A customer receipt cannot be issued yet.</p>
      <a href="/sales">Go back to Sales</a>
    </div>
  );

  const totals = receiptTotals(sale);
  const onCredit = totals.customerCreditMinor > 0;
  const money = (minor: number) => formatMoney(minor, sale.currencyCode);
  const customer = sale.customer?.name || sale.customer?.phone || "Walk-in customer";
  const address = [branch?.addressLine1 || business?.addressLine1, branch?.city || business?.city]
    .filter(Boolean).join(", ");

  return (
    <div className={styles.wrapper}>
      <div className={styles.actions}>
        <a href="/sales" className={styles.link}>Back to sales</a>
        <div className={styles.controls}>
          <label htmlFor="tradeos-receipt-paper">Receipt paper
            <select id="tradeos-receipt-paper" className={styles.paperSelect}
              value={paper} onChange={e=>selectPaper(e.target.value as ReceiptPaper)}>
              {RECEIPT_PAPER_OPTIONS.map(option=>
                <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <span className={styles.paperHint}>Remembered for this branch on this device</span>
          </label>
          <div className={styles.actionButtons}>
            <button type="button" className={styles.printButton} onClick={() => window.print()}
              aria-label="Print receipt" title="Print receipt">
              <IconPrint aria-hidden="true" /><span className={styles.actionLabel}>Print receipt</span>
            </button>
            <button type="button" className={styles.downloadButton} disabled={busy}
              onClick={()=>void pdfAction(false)} aria-label="Download receipt PDF" title="Download receipt PDF">
              <IconDownload aria-hidden="true" /><span className={styles.actionLabel}>
                {busy?"Preparing…":"Download PDF"}
              </span>
            </button>
            <button type="button" className={styles.downloadButton} disabled={busy}
              onClick={()=>void pdfAction(true)} aria-label="Share receipt PDF" title="Share receipt PDF">
              <IconShare aria-hidden="true" /><span className={styles.actionLabel}>
                {busy?"Preparing…":"Share PDF"}
              </span>
            </button>
          </div>
        </div>
      </div>
      {pdfError?<p role="alert" className={styles.error}>{pdfError}</p>:null}
      <article id="tos-verified-receipt"
        className={`tos-print-document ${styles.receipt} ${paper==="A5"?styles.paperA5:paper==="80mm"?styles.paper80:styles.paper58}`}
        aria-label="Verified sales receipt">
        <header className={styles.header}>
          <div className={styles.brand}>{business?.name || session?.businessName || "Business"}</div>
          {branch ? <div className={styles.muted}>{branch.name} branch</div> : null}
          {address ? <div className={styles.muted}>{address}</div> : null}
          {branch?.phone || business?.phone ? <div className={styles.muted}>Tel: {branch?.phone || business?.phone}</div> : null}
          <h1>{onCredit ? "CREDIT SALE RECORD" : "SALES RECEIPT"}</h1>
          <span className={styles.status}>
            {sale.status === "REFUNDED" ? "SALE REFUNDED" :
              sale.status === "PARTIALLY_REFUNDED" ? "PARTIALLY REFUNDED" :
              onCredit ? "PAYMENT DUE" : "SALE COMPLETED"}
          </span>
        </header>
        <div className={styles.details}>
          <div><span>Receipt</span><strong>{sale.id.slice(0, 8).toUpperCase()}</strong></div>
          <div><span>Date</span><strong>{date}</strong></div>
          <div><span>Customer</span><strong>{customer}</strong></div>
          {sale.cashierName ? <div><span>Cashier</span><strong>{sale.cashierName}</strong></div> : null}
        </div>
        <table className={styles.items}>
          <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Amount</th></tr></thead>
          <tbody>
            {sale.lines.map(line => (
              <tr key={line.id}>
                <td><strong>{line.itemName}</strong><small>{money(line.unitNetMinor)} / {line.saleUnitCode}</small></td>
                <td>{line.quantity.toLocaleString("en-GH")}</td>
                <td>{money(line.lineTotalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.thermalItems} aria-label="Purchased items">
          {sale.lines.map(line=>(
            <div key={line.id} className={styles.thermalItem}>
              <div className={styles.thermalCompactRow}>
                <strong className={styles.thermalName}>{line.itemName}</strong>
                <span className={styles.thermalTerms}>
                  {line.quantity.toLocaleString("en-GH")} × {line.saleUnitCode} @ {money(line.unitNetMinor)}
                </span>
                <strong className={styles.thermalAmount}>{money(line.lineTotalMinor)}</strong>
              </div>
            </div>
          ))}
        </div>
        <div className={styles.totals}>
          {totals.taxMinor > 0 ? <div><span>Included tax</span><span>{money(totals.taxMinor)}</span></div> : null}
          <div className={styles.grand}><span>Sale total</span><strong>{money(sale.totalMinor)}</strong></div>
          {sale.payments.map(payment => (
            <div key={payment.id}><span>{payment.method.replaceAll("_", " ")}</span><span>{money(payment.amountMinor)}</span></div>
          ))}
          {onCredit ? <div><span>Customer credit (not collected)</span><span>{money(totals.customerCreditMinor)}</span></div> : null}
          {onCredit ? <div><span>Payment collected</span><span>{money(totals.grossPaidMinor)}</span></div> : null}
          {totals.refundedMinor > 0 ? <div><span>Refunded after sale</span><span>−{money(totals.refundedMinor)}</span></div> : null}
          {totals.refundedMinor > 0 ? <div><span>Net received</span><span>{money(totals.netPaidMinor)}</span></div> : null}
        </div>
        <footer className={styles.footer}>
          <p>Thank you for your business.</p>
          <p>Receipt reference: {sale.id}</p>
          <p>This document reflects the recorded completed sale. Returns and refunds are recorded separately.</p>
          <span>Powered by TradeOS Africa</span>
        </footer>
      </article>
      <p className={styles.hint}>Printed from authenticated records; an unpaid or offline-queued sale cannot issue this document.</p>
    </div>
  );
}
