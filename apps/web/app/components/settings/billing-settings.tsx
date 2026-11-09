"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  TenantBillingInvoiceSummary,
  TenantBillingOverview,
  TenantBillingPaymentSummary,
} from "@tradeos/contracts";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import type { WorkspaceRole } from "../workspace/workspace-navigation";
import { useWorkspace } from "../workspace/use-workspace";

export function canReadTenantBilling(role: WorkspaceRole | string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "ACCOUNTANT";
}

export function canManageTenantSubscription(role: WorkspaceRole | string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

type BillingFeedback = { tone: "success" | "error"; text: string } | null;
type TransitionAction = "CANCEL_AT_PERIOD_END" | "RESUME";

export function BillingSettings({ online }: { online: boolean }) {
  const { session, role } = useWorkspace();
  const [overview, setOverview] = useState<TenantBillingOverview | null>(null);
  const [invoices, setInvoices] = useState<TenantBillingInvoiceSummary[]>([]);
  const [payments, setPayments] = useState<TenantBillingPaymentSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationPending, setMutationPending] = useState<TransitionAction | null>(null);
  const [feedback, setFeedback] = useState<BillingFeedback>(null);
  const canRead = canReadTenantBilling(role);
  const canManage = canManageTenantSubscription(role);

  const loadBilling = useCallback(async () => {
    if (!session || !online || !canRead) return;
    setLoading(true);
    setError(null);
    const businessId = encodeURIComponent(session.businessId);
    try {
      const authFetch = getOfflineQueue().authenticatedFetch.bind(getOfflineQueue());
      const [overviewResponse, invoiceResponse, paymentResponse] = await Promise.all([
        authFetch(`/v1/billing/overview?businessId=${businessId}`),
        authFetch(`/v1/billing/invoices?businessId=${businessId}&limit=24`),
        authFetch(`/v1/billing/payments?businessId=${businessId}&limit=24`),
      ]);
      if (!overviewResponse.ok) throw new Error(await readApiErrorMessage(overviewResponse, "Billing overview could not be loaded"));
      if (!invoiceResponse.ok) throw new Error(await readApiErrorMessage(invoiceResponse, "Invoices could not be loaded"));
      if (!paymentResponse.ok) throw new Error(await readApiErrorMessage(paymentResponse, "Payments could not be loaded"));
      const [nextOverview, nextInvoices, nextPayments] = await Promise.all([
        overviewResponse.json() as Promise<TenantBillingOverview>,
        invoiceResponse.json() as Promise<{ items: TenantBillingInvoiceSummary[] }>,
        paymentResponse.json() as Promise<{ items: TenantBillingPaymentSummary[] }>,
      ]);
      setOverview(nextOverview);
      setInvoices(nextInvoices.items);
      setPayments(nextPayments.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Billing information could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [canRead, online, session]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const transitionSubscription = async (action: TransitionAction) => {
    if (!online || !canManage || !session || mutationPending) return;
    setMutationPending(action);
    setFeedback(null);
    try {
      const path = action === "CANCEL_AT_PERIOD_END"
        ? "/v1/billing/subscription/cancel-at-period-end"
        : "/v1/billing/subscription/resume";
      const response = await getOfflineQueue().authenticatedFetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: session.businessId }),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Subscription could not be updated"));
      setFeedback({
        tone: "success",
        text: action === "CANCEL_AT_PERIOD_END"
          ? "Cancellation is scheduled for the end of the current billing period."
          : "Your subscription will continue beyond the current billing period.",
      });
      await loadBilling();
    } catch (transitionError) {
      setFeedback({
        tone: "error",
        text: transitionError instanceof Error ? transitionError.message : "Subscription could not be updated.",
      });
    } finally {
      setMutationPending(null);
    }
  };

  if (!session) return null;

  if (!canRead) {
    return (
      <div className="tos-billing-settings">
        <BillingHeader />
        <div className="tos-settings__subpanel">
          <strong>Billing access is restricted</strong>
          <p>Owners, administrators and accountants can review subscription and billing information.</p>
        </div>
      </div>
    );
  }

  if (!online && !overview) {
    return (
      <div className="tos-billing-settings">
        <BillingHeader />
        <div className="tos-banner tos-banner--warning" role="status">
          <div className="tos-banner__body">
            <span className="tos-banner__title">Billing requires a verified connection</span>
            <span className="tos-banner__text">Reconnect to refresh your subscription, invoices and payments. Subscription changes are never queued offline.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tos-billing-settings">
      <BillingHeader />

      {feedback ? (
        <div className={`tos-banner ${feedback.tone === "error" ? "tos-banner--danger" : "tos-banner--success"}`} role="status">
          <div className="tos-banner__body"><span className="tos-banner__text">{feedback.text}</span></div>
        </div>
      ) : null}

      {error && !overview ? (
        <div className="tos-settings__subpanel">
          <strong>Billing information could not be loaded</strong>
          <p>{error}</p>
          <button type="button" className="tos-button tos-button--secondary" disabled={!online || loading} onClick={() => void loadBilling()}>
            {loading ? "Refreshing…" : "Try again"}
          </button>
        </div>
      ) : null}

      {loading && !overview ? <div className="tos-settings__subpanel">Loading billing information…</div> : null}

      {overview ? (
        <>
          <section className="tos-billing-settings__current tos-settings__subpanel">
            <div className="tos-billing-settings__section-head">
              <div>
                <span className="tos-settings__eyebrow">Current plan</span>
                <h2>{overview.subscription?.plan.name ?? "No active subscription"}</h2>
              </div>
              {overview.subscription ? <span className="tos-billing-settings__status">{humanize(overview.subscription.status)}</span> : null}
            </div>
            {overview.subscription ? (
              <div className="tos-billing-settings__summary-grid">
                <BillingFact label="Price" value={formatMoney(overview.subscription.plan.amountMinor, overview.subscription.plan.currencyCode)} />
                <BillingFact label="Billing cycle" value={humanize(overview.subscription.plan.billingInterval)} />
                <BillingFact label="Period ends" value={formatDate(overview.subscription.currentPeriodEndsAt)} />
                <BillingFact label="Renewal" value={overview.subscription.cancelAtPeriodEnd ? "Ends after this period" : "Continues automatically"} />
              </div>
            ) : (
              <p>No current subscription is attached to this business. Contact TradeOS support if you believe this is incorrect.</p>
            )}

            {overview.subscription && canManage ? (
              <div className="tos-billing-settings__actions">
                {overview.subscription.supportedActions.includes("CANCEL_AT_PERIOD_END") ? (
                  <button
                    type="button"
                    className="tos-button tos-button--secondary"
                    disabled={!online || mutationPending !== null}
                    onClick={() => void transitionSubscription("CANCEL_AT_PERIOD_END")}
                  >
                    {mutationPending === "CANCEL_AT_PERIOD_END" ? "Scheduling…" : "Cancel at period end"}
                  </button>
                ) : null}
                {overview.subscription.supportedActions.includes("RESUME") ? (
                  <button
                    type="button"
                    className="tos-button tos-button--primary"
                    disabled={!online || mutationPending !== null}
                    onClick={() => void transitionSubscription("RESUME")}
                  >
                    {mutationPending === "RESUME" ? "Resuming…" : "Resume subscription"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="tos-settings__subpanel">
            <div className="tos-billing-settings__section-head">
              <div><span className="tos-settings__eyebrow">Effective entitlements</span><h3>What this business can use</h3></div>
            </div>
            <div className="tos-billing-settings__entitlements">
              {overview.effectiveEntitlements.length ? overview.effectiveEntitlements.map((item) => (
                <div className="tos-billing-settings__entitlement" key={item.code}>
                  <span>{humanize(item.code)}</span><strong>{formatEntitlement(item.value)}</strong>
                </div>
              )) : <p>No plan entitlements are configured yet.</p>}
            </div>
          </section>

          <section className="tos-settings__subpanel">
            <div className="tos-billing-settings__section-head">
              <div><span className="tos-settings__eyebrow">Available plans</span><h3>Compare public TradeOS plans</h3></div>
            </div>
            <div className="tos-billing-settings__plans">
              {overview.publicPlans.map((plan) => (
                <article className="tos-billing-settings__plan" key={plan.id} data-current={overview.subscription?.plan.id === plan.id}>
                  <div><strong>{plan.name}</strong><span>{plan.description ?? "TradeOS subscription plan"}</span></div>
                  <b>{formatMoney(plan.amountMinor, plan.currencyCode)} <small>/ {humanize(plan.billingInterval).toLowerCase()}</small></b>
                  <span>{plan.entitlements.length} entitlement{plan.entitlements.length === 1 ? "" : "s"}</span>
                  {overview.subscription?.plan.id === plan.id ? <em>Current plan</em> : null}
                </article>
              ))}
              {!overview.publicPlans.length ? <p>No public plans are currently available.</p> : null}
            </div>
          </section>
        </>
      ) : null}

      <section className="tos-settings__subpanel">
        <div className="tos-billing-settings__section-head"><div><span className="tos-settings__eyebrow">Invoices</span><h3>Recent billing documents</h3></div></div>
        <div className="tos-billing-settings__history">
          {invoices.map((invoice) => (
            <div className="tos-billing-settings__history-row" key={invoice.id}>
              <div><strong>{invoice.invoiceNumber}</strong><span>{formatDate(invoice.createdAt)}</span></div>
              <span>{humanize(invoice.status)}</span>
              <div className="tos-billing-settings__amount"><strong>{formatMoney(invoice.totalMinor, invoice.currencyCode)}</strong><span>{formatMoney(invoice.balanceMinor, invoice.currencyCode)} due</span></div>
            </div>
          ))}
          {!loading && !invoices.length ? <p>No invoices yet.</p> : null}
        </div>
      </section>

      <section className="tos-settings__subpanel">
        <div className="tos-billing-settings__section-head"><div><span className="tos-settings__eyebrow">Payments</span><h3>Recent subscription payments</h3></div></div>
        <div className="tos-billing-settings__history">
          {payments.map((payment) => (
            <div className="tos-billing-settings__history-row" key={payment.id}>
              <div><strong>{payment.invoiceNumber ?? "Subscription payment"}</strong><span>{formatDate(payment.occurredAt)}</span></div>
              <span>{humanize(payment.status)}</span>
              <div className="tos-billing-settings__amount"><strong>{formatMoney(payment.amountMinor, payment.currencyCode)}</strong><span>{payment.settledAt ? `Settled ${formatDate(payment.settledAt)}` : "Settlement pending"}</span></div>
            </div>
          ))}
          {!loading && !payments.length ? <p>No subscription payments yet.</p> : null}
        </div>
      </section>
    </div>
  );
}

function BillingHeader() {
  return (
    <header className="tos-billing-settings__header">
      <div><span className="tos-settings__eyebrow">Commercial account</span><h2>Billing & subscription</h2></div>
      <p>Review the plan, effective access, invoices and payments for this business. Billing records remain protected and managed by TradeOS.</p>
    </header>
  );
}

function BillingFact({ label, value }: { label: string; value: string }) {
  return <div className="tos-billing-settings__fact"><span>{label}</span><strong>{value}</strong></div>;
}

function formatMoney(amountMinor: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(amountMinor / 100);
  } catch {
    return `${currencyCode} ${(amountMinor / 100).toFixed(2)}`;
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : "—";
}

function formatEntitlement(value: unknown): string {
  if (value === true) return "Included";
  if (value === false) return "Not included";
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}
