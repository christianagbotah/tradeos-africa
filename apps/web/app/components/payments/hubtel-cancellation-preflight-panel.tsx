"use client";

import { formatMoney } from "@tradeos/contracts";
import { useApiFetch } from "../../../lib/use-api-fetch";
import styles from "./hubtel-reconciliation-workspace.module.css";

type CancellationAssessment = {
  saleId: string;
  currencyCode: string;
  checkoutAmountMinor: number;
  recordedCostBasisMinor: number;
  costEvidenceComplete: boolean;
  saleStatus: string;
  paymentStatus: string;
  checkoutState: string;
  assessedAt: string;
  saleLineCount: number;
  stockToReview: Array<{
    sourceMovementId: string;
    itemId: string;
    itemName: string;
    stockUnitCode: string;
    quantityToReview: string;
    consumptionReason: string;
    consumedCostMinor: number | null;
  }>;
  blockers: string[];
  permission: "REVIEW_ONLY";
  canReleaseStock: false;
};

function readableReason(value: string): string {
  const explanations: Record<string, string> = {
    HISTORICAL_STOCK_COST_ALLOCATION_MISSING:
      "This older sale did not record a separate historic cost for every stock item. Do not reconstruct it using today's stock valuation.",
    SOURCE_COST_BASIS_MISMATCH:
      "Original component costs do not add up to the sale line's historical cost.",
    HUBTEL_PAYMENT_FINALITY_NOT_ESTABLISHED:
      "Hubtel has not provided guaranteed cancellation finality; late payment is still possible.",
    ATOMIC_STOCK_REVERSAL_NOT_ENABLED:
      "Exact-once inventory and valuation reversal is not authorized or enabled.",
    SALE_OR_PAYMENT_ALREADY_SETTLED:
      "The payment or sale has already moved out of its open, pending state.",
    CHECKOUT_INITIATION_OUTCOME_UNCERTAIN:
      "Checkout initiation might have reached Hubtel; independent investigation is required.",
    PROVIDER_MANUAL_REVIEW_REQUIRED:
      "A prior provider status check required manual investigation.",
    SOURCE_STOCK_JOURNAL_MISMATCH:
      "Original stock movements do not reconcile to the recorded sale lines.",
    COMPONENT_VALUATION_ALLOCATION_REVIEW:
      "Service or recipe components require individual valuation checks.",
    SALE_LINES_MISSING: "The original sale line record is missing.",
    UNSUPPORTED_SALE_ITEM_KIND: "The sale has an unsupported line-item kind.",
  };
  return explanations[value] ?? value.replaceAll("_", " ").toLowerCase();
}
function quantity(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export function HubtelCancellationPreflightPanel({ saleId, businessId, onClose }: {
  saleId: string; businessId: string; onClose: () => void;
}) {
  const path = `/v1/sales/${encodeURIComponent(saleId)}/hubtel/cancellation-preflight?businessId=${encodeURIComponent(businessId)}`;
  const { data, error, loading, refetch } = useApiFetch<{ assessment: CancellationAssessment }>(path);
  const assessment = data?.assessment;
  const verifiedStructure = assessment?.saleId === saleId &&
    assessment?.permission === "REVIEW_ONLY" && assessment?.canReleaseStock === false &&
    Array.isArray(assessment.stockToReview) && Array.isArray(assessment.blockers) &&
    Number.isSafeInteger(assessment.checkoutAmountMinor) &&
    Number.isSafeInteger(assessment.recordedCostBasisMinor) &&
    typeof assessment.costEvidenceComplete === "boolean" &&
    assessment.stockToReview.every((movement) => movement &&
      (movement.consumedCostMinor === null ||
        (Number.isSafeInteger(movement.consumedCostMinor) &&
          movement.consumedCostMinor >= 0)));
  return <section className={styles.impact} aria-label="Read-only cancellation impact assessment">
    <div className={styles.impactHead}>
      <div>
        <h3>Stock and cost impact review</h3>
        <p>Read-only assessment. This is not payment cancellation or permission to restore stock.</p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={refetch}>Refresh</button>
        <button type="button" className={styles.secondary} onClick={onClose}>Close</button>
      </div>
    </div>
    {loading && !data ? <p>Checking original sale and stock journal…</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {data && !verifiedStructure ? <p role="alert" className={styles.error}>
      Cancellation impact could not be verified. No financial or stock changes have been made.
    </p> : null}
    {verifiedStructure && assessment ? <>
      <div className={styles.impactTotals}>
        <span>Unverified checkout amount
          <strong>{formatMoney(assessment.checkoutAmountMinor, assessment.currencyCode)}</strong>
        </span>
        <span>Recorded historical cost basis
          <strong>{formatMoney(assessment.recordedCostBasisMinor, assessment.currencyCode)}</strong>
        </span>
        <span>Original sale lines <strong>{assessment.saleLineCount}</strong></span>
      </div>
      <p className={styles.review}>Status: {assessment.saleStatus} sale,
        {assessment.paymentStatus} payment, {assessment.checkoutState} checkout.
        Assessed at {assessment.assessedAt}. A subsequent provider result can change this status.</p>
      {assessment.costEvidenceComplete ? (
        <p role="status">Each stock movement has an original recorded cost basis
          reconciled to the sale line. Payment cancellation remains blocked.</p>
      ) : (
        <p role="alert" className={styles.review}>
          Historical stock-cost evidence is incomplete or inconsistent. Review
          original purchase and inventory records; do not estimate past costs
          using current stock averages.
        </p>
      )}
      <h4>Original stock consumption (review only)</h4>
      {assessment.stockToReview.length === 0 ? (
        <p>No original stock movement was found. This can be normal for a non-stock service,
          but it does not establish that cancellation is safe.</p>
      ) : (
        <div className={styles.impactList}>
          {assessment.stockToReview.map((movement) => (
            <div key={movement.sourceMovementId} className={styles.impactRow}>
              <strong>{movement.itemName}</strong>
              <span>{quantity(movement.quantityToReview)} {movement.stockUnitCode}
                {" · "}{movement.consumptionReason.replaceAll("_", " ").toLowerCase()}
                {" · "}{movement.consumedCostMinor === null ? "Historical cost unavailable" :
                  formatMoney(movement.consumedCostMinor, assessment.currencyCode)}</span>
            </div>
          ))}
        </div>
      )}
      <h4>Why cancellation is blocked</h4>
      <ul className={styles.impactBlockers}>
        {assessment.blockers.map((reason) => <li key={reason}>{readableReason(reason)}</li>)}
      </ul>
      <p className={styles.review}><strong>Stock release is prohibited.</strong> This preview
        does not contact Hubtel, void a checkout, reverse inventory, edit COGS or post cashbook
        entries. Escalate to merchant support with independent payment evidence.</p>
    </> : null}
  </section>;
}
