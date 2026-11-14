import type {
  BusinessAttentionItem,
  BusinessAttentionResponse,
  BusinessAttentionRule,
  BusinessAttentionSeverity,
  BusinessInsightEvidence,
  CreditAgingReport,
  FinancialSummaryReport,
  InventoryIntelligenceReport,
  InventoryAdvisoryItem,
} from "@tradeos/contracts";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { loadCreditAging, loadFinancialSummary } from "../reports.js";
import { loadInventoryIntelligence } from "./inventory-intelligence-service.js";

type Signal = {
  sourceKey: string;
  ruleCode: BusinessAttentionRule;
  severity: BusinessAttentionSeverity;
  title: string;
  summary: string;
  evidence: BusinessInsightEvidence[];
};
type Row = {
  id: string; business_id: string; branch_id: string | null; source_key: string;
  rule_code: BusinessAttentionRule; severity: BusinessAttentionSeverity;
  state: "OPEN" | "RESOLVED" | "DISMISSED";
  title: string; summary: string; evidence: BusinessInsightEvidence[];
  first_seen_at: Date; last_seen_at: Date; resolved_at: Date | null;
  created_at: Date; updated_at: Date;
};

const SELECT = `id,business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence,
   first_seen_at,last_seen_at,resolved_at,created_at,updated_at`;
const PRIORITY = `CASE severity
  WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END`;

/**
 * Facts come only from authorized, reconciled reporting services.
 * No LLM prompt, free-form SQL by AI, or economic transaction side effects.
 */
export function detectBusinessAttention(
  report: FinancialSummaryReport,
  aging: CreditAgingReport,
  inventory: InventoryIntelligenceReport | null = null,
): Signal[] {
  if (report.businessId !== aging.businessId || report.branchId !== aging.branchId) {
    throw new Error("Business attention report scope does not match credit aging scope");
  }
  const signals: Signal[] = [];
  const lowData = report.health.status === "INSUFFICIENT_DATA";
  if (lowData) {
    signals.push({
      sourceKey: "LOW_DATA_CONFIDENCE",
      ruleCode: "LOW_DATA_CONFIDENCE",
      severity: "INFO",
      title: "More trading history is needed",
      summary: "Record sales and expenses consistently before relying on trend-based business recommendations.",
      evidence: [
        metric("salesCount", "Recorded sales this period", report.flow.salesCount, "COUNT"),
      ],
    });
  } else {
    for (const insight of report.health.insights) {
      if (insight.severity === "POSITIVE" || insight.severity === "INFO") continue;
      // The canonical health evaluator decides which signals exist. Do not recompute its thresholds.
      signals.push({
        sourceKey: `HEALTH:${insight.code}`,
        ruleCode: "BUSINESS_HEALTH_INSIGHT",
        severity: insight.severity === "CRITICAL" ? "CRITICAL" : insight.severity === "WARNING" ? "HIGH" : "LOW",
        title: insight.title,
        summary: insight.message,
        evidence: insight.evidence,
      });
    }
  }

  // Credit obligation signals do not need a trend model or sales history.
  // They remain valid even for a newly onboarded business.
  const overdueReceivablesMinor = aging.receivables.overdue1To30DaysMinor
    + aging.receivables.overdue31To60DaysMinor
    + aging.receivables.overdue61To90DaysMinor
    + aging.receivables.overdueOver90DaysMinor;
  if (overdueReceivablesMinor > 0) {
    signals.push({
      sourceKey: "RECEIVABLES_OVERDUE",
      ruleCode: "RECEIVABLES_OVERDUE",
      severity: "HIGH",
      title: "Customer payments are overdue",
      summary: "Check outstanding customer balances and arrange collections before extending further credit.",
      evidence: [metric("overdueReceivablesMinor", "Overdue customer balances", overdueReceivablesMinor, "MINOR")],
    });
  }
  const overduePayablesMinor = aging.payables.overdue1To30DaysMinor
    + aging.payables.overdue31To60DaysMinor
    + aging.payables.overdue61To90DaysMinor
    + aging.payables.overdueOver90DaysMinor;
  if (overduePayablesMinor > 0) {
    signals.push({
      sourceKey: "PAYABLES_OVERDUE",
      ruleCode: "PAYABLES_OVERDUE",
      severity: "HIGH",
      title: "Supplier payments are overdue",
      summary: "Review supplier obligations and agree on a repayment plan using the recorded cash position.",
      evidence: [metric("overduePayablesMinor", "Overdue supplier balances", overduePayablesMinor, "MINOR")],
    });
  }
  if (inventory !== null) {
    if (inventory.businessId !== report.businessId || inventory.branchId !== report.branchId) {
      throw new Error("Inventory attention report scope does not match financial report scope");
    }
    signals.push(...detectInventoryAttention(inventory));
  }
  return signals;
}

/** 
 * Inventory signals stay advisory-only. The 14-day review horizon matches the
 * default inventory scenario, not a promised supplier delivery date.
 * A limited scan preserves existing alerts rather than falsely resolving them.
 */
function detectInventoryAttention(inventory: InventoryIntelligenceReport): Signal[] {
  const candidates = inventory.items.filter((item) =>
    item.status === "OUT_OF_STOCK" ||
    item.status === "REORDER_REVIEW" ||
    item.status === "SLOW_MOVING" ||
    item.status === "OVERSTOCK_REVIEW",
  );
  const priority: Record<string, number> = {
    OUT_OF_STOCK: 1,
    REORDER_REVIEW: 2,
    OVERSTOCK_REVIEW: 3,
    SLOW_MOVING: 4,
  };
  candidates.sort((left, right) =>
    (priority[left.status] ?? 99) - (priority[right.status] ?? 99)
    || left.itemId.localeCompare(right.itemId));
  const limited = inventory.truncated || candidates.length > 80;
  const signals: Signal[] = [];
  if (limited) {
    signals.push({
      sourceKey: "STOCK:PARTIAL_COVERAGE",
      ruleCode: "INVENTORY_COVERAGE_LIMITED",
      severity: "INFO",
      title: "Inventory alert coverage is partial",
      summary: "Some tracked stock items are outside the evaluated alert set. Review the inventory report for the full picture.",
      evidence: [metric("evaluatedItemCount", "Items evaluated", inventory.evaluatedItemCount, "COUNT")],
    });
  }
  for (const item of candidates.slice(0, 80)) {
    signals.push(stockSignal(item));
  }
  return signals;
}

function stockSignal(item: InventoryAdvisoryItem): Signal {
  const ruleCode: BusinessAttentionRule =
    item.status === "OUT_OF_STOCK" ? "STOCKOUT_RISK"
    : item.status === "REORDER_REVIEW" ? "REORDER_REVIEW"
    : item.status === "SLOW_MOVING" ? "SLOW_STOCK"
    : "OVERSTOCK_REVIEW";
  const severity: BusinessAttentionSeverity =
    ruleCode === "STOCKOUT_RISK" ? "HIGH"
    : ruleCode === "REORDER_REVIEW" ? "MEDIUM" : "LOW";
  const label =
    ruleCode === "STOCKOUT_RISK" ? "Stockout review"
    : ruleCode === "REORDER_REVIEW" ? "Replenishment review"
    : ruleCode === "SLOW_STOCK" ? "Slow-stock review" : "Excess-stock review";
  const inventoryEvidence = [
    metric("availableStock", "Available stock units", item.available, "COUNT"),
    metric("netSold30Days", "Net stock units sold in 30 days", item.netSold30Days, "COUNT"),
    metric("inventoryValueMinor", "Recorded inventory value", item.inventoryValueMinor, "MINOR"),
  ];
  if (item.suggestedReviewQuantity !== null) {
    inventoryEvidence.push(metric("scenarioShortfall", "14-day scenario shortfall, stock units",
      item.suggestedReviewQuantity, "COUNT"));
  }
  return {
    sourceKey: "STOCK:" + item.itemId,
    ruleCode,
    severity,
    title: label + ": " + item.name,
    summary: item.explanation + " (" + item.stockUnitCode + " stock unit; review only, no purchase is created.)",
    evidence: inventoryEvidence,
  };
}

export async function listBusinessAttention(
  pool: DatabasePool, businessId: string, branchId: string | null,
): Promise<BusinessAttentionResponse> {
  const result = await pool.query<Row>(
    `SELECT ${SELECT} FROM business_attention_items
      WHERE business_id=$1 AND branch_id IS NOT DISTINCT FROM $2::uuid AND state='OPEN'
      ORDER BY ${PRIORITY}, last_seen_at DESC, id LIMIT 100`,
    [businessId, branchId],
  );
  return {
    businessId, branchId, items: result.rows.map(mapRow),
    generatedAt: new Date().toISOString(), evaluated: false,
  };
}

/**
 * Evaluation is a deliberate authorized action, not a side effect of GET.
 * A scoped advisory lock prevents simultaneous evaluations of the same branch
 * from creating duplicate/incorrect resolution transitions.
 */
export async function evaluateBusinessAttention(
  pool: DatabasePool, businessId: string, branchId: string | null,
): Promise<BusinessAttentionResponse> {
  const [report, aging, inventory] = await Promise.all([
    loadFinancialSummary(pool, businessId, branchId, { range: "month" }),
    loadCreditAging(pool, businessId, branchId),
    branchId === null ? Promise.resolve(null) : loadInventoryIntelligence(pool, businessId, branchId, 14),
  ]);
  const signals = detectBusinessAttention(report, aging, inventory);
  const inventoryCandidates = inventory?.items.filter((item) =>
    item.status === "OUT_OF_STOCK" ||
    item.status === "REORDER_REVIEW" ||
    item.status === "SLOW_MOVING" ||
    item.status === "OVERSTOCK_REVIEW").length ?? 0;
  const inventoryComplete = inventory !== null && !inventory.truncated && inventoryCandidates <= 80;
  return withTransaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))",
      [businessId, branchId ?? "ALL"],
    );
    // Do not allow asynchronous evaluation to persist alerts for a suspended tenant
    // or an inactive/foreign branch after the reports have been loaded.
    const scope = await client.query(
      `SELECT b.id FROM businesses b
         WHERE b.id=$1 AND b.status='ACTIVE'
           AND ($2::uuid IS NULL OR EXISTS
             (SELECT 1 FROM branches br
               WHERE br.id=$2 AND br.business_id=b.id AND br.is_active=true))`,
      [businessId, branchId],
    );
    if (!scope.rows[0]) throw new Error("Business or branch is no longer active");
    for (const signal of signals) await upsert(client, businessId, branchId, signal);
    const activeKeys = signals.map((signal) => signal.sourceKey);
    // Only evaluator-owned rules may be resolved here. Never rewrite human-dismissed history.
    await client.query(
      `UPDATE business_attention_items
         SET state='RESOLVED', resolved_at=now(), updated_at=now()
         WHERE business_id=$1 AND branch_id IS NOT DISTINCT FROM $2::uuid AND state='OPEN'
           AND NOT (source_key=ANY($3::text[]))
           AND (source_key NOT LIKE 'STOCK:%' OR $4::boolean)`,
      [businessId, branchId, activeKeys, inventoryComplete],
    );
    const rows = await client.query<Row>(
      `SELECT ${SELECT} FROM business_attention_items
        WHERE business_id=$1 AND branch_id IS NOT DISTINCT FROM $2::uuid AND state='OPEN'
        ORDER BY ${PRIORITY}, last_seen_at DESC, id LIMIT 100`,
      [businessId, branchId],
    );
    return {
      businessId, branchId, items: rows.rows.map(mapRow),
      generatedAt: new Date().toISOString(), evaluated: true,
    };
  });
}

async function upsert(client: DatabaseClient, businessId: string, branchId: string | null, signal: Signal) {
  await client.query(
    `INSERT INTO business_attention_items(
      business_id,branch_id,source_key,rule_code,severity,title,summary,evidence
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
    ON CONFLICT (business_id,branch_id,source_key) WHERE state='OPEN'
    DO UPDATE SET rule_code=EXCLUDED.rule_code,severity=EXCLUDED.severity,
      title=EXCLUDED.title,summary=EXCLUDED.summary,evidence=EXCLUDED.evidence,
      last_seen_at=now(),updated_at=now(),resolved_at=NULL`,
    [
      businessId, branchId, signal.sourceKey, signal.ruleCode,
      signal.severity, signal.title, signal.summary, JSON.stringify(signal.evidence),
    ],
  );
}
function metric(
  key: string, label: string, value: number, unit: BusinessInsightEvidence["unit"],
): BusinessInsightEvidence { return { key, label, value, unit }; }
function mapRow(row: Row): BusinessAttentionItem {
  return {
    id: row.id, businessId: row.business_id, branchId: row.branch_id,
    sourceKey: row.source_key, ruleCode: row.rule_code, severity: row.severity,
    state: row.state, title: row.title, summary: row.summary,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    firstSeenAt: row.first_seen_at.toISOString(), lastSeenAt: row.last_seen_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}
