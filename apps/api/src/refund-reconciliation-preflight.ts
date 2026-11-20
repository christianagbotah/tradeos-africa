import type { FastifyInstance } from "fastify";
import { requireBusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import type { DatabasePool } from "./db.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVIEW_ROLES = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"] as const;

class RefundReconciliationError extends Error {
  constructor(message: string, readonly statusCode = 400,
    readonly code = "REFUND_RECONCILIATION_INVALID") { super(message); }
}
type Row = {
  refund_id: string;
  refund_status: "PENDING" | "SUCCEEDED" | "FAILED";
  refund_amount_minor: string;
  refund_currency: string;
  refund_method: string;
  refund_provider_reference: string | null;
  original_payment_id: string | null;
  payment_id: string | null;
  payment_status: string | null;
  payment_amount_minor: string | null;
  payment_currency: string | null;
  payment_method: string | null;
  payment_provider_reference: string | null;
  attempt_id: string | null;
  attempt_state: string | null;
  attempt_amount_minor: string | null;
  attempt_currency: string | null;
  provider_transaction_id: string | null;
  merchant_collection_account: string | null;
  checkout_client_reference: string | null;
};
export type RefundReconciliationBlocker =
  | "REFUND_ALREADY_CLOSED" | "ORIGINAL_PAYMENT_NOT_LINKED"
  | "ORIGINAL_PAYMENT_NOT_SETTLED" | "ORIGINAL_PAYMENT_AMOUNT_INVALID"
  | "ORIGINAL_PAYMENT_CURRENCY_MISMATCH" | "REFUND_AMOUNT_EXCEEDS_PAYMENT"
  | "ORIGINAL_PAYMENT_REFERENCE_MISSING"
  | "HUBTEL_ORIGINAL_CHECKOUT_NOT_VERIFIED"
  | "HUBTEL_ORIGINAL_CHECKOUT_MISMATCH"
  | "HUBTEL_ORIGINAL_TRANSACTION_REFERENCE_CONFLICT"
  | "HUBTEL_ORDER_LEVEL_PARTIAL_REFUND_UNSUPPORTED"
  | "REFUND_DESTINATION_NOT_PROVIDER_VERIFIED"
  | "REFUND_SPECIFIC_SETTLEMENT_NOT_PROVIDER_VERIFIED";

export type RefundReconciliationPreflight = {
  refundId: string;
  refundStatus: Row["refund_status"];
  expected: { amountMinor: number; currencyCode: string; method: string };
  originalPayment: {
    linked: boolean; status: string | null;
    amountMinor: number | null; currencyCode: string | null;
    method: string | null; referencePresent: boolean;
  };
  hubtel: {
    checkoutLinked: boolean; originalCheckoutReconciled: boolean;
    originalTransactionReferenceMatches: boolean | null;
    providerRecheckAvailable: false;
  };
  checks: {
    amountWithinOriginalPayment: boolean | null;
    currencyMatchesOriginalPayment: boolean | null;
    refundDestinationProviderVerified: false;
    refundSpecificSettlementVerified: false;
  };
  blockers: RefundReconciliationBlocker[];
  verdict: "PROVIDER_REFUND_PROOF_MISSING";
  providerFinality: "NOT_ESTABLISHED";
  canMarkPaid: false;
  paymentStatusUnchanged: true;
};
function requiredId(value: string | undefined, name: string) {
  if (!value || !UUID.test(value)) throw new RefundReconciliationError(
    "Valid " + name + " is required.", 400, "REFUND_RECONCILIATION_ID_INVALID");
  return value;
}
function safeMinor(raw: string | null, field: string): number | null {
  if (raw === null) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(raw) ||
      !Number.isSafeInteger(Number(raw))) {
    throw new RefundReconciliationError(
      "Refund " + field + " exceeds supported precision.", 500,
      "REFUND_RECONCILIATION_AMOUNT_UNREPRESENTABLE");
  }
  return Number(raw);
}

/**
 * Read-only preflight, not provider verification. A payment-status lookup or
 * operator note cannot authenticate which destination received a REFUND.
 * We must fail closed until refund-specific provider evidence is integrated.
 */
export function classifyRefundReconciliation(row: Row): RefundReconciliationPreflight {
  const amountMinor = safeMinor(row.refund_amount_minor, "amount");
  if (amountMinor === null || amountMinor <= 0) throw new RefundReconciliationError(
    "Refund amount is invalid.", 500, "REFUND_RECONCILIATION_AMOUNT_UNREPRESENTABLE");
  const paymentMinor = safeMinor(row.payment_amount_minor, "original payment");
  const attemptMinor = safeMinor(row.attempt_amount_minor, "Hubtel checkout");
  const hasPayment = row.payment_id !== null &&
    row.original_payment_id === row.payment_id;
  const currencyMatches = hasPayment && row.payment_currency !== null
    ? row.payment_currency === row.refund_currency : null;
  const amountWithin = hasPayment && paymentMinor !== null
    ? amountMinor <= paymentMinor : null;
  const attempted = row.attempt_id !== null;
  const originalReferenceMatches = attempted &&
    row.payment_provider_reference && row.provider_transaction_id
    ? row.payment_provider_reference === row.provider_transaction_id : null;
  const checkoutReconciled = attempted &&
    row.attempt_state === "RECONCILED" &&
    row.provider_transaction_id !== null;
  const blockers: RefundReconciliationBlocker[] = [];
  if (row.refund_status === "SUCCEEDED") blockers.push("REFUND_ALREADY_CLOSED");
  if (!hasPayment) blockers.push("ORIGINAL_PAYMENT_NOT_LINKED");
  if (hasPayment && row.payment_status !== "SUCCEEDED") {
    blockers.push("ORIGINAL_PAYMENT_NOT_SETTLED");
  }
  if (hasPayment && (paymentMinor === null || paymentMinor <= 0)) {
    blockers.push("ORIGINAL_PAYMENT_AMOUNT_INVALID");
  }
  if (currencyMatches === false) blockers.push("ORIGINAL_PAYMENT_CURRENCY_MISMATCH");
  if (amountWithin === false) blockers.push("REFUND_AMOUNT_EXCEEDS_PAYMENT");
  if (hasPayment && !row.payment_provider_reference &&
      ["MOMO", "CARD", "BANK"].includes(row.payment_method ?? "")) {
    blockers.push("ORIGINAL_PAYMENT_REFERENCE_MISSING");
  }
  if (attempted) {
    if (!checkoutReconciled) blockers.push("HUBTEL_ORIGINAL_CHECKOUT_NOT_VERIFIED");
    if (row.attempt_currency !== row.payment_currency ||
        row.attempt_currency !== row.refund_currency ||
        attemptMinor !== paymentMinor ||
        !row.checkout_client_reference || !row.merchant_collection_account) {
      blockers.push("HUBTEL_ORIGINAL_CHECKOUT_MISMATCH");
    }
    if (originalReferenceMatches === false) {
      blockers.push("HUBTEL_ORIGINAL_TRANSACTION_REFERENCE_CONFLICT");
    }
    // The existing Hubtel refund adapter only supports a FULL order refund.
    if (paymentMinor !== amountMinor) {
      blockers.push("HUBTEL_ORDER_LEVEL_PARTIAL_REFUND_UNSUPPORTED");
    }
  }
  // The current refund transaction stores neither an authenticated
  // destination nor a provider refund receipt. These are always blockers,
  // even when the original checkout reports the order as REFUNDED.
  blockers.push("REFUND_DESTINATION_NOT_PROVIDER_VERIFIED");
  blockers.push("REFUND_SPECIFIC_SETTLEMENT_NOT_PROVIDER_VERIFIED");
  return {
    refundId: row.refund_id,
    refundStatus: row.refund_status,
    expected: {
      amountMinor, currencyCode: row.refund_currency, method: row.refund_method,
    },
    originalPayment: {
      linked: hasPayment, status: hasPayment ? row.payment_status : null,
      amountMinor: hasPayment ? paymentMinor : null,
      currencyCode: hasPayment ? row.payment_currency : null,
      method: hasPayment ? row.payment_method : null,
      referencePresent: hasPayment && Boolean(row.payment_provider_reference),
    },
    hubtel: {
      checkoutLinked: attempted,
      originalCheckoutReconciled: checkoutReconciled,
      originalTransactionReferenceMatches: originalReferenceMatches,
      providerRecheckAvailable: false,
    },
    checks: {
      amountWithinOriginalPayment: amountWithin,
      currencyMatchesOriginalPayment: currencyMatches,
      refundDestinationProviderVerified: false,
      refundSpecificSettlementVerified: false,
    },
    blockers,
    verdict: "PROVIDER_REFUND_PROOF_MISSING",
    providerFinality: "NOT_ESTABLISHED",
    canMarkPaid: false,
    paymentStatusUnchanged: true,
  };
}
function sendError(request: { log: { error: (error: unknown) => void } },
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
  error: unknown) {
  if (error instanceof RefundReconciliationError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({error: error.code, message: error.message});
  }
  request.log.error(error);
  return reply.code(500).send({error: "REFUND_RECONCILIATION_FAILED",
    message: "Refund reconciliation could not be loaded."});
}
export function registerRefundReconciliationRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{Querystring: {businessId?: string; branchId?: string; refundId?: string}}>(
    "/v1/refunds/reconciliation-preflight", async (request, reply) => {
      reply.header("Cache-Control", "private, no-store, max-age=0");
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const businessId = requiredId(request.query.businessId, "business ID");
        const branchId = requiredId(request.query.branchId, "branch ID");
        const refundId = requiredId(request.query.refundId, "refund ID");
        await requireBusinessRole(pool, auth, businessId, REVIEW_ROLES);
        const branch = await pool.query(
          "SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true",
          [branchId, businessId]);
        if (branch.rowCount !== 1) throw new RefundReconciliationError(
          "Branch is not available to this business.", 404,
          "REFUND_RECONCILIATION_BRANCH_NOT_FOUND");
        const result = await pool.query<Row>(
          `SELECT rt.id AS refund_id,rt.status AS refund_status,
                  rt.amount_minor::text AS refund_amount_minor,
                  rt.currency_code AS refund_currency,rt.method AS refund_method,
                  rt.provider_reference AS refund_provider_reference,
                  rt.original_payment_id,p.id AS payment_id,p.status AS payment_status,
                  p.amount_minor::text AS payment_amount_minor,
                  p.currency_code AS payment_currency,p.method AS payment_method,
                  p.provider_reference AS payment_provider_reference,
                  a.id AS attempt_id,a.state AS attempt_state,
                  a.expected_amount_minor::text AS attempt_amount_minor,
                  a.currency_code AS attempt_currency,
                  a.verified_provider_transaction_id AS provider_transaction_id,
                  a.merchant_collection_account,a.client_reference AS checkout_client_reference
             FROM refund_transactions rt
             JOIN return_cases rc ON rc.id=rt.return_case_id
                 AND rc.business_id=rt.business_id AND rc.branch_id=$3
             LEFT JOIN payments p ON p.id=rt.original_payment_id
                 AND p.business_id=rt.business_id
                 AND p.branch_id=rc.branch_id AND p.sale_id=rc.original_sale_id
             LEFT JOIN hubtel_sale_checkout_attempts a ON a.payment_id=p.id
                 AND a.business_id=rt.business_id
                 AND a.branch_id=rc.branch_id AND a.sale_id=rc.original_sale_id
            WHERE rt.id=$1 AND rt.business_id=$2`,
          [refundId, businessId, branchId]);
        if (result.rowCount !== 1) throw new RefundReconciliationError(
          "Refund was not found in this branch.", 404,
          "REFUND_RECONCILIATION_NOT_FOUND");
        return classifyRefundReconciliation(result.rows[0]!);
      } catch (error) { return sendError(request, reply, error); }
    });
}
