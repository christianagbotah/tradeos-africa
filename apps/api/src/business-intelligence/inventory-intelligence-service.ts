import type { InventoryAdvisoryItem, InventoryDemandConfidence, InventoryIntelligenceReport } from "@tradeos/contracts";
import { withTransaction, type DatabasePool } from "../db.js";

type Row = {
  id: string; sku: string | null; name: string; stock_unit_code: string;
  available: string | number; inventory_value_minor: string | number;
  sold_30: string | number; returned_30: string | number;
  sale_movements_30: string | number; sale_movements_90: string | number;
  first_movement_at: Date | null; last_sale_at: Date | null;
};
const DAY_MS = 86_400_000;
const MAX_ITEMS = 1000;
export type InventoryPlanningHorizon = 7 | 14 | 30;

export class InventoryIntelligenceError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "INVENTORY_ADVISORY_INVALID") {
    super(message);
  }
}

/**
 * Uses authoritative stock movements and current valuations, in one read-only
 * reporting snapshot. No guessed supplier lead times, AI-generated quantities
 * or automated economic mutations.
 */
export async function loadInventoryIntelligence(
  pool: DatabasePool, businessId: string, branchId: string,
  planningHorizonDays: InventoryPlanningHorizon = 14, asOf = new Date(),
): Promise<InventoryIntelligenceReport> {
  if (![7, 14, 30].includes(planningHorizonDays)) {
    throw new InventoryIntelligenceError("Planning horizon must be 7, 14 or 30 days");
  }
  return withTransaction(pool, async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const scope = await client.query<{ currency_code: string }>(
      "SELECT b.currency_code FROM businesses b JOIN branches br ON br.business_id=b.id " +
      "WHERE b.id=$1 AND br.id=$2 AND b.status='ACTIVE' AND br.is_active=true",
      [businessId, branchId],
    );
    if (!scope.rows[0]) {
      throw new InventoryIntelligenceError("Business branch is unavailable", 404, "INVENTORY_BRANCH_NOT_FOUND");
    }
    const rows = await client.query<Row>(
      [
        "WITH movement AS (",
        "  SELECT im.item_id,",
        "  COALESCE(SUM(im.quantity_delta) FILTER (",
        "    WHERE im.location_type='AVAILABLE' AND im.occurred_at<=$3::timestamptz),0) AS available,",
        "  COALESCE(SUM(-im.quantity_delta) FILTER (",
        "    WHERE im.reason='SALE' AND im.quantity_delta<0",
        "      AND im.occurred_at>$3::timestamptz-interval '30 days'",
        "      AND im.occurred_at<=$3::timestamptz),0) AS sold_30,",
        "  COALESCE(SUM(im.quantity_delta) FILTER (",
        "    WHERE im.reason='SALE_RETURN' AND im.quantity_delta>0",
        "      AND im.occurred_at>$3::timestamptz-interval '30 days'",
        "      AND im.occurred_at<=$3::timestamptz),0) AS returned_30,",
        "  COUNT(*) FILTER (WHERE im.reason='SALE' AND im.quantity_delta<0",
        "    AND im.occurred_at>$3::timestamptz-interval '30 days'",
        "    AND im.occurred_at<=$3::timestamptz)::integer AS sale_movements_30,",
        "  COUNT(*) FILTER (WHERE im.reason='SALE' AND im.quantity_delta<0",
        "    AND im.occurred_at>$3::timestamptz-interval '90 days'",
        "    AND im.occurred_at<=$3::timestamptz)::integer AS sale_movements_90,",
        "  MIN(im.occurred_at) FILTER (WHERE im.occurred_at<=$3::timestamptz) AS first_movement_at,",
        "  MAX(im.occurred_at) FILTER (WHERE im.reason='SALE' AND im.quantity_delta<0",
        "    AND im.occurred_at<=$3::timestamptz) AS last_sale_at",
        "  FROM inventory_movements im",
        "  WHERE im.business_id=$1 AND im.branch_id=$2",
        "  GROUP BY im.item_id",
        "), valuations AS (",
        "  SELECT item_id,COALESCE(SUM(value_minor),0) AS inventory_value_minor",
        "  FROM inventory_valuations WHERE business_id=$1 AND branch_id=$2 GROUP BY item_id",
        ")",
        "SELECT ci.id,ci.sku,ci.name,ci.stock_unit_code,",
        "  COALESCE(m.available,0) AS available,",
        "  COALESCE(v.inventory_value_minor,0) AS inventory_value_minor,",
        "  COALESCE(m.sold_30,0) AS sold_30,",
        "  COALESCE(m.returned_30,0) AS returned_30,",
        "  COALESCE(m.sale_movements_30,0) AS sale_movements_30,",
        "  COALESCE(m.sale_movements_90,0) AS sale_movements_90,",
        "  m.first_movement_at,m.last_sale_at",
        "FROM catalog_items ci",
        "LEFT JOIN movement m ON m.item_id=ci.id",
        "LEFT JOIN valuations v ON v.item_id=ci.id",
        "WHERE ci.business_id=$1 AND ci.kind='PRODUCT' AND ci.track_stock=true",
        "  AND ci.is_active=true AND ci.stock_unit_code IS NOT NULL",
        "ORDER BY ci.name,ci.id LIMIT $4::integer",
      ].join(" "),
      [businessId, branchId, asOf.toISOString(), MAX_ITEMS + 1],
    );
    const items = rows.rows.slice(0, MAX_ITEMS).map((row) =>
      evaluateInventoryAdvisory(row, asOf, planningHorizonDays));
    return {
      businessId, branchId, generatedAt: asOf.toISOString(),
      currencyCode: scope.rows[0].currency_code,
      planningHorizonDays, observationWindowDays: 30,
      evaluatedItemCount: items.length,
      truncated: rows.rows.length > MAX_ITEMS,
      summary: {
        outOfStock: items.filter((x) => x.status === "OUT_OF_STOCK").length,
        reorderReview: items.filter((x) => x.status === "REORDER_REVIEW").length,
        slowMoving: items.filter((x) => x.status === "SLOW_MOVING").length,
        overstockReview: items.filter((x) => x.status === "OVERSTOCK_REVIEW").length,
        insufficientData: items.filter((x) => x.confidence === "INSUFFICIENT").length,
        potentialInventoryValueMinor: items.filter((x) =>
          x.status === "SLOW_MOVING" || x.status === "OVERSTOCK_REVIEW")
          .reduce((total, x) => total + x.inventoryValueMinor, 0),
      },
      items,
      methodology: "Uses current branch stock movements and recorded sales and returns in the past 30 days. " +
        "The user-selected planning horizon is a scenario, not a supplier lead time or guaranteed forecast. " +
        "Reorder review quantities exclude safety stock, incoming deliveries, reservations and pack sizes. " +
        "No purchases, stock adjustments or payments are created.",
    };
  });
}

/** Pure, deterministic explanation; incomplete histories never produce a reorder quantity. */
export function evaluateInventoryAdvisory(
  row: Row, asOf: Date, horizonDays: InventoryPlanningHorizon,
): InventoryAdvisoryItem {
  const available = Number(row.available);
  const sold = Math.max(0, Number(row.sold_30) - Number(row.returned_30));
  const sales = Number(row.sale_movements_30);
  const sales90 = Number(row.sale_movements_90);
  const first = row.first_movement_at ? new Date(row.first_movement_at) : null;
  const historyDays = first ? (asOf.getTime() - first.getTime()) / DAY_MS : 0;
  const confidence: InventoryDemandConfidence =
    historyDays < 30 || sales === 0 ? "INSUFFICIENT"
      : sales < 5 || sold <= 0 ? "LIMITED" : "ESTABLISHED";
  const daily = confidence === "ESTABLISHED" ? sold / 30 : null;
  const coverDays = daily && daily > 0 && available > 0
    ? Math.round(available / daily * 10) / 10 : null;
  let status: InventoryAdvisoryItem["status"] = "INSUFFICIENT_DATA";
  let explanation = "Not enough recorded stock/sales history for a reliable demand estimate.";
  let suggestedReviewQuantity: number | null = null;

  if (available > 0 && historyDays >= 90 && sales90 === 0) {
    status = "SLOW_MOVING";
    explanation = "No stock-depleting sales recorded during the past 90 days; review whether this stock is needed.";
  } else if (confidence === "ESTABLISHED" && daily !== null) {
    const required = daily * horizonDays;
    if (available <= 0) {
      status = "OUT_OF_STOCK";
      suggestedReviewQuantity = roundUpStockUnits(required - available);
      explanation = "No available stock remains, but actual recorded sales suggest demand. Review replenishment.";
    } else if (available < required) {
      status = "REORDER_REVIEW";
      suggestedReviewQuantity = roundUpStockUnits(required - available);
      explanation = "Current stock is below the selected days-of-demand scenario. Verify delivery lead times and pack sizes.";
    } else if (coverDays !== null && coverDays > 90) {
      status = "OVERSTOCK_REVIEW";
      explanation = "Available stock represents over 90 days at the trailing 30-day observed sales rate.";
    } else {
      status = "HEALTHY";
      explanation = "Recorded sales and available stock cover the selected planning horizon.";
    }
  } else if (confidence === "LIMITED") {
    explanation = "Some sales exist, but too few observations or significant returns make a demand estimate unreliable.";
  }
  return {
    itemId: row.id, sku: row.sku, name: row.name, stockUnitCode: row.stock_unit_code,
    available, inventoryValueMinor: Number(row.inventory_value_minor),
    netSold30Days: sold, salesMovementCount30Days: sales,
    firstStockMovementAt: first?.toISOString() ?? null,
    lastSaleAt: row.last_sale_at ? new Date(row.last_sale_at).toISOString() : null,
    status, confidence,
    averageDailyDemand: daily === null ? null : Math.round(daily * 1000) / 1000,
    estimatedCoverDays: coverDays,
    suggestedReviewQuantity,
    explanation,
  };
}

function roundUpStockUnits(n: number): number {
  return Math.ceil(Math.max(0, n) * 1000 - 0.000001) / 1000;
}
