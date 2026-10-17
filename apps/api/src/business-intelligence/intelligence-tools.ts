import type { AiGroundingEvidence, BusinessEvidenceReference } from "@tradeos/contracts";
import type { BusinessRole } from "../auth/authorization.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "../db.js";
import { listBusinessAttention } from "./attention-service.js";

const FINANCIAL_ROLES = new Set<BusinessRole>(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

export class BusinessIntelligenceToolError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "BUSINESS_AI_TOOL_INVALID",
  ) {
    super(message);
    this.name = "BusinessIntelligenceToolError";
  }
}

export async function collectBusinessIntelligenceEvidence(
  pool: DatabasePool,
  input: { businessId: string; branchId: string | null; role: BusinessRole; now?: Date },
): Promise<BusinessEvidenceReference[]> {
  const observedAt = (input.now ?? new Date()).toISOString();
  const financial = FINANCIAL_ROLES.has(input.role);

  const facts = await withTransaction(pool, async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const scope = await loadScope(client, input.businessId, input.branchId);
    const evidence: BusinessEvidenceReference[] = [
      reference("businesses", "BUSINESS", input.businessId, "businessName", scope.businessName, observedAt),
      reference("businesses", "BUSINESS", input.businessId, "currencyCode", scope.currencyCode, observedAt),
    ];
    if (input.branchId && scope.branchName) {
      evidence.push(reference("branches", "BRANCH", input.branchId, "branchName", scope.branchName, observedAt));
    }

    evidence.push(...await loadBranches(client, input.businessId, input.branchId, observedAt));
    evidence.push(...await loadSalesEvidence(client, input.businessId, input.branchId, financial, observedAt));
    evidence.push(...await loadInventoryEvidence(client, input.businessId, input.branchId, observedAt));

    if (financial) {
      evidence.push(...await loadCashEvidence(client, input.businessId, input.branchId, observedAt));
      evidence.push(...await loadCustomerCreditEvidence(client, input.businessId, input.branchId, observedAt));
      evidence.push(...await loadSupplierCreditEvidence(client, input.businessId, input.branchId, observedAt));
    }

    return evidence;
  });

  const attention = await listBusinessAttention(pool, {
    businessId: input.businessId,
    branchId: input.branchId,
    includeFinancial: financial,
  });
  for (const item of attention.slice(0, 10)) {
    facts.push(reference(
      "business_attention",
      "ATTENTION_ITEM",
      item.id,
      `${item.ruleCode}:${item.severity}`,
      item.title,
      item.lastSeenAt,
    ));
  }

  return facts.slice(0, 60);
}

export function toAiGroundingEvidence(evidence: BusinessEvidenceReference[]): AiGroundingEvidence[] {
  return evidence.map((item) => ({
    sourceType: item.source,
    label: item.label ?? item.entityType,
    ...(item.entityId ? { sourceId: item.entityId } : {}),
    ...(item.value !== undefined ? { value: item.value } : {}),
    ...(item.observedAt ? { observedAt: item.observedAt } : {}),
  }));
}

async function loadScope(client: DatabaseClient, businessId: string, branchId: string | null) {
  const result = branchId
    ? await client.query<{ business_name: string; currency_code: string; branch_name: string }>(
        `SELECT b.name AS business_name,b.currency_code::text AS currency_code,br.name AS branch_name
         FROM businesses b
         JOIN branches br ON br.business_id=b.id AND br.id=$2::uuid AND br.is_active=true
         WHERE b.id=$1::uuid AND b.status='ACTIVE'`,
        [businessId, branchId],
      )
    : await client.query<{ business_name: string; currency_code: string; branch_name: null }>(
        `SELECT b.name AS business_name,b.currency_code::text AS currency_code,NULL::text AS branch_name
         FROM businesses b WHERE b.id=$1::uuid AND b.status='ACTIVE'`,
        [businessId],
      );
  const row = result.rows[0];
  if (!row) {
    throw new BusinessIntelligenceToolError(
      branchId ? "Branch not found in the authorized business." : "Business is unavailable.",
      404,
      branchId ? "BRANCH_NOT_FOUND" : "BUSINESS_NOT_FOUND",
    );
  }
  return { businessName: row.business_name, currencyCode: row.currency_code.trim(), branchName: row.branch_name };
}

async function loadBranches(
  client: DatabaseClient,
  businessId: string,
  branchId: string | null,
  observedAt: string,
): Promise<BusinessEvidenceReference[]> {
  const result = await client.query<{ id: string; name: string }>(
    `SELECT id,name FROM branches
     WHERE business_id=$1::uuid AND is_active=true AND ($2::uuid IS NULL OR id=$2::uuid)
     ORDER BY name,id LIMIT 20`,
    [businessId, branchId],
  );
  return result.rows.map((row) => reference("branches", "BRANCH", row.id, "accessibleBranch", row.name, observedAt));
}

async function loadSalesEvidence(
  client: DatabaseClient,
  businessId: string,
  branchId: string | null,
  financial: boolean,
  observedAt: string,
): Promise<BusinessEvidenceReference[]> {
  const summary = await client.query<{ completed_count: string; total_minor: string }>(
    `SELECT COUNT(*)::text AS completed_count,COALESCE(SUM(total_minor),0)::text AS total_minor
     FROM sales
     WHERE business_id=$1::uuid AND ($2::uuid IS NULL OR branch_id=$2::uuid)
       AND status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
       AND completed_at >= $3::timestamptz - interval '7 days'`,
    [businessId, branchId, observedAt],
  );
  const scopeId = branchId ?? businessId;
  const evidence = [reference(
    "sales",
    branchId ? "BRANCH" : "BUSINESS",
    scopeId,
    "completedSales7d",
    Number(summary.rows[0]?.completed_count ?? 0),
    observedAt,
  )];
  if (financial) {
    evidence.push(reference(
      "sales",
      branchId ? "BRANCH" : "BUSINESS",
      scopeId,
      "grossSalesTotalMinor7d",
      summary.rows[0]?.total_minor ?? "0",
      observedAt,
    ));
  }

  const topItems = await client.query<{
    item_id: string;
    item_name: string;
    quantity_sold: string;
    net_revenue_minor: string;
  }>(
    `SELECT sl.item_id,MAX(sl.item_name_snapshot) AS item_name,
            COALESCE(SUM(COALESCE(sl.stock_quantity,sl.quantity)),0)::text AS quantity_sold,
            COALESCE(SUM(sl.line_net_minor),0)::text AS net_revenue_minor
     FROM sale_lines sl
     JOIN sales s ON s.id=sl.sale_id AND s.business_id=sl.business_id
     WHERE s.business_id=$1::uuid AND ($2::uuid IS NULL OR s.branch_id=$2::uuid)
       AND s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
       AND s.completed_at >= $3::timestamptz - interval '7 days'
     GROUP BY sl.item_id
     ORDER BY SUM(COALESCE(sl.stock_quantity,sl.quantity)) DESC,sl.item_id
     LIMIT 10`,
    [businessId, branchId, observedAt],
  );
  for (const row of topItems.rows) {
    evidence.push(reference("sales", "CATALOG_ITEM", row.item_id, `topItemQuantity7d:${row.item_name}`, row.quantity_sold, observedAt));
    if (financial) {
      evidence.push(reference("sales", "CATALOG_ITEM", row.item_id, `topItemNetRevenueMinor7d:${row.item_name}`, row.net_revenue_minor, observedAt));
    }
  }
  return evidence;
}

async function loadInventoryEvidence(
  client: DatabaseClient,
  businessId: string,
  branchId: string | null,
  observedAt: string,
): Promise<BusinessEvidenceReference[]> {
  const result = await client.query<{ id: string; name: string; stock_unit_code: string | null; available: string }>(
    `SELECT ci.id,ci.name,ci.stock_unit_code,
            COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.location_type='AVAILABLE'),0)::text AS available
     FROM catalog_items ci
     LEFT JOIN inventory_movements im
       ON im.business_id=ci.business_id AND im.item_id=ci.id
      AND ($2::uuid IS NULL OR im.branch_id=$2::uuid)
     WHERE ci.business_id=$1::uuid AND ci.is_active=true AND ci.track_stock=true
     GROUP BY ci.id,ci.name,ci.stock_unit_code
     ORDER BY COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.location_type='AVAILABLE'),0) ASC,ci.name,ci.id
     LIMIT 12`,
    [businessId, branchId],
  );
  const scopeId = branchId ?? businessId;
  const evidence: BusinessEvidenceReference[] = [reference(
    "inventory",
    branchId ? "BRANCH" : "BUSINESS",
    scopeId,
    "trackedItemsInContext",
    result.rows.length,
    observedAt,
  )];
  for (const row of result.rows) {
    evidence.push(reference(
      "inventory",
      "CATALOG_ITEM",
      row.id,
      `available:${row.name}:${row.stock_unit_code ?? "unit"}`,
      row.available,
      observedAt,
    ));
  }
  return evidence;
}

async function loadCashEvidence(
  client: DatabaseClient,
  businessId: string,
  branchId: string | null,
  observedAt: string,
): Promise<BusinessEvidenceReference[]> {
  const result = await client.query<{ balance_minor: string; movement_7d_minor: string }>(
    `SELECT COALESCE(SUM(amount_delta_minor),0)::text AS balance_minor,
            COALESCE(SUM(amount_delta_minor) FILTER (WHERE occurred_at >= $3::timestamptz - interval '7 days'),0)::text AS movement_7d_minor
     FROM cashbook_entries
     WHERE business_id=$1::uuid AND ($2::uuid IS NULL OR branch_id=$2::uuid)`,
    [businessId, branchId, observedAt],
  );
  const row = result.rows[0];
  const scopeId = branchId ?? businessId;
  return [
    reference("cashbook_entries", branchId ? "BRANCH" : "BUSINESS", scopeId, "cashBalanceMinor", row?.balance_minor ?? "0", observedAt),
    reference("cashbook_entries", branchId ? "BRANCH" : "BUSINESS", scopeId, "cashMovement7dMinor", row?.movement_7d_minor ?? "0", observedAt),
  ];
}

async function loadCustomerCreditEvidence(
  client: DatabaseClient,
  businessId: string,
  branchId: string | null,
  observedAt: string,
): Promise<BusinessEvidenceReference[]> {
  const result = await client.query<{ customer_id: string; customer_name: string; open_minor: string; oldest_due: Date | null }>(
    `SELECT o.customer_id,c.name AS customer_name,SUM(o.open_minor)::text AS open_minor,MIN(o.due_at) AS oldest_due
     FROM customer_credit_obligations o
     JOIN customers c ON c.id=o.customer_id AND c.business_id=o.business_id
     WHERE o.business_id=$1::uuid AND ($2::uuid IS NULL OR o.branch_id=$2::uuid) AND o.open_minor>0
     GROUP BY o.customer_id,c.name
     ORDER BY SUM(o.open_minor) DESC,o.customer_id
     LIMIT 10`,
    [businessId, branchId],
  );
  if (result.rows.length === 0) {
    return [reference("customer_credit_obligations", "BUSINESS", businessId, "openCustomerBalances", 0, observedAt)];
  }
  return result.rows.flatMap((row) => [
    reference("customer_credit_obligations", "CUSTOMER", row.customer_id, `openBalanceMinor:${row.customer_name}`, row.open_minor, observedAt),
    ...(row.oldest_due ? [reference("customer_credit_obligations", "CUSTOMER", row.customer_id, `oldestDueAt:${row.customer_name}`, row.oldest_due.toISOString(), observedAt)] : []),
  ]);
}

async function loadSupplierCreditEvidence(
  client: DatabaseClient,
  businessId: string,
  branchId: string | null,
  observedAt: string,
): Promise<BusinessEvidenceReference[]> {
  const result = await client.query<{ supplier_id: string; supplier_name: string; open_minor: string; oldest_due: Date | null }>(
    `SELECT o.supplier_id,s.name AS supplier_name,SUM(o.open_minor)::text AS open_minor,MIN(o.due_at) AS oldest_due
     FROM supplier_credit_obligations o
     JOIN suppliers s ON s.id=o.supplier_id AND s.business_id=o.business_id
     WHERE o.business_id=$1::uuid AND ($2::uuid IS NULL OR o.branch_id=$2::uuid) AND o.open_minor>0
     GROUP BY o.supplier_id,s.name
     ORDER BY SUM(o.open_minor) DESC,o.supplier_id
     LIMIT 10`,
    [businessId, branchId],
  );
  if (result.rows.length === 0) {
    return [reference("supplier_credit_obligations", "BUSINESS", businessId, "openSupplierBalances", 0, observedAt)];
  }
  return result.rows.flatMap((row) => [
    reference("supplier_credit_obligations", "SUPPLIER", row.supplier_id, `openBalanceMinor:${row.supplier_name}`, row.open_minor, observedAt),
    ...(row.oldest_due ? [reference("supplier_credit_obligations", "SUPPLIER", row.supplier_id, `oldestDueAt:${row.supplier_name}`, row.oldest_due.toISOString(), observedAt)] : []),
  ]);
}

function reference(
  source: string,
  entityType: string,
  entityId: string,
  label: string,
  value: string | number | boolean | null,
  observedAt: string,
): BusinessEvidenceReference {
  return { source, entityType, entityId, label, value, observedAt };
}
