import type { DatabasePool } from "../db.js";
import { posFail } from "./hubtel-pos-config.js";
import { readHubtelCancellationInvestigation } from "./hubtel-cancellation-investigation.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/;
const UNITS = 100_000_000n;

type CheckoutRow = {
  sale_id: string;
  branch_id: string;
  sale_status: string;
  payment_status: string;
  attempt_state: string;
  amount_minor: string;
  currency_code: string;
  created_at: Date;
};
type SaleLine = {
  id: string;
  item_kind: string;
  item_name_snapshot: string;
  stock_quantity: string | null;
  stock_unit_code: string | null;
  line_cost_minor: string;
};
type StockRow = {
  id: string;
  reference_id: string;
  item_id: string;
  item_name: string;
  stock_unit_code: string;
  quantity_delta: string;
  reason: string;
  location_type: string;
  consumed_cost_minor: string | null;
};

/** Exact decimal arithmetic prevents loss of stock precision (numeric(24,8)). */
function units(value: string): bigint {
  const match = DECIMAL.exec(value);
  if (!match) posFail("Stock movement data is not representable.",
    "HUBTEL_CANCEL_STOCK_PRECISION_INVALID", 500);
  return BigInt(match[1]!) * UNITS + BigInt((match[2] ?? "").padEnd(8, "0"));
}
function safeMinor(value: string, name: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
    posFail("Checkout " + name + " exceeds supported precision.",
      "HUBTEL_CANCEL_AMOUNT_PRECISION_INVALID", 500);
  }
  return Number(value);
}

/**
 * Read-only cancellation preflight. NO payment finality is proven here:
 * a Hubtel UNPAID response, elapsed time, or return URL must never authorize
 * stock release. Actual cancellation will require provider-guaranteed finality
 * and an atomic, audited reversal transaction not yet enabled.
 */
export async function getHubtelCancellationPreflight(
  pool: DatabasePool, input: { businessId: string; saleId: string },
) {
  if (!UUID.test(input.businessId) || !UUID.test(input.saleId)) {
    posFail("A valid business and sale are required.", "HUBTEL_CANCEL_ID_INVALID", 400);
  }
  const checkout = (await pool.query<CheckoutRow>(
    `SELECT s.id AS sale_id,s.branch_id,s.status AS sale_status,
            p.status AS payment_status,a.state AS attempt_state,
            a.expected_amount_minor::text AS amount_minor,a.currency_code,
            a.created_at
       FROM hubtel_sale_checkout_attempts a
       JOIN sales s ON s.id=a.sale_id AND s.business_id=a.business_id
                  AND s.branch_id=a.branch_id
       JOIN payments p ON p.id=a.payment_id AND p.business_id=a.business_id
                      AND p.branch_id=a.branch_id AND p.sale_id=s.id
      WHERE a.business_id=$1 AND a.sale_id=$2`,
    [input.businessId, input.saleId],
  )).rows[0];
  if (!checkout) posFail("Hubtel checkout was not found.",
    "HUBTEL_CANCEL_CHECKOUT_NOT_FOUND", 404);

  const lines = (await pool.query<SaleLine>(
    `SELECT id,item_kind,item_name_snapshot,stock_quantity::text,
            stock_unit_code,line_cost_minor::text
       FROM sale_lines
      WHERE business_id=$1 AND sale_id=$2 ORDER BY id`,
    [input.businessId, input.saleId],
  )).rows;
  const movements = (await pool.query<StockRow>(
    `SELECT im.id,im.reference_id,im.item_id,ci.name AS item_name,
            im.stock_unit_code,im.quantity_delta::text,
            im.reason,im.location_type,
            sc.consumed_cost_minor::text
       FROM inventory_movements im
       JOIN sale_lines sl ON sl.id=im.reference_id
                         AND sl.business_id=im.business_id
       JOIN catalog_items ci ON ci.id=im.item_id
                            AND ci.business_id=im.business_id
       LEFT JOIN sale_stock_cost_allocations sc
         ON sc.inventory_movement_id=im.id
        AND sc.business_id=im.business_id
        AND sc.branch_id=im.branch_id
      WHERE im.business_id=$1 AND im.branch_id=$2
        AND sl.sale_id=$3 AND im.reference_type='SALE_LINE'
      ORDER BY im.id`,
    [input.businessId, checkout.branch_id, checkout.sale_id],
  )).rows;

  const blockers = new Set<string>();
  if (checkout.sale_status !== "OPEN" || checkout.payment_status !== "PENDING" ||
      checkout.attempt_state === "RECONCILED") {
    blockers.add("SALE_OR_PAYMENT_ALREADY_SETTLED");
  }
  if (checkout.attempt_state === "PREPARED") {
    blockers.add("CHECKOUT_INITIATION_OUTCOME_UNCERTAIN");
  }
  if (checkout.attempt_state === "REVIEW_REQUIRED") {
    blockers.add("PROVIDER_MANUAL_REVIEW_REQUIRED");
  }
  if (lines.length === 0) blockers.add("SALE_LINES_MISSING");
  let totalCost = 0n;
  for (const line of lines) {
    totalCost += BigInt(safeMinor(line.line_cost_minor, "cost basis"));
    const source = movements.filter((m) => m.reference_id === line.id);
    // Compare summed historical per-movement valuation with the recorded
    // original sale-line cost. Missing allocations on legacy sales are
    // reported as unavailable, never fabricated from a current average cost.
    if (source.some((m) => m.consumed_cost_minor === null)) {
      blockers.add("HISTORICAL_STOCK_COST_ALLOCATION_MISSING");
    } else {
      const allocatedMinor = source.reduce((sum, m) =>
        sum + BigInt(safeMinor(m.consumed_cost_minor!, "source cost")), 0n);
      if (allocatedMinor !== BigInt(safeMinor(line.line_cost_minor, "line cost"))) {
        blockers.add("SOURCE_COST_BASIS_MISMATCH");
      }
    }
    if (line.item_kind === "PRODUCT" && line.stock_quantity !== null) {
      const expected = units(line.stock_quantity);
      let actual = 0n;
      for (const m of source) {
        if (m.reason !== "SALE" || m.location_type !== "AVAILABLE" ||
            m.stock_unit_code !== line.stock_unit_code ||
            !m.quantity_delta.startsWith("-")) {
          blockers.add("SOURCE_STOCK_JOURNAL_MISMATCH");
          continue;
        }
        actual += units(m.quantity_delta.slice(1));
      }
      if (actual !== expected) blockers.add("SOURCE_STOCK_JOURNAL_MISMATCH");
    }
    if (line.item_kind !== "PRODUCT" &&
        !["SERVICE", "PREPARED_PRODUCT"].includes(line.item_kind)) {
      blockers.add("UNSUPPORTED_SALE_ITEM_KIND");
    }
    if (line.item_kind === "SERVICE" || line.item_kind === "PREPARED_PRODUCT") {
      for (const m of source) {
        const validReason = m.reason === (line.item_kind === "SERVICE"
          ? "SERVICE_CONSUMPTION" : "RECIPE_CONSUMPTION");
        if (!validReason || m.location_type !== "AVAILABLE" ||
            !m.quantity_delta.startsWith("-")) {
          blockers.add("SOURCE_STOCK_JOURNAL_MISMATCH");
        }
      }
      if (source.length > 0 && source.some((m) => m.consumed_cost_minor === null)) {
        blockers.add("COMPONENT_VALUATION_ALLOCATION_REVIEW");
      }
      if (source.length === 0 && safeMinor(line.line_cost_minor, "line cost") > 0) {
        blockers.add("SOURCE_STOCK_JOURNAL_MISMATCH");
      }
    }
    if (line.item_kind === "PRODUCT" && line.stock_quantity === null &&
        source.length > 0) blockers.add("SOURCE_STOCK_JOURNAL_MISMATCH");
  }

  // Source rows are ledger evidence only. Their arithmetic inverse is a
  // proposed restoration, NOT a stock movement that can currently be posted.
  const stockToReview = movements.filter((m) => m.quantity_delta.startsWith("-"))
    .map((m) => ({
      sourceMovementId: m.id,
      itemId: m.item_id,
      itemName: m.item_name,
      stockUnitCode: m.stock_unit_code,
      quantityToReview: m.quantity_delta.slice(1),
      consumptionReason: m.reason,
      consumedCostMinor: m.consumed_cost_minor === null
        ? null : safeMinor(m.consumed_cost_minor, "component cost"),
    }));
  const investigation = await readHubtelCancellationInvestigation(
    pool, input.businessId, input.saleId);
  const recordedCostBasisMinor = safeMinor(totalCost.toString(), "total cost");
  blockers.add("HUBTEL_PAYMENT_FINALITY_NOT_ESTABLISHED");
  blockers.add("ATOMIC_STOCK_REVERSAL_NOT_ENABLED");
  return {
    saleId: checkout.sale_id,
    branchId: checkout.branch_id,
    currencyCode: checkout.currency_code,
    checkoutAmountMinor: safeMinor(checkout.amount_minor, "amount"),
    recordedCostBasisMinor,
    costEvidenceComplete: !blockers.has("HISTORICAL_STOCK_COST_ALLOCATION_MISSING") &&
      !blockers.has("SOURCE_COST_BASIS_MISMATCH") &&
      !blockers.has("SOURCE_STOCK_JOURNAL_MISMATCH"),
    saleStatus: checkout.sale_status,
    paymentStatus: checkout.payment_status,
    checkoutState: checkout.attempt_state,
    checkoutCreatedAt: checkout.created_at.toISOString(),
    assessedAt: new Date().toISOString(),
    saleLineCount: lines.length,
    stockToReview,
    blockers: [...blockers],
    permission: "REVIEW_ONLY" as const,
    canReleaseStock: false as const,
    investigation,
  };
}
