"use client";

import { useParams } from "next/navigation";
import { formatMoney } from "@tradeos/contracts";
import { useWorkspace } from "../../../../components/workspace/use-workspace";
import { useApiFetch } from "../../../../../lib/use-api-fetch";
import {
  canIssueReceipt, receiptTimestamp, receiptTotals, receiptUrl,
  type ReceiptSale,
} from "../../../../../lib/receipt-document";
import { StatePanel } from "../../../../components/ui/state-panel";
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
        <button type="button" className={styles.printButton} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <article id="tos-verified-receipt" className={styles.receipt} aria-label="Verified sales receipt">
        <header className={styles.header}>
          <div className={styles.brand}>{business?.name || session?.businessName || "Business"}</div>
          {branch ? <div className={styles.muted}>{branch.name} branch</div> : null}
          {address ? <div className={styles.muted}>{address}</div> : null}
          {branch?.phone || business?.phone ? <div className={styles.muted}>Tel: {branch?.phone || business?.phone}</div> : null}
          <h1>{onCredit ? "CREDIT SALE RECORD" : "SALES RECEIPT"}</h1>
          <span className={styles.status}>{onCredit ? "PAYMENT DUE" : "SALE COMPLETED"}</span>
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
