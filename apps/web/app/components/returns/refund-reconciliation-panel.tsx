"use client";

import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { Button } from "../ui/button";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";

type Check = boolean | null;
type RefundPreflight = {
  refundId: string;
  refundStatus: "PENDING" | "FAILED" | "SUCCEEDED";
  expected: { amountMinor: number; currencyCode: string; method: string };
  originalPayment: {
    linked: boolean; status: string | null; amountMinor: number | null;
    currencyCode: string | null; method: string | null; referencePresent: boolean;
  };
  hubtel: {
    checkoutLinked: boolean;
    originalCheckoutReconciled: boolean;
    originalTransactionReferenceMatches: Check;
    providerRecheckAvailable: false;
  };
  checks: {
    amountWithinOriginalPayment: Check;
    currencyMatchesOriginalPayment: Check;
    refundDestinationProviderVerified: false;
    refundSpecificSettlementVerified: false;
  };
  blockers: string[];
  verdict: "PROVIDER_REFUND_PROOF_MISSING";
  providerFinality: "NOT_ESTABLISHED";
  canMarkPaid: false;
  paymentStatusUnchanged: true;
};
const REASONS: Record<string, string> = {
  REFUND_ALREADY_CLOSED: "Refund is already closed; review existing financial evidence.",
  ORIGINAL_PAYMENT_NOT_LINKED: "No original payment is linked to this refund.",
  ORIGINAL_PAYMENT_NOT_SETTLED: "Original payment is not recorded as settled.",
  ORIGINAL_PAYMENT_AMOUNT_INVALID: "Original payment amount is missing or invalid.",
  ORIGINAL_PAYMENT_CURRENCY_MISMATCH: "Currency does not match the original payment.",
  REFUND_AMOUNT_EXCEEDS_PAYMENT: "Refund is greater than its linked original payment.",
  ORIGINAL_PAYMENT_REFERENCE_MISSING: "Original provider transaction reference is missing.",
  HUBTEL_ORIGINAL_CHECKOUT_NOT_VERIFIED: "Hubtel original checkout has not been reconciled.",
  HUBTEL_ORIGINAL_CHECKOUT_MISMATCH: "Hubtel original checkout amount, currency, or account linkage conflicts.",
  HUBTEL_ORIGINAL_TRANSACTION_REFERENCE_CONFLICT: "Original Hubtel transaction reference conflicts with payment.",
  HUBTEL_ORDER_LEVEL_PARTIAL_REFUND_UNSUPPORTED: "Hubtel order-level refund cannot prove this partial amount.",
  REFUND_DESTINATION_NOT_PROVIDER_VERIFIED: "The refund destination has not been authenticated by the payout provider.",
  REFUND_SPECIFIC_SETTLEMENT_NOT_PROVIDER_VERIFIED: "No provider-authenticated settlement receipt for this specific refund is recorded.",
};
function outcome(value: Check): string {
  return value === true ? "Matched" : value === false ? "Mismatch" : "Not available";
}
export function RefundReconciliationPanel({ refundId }: { refundId: string }) {
  const { session } = useWorkspace();
  const path = session
    ? `/v1/refunds/reconciliation-preflight?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&refundId=${encodeURIComponent(refundId)}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<RefundPreflight>(path);
  // Don't render stale data after a refund or tenant switch.
  const snapshot = data?.refundId === refundId ? data : null;
  const safe = snapshot &&
    snapshot.verdict === "PROVIDER_REFUND_PROOF_MISSING" &&
    snapshot.providerFinality === "NOT_ESTABLISHED" &&
    snapshot.canMarkPaid === false &&
    snapshot.paymentStatusUnchanged === true &&
    snapshot.checks.refundDestinationProviderVerified === false &&
    snapshot.checks.refundSpecificSettlementVerified === false &&
    Array.isArray(snapshot.blockers) &&
    snapshot.blockers.includes("REFUND_DESTINATION_NOT_PROVIDER_VERIFIED") &&
    snapshot.blockers.includes("REFUND_SPECIFIC_SETTLEMENT_NOT_PROVIDER_VERIFIED") &&
    Number.isSafeInteger(snapshot.expected.amountMinor) &&
    snapshot.expected.amountMinor > 0 &&
    /^[A-Z]{3}$/.test(snapshot.expected.currencyCode) &&
    (snapshot.originalPayment.amountMinor === null ||
      (Number.isSafeInteger(snapshot.originalPayment.amountMinor) &&
        snapshot.originalPayment.amountMinor > 0)) &&
    (snapshot.originalPayment.currencyCode === null ||
      /^[A-Z]{3}$/.test(snapshot.originalPayment.currencyCode));
  return (
    <section className="tos-card tos-card--padded" aria-label="Refund reconciliation preflight"
      style={{ marginTop: 12 }}>
      <div className="tos-row" style={{ gap: 10, justifyContent: "space-between",
        alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h3 className="tos-section__title">Refund reconciliation preflight</h3>
          <p className="tos-section__sub">
            Checks the linked refund and original payment. This does not contact a provider or
            prove that money reached the customer.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refetch}>Refresh checks</Button>
      </div>
      {loading ? <p className="tos-section__sub" role="status">Checking refund records…</p> : null}
      {error ? <StatePanel inline variant="error" title="Could not load reconciliation"
        text={error} actionLabel="Retry" onAction={refetch} /> : null}
      {!loading && !error && snapshot && !safe ? (
        <p role="alert" className="tos-section__sub">
          Reconciliation response is incomplete or inconsistent. Treat this refund as unverified.
        </p>
      ) : null}
      {!loading && !error && safe && snapshot ? (
        <>
          <p role="status" className="tos-section__sub" style={{ fontWeight: 700 }}>
            Payout verification: Not established. No financial status will be changed.
          </p>
          <div className="tos-row" style={{ gap: 16, flexWrap: "wrap", marginTop: 10,
            marginBottom: 12 }}>
            <div>
              <span className="tos-section__sub">Expected refund</span>
              <div><MoneyValue minor={snapshot.expected.amountMinor}
                currencyCode={snapshot.expected.currencyCode} /> · {snapshot.expected.method}</div>
            </div>
            <div>
              <span className="tos-section__sub">Linked original payment</span>
              <div>{snapshot.originalPayment.amountMinor !== null &&
                snapshot.originalPayment.currencyCode
                ? <MoneyValue minor={snapshot.originalPayment.amountMinor}
                  currencyCode={snapshot.originalPayment.currencyCode} />
                : "Unavailable"} · {snapshot.originalPayment.status ?? "Unknown"}</div>
            </div>
          </div>
          <div className="tos-row" style={{ gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
            <span>Amount: <strong>{outcome(snapshot.checks.amountWithinOriginalPayment)}</strong></span>
            <span>Currency: <strong>{outcome(snapshot.checks.currencyMatchesOriginalPayment)}</strong></span>
            <span>Original Hubtel checkout: <strong>
              {snapshot.hubtel.checkoutLinked
                ? snapshot.hubtel.originalCheckoutReconciled ? "Reconciled" : "Not verified"
                : "Not linked"}
            </strong></span>
            <span>Refund destination: <strong>Not verified</strong></span>
          </div>
          <strong>What must be resolved</strong>
          <ul style={{ marginTop: 6, paddingLeft: 20 }}>
            {snapshot.blockers.map((reason) => (
              <li key={reason} style={{ marginBottom: 5, overflowWrap: "anywhere" }}>
                {REASONS[reason] ?? "Further review needed: " + reason}
              </li>
            ))}
          </ul>
          <p className="tos-section__sub">
            A Hubtel checkout marked reconciled confirms only the original payment.
            Refund completion requires an independently authenticated, refund-specific payout
            amount, currency, destination, and transaction reference. Staff notes and customer
            messages are not settlement evidence.
          </p>
        </>
      ) : null}
    </section>
  );
}
