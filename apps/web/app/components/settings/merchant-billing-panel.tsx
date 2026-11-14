"use client";

import type { MerchantBillingOverview } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import styles from "./merchant-billing-panel.module.css";

const READ_ROLES = new Set(["OWNER","ADMIN","ACCOUNTANT"]);

function date(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" :
    parsed.toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit",year:"numeric"});
}
function status(value: string): string {
  return value.replaceAll("_"," ").toLowerCase().replace(/^./,(c)=>c.toUpperCase());
}

export function MerchantBillingPanel() {
  const { session, role, queue } = useWorkspace();
  const allowed = role !== null && READ_ROLES.has(role);
  const path = session && allowed && queue.online
    ? "/v1/billing/overview?businessId=" + encodeURIComponent(session.businessId)
    : null;
  const { data, loading, error, refetch } = useApiFetch<MerchantBillingOverview>(path);
  if (!session) return null;
  if (!allowed) {
    return (
      <section className={styles.panel}>
        <h2>Subscription & billing</h2>
        <p>Only the business owner, an administrator or an accountant can view subscription billing.</p>
      </section>
    );
  }
  const overview = queue.online && !loading && !error && data?.businessId === session.businessId
    ? data : null;
  return (
    <section className={styles.panel} aria-labelledby="merchant-billing-heading">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>BUSINESS SUBSCRIPTION</p>
          <h2 id="merchant-billing-heading">Subscription & billing</h2>
          <p>See your current plan, billing periods, recorded invoices and confirmed payment history.</p>
        </div>
        <button type="button" className={styles.refresh} disabled={loading || !queue.online}
          onClick={refetch}>Refresh</button>
      </div>
      {!queue.online ? (
        <p className={styles.notice} role="status">
          Connect to view billing records. Offline sales can continue; billing amounts are never guessed from cached data.
        </p>
      ) : loading ? (
        <p className={styles.notice} role="status">Loading your verified subscription records…</p>
      ) : error ? (
        <p className={styles.error} role="alert">Billing records could not be loaded: {error}</p>
      ) : !overview ? (
        <p className={styles.notice}>Subscription records are unavailable for this business.</p>
      ) : (
        <>
          {overview.subscription ? (
            <div className={styles.plan}>
              <div className={styles.planHeader}>
                <div>
                  <span className={styles.label}>CURRENT OR MOST RECENT PLAN</span>
                  <h3>{overview.subscription.planName}</h3>
                  <p>{overview.subscription.planCode} · {overview.subscription.billingInterval.toLowerCase()}</p>
                </div>
                <span className={styles.status}>{status(overview.subscription.status)}</span>
              </div>
              <div className={styles.planFacts}>
                <div>
                  <span className={styles.label}>Plan price</span>
                  <strong><MoneyValue minor={overview.subscription.planAmountMinor}
                    currencyCode={overview.subscription.currencyCode} /></strong>
                </div>
                <div>
                  <span className={styles.label}>Period starts</span>
                  <strong>{date(overview.subscription.currentPeriodStartsAt)}</strong>
                </div>
                <div>
                  <span className={styles.label}>Period ends</span>
                  <strong>{date(overview.subscription.currentPeriodEndsAt)}</strong>
                </div>
                <div>
                  <span className={styles.label}>Trial ends</span>
                  <strong>{date(overview.subscription.trialEndsAt)}</strong>
                </div>
              </div>
              {overview.subscription.cancelAtPeriodEnd ? (
                <p className={styles.notice}>Cancellation at the end of the current period is recorded.</p>
              ) : null}
            </div>
          ) : (
            <p className={styles.notice}>No subscription plan has been assigned to this business yet.</p>
          )}
          <p className={styles.notice}>{overview.notice}</p>

          <div className={styles.history}>
            <h3>Invoices</h3>
            {overview.invoices.length ? (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead><tr>
                    <th scope="col">Invoice</th><th scope="col">Issued</th><th scope="col">Due</th>
                    <th scope="col">Status</th><th scope="col">Total</th>
                    <th scope="col">Paid</th><th scope="col">Outstanding</th>
                  </tr></thead>
                  <tbody>{overview.invoices.map((invoice)=>(
                    <tr key={invoice.id}>
                      <td><strong>{invoice.invoiceNumber}</strong></td>
                      <td>{date(invoice.issuedAt)}</td>
                      <td>{date(invoice.dueAt)}</td>
                      <td>{status(invoice.status)}</td>
                      <td><MoneyValue minor={invoice.totalMinor} currencyCode={invoice.currencyCode} /></td>
                      <td><MoneyValue minor={invoice.amountPaidMinor} currencyCode={invoice.currencyCode} /></td>
                      <td><MoneyValue minor={invoice.outstandingMinor} currencyCode={invoice.currencyCode} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className={styles.empty}>No subscription invoices have been issued yet.</p>}
            {overview.invoiceHistoryLimited ? (
              <p className={styles.notice}>Showing the 20 most recent invoices only.</p>
            ) : null}
          </div>

          <div className={styles.history}>
            <h3>Recorded payments</h3>
            {overview.payments.length ? (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead><tr>
                    <th scope="col">Invoice</th><th scope="col">Received</th>
                    <th scope="col">Method</th><th scope="col">Provider</th>
                    <th scope="col">Status</th><th scope="col">Amount</th>
                  </tr></thead>
                  <tbody>{overview.payments.map((payment)=>(
                    <tr key={payment.id}>
                      <td>{payment.invoiceNumber}</td>
                      <td>{date(payment.receivedAt)}</td>
                      <td>{payment.method}</td>
                      <td>{payment.provider}</td>
                      <td>{status(payment.status)}</td>
                      <td><MoneyValue minor={payment.amountMinor} currencyCode={payment.currencyCode} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className={styles.empty}>No subscription payments have been recorded yet.</p>}
            {overview.paymentHistoryLimited ? (
              <p className={styles.notice}>Showing the 20 most recent payments only.</p>
            ) : null}
          </div>
          <p className={styles.footnote}>
            Billing history is per business, not per branch. Figures reflect posted TradeOS subscription records;
            no payment can be initiated or completed on this screen yet.
          </p>
        </>
      )}
    </section>
  );
}
