import type {
  BusinessAttentionItem,
  BusinessBriefing,
  BusinessBriefingSection,
  BusinessEvidenceReference,
  BusinessInsightConfidenceLevel,
  BusinessInsightRange,
  BusinessRecommendation,
} from "@tradeos/contracts";
import { withTransaction, type DatabaseClient, type DatabasePool } from "../db.js";
import { evaluateBusinessAttention } from "./attention-service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<BusinessInsightRange, number> = { today: 1, week: 7, month: 30 };

type Scope = { currencyCode: string };
type SalesFacts = { selectedCount: number; selectedTotalMinor: string; completedSales30d: number };
type ObligationFacts = { totalOpenMinor: string; overdueMinor: string; openCount: number; overdueCount: number };

export class BusinessBriefingError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "BUSINESS_BRIEFING_INVALID") {
    super(message);
  }
}

export async function buildBusinessBriefing(
  pool: DatabasePool,
  input: { businessId: string; branchId: string | null; range: BusinessInsightRange; now?: Date },
): Promise<BusinessBriefing> {
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();

  // Evaluation is deterministic and refreshes the same evidence-backed attention state the rest of TradeOS uses.
  const attentionItems = await evaluateBusinessAttention(pool, {
    businessId: input.businessId,
    branchId: input.branchId,
    now,
    correlationId: `briefing:${input.businessId}:${input.branchId ?? "all"}:${generatedAt}`,
  });

  const facts = await withTransaction(pool, async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const scope = await loadScope(client, input.businessId, input.branchId);
    const from = new Date(now.getTime() - RANGE_DAYS[input.range] * DAY_MS);
    const sales = await loadSalesFacts(client, input.businessId, input.branchId, from, now);
    const cashBalanceMinor = await loadCashBalance(client, input.businessId, input.branchId, now);
    const receivables = await loadObligations(client, "customer_credit_obligations", input.businessId, input.branchId, now);
    const payables = await loadObligations(client, "supplier_credit_obligations", input.businessId, input.branchId, now);
    return { scope, sales, cashBalanceMinor, receivables, payables };
  });

  const confidence = confidenceFor(facts.sales.completedSales30d, attentionItems);
  const baseEvidence: BusinessEvidenceReference[] = [
    evidence("sales", input, generatedAt, "completedSales30d", facts.sales.completedSales30d),
    evidence("sales", input, generatedAt, `${input.range}SalesCount`, facts.sales.selectedCount),
    evidence("sales", input, generatedAt, `${input.range}SalesTotalMinor`, facts.sales.selectedTotalMinor),
    evidence("cashbook_entries", input, generatedAt, "cashBalanceMinor", facts.cashBalanceMinor),
    evidence("customer_credit_obligations", input, generatedAt, "openReceivablesMinor", facts.receivables.totalOpenMinor),
    evidence("customer_credit_obligations", input, generatedAt, "overdueReceivablesMinor", facts.receivables.overdueMinor),
    evidence("supplier_credit_obligations", input, generatedAt, "openPayablesMinor", facts.payables.totalOpenMinor),
    evidence("supplier_credit_obligations", input, generatedAt, "overduePayablesMinor", facts.payables.overdueMinor),
  ];
  const allEvidence = [...baseEvidence, ...attentionItems.flatMap(item => item.evidence)];

  const lowData = attentionItems.filter(item => item.ruleCode === "LOW_DATA_CONFIDENCE");
  const urgentItems = attentionItems.filter(item =>
    item.severity === "HIGH" || item.severity === "CRITICAL" || item.ruleCode === "LOW_DATA_CONFIDENCE",
  );
  const salesItems = byRules(attentionItems, ["SALES_DROP", "MARGIN_PRESSURE"]);
  const cashItems = byRules(attentionItems, ["CASH_PRESSURE_FORECAST"]);
  const customerItems = byRules(attentionItems, ["RECEIVABLES_OVERDUE"]);
  const supplierItems = byRules(attentionItems, ["PAYABLES_OVERDUE", "SUPPLIER_BILL_DUE"]);
  const inventoryItems = byRules(attentionItems, ["STOCKOUT_RISK", "SLOW_STOCK", "WASTAGE_SPIKE", "WASTAGE_LOSS"]);

  const sections: BusinessBriefingSection[] = [
    section("URGENT", "Needs attention", urgentSummary(urgentItems), urgentItems, []),
    section(
      "SALES",
      "Sales",
      `${facts.sales.selectedCount} completed sale${facts.sales.selectedCount === 1 ? "" : "s"} recorded in this ${rangeLabel(input.range)}; total ${facts.sales.selectedTotalMinor} minor units.`,
      salesItems,
      [],
    ),
    section(
      "CASH",
      "Cash position",
      `Recorded cashbook position is ${facts.cashBalanceMinor} minor units.`,
      cashItems,
      [],
    ),
    section(
      "CUSTOMERS_CREDIT",
      "Customer credit",
      `${facts.receivables.openCount} open customer balance${facts.receivables.openCount === 1 ? "" : "s"}; ${facts.receivables.overdueCount} overdue.`,
      customerItems,
      recommendationForOverdue(input, "CUSTOMER_COLLECTION_FOLLOW_UP", facts.receivables.overdueCount, customerItems, "Follow up overdue customer balances"),
    ),
    section(
      "SUPPLIERS_PAYABLES",
      "Supplier payables",
      `${facts.payables.openCount} open supplier balance${facts.payables.openCount === 1 ? "" : "s"}; ${facts.payables.overdueCount} overdue.`,
      supplierItems,
      recommendationForOverdue(input, "SUPPLIER_PAYMENT_REVIEW", facts.payables.overdueCount, supplierItems, "Review overdue supplier balances"),
    ),
    section(
      "INVENTORY",
      "Inventory",
      inventoryItems.length > 0 ? `${inventoryItems.length} inventory signal${inventoryItems.length === 1 ? "" : "s"} need review.` : "No deterministic inventory risk is currently open.",
      inventoryItems,
      [],
    ),
    section(
      "OPPORTUNITIES",
      "Opportunities",
      lowData.length > 0 ? "Keep recording sales, payments and stock movements so TradeOS can increase confidence and surface stronger opportunities." : "TradeOS will surface evidence-backed growth opportunities as operating patterns become material.",
      [],
      lowData.length > 0 ? [lowDataRecommendation(input, lowData)] : [],
    ),
  ];

  const headline = confidence.level === "LOW"
    ? "Limited recent data — TradeOS is keeping this briefing conservative."
    : urgentItems.length > 0
      ? `${urgentItems.length} item${urgentItems.length === 1 ? "" : "s"} need attention.`
      : "Operations are stable across the signals TradeOS can verify.";

  return {
    businessId: input.businessId,
    branchId: input.branchId,
    range: input.range,
    generatedAt,
    headline,
    summary: `${facts.sales.selectedCount} sales in scope; ${urgentItems.length} urgent signal${urgentItems.length === 1 ? "" : "s"}; currency ${facts.scope.currencyCode}.`,
    confidence,
    dataQuality: {
      completedSales30d: facts.sales.completedSales30d,
      sufficientForTrends: facts.sales.completedSales30d >= 10,
      currencyCode: facts.scope.currencyCode,
    },
    sections,
    evidence: dedupeEvidence(allEvidence),
  };
}

async function loadScope(client: DatabaseClient, businessId: string, branchId: string | null): Promise<Scope> {
  const result = await client.query<{ currency_code: string }>(
    branchId
      ? `SELECT b.currency_code
         FROM businesses b JOIN branches br ON br.business_id=b.id
         WHERE b.id=$1 AND b.status='ACTIVE' AND br.id=$2 AND br.is_active=true`
      : `SELECT currency_code FROM businesses WHERE id=$1 AND status='ACTIVE'`,
    branchId ? [businessId, branchId] : [businessId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new BusinessBriefingError(
      branchId ? "Branch not found" : "Business not found",
      404,
      branchId ? "BRANCH_NOT_FOUND" : "BUSINESS_NOT_FOUND",
    );
  }
  return { currencyCode: row.currency_code };
}

async function loadSalesFacts(
  client: DatabaseClient,
  businessId: string,
  branchId: string | null,
  from: Date,
  now: Date,
): Promise<SalesFacts> {
  const result = await client.query<{ selected_count: number; selected_total_minor: string; completed_30d: number }>(
    `SELECT
       count(*) FILTER (WHERE completed_at >= $3)::int AS selected_count,
       COALESCE(SUM(total_minor) FILTER (WHERE completed_at >= $3),0)::text AS selected_total_minor,
       count(*) FILTER (WHERE completed_at >= $4::timestamptz - interval '30 days')::int AS completed_30d
     FROM sales
     WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2)
       AND status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
       AND completed_at < $4`,
    [businessId, branchId, from.toISOString(), now.toISOString()],
  );
  const row = result.rows[0];
  return {
    selectedCount: row?.selected_count ?? 0,
    selectedTotalMinor: row?.selected_total_minor ?? "0",
    completedSales30d: row?.completed_30d ?? 0,
  };
}

async function loadCashBalance(
  client: DatabaseClient,
  businessId: string,
  branchId: string | null,
  now: Date,
): Promise<string> {
  const result = await client.query<{ balance_minor: string }>(
    `SELECT COALESCE(SUM(amount_delta_minor),0)::text AS balance_minor
     FROM cashbook_entries
     WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND occurred_at <= $3`,
    [businessId, branchId, now.toISOString()],
  );
  return result.rows[0]?.balance_minor ?? "0";
}

async function loadObligations(
  client: DatabaseClient,
  table: "customer_credit_obligations" | "supplier_credit_obligations",
  businessId: string,
  branchId: string | null,
  now: Date,
): Promise<ObligationFacts> {
  const result = await client.query<{
    total_open_minor: string;
    overdue_minor: string;
    open_count: number;
    overdue_count: number;
  }>(
    `SELECT
       COALESCE(SUM(open_minor),0)::text AS total_open_minor,
       COALESCE(SUM(open_minor) FILTER (WHERE due_at < $3),0)::text AS overdue_minor,
       count(*) FILTER (WHERE open_minor>0)::int AS open_count,
       count(*) FILTER (WHERE open_minor>0 AND due_at < $3)::int AS overdue_count
     FROM ${table}
     WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2) AND open_minor>0`,
    [businessId, branchId, now.toISOString()],
  );
  const row = result.rows[0];
  return {
    totalOpenMinor: row?.total_open_minor ?? "0",
    overdueMinor: row?.overdue_minor ?? "0",
    openCount: row?.open_count ?? 0,
    overdueCount: row?.overdue_count ?? 0,
  };
}

function confidenceFor(completedSales30d: number, attention: BusinessAttentionItem[]): { level: BusinessInsightConfidenceLevel; reason: string } {
  if (completedSales30d < 10 || attention.some(item => item.ruleCode === "LOW_DATA_CONFIDENCE")) {
    return { level: "LOW", reason: "Fewer than 10 completed sales are available in the last 30 days, so trend recommendations remain conservative." };
  }
  if (completedSales30d < 30) {
    return { level: "MEDIUM", reason: "Recent operating data supports directional insights, but more history will improve confidence." };
  }
  return { level: "HIGH", reason: "At least 30 completed sales are available in the last 30 days for stronger trend context." };
}

function evidence(
  source: string,
  scope: { businessId: string; branchId: string | null },
  observedAt: string,
  label: string,
  value: string | number,
): BusinessEvidenceReference {
  return {
    source,
    entityType: scope.branchId ? "BRANCH" : "BUSINESS",
    entityId: scope.branchId ?? scope.businessId,
    observedAt,
    label,
    value,
  };
}

function byRules(items: BusinessAttentionItem[], rules: string[]): BusinessAttentionItem[] {
  const allowed = new Set(rules);
  return items.filter(item => allowed.has(item.ruleCode));
}

function section(
  code: BusinessBriefingSection["code"],
  title: string,
  summary: string,
  attentionItems: BusinessAttentionItem[],
  recommendations: BusinessRecommendation[],
): BusinessBriefingSection {
  return { code, title, summary, attentionItems, recommendations };
}

function urgentSummary(items: BusinessAttentionItem[]): string {
  if (items.length === 0) return "No critical or high-priority deterministic signal is currently open.";
  return `${items.length} signal${items.length === 1 ? "" : "s"} should be reviewed before lower-priority opportunities.`;
}

function recommendationForOverdue(
  scope: { businessId: string; branchId: string | null },
  code: string,
  overdueCount: number,
  items: BusinessAttentionItem[],
  title: string,
): BusinessRecommendation[] {
  if (overdueCount === 0) return [];
  return [{
    businessId: scope.businessId,
    branchId: scope.branchId,
    code,
    title,
    summary: `${overdueCount} overdue balance${overdueCount === 1 ? "" : "s"} should be reviewed.`,
    rationale: "The recommendation is based only on currently open credit obligations recorded in TradeOS.",
    priority: "MEDIUM",
    evidence: items.flatMap(item => item.evidence),
  }];
}

function lowDataRecommendation(
  scope: { businessId: string; branchId: string | null },
  items: BusinessAttentionItem[],
): BusinessRecommendation {
  return {
    businessId: scope.businessId,
    branchId: scope.branchId,
    code: "IMPROVE_DATA_COVERAGE",
    title: "Keep recording daily activity",
    summary: "Record sales, payments, expenses and stock movements consistently so TradeOS can increase confidence.",
    rationale: "Recent completed-sales volume is below the deterministic confidence threshold.",
    priority: "INFO",
    evidence: items.flatMap(item => item.evidence),
  };
}

function rangeLabel(range: BusinessInsightRange): string {
  return range === "today" ? "day" : range;
}

function dedupeEvidence(evidenceItems: BusinessEvidenceReference[]): BusinessEvidenceReference[] {
  const seen = new Set<string>();
  return evidenceItems.filter(item => {
    const key = JSON.stringify([item.source, item.entityType, item.entityId ?? null, item.label ?? null, item.value ?? null, item.observedAt ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
