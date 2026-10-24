import type {
  BusinessAttentionItem,
  BusinessAttentionSeverity,
  BusinessEvidenceReference,
} from "@tradeos/contracts";
import { withTransaction, type DatabaseClient, type DatabasePool } from "../db.js";
import { CashForecastReportError, getCashForecastReport } from "../cash-forecast.js";
import type { CashForecastResponse } from "@tradeos/contracts";

export const BUSINESS_ATTENTION_RULE_CODES = [
  "CASH_PRESSURE_FORECAST",
  "RECEIVABLES_OVERDUE",
  "PAYABLES_OVERDUE",
  "SALES_DROP",
  "MARGIN_PRESSURE",
  "STOCKOUT_RISK",
  "SLOW_STOCK",
  "WASTAGE_SPIKE",
  "LOW_DATA_CONFIDENCE",
] as const;

export const FINANCIAL_BUSINESS_ATTENTION_RULE_CODES = new Set<string>([
  "CASH_PRESSURE_FORECAST",
  "RECEIVABLES_OVERDUE",
  "PAYABLES_OVERDUE",
  "SALES_DROP",
  "MARGIN_PRESSURE",
]);

type Signal = {
  sourceKey: string;
  ruleCode: (typeof BUSINESS_ATTENTION_RULE_CODES)[number];
  severity: BusinessAttentionSeverity;
  title: string;
  summary: string;
  evidence: BusinessEvidenceReference[];
};

type AttentionRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  source_key: string;
  rule_code: string;
  severity: BusinessAttentionSeverity;
  state: "OPEN" | "RESOLVED" | "DISMISSED";
  title: string;
  summary: string;
  evidence: BusinessEvidenceReference[];
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  resolved_at: Date | string | null;
};

export class BusinessAttentionError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "BUSINESS_INTELLIGENCE_INVALID") {
    super(message);
  }
}

export async function evaluateBusinessAttention(
  pool: DatabasePool,
  input: { businessId: string; branchId: string | null; now: Date; correlationId: string },
): Promise<BusinessAttentionItem[]> {
  let cashForecast: CashForecastResponse;
  try {
    cashForecast = await getCashForecastReport(pool, {
      businessId: input.businessId,
      branchId: input.branchId,
      horizonDays: 30,
      generatedAt: input.now,
    });
  } catch (error) {
    if (error instanceof CashForecastReportError) {
      throw new BusinessAttentionError(error.message, error.statusCode, error.code);
    }
    throw error;
  }
  return withTransaction(pool, async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await assertScope(client, input.businessId, input.branchId);
    const signals = await collectSignals(client, input.businessId, input.branchId, input.now, cashForecast);

    for (const signal of signals) {
      await client.query(
        `INSERT INTO business_attention_items(
           business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence,first_seen_at,last_seen_at,updated_at
         ) VALUES($1,$2,$3,$4,$5,'OPEN',$6,$7,$8::jsonb,$9,$9,$9)
         ON CONFLICT (business_id,branch_id,rule_code,source_key) WHERE state='OPEN'
         DO UPDATE SET
           severity=EXCLUDED.severity,
           title=EXCLUDED.title,
           summary=EXCLUDED.summary,
           evidence=EXCLUDED.evidence,
           last_seen_at=EXCLUDED.last_seen_at,
           updated_at=EXCLUDED.updated_at`,
        [
          input.businessId,
          input.branchId,
          signal.sourceKey,
          signal.ruleCode,
          signal.severity,
          signal.title,
          signal.summary,
          JSON.stringify(signal.evidence),
          input.now.toISOString(),
        ],
      );
    }

    const activeKeys = signals.map(signal => signal.sourceKey);
    await client.query(
      `UPDATE business_attention_items
       SET state='RESOLVED',resolved_at=$3,updated_at=$3
       WHERE business_id=$1
         AND branch_id IS NOT DISTINCT FROM $2::uuid
         AND state='OPEN'
         AND rule_code = ANY($4::text[])
         AND NOT (source_key = ANY($5::text[]))`,
      [input.businessId, input.branchId, input.now.toISOString(), BUSINESS_ATTENTION_RULE_CODES, activeKeys],
    );

    return listAttentionWithClient(client, {
      businessId: input.businessId,
      branchId: input.branchId,
      includeFinancial: true,
    });
  });
}

export async function listBusinessAttention(
  pool: DatabasePool,
  input: { businessId: string; branchId: string | null; includeFinancial: boolean },
): Promise<BusinessAttentionItem[]> {
  return withTransaction(pool, async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await assertScope(client, input.businessId, input.branchId);
    return listAttentionWithClient(client, input);
  });
}

async function collectSignals(
  client: DatabaseClient,
  businessId: string,
  branchId: string | null,
  now: Date,
  cashForecast: CashForecastResponse,
): Promise<Signal[]> {
  const signals: Signal[] = [];
  const observedAt = now.toISOString();
  appendCashPressureSignal(signals, cashForecast);

  const salesCount = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM sales
     WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2)
       AND status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
       AND completed_at >= $3::timestamptz - interval '30 days'`,
    [businessId, branchId, observedAt],
  );
  const completedSales30d = salesCount.rows[0]?.count ?? 0;
  if (completedSales30d < 10) {
    signals.push({
      sourceKey: `low-data:${branchId ?? "all"}`,
      ruleCode: "LOW_DATA_CONFIDENCE",
      severity: "INFO",
      title: "More operating data is needed",
      summary: "TradeOS will keep recommendations conservative until enough recent transactions are available.",
      evidence: [{
        source: "sales",
        entityType: branchId ? "BRANCH" : "BUSINESS",
        entityId: branchId ?? businessId,
        observedAt,
        label: "completedSales30d",
        value: completedSales30d,
      }],
    });
  }

  await appendOverdueSignal(client, signals, {
    businessId,
    branchId,
    now,
    table: "customer_credit_obligations",
    sourceKey: `receivables:overdue:${branchId ?? "all"}`,
    ruleCode: "RECEIVABLES_OVERDUE",
    title: "Overdue customer balances need attention",
    summary: "One or more customer credit obligations are overdue.",
  });
  await appendOverdueSignal(client, signals, {
    businessId,
    branchId,
    now,
    table: "supplier_credit_obligations",
    sourceKey: `payables:overdue:${branchId ?? "all"}`,
    ruleCode: "PAYABLES_OVERDUE",
    title: "Overdue supplier balances need attention",
    summary: "One or more supplier credit obligations are overdue.",
  });

  const salesTrend = await client.query<{ current_minor: string; previous_minor: string }>(
    `SELECT
       COALESCE(SUM(total_minor) FILTER (WHERE completed_at >= $3::timestamptz - interval '7 days'),0)::text AS current_minor,
       COALESCE(SUM(total_minor) FILTER (
         WHERE completed_at >= $3::timestamptz - interval '14 days'
           AND completed_at < $3::timestamptz - interval '7 days'
       ),0)::text AS previous_minor
     FROM sales
     WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2)
       AND status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
       AND completed_at >= $3::timestamptz - interval '14 days'`,
    [businessId, branchId, observedAt],
  );
  const currentSales = BigInt(salesTrend.rows[0]?.current_minor ?? "0");
  const previousSales = BigInt(salesTrend.rows[0]?.previous_minor ?? "0");
  if (previousSales > 0n && currentSales * 100n <= previousSales * 75n) {
    signals.push({
      sourceKey: `sales-drop:${branchId ?? "all"}`,
      ruleCode: "SALES_DROP",
      severity: "MEDIUM",
      title: "Sales are below the previous week",
      summary: "Completed sales value for the last seven days is at least 25% below the preceding seven days.",
      evidence: [
        { source: "sales", entityType: "PERIOD", observedAt, label: "current7dMinor", value: currentSales.toString() },
        { source: "sales", entityType: "PERIOD", observedAt, label: "previous7dMinor", value: previousSales.toString() },
      ],
    });
  }

  const margin = await client.query<{ revenue_minor: string; cost_minor: string; margin_bps: number | null }>(
    `SELECT
       COALESCE(SUM(sl.line_net_minor),0)::text AS revenue_minor,
       COALESCE(SUM(sl.unit_cost_minor * sl.quantity),0)::text AS cost_minor,
       CASE WHEN COALESCE(SUM(sl.line_net_minor),0) > 0
         THEN floor((SUM(sl.line_net_minor) - SUM(sl.unit_cost_minor * sl.quantity)) * 10000.0 / SUM(sl.line_net_minor))::int
         ELSE NULL END AS margin_bps
     FROM sale_lines sl
     JOIN sales s ON s.id=sl.sale_id AND s.business_id=sl.business_id
     WHERE s.business_id=$1 AND ($2::uuid IS NULL OR s.branch_id=$2)
       AND s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
       AND s.completed_at >= $3::timestamptz - interval '30 days'`,
    [businessId, branchId, observedAt],
  );
  const marginBps = margin.rows[0]?.margin_bps;
  if (marginBps !== null && marginBps !== undefined && marginBps < 1500 && completedSales30d >= 10) {
    signals.push({
      sourceKey: `margin-pressure:${branchId ?? "all"}`,
      ruleCode: "MARGIN_PRESSURE",
      severity: marginBps < 500 ? "HIGH" : "MEDIUM",
      title: "Gross margin is under pressure",
      summary: "Recent recorded sales costs leave a gross margin below the 15% attention threshold.",
      evidence: [
        { source: "sale_lines", entityType: "PERIOD", observedAt, label: "grossMarginBasisPoints", value: marginBps },
        { source: "sale_lines", entityType: "PERIOD", observedAt, label: "revenueMinor", value: margin.rows[0]?.revenue_minor ?? "0" },
        { source: "sale_lines", entityType: "PERIOD", observedAt, label: "costMinor", value: margin.rows[0]?.cost_minor ?? "0" },
      ],
    });
  }

  const inventory = await client.query<{
    item_id: string;
    item_name: string;
    stock_unit_code: string | null;
    available_quantity: string;
    movement_count: number;
    last_sale_at: Date | string | null;
  }>(
    `WITH balances AS (
       SELECT ci.id AS item_id,ci.name AS item_name,ci.stock_unit_code,
              COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.location_type='AVAILABLE'),0) AS available_quantity,
              count(im.id)::int AS movement_count
       FROM catalog_items ci
       LEFT JOIN inventory_movements im
         ON im.business_id=ci.business_id AND im.item_id=ci.id
        AND ($2::uuid IS NULL OR im.branch_id=$2)
       WHERE ci.business_id=$1 AND ci.is_active=true AND ci.track_stock=true
       GROUP BY ci.id,ci.name,ci.stock_unit_code
     ), last_sales AS (
       SELECT sl.item_id,max(s.completed_at) AS last_sale_at
       FROM sale_lines sl
       JOIN sales s ON s.id=sl.sale_id AND s.business_id=sl.business_id
       WHERE s.business_id=$1 AND ($2::uuid IS NULL OR s.branch_id=$2)
         AND s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
       GROUP BY sl.item_id
     )
     SELECT b.item_id,b.item_name,b.stock_unit_code,b.available_quantity::text,b.movement_count,ls.last_sale_at
     FROM balances b LEFT JOIN last_sales ls ON ls.item_id=b.item_id
     WHERE b.movement_count > 0`,
    [businessId, branchId],
  );
  for (const row of inventory.rows) {
    const available = Number(row.available_quantity);
    if (Number.isFinite(available) && available <= 0) {
      signals.push({
        sourceKey: `stockout:${row.item_id}:${branchId ?? "all"}`,
        ruleCode: "STOCKOUT_RISK",
        severity: "HIGH",
        title: `${row.item_name} is out of available stock`,
        summary: "Recorded available inventory is zero or below and should be reviewed before the next sale.",
        evidence: [{ source: "inventory_movements", entityType: "CATALOG_ITEM", entityId: row.item_id, observedAt, label: "availableQuantity", value: row.available_quantity, metadata: { stockUnitCode: row.stock_unit_code } }],
      });
      continue;
    }
    if (available > 0) {
      const lastSale = row.last_sale_at ? new Date(row.last_sale_at) : null;
      if (!lastSale || now.getTime() - lastSale.getTime() >= 30 * 24 * 60 * 60 * 1000) {
        signals.push({
          sourceKey: `slow-stock:${row.item_id}:${branchId ?? "all"}`,
          ruleCode: "SLOW_STOCK",
          severity: "LOW",
          title: `${row.item_name} may be slow-moving`,
          summary: "Available stock exists but there has been no completed sale for this item in the last 30 days.",
          evidence: [{ source: "inventory_movements", entityType: "CATALOG_ITEM", entityId: row.item_id, observedAt, label: "availableQuantity", value: row.available_quantity, metadata: { lastSaleAt: lastSale?.toISOString() ?? null } }],
        });
      }
    }
  }

  const wastage = await client.query<{ current_count: number; previous_count: number }>(
    `SELECT
       count(*) FILTER (WHERE occurred_at >= $3::timestamptz - interval '7 days')::int AS current_count,
       count(*) FILTER (
         WHERE occurred_at >= $3::timestamptz - interval '14 days'
           AND occurred_at < $3::timestamptz - interval '7 days'
       )::int AS previous_count
     FROM inventory_movements
     WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2)
       AND reason='WASTAGE'
       AND occurred_at >= $3::timestamptz - interval '14 days'`,
    [businessId, branchId, observedAt],
  );
  const currentWaste = wastage.rows[0]?.current_count ?? 0;
  const previousWaste = wastage.rows[0]?.previous_count ?? 0;
  if (currentWaste >= 3 && currentWaste >= Math.max(2, previousWaste * 2)) {
    signals.push({
      sourceKey: `wastage-spike:${branchId ?? "all"}`,
      ruleCode: "WASTAGE_SPIKE",
      severity: "MEDIUM",
      title: "Wastage events have increased",
      summary: "Recorded wastage events in the last seven days are materially above the previous week.",
      evidence: [
        { source: "inventory_movements", entityType: "PERIOD", observedAt, label: "current7dWastageEvents", value: currentWaste },
        { source: "inventory_movements", entityType: "PERIOD", observedAt, label: "previous7dWastageEvents", value: previousWaste },
      ],
    });
  }

  return signals;
}

function appendCashPressureSignal(signals: Signal[], forecast: CashForecastResponse): void {
  const firstNegativeCashDate = forecast.summary.firstNegativeCashDate;
  if (!firstNegativeCashDate) return;
  const firstNegativeIndex = forecast.days.findIndex((day) => day.date === firstNegativeCashDate);
  const severity: BusinessAttentionSeverity = firstNegativeIndex >= 0 && firstNegativeIndex <= 2 ? "CRITICAL" : "HIGH";
  const entityType = forecast.branchId ? "BRANCH" : "BUSINESS";
  const entityId = forecast.branchId ?? forecast.businessId;
  const observedAt = forecast.generatedAt;
  const money = (label: string, value: number): BusinessEvidenceReference => ({
    source: "cash_forecast", entityType, entityId, observedAt, label, value,
    metadata: { kind: "money_minor", currencyCode: forecast.currencyCode },
  });

  signals.push({
    sourceKey: `cash-pressure:${forecast.branchId ?? "all"}`,
    ruleCode: "CASH_PRESSURE_FORECAST",
    severity,
    title: "Cash is projected to go negative",
    summary: `The 30-day cash forecast first falls below zero on ${firstNegativeCashDate}. Review collections, supplier timing and planned cash outflows before then.`,
    evidence: [
      money("openingCashMinor", forecast.summary.openingCashMinor),
      money("projectedClosingCashMinor", forecast.summary.projectedClosingCashMinor),
      money("lowestProjectedCashMinor", forecast.summary.lowestProjectedCashMinor),
      { source: "cash_forecast", entityType, entityId, observedAt, label: "lowestProjectedCashDate", value: forecast.summary.lowestProjectedCashDate },
      { source: "cash_forecast", entityType, entityId, observedAt, label: "firstNegativeCashDate", value: firstNegativeCashDate },
      money("totalContractualInflowsMinor", forecast.summary.totalContractualInflowsMinor),
      money("totalContractualOutflowsMinor", forecast.summary.totalContractualOutflowsMinor),
      { source: "cash_forecast", entityType, entityId, observedAt, label: "confidenceLevel", value: forecast.confidence.level },
      { source: "cash_forecast", entityType, entityId, observedAt, label: "historyDaysAvailable", value: forecast.confidence.historyDaysAvailable },
    ],
  });
}

async function appendOverdueSignal(
  client: DatabaseClient,
  signals: Signal[],
  input: {
    businessId: string;
    branchId: string | null;
    now: Date;
    table: "customer_credit_obligations" | "supplier_credit_obligations";
    sourceKey: string;
    ruleCode: "RECEIVABLES_OVERDUE" | "PAYABLES_OVERDUE";
    title: string;
    summary: string;
  },
) {
  const result = await client.query<{ overdue_minor: string; obligation_count: number; oldest_due: Date | string | null }>(
    `SELECT COALESCE(SUM(open_minor),0)::text AS overdue_minor,
            count(*) FILTER (WHERE open_minor>0)::int AS obligation_count,
            min(due_at) FILTER (WHERE open_minor>0) AS oldest_due
     FROM ${input.table}
     WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2)
       AND open_minor>0 AND due_at < $3`,
    [input.businessId, input.branchId, input.now.toISOString()],
  );
  const overdue = BigInt(result.rows[0]?.overdue_minor ?? "0");
  if (overdue <= 0n) return;
  signals.push({
    sourceKey: input.sourceKey,
    ruleCode: input.ruleCode,
    severity: "HIGH",
    title: input.title,
    summary: input.summary,
    evidence: [{
      source: input.table,
      entityType: "CREDIT_AGING",
      observedAt: input.now.toISOString(),
      label: "overdueMinor",
      value: overdue.toString(),
      metadata: {
        obligationCount: result.rows[0]?.obligation_count ?? 0,
        oldestDueAt: result.rows[0]?.oldest_due ? new Date(result.rows[0].oldest_due!).toISOString() : null,
      },
    }],
  });
}

async function assertScope(client: DatabaseClient, businessId: string, branchId: string | null) {
  if (!branchId) return;
  const result = await client.query(
    `SELECT 1 FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true`,
    [branchId, businessId],
  );
  if (!result.rowCount) throw new BusinessAttentionError("Branch not found", 404, "BRANCH_NOT_FOUND");
}

async function listAttentionWithClient(
  client: DatabaseClient,
  input: { businessId: string; branchId: string | null; includeFinancial: boolean },
): Promise<BusinessAttentionItem[]> {
  const result = await client.query<AttentionRow>(
    `SELECT id,business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence,
            first_seen_at,last_seen_at,resolved_at
     FROM business_attention_items
     WHERE business_id=$1
       AND branch_id IS NOT DISTINCT FROM $2::uuid
       AND state='OPEN'
       AND ($3::boolean OR NOT (rule_code = ANY($4::text[])))
     ORDER BY CASE severity
       WHEN 'CRITICAL' THEN 5 WHEN 'HIGH' THEN 4 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 2 ELSE 1 END DESC,
       last_seen_at DESC,id`,
    [input.businessId, input.branchId, input.includeFinancial, [...FINANCIAL_BUSINESS_ATTENTION_RULE_CODES]],
  );
  return result.rows.map(mapRow);
}

function mapRow(row: AttentionRow): BusinessAttentionItem {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    sourceKey: row.source_key,
    ruleCode: row.rule_code,
    severity: row.severity,
    state: row.state,
    title: row.title,
    summary: row.summary,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    firstSeenAt: iso(row.first_seen_at),
    lastSeenAt: iso(row.last_seen_at),
    resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
  };
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
