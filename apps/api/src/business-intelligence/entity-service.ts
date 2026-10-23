import type {
  BusinessAttentionItem,
  BusinessAttentionSeverity,
  BusinessEntityContext,
  BusinessEntityIdentity,
  BusinessEntityIntelligence,
  BusinessEvidenceReference,
  BusinessRecommendation,
} from "@tradeos/contracts";
import type { BusinessRole } from "../auth/authorization.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "../db.js";
import { listBusinessAttention } from "./attention-service.js";

const FINANCIAL_ROLES = new Set<BusinessRole>(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

export class BusinessEntityIntelligenceError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "ENTITY_INTELLIGENCE_INVALID",
  ) {
    super(message);
    this.name = "BusinessEntityIntelligenceError";
  }
}

type EntityInput = BusinessEntityContext & {
  businessId: string;
  branchId: string | null;
  role: BusinessRole;
  now?: Date;
};

type CollectedEntity = {
  entity: BusinessEntityIdentity;
  evidence: BusinessEvidenceReference[];
  suggestedSurface: "INVENTORY" | "PURCHASES" | "CUSTOMERS";
};

export async function getBusinessEntityIntelligence(
  pool: DatabasePool,
  input: EntityInput,
): Promise<BusinessEntityIntelligence> {
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const financial = FINANCIAL_ROLES.has(input.role);

  const collected = await withTransaction(pool, async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const scope = await assertScope(client, input.businessId, input.branchId);
    switch (input.entityType) {
      case "CATALOG_ITEM": return collectCatalogItem(client, input, financial, generatedAt, scope.currencyCode);
      case "CUSTOMER": return collectCustomer(client, input, financial, generatedAt, scope.currencyCode);
      case "SUPPLIER": return collectSupplier(client, input, financial, generatedAt, scope.currencyCode);
      case "PURCHASE": return collectPurchase(client, input, financial, generatedAt);
    }
  });

  const attentionItems = (await listBusinessAttention(pool, {
    businessId: input.businessId,
    branchId: input.branchId,
    includeFinancial: financial,
  })).filter((item) => item.evidence.some((evidence) =>
    evidence.entityType === input.entityType && evidence.entityId === input.entityId,
  ));

  return {
    businessId: input.businessId,
    branchId: input.branchId,
    entity: collected.entity,
    generatedAt,
    evidence: collected.evidence.slice(0, 30),
    attentionItems: attentionItems.slice(0, 6),
    recommendations: [recommendation(input, collected, attentionItems)],
    askPrompt: askPrompt(collected.entity),
  };
}

async function assertScope(client: DatabaseClient, businessId: string, branchId: string | null): Promise<{ currencyCode: string }> {
  const result = branchId
    ? await client.query<{ currency_code: string }>(
        `SELECT b.currency_code::text AS currency_code FROM businesses b JOIN branches br ON br.business_id=b.id
         WHERE b.id=$1::uuid AND b.status='ACTIVE' AND br.id=$2::uuid AND br.is_active=true`,
        [businessId, branchId],
      )
    : await client.query<{ currency_code: string }>(
        `SELECT currency_code::text AS currency_code FROM businesses WHERE id=$1::uuid AND status='ACTIVE'`,
        [businessId],
      );
  if (!result.rowCount) {
    throw new BusinessEntityIntelligenceError(
      branchId ? "Branch is unavailable in the authorized business." : "Business is unavailable.",
      404,
      branchId ? "BRANCH_NOT_FOUND" : "BUSINESS_NOT_FOUND",
    );
  }
  return { currencyCode: result.rows[0]!.currency_code.trim() };
}

async function collectCatalogItem(
  client: DatabaseClient,
  input: EntityInput,
  financial: boolean,
  observedAt: string,
  currencyCode: string,
): Promise<CollectedEntity> {
  const item = (await client.query<{
    id: string; name: string; sku: string | null; kind: string; stock_unit_code: string | null; track_stock: boolean; is_active: boolean;
  }>(
    `SELECT id,name,sku,kind,stock_unit_code,track_stock,is_active
     FROM catalog_items WHERE business_id=$1::uuid AND id=$2::uuid`,
    [input.businessId, input.entityId],
  )).rows[0];
  if (!item) notFound();

  const evidence: BusinessEvidenceReference[] = [
    ref("catalog_items", "CATALOG_ITEM", item.id, "itemName", item.name, observedAt),
    ref("catalog_items", "CATALOG_ITEM", item.id, "sku", item.sku, observedAt),
    ref("catalog_items", "CATALOG_ITEM", item.id, "kind", item.kind, observedAt),
    ref("catalog_items", "CATALOG_ITEM", item.id, "stockUnitCode", item.stock_unit_code, observedAt),
    ref("catalog_items", "CATALOG_ITEM", item.id, "trackStock", item.track_stock, observedAt),
    ref("catalog_items", "CATALOG_ITEM", item.id, "isActive", item.is_active, observedAt),
  ];

  const balances = await client.query<{ location_type: string; quantity: string }>(
    `SELECT location_type,COALESCE(SUM(quantity_delta),0)::text AS quantity
     FROM inventory_movements
     WHERE business_id=$1::uuid AND item_id=$3::uuid AND ($2::uuid IS NULL OR branch_id=$2::uuid)
     GROUP BY location_type`,
    [input.businessId, input.branchId, input.entityId],
  );
  const quantities = new Map(balances.rows.map((row) => [row.location_type, row.quantity]));
  for (const [location, label] of [
    ["AVAILABLE", "availableQuantity"], ["QUARANTINE", "quarantineQuantity"],
    ["DAMAGED", "damagedQuantity"], ["WASTE", "wasteQuantity"],
  ] as const) {
    evidence.push(ref("inventory_movements", "CATALOG_ITEM", item.id, label, quantities.get(location) ?? "0", observedAt));
  }

  const sales = (await client.query<{ sale_count: number; sold_quantity: string; revenue_minor: string }>(
    `WITH sale_events AS (
       SELECT count(DISTINCT s.id)::int AS sale_count,
              COALESCE(SUM(COALESCE(sl.stock_quantity,sl.quantity)),0) AS sold_quantity,
              COALESCE(SUM(sl.line_net_minor),0)::bigint AS revenue_minor
       FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id AND s.business_id=sl.business_id
       WHERE s.business_id=$1::uuid AND sl.item_id=$3::uuid AND ($2::uuid IS NULL OR s.branch_id=$2::uuid)
         AND s.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
         AND s.completed_at >= $4::timestamptz - interval '30 days'
     ), return_events AS (
       SELECT COALESCE(SUM(rl.net_revenue_reversal_minor),0)::bigint AS revenue_reversal_minor
       FROM return_lines rl
       JOIN return_cases r ON r.id=rl.return_case_id
       JOIN sale_lines sl ON sl.id=rl.original_sale_line_id
       WHERE r.business_id=$1::uuid AND sl.item_id=$3::uuid AND ($2::uuid IS NULL OR r.branch_id=$2::uuid)
         AND r.status IN ('PROCESSING','COMPLETED')
         AND COALESCE(r.completed_at,r.created_at) >= $4::timestamptz - interval '30 days'
     )
     SELECT s.sale_count,s.sold_quantity::text,(s.revenue_minor-r.revenue_reversal_minor)::text AS revenue_minor
     FROM sale_events s CROSS JOIN return_events r`,
    [input.businessId, input.branchId, input.entityId, observedAt],
  )).rows[0];
  evidence.push(ref("sales", "CATALOG_ITEM", item.id, "completedSales30d", sales?.sale_count ?? 0, observedAt));
  evidence.push(ref("sale_lines", "CATALOG_ITEM", item.id, "soldQuantity30d", sales?.sold_quantity ?? "0", observedAt));
  if (financial) evidence.push(ref("sale_lines", "CATALOG_ITEM", item.id, "netRevenueMinor30d", sales?.revenue_minor ?? "0", observedAt, moneyMetadata(currencyCode)));

  const movements = await client.query<{ reason: string; location_type: string; quantity_delta: string; occurred_at: Date | string }>(
    `SELECT reason,location_type,quantity_delta::text,occurred_at
     FROM inventory_movements
     WHERE business_id=$1::uuid AND item_id=$3::uuid AND ($2::uuid IS NULL OR branch_id=$2::uuid)
     ORDER BY occurred_at DESC,id DESC LIMIT 6`,
    [input.businessId, input.branchId, input.entityId],
  );
  for (const movement of movements.rows) {
    evidence.push(ref(
      "inventory_movements", "CATALOG_ITEM", item.id,
      `movement:${movement.reason}:${movement.location_type}`,
      movement.quantity_delta, iso(movement.occurred_at),
    ));
  }

  return { entity: { entityType: "CATALOG_ITEM", entityId: item.id, label: item.name }, evidence, suggestedSurface: "INVENTORY" };
}

async function collectCustomer(
  client: DatabaseClient,
  input: EntityInput,
  financial: boolean,
  observedAt: string,
  currencyCode: string,
): Promise<CollectedEntity> {
  const customer = (await client.query<{
    id: string; name: string; phone: string | null; email: string | null; credit_limit_minor: string | null; credit_terms_days: number; is_active: boolean;
  }>(
    `SELECT id,name,phone,email,credit_limit_minor::text,credit_terms_days,is_active
     FROM customers WHERE business_id=$1::uuid AND id=$2::uuid`,
    [input.businessId, input.entityId],
  )).rows[0];
  if (!customer) notFound();

  const evidence: BusinessEvidenceReference[] = [
    ref("customers", "CUSTOMER", customer.id, "customerName", customer.name, observedAt),
    ref("customers", "CUSTOMER", customer.id, "isActive", customer.is_active, observedAt),
    ref("customers", "CUSTOMER", customer.id, "hasPhone", Boolean(customer.phone?.trim()), observedAt),
    ref("customers", "CUSTOMER", customer.id, "hasEmail", Boolean(customer.email?.trim()), observedAt),
  ];
  if (financial) {
    evidence.push(ref("customers", "CUSTOMER", customer.id, "creditLimitMinor", customer.credit_limit_minor, observedAt, moneyMetadata(currencyCode)));
    evidence.push(ref("customers", "CUSTOMER", customer.id, "creditTermsDays", customer.credit_terms_days, observedAt));
    const obligations = (await client.query<{ open_minor: string; open_count: number; overdue_count: number; oldest_due: Date | string | null }>(
      `SELECT COALESCE(SUM(open_minor),0)::text AS open_minor,
              count(*) FILTER (WHERE open_minor>0)::int AS open_count,
              count(*) FILTER (WHERE open_minor>0 AND due_at<$4::timestamptz)::int AS overdue_count,
              min(due_at) FILTER (WHERE open_minor>0) AS oldest_due
       FROM customer_credit_obligations
       WHERE business_id=$1::uuid AND customer_id=$3::uuid AND ($2::uuid IS NULL OR branch_id=$2::uuid)`,
      [input.businessId, input.branchId, input.entityId, observedAt],
    )).rows[0];
    evidence.push(ref("customer_credit_obligations", "CUSTOMER", customer.id, "openBalanceMinor", obligations?.open_minor ?? "0", observedAt, moneyMetadata(currencyCode)));
    evidence.push(ref("customer_credit_obligations", "CUSTOMER", customer.id, "openObligationCount", obligations?.open_count ?? 0, observedAt));
    evidence.push(ref("customer_credit_obligations", "CUSTOMER", customer.id, "overdueObligationCount", obligations?.overdue_count ?? 0, observedAt));
    if (obligations?.oldest_due) evidence.push(ref("customer_credit_obligations", "CUSTOMER", customer.id, "oldestDueAt", iso(obligations.oldest_due), observedAt));

    const recent = (await client.query<{ entry_count: number; latest_at: Date | string | null; latest_type: string | null }>(
      `SELECT count(*)::int AS entry_count,max(occurred_at) AS latest_at,
              (array_agg(entry_type ORDER BY occurred_at DESC,id DESC))[1] AS latest_type
       FROM customer_account_entries
       WHERE business_id=$1::uuid AND customer_id=$3::uuid AND ($2::uuid IS NULL OR branch_id=$2::uuid)
         AND occurred_at >= $4::timestamptz - interval '30 days'`,
      [input.businessId, input.branchId, input.entityId, observedAt],
    )).rows[0];
    evidence.push(ref("customer_account_entries", "CUSTOMER", customer.id, "recentAccountEntryCount30d", recent?.entry_count ?? 0, observedAt));
    if (recent?.latest_at) evidence.push(ref("customer_account_entries", "CUSTOMER", customer.id, "latestAccountEntryAt", iso(recent.latest_at), observedAt));
    if (recent?.latest_type) evidence.push(ref("customer_account_entries", "CUSTOMER", customer.id, "latestAccountEntryType", recent.latest_type, observedAt));
  }
  return { entity: { entityType: "CUSTOMER", entityId: customer.id, label: customer.name }, evidence, suggestedSurface: "CUSTOMERS" };
}

async function collectSupplier(
  client: DatabaseClient,
  input: EntityInput,
  financial: boolean,
  observedAt: string,
  currencyCode: string,
): Promise<CollectedEntity> {
  const supplier = (await client.query<{
    id: string; name: string; phone: string | null; email: string | null; address: string | null; payment_terms_days: number; is_active: boolean;
  }>(
    `SELECT id,name,phone,email,address,payment_terms_days,is_active
     FROM suppliers WHERE business_id=$1::uuid AND id=$2::uuid`,
    [input.businessId, input.entityId],
  )).rows[0];
  if (!supplier) notFound();
  const evidence: BusinessEvidenceReference[] = [
    ref("suppliers", "SUPPLIER", supplier.id, "supplierName", supplier.name, observedAt),
    ref("suppliers", "SUPPLIER", supplier.id, "isActive", supplier.is_active, observedAt),
    ref("suppliers", "SUPPLIER", supplier.id, "hasPhone", Boolean(supplier.phone?.trim()), observedAt),
    ref("suppliers", "SUPPLIER", supplier.id, "hasEmail", Boolean(supplier.email?.trim()), observedAt),
    ref("suppliers", "SUPPLIER", supplier.id, "hasAddress", Boolean(supplier.address?.trim()), observedAt),
  ];
  const purchases = (await client.query<{ purchase_count: number; purchase_total_minor: string; latest_at: Date | string | null }>(
    `SELECT count(*)::int AS purchase_count,COALESCE(SUM(total_minor),0)::text AS purchase_total_minor,max(received_at) AS latest_at
     FROM purchases
     WHERE business_id=$1::uuid AND supplier_id=$3::uuid AND ($2::uuid IS NULL OR branch_id=$2::uuid)
       AND status='RECEIVED' AND received_at >= $4::timestamptz - interval '30 days'`,
    [input.businessId, input.branchId, input.entityId, observedAt],
  )).rows[0];
  evidence.push(ref("purchases", "SUPPLIER", supplier.id, "recentPurchaseCount30d", purchases?.purchase_count ?? 0, observedAt));
  if (purchases?.latest_at) evidence.push(ref("purchases", "SUPPLIER", supplier.id, "latestPurchaseAt", iso(purchases.latest_at), observedAt));
  const returns = (await client.query<{ return_count: number; latest_at: Date | string | null }>(
    `SELECT count(*)::int AS return_count,max(occurred_at) AS latest_at FROM purchase_return_cases
     WHERE business_id=$1::uuid AND supplier_id=$3::uuid AND ($2::uuid IS NULL OR branch_id=$2::uuid)
       AND occurred_at >= $4::timestamptz - interval '30 days'`,
    [input.businessId, input.branchId, input.entityId, observedAt],
  )).rows[0];
  evidence.push(ref("purchase_return_cases", "SUPPLIER", supplier.id, "recentReturnCount30d", returns?.return_count ?? 0, observedAt));
  const payments = (await client.query<{ payment_count: number; latest_at: Date | string | null }>(
    `SELECT count(*)::int AS payment_count,max(occurred_at) AS latest_at FROM supplier_payable_ledger
     WHERE business_id=$1::uuid AND supplier_id=$3::uuid AND ($2::uuid IS NULL OR branch_id=$2::uuid)
       AND source_type='PAYMENT' AND occurred_at >= $4::timestamptz - interval '30 days'`,
    [input.businessId, input.branchId, input.entityId, observedAt],
  )).rows[0];
  evidence.push(ref("supplier_payable_ledger", "SUPPLIER", supplier.id, "recentPaymentCount30d", payments?.payment_count ?? 0, observedAt));

  if (financial) {
    evidence.push(ref("suppliers", "SUPPLIER", supplier.id, "paymentTermsDays", supplier.payment_terms_days, observedAt));
    evidence.push(ref("purchases", "SUPPLIER", supplier.id, "recentPurchaseTotalMinor30d", purchases?.purchase_total_minor ?? "0", observedAt, moneyMetadata(currencyCode)));
    const obligations = (await client.query<{ open_minor: string; open_count: number; overdue_count: number; oldest_due: Date | string | null }>(
      `SELECT COALESCE(SUM(open_minor),0)::text AS open_minor,count(*) FILTER (WHERE open_minor>0)::int AS open_count,
              count(*) FILTER (WHERE open_minor>0 AND due_at<$4::timestamptz)::int AS overdue_count,
              min(due_at) FILTER (WHERE open_minor>0) AS oldest_due
       FROM supplier_credit_obligations
       WHERE business_id=$1::uuid AND supplier_id=$3::uuid AND ($2::uuid IS NULL OR branch_id=$2::uuid)`,
      [input.businessId, input.branchId, input.entityId, observedAt],
    )).rows[0];
    evidence.push(ref("supplier_credit_obligations", "SUPPLIER", supplier.id, "openPayableMinor", obligations?.open_minor ?? "0", observedAt, moneyMetadata(currencyCode)));
    evidence.push(ref("supplier_credit_obligations", "SUPPLIER", supplier.id, "openObligationCount", obligations?.open_count ?? 0, observedAt));
    evidence.push(ref("supplier_credit_obligations", "SUPPLIER", supplier.id, "overdueObligationCount", obligations?.overdue_count ?? 0, observedAt));
    if (obligations?.oldest_due) evidence.push(ref("supplier_credit_obligations", "SUPPLIER", supplier.id, "oldestDueAt", iso(obligations.oldest_due), observedAt));
  }
  return { entity: { entityType: "SUPPLIER", entityId: supplier.id, label: supplier.name }, evidence, suggestedSurface: "PURCHASES" };
}

async function collectPurchase(
  client: DatabaseClient,
  input: EntityInput,
  financial: boolean,
  observedAt: string,
): Promise<CollectedEntity> {
  const purchase = (await client.query<{
    id: string; status: string; supplier_name: string; supplier_reference: string | null; received_at: Date | string; currency_code: string; total_minor: string; line_count: number; return_count: number;
  }>(
    `SELECT p.id,p.status,s.name AS supplier_name,p.supplier_reference,p.received_at,p.currency_code::text,p.total_minor::text,
            (SELECT count(*)::int FROM purchase_lines pl WHERE pl.purchase_id=p.id AND pl.business_id=p.business_id) AS line_count,
            (SELECT count(*)::int FROM purchase_return_cases pr WHERE pr.original_purchase_id=p.id AND pr.business_id=p.business_id) AS return_count
     FROM purchases p JOIN suppliers s ON s.id=p.supplier_id AND s.business_id=p.business_id
     WHERE p.business_id=$1::uuid AND p.id=$3::uuid AND ($2::uuid IS NULL OR p.branch_id=$2::uuid)`,
    [input.businessId, input.branchId, input.entityId],
  )).rows[0];
  if (!purchase) notFound();
  const evidence: BusinessEvidenceReference[] = [
    ref("purchases", "PURCHASE", purchase.id, "status", purchase.status, observedAt),
    ref("purchases", "PURCHASE", purchase.id, "supplierName", purchase.supplier_name, observedAt),
    ref("purchases", "PURCHASE", purchase.id, "supplierReferencePresent", Boolean(purchase.supplier_reference?.trim()), observedAt),
    ref("purchases", "PURCHASE", purchase.id, "currencyCode", purchase.currency_code.trim(), observedAt),
    ref("purchases", "PURCHASE", purchase.id, "lineCount", purchase.line_count, observedAt),
    ref("purchases", "PURCHASE", purchase.id, "receivedAt", iso(purchase.received_at), observedAt),
    ref("purchase_return_cases", "PURCHASE", purchase.id, "returnCount", purchase.return_count, observedAt),
    ref("purchase_return_cases", "PURCHASE", purchase.id, "hasReturns", purchase.return_count > 0, observedAt),
  ];
  if (financial) evidence.push(ref("purchases", "PURCHASE", purchase.id, "totalMinor", purchase.total_minor, observedAt, moneyMetadata(purchase.currency_code.trim())));
  return {
    entity: { entityType: "PURCHASE", entityId: purchase.id, label: `Purchase · ${purchase.supplier_name}` },
    evidence,
    suggestedSurface: "PURCHASES",
  };
}

function recommendation(input: EntityInput, collected: CollectedEntity, attention: BusinessAttentionItem[]): BusinessRecommendation {
  const priority = highestSeverity(attention.map((item) => item.severity));
  const map = {
    INVENTORY: { code: "ENTITY_INVENTORY_REVIEW", title: `Review ${collected.entity.label} inventory`, summary: "Open Inventory to review stock evidence and use the canonical stock workflow.", action: "OPEN_INVENTORY" },
    PURCHASES: { code: "ENTITY_PURCHASE_REVIEW", title: `Review ${collected.entity.label}`, summary: "Open Purchases to review this record in the canonical purchasing workflow.", action: "OPEN_PURCHASES" },
    CUSTOMERS: { code: "ENTITY_CUSTOMER_REVIEW", title: `Review ${collected.entity.label}`, summary: "Open Customers to review this account in the canonical customer workflow.", action: "OPEN_CUSTOMERS" },
  } as const;
  const selected = map[collected.suggestedSurface];
  return {
    businessId: input.businessId,
    branchId: input.branchId,
    code: selected.code,
    title: selected.title,
    summary: selected.summary,
    rationale: attention.length ? "This record has matching open attention evidence." : "Use the authoritative record workflow for any change.",
    priority,
    evidence: collected.evidence.slice(0, 6),
    suggestedActionType: selected.action,
    suggestedActionLabel: `Open ${collected.suggestedSurface === "CUSTOMERS" ? "Customers" : collected.suggestedSurface === "INVENTORY" ? "Inventory" : "Purchases"}`,
  };
}

function askPrompt(entity: BusinessEntityIdentity): string {
  switch (entity.entityType) {
    case "CATALOG_ITEM": return `What should I know about inventory item ${entity.label}, and what should I review next?`;
    case "CUSTOMER": return `What should I know about customer ${entity.label}, and what follow-up should I review?`;
    case "SUPPLIER": return `What should I know about supplier ${entity.label}, and what purchasing or payable issue should I review?`;
    case "PURCHASE": return `What should I know about ${entity.label}, and what should I review next?`;
  }
}

function highestSeverity(values: BusinessAttentionSeverity[]): BusinessAttentionSeverity {
  const order: BusinessAttentionSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  return order.find((severity) => values.includes(severity)) ?? "INFO";
}

function ref(
  source: string,
  entityType: string,
  entityId: string,
  label: string,
  value: string | number | boolean | null,
  observedAt: string,
  metadata?: Record<string, unknown>,
): BusinessEvidenceReference {
  return { source, entityType, entityId, label, value, observedAt, ...(metadata ? { metadata } : {}) };
}

function moneyMetadata(currencyCode: string): Record<string, unknown> {
  return { kind: "money_minor", currencyCode };
}

function notFound(): never {
  throw new BusinessEntityIntelligenceError("Entity was not found in the authorized scope.", 404, "ENTITY_NOT_FOUND");
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
