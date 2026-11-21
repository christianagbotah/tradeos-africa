import type { DatabasePool } from "./db.js";

/**
 * All-branch refund evidence attention indicators, scoped to unresolved
 * liabilities only. Each refund is counted at most once per bucket, even
 * when it has several evidence claims. Discrepancy and awaiting-review
 * buckets MAY overlap and must never be summed as new liabilities.
 *
 * These are merchant-reported observations, not provider payout receipts.
 */
export type RefundEvidenceCurrencyRollup = {
  currencyCode: string;
  missingCount: number;
  missingMinor: number;
  awaitingReviewCount: number;
  awaitingReviewMinor: number;
  discrepancyCount: number;
  discrepancyMinor: number;
  needsProviderCount: number;
  needsProviderMinor: number;
};

type RefundEvidenceRollupRow = {
  currency_code: string;
  missing_count: string | number;
  missing_minor: string | number;
  awaiting_review_count: string | number;
  awaiting_review_minor: string | number;
  discrepancy_count: string | number;
  discrepancy_minor: string | number;
  needs_provider_count: string | number;
  needs_provider_minor: string | number;
};
function safeNonnegative(raw: string | number): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Refund evidence summary exceeds safe minor-unit precision.");
  }
  return value;
}

export async function loadRefundEvidenceBranchRollup(
  pool: DatabasePool, businessId: string, branchId: string,
): Promise<RefundEvidenceCurrencyRollup[]> {
  const result = await pool.query<RefundEvidenceRollupRow>(
    `WITH refund_scope AS (
        SELECT rt.id,rt.currency_code,rt.amount_minor,
          (
            rt.method IN ('MOMO','CARD','BANK')
            OR (rt.method='ORIGINAL_METHOD'
              AND original_payment.method IN ('MOMO','CARD','BANK'))
          ) AS electronic_refund,
          evidence.claim_count,
          evidence.awaiting_review_count,
          evidence.discrepancy_count
        FROM refund_transactions rt
        JOIN return_cases rc ON rc.id=rt.return_case_id
          AND rc.business_id=rt.business_id AND rc.branch_id=$2
        LEFT JOIN payments original_payment
          ON original_payment.id=rt.original_payment_id
          AND original_payment.business_id=rt.business_id
          AND original_payment.branch_id=rc.branch_id
          AND original_payment.sale_id=rc.original_sale_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS claim_count,
            COUNT(*) FILTER (WHERE review.id IS NULL) AS awaiting_review_count,
            COUNT(*) FILTER (
              WHERE claim.reported_amount_minor<>rt.amount_minor
                OR claim.reported_currency<>rt.currency_code
                OR review.decision='DISCREPANCY_RECORDED'
            ) AS discrepancy_count
          FROM refund_provider_evidence_claims claim
          LEFT JOIN refund_provider_evidence_reviews review
            ON review.evidence_claim_id=claim.id
            AND review.business_id=rt.business_id
            AND review.branch_id=rc.branch_id
          WHERE claim.business_id=rt.business_id
            AND claim.branch_id=rc.branch_id
            AND claim.refund_transaction_id=rt.id
        ) evidence ON true
        WHERE rt.business_id=$1 AND rt.status IN ('PENDING','FAILED')
      )
      SELECT currency_code,
        COUNT(*) FILTER (
          WHERE electronic_refund AND claim_count=0
        ) AS missing_count,
        COALESCE(SUM(amount_minor) FILTER (
          WHERE electronic_refund AND claim_count=0
        ),0) AS missing_minor,
        COUNT(*) FILTER (
          WHERE awaiting_review_count>0
        ) AS awaiting_review_count,
        COALESCE(SUM(amount_minor) FILTER (
          WHERE awaiting_review_count>0
        ),0) AS awaiting_review_minor,
        COUNT(*) FILTER (
          WHERE discrepancy_count>0
        ) AS discrepancy_count,
        COALESCE(SUM(amount_minor) FILTER (
          WHERE discrepancy_count>0
        ),0) AS discrepancy_minor,
        COUNT(*) FILTER (
          WHERE claim_count>0 AND awaiting_review_count=0
            AND discrepancy_count=0
        ) AS needs_provider_count,
        COALESCE(SUM(amount_minor) FILTER (
          WHERE claim_count>0 AND awaiting_review_count=0
            AND discrepancy_count=0
        ),0) AS needs_provider_minor
      FROM refund_scope GROUP BY currency_code ORDER BY currency_code`,
    [businessId, branchId],
  );
  return result.rows.map(row => ({
    currencyCode: row.currency_code,
    missingCount: safeNonnegative(row.missing_count),
    missingMinor: safeNonnegative(row.missing_minor),
    awaitingReviewCount: safeNonnegative(row.awaiting_review_count),
    awaitingReviewMinor: safeNonnegative(row.awaiting_review_minor),
    discrepancyCount: safeNonnegative(row.discrepancy_count),
    discrepancyMinor: safeNonnegative(row.discrepancy_minor),
    needsProviderCount: safeNonnegative(row.needs_provider_count),
    needsProviderMinor: safeNonnegative(row.needs_provider_minor),
  }));
}
