import type { BusinessAttentionItem, BusinessAttentionSeverity, BusinessEvidence } from "@tradeos/contracts";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

const LOW_DATA_RULE = "LOW_DATA_CONFIDENCE" as const;
const MIN_RECENT_SALES = 7;
const MIN_ACTIVE_SALE_DAYS = 3;

type AttentionState = "OPEN" | "RESOLVED" | "DISMISSED";

interface AttentionRow {
  id: string;
  business_id: string;
  branch_id: string | null;
  source_key: string;
  rule_code: string;
  entity_type: string | null;
  entity_id: string | null;
  severity: BusinessAttentionSeverity;
  state: AttentionState;
  title: string;
  summary: string;
  evidence: BusinessEvidence[];
  first_seen_at: Date;
  last_seen_at: Date;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface AttentionSignal {
  sourceKey: string;
  ruleCode: typeof LOW_DATA_RULE;
  severity: BusinessAttentionSeverity;
  title: string;
  summary: string;
  evidence: BusinessEvidence[];
}

export class BusinessIntelligenceError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message);
  }
}

export async function assertBusinessIntelligenceBranchScope(
  pool: DatabasePool,
  businessId: string,
  branchId: string | null,
): Promise<void> {
  if (!branchId) return;
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true`,
    [branchId, businessId],
  );
  if (!result.rows[0]) {
    throw new BusinessIntelligenceError("Branch not found for this business", 404, "BRANCH_NOT_FOUND");
  }
}

export async function listBusinessAttention(
  pool: DatabasePool,
  input: { businessId: string; branchId: string | null },
): Promise<BusinessAttentionItem[]> {
  const result = await pool.query<AttentionRow>(
    `SELECT id,business_id,branch_id,source_key,rule_code,entity_type,entity_id,severity,state,title,summary,evidence,
            first_seen_at,last_seen_at,resolved_at,created_at,updated_at
     FROM business_attention_items
     WHERE business_id=$1 AND branch_id IS NOT DISTINCT FROM $2::uuid AND state='OPEN'
     ORDER BY CASE severity
       WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END,
       last_seen_at DESC,id`,
    [input.businessId, input.branchId],
  );
  return result.rows.map(mapAttention);
}

export async function evaluateBusinessAttention(
  pool: DatabasePool,
  input: { businessId: string; branchId: string | null },
): Promise<BusinessAttentionItem[]> {
  return withTransaction(pool, async (client) => {
    const signal = await detectLowDataSignal(client, input);
    if (signal) {
      await upsertSignal(client, input, signal);
    } else {
      await client.query(
        `UPDATE business_attention_items
         SET state='RESOLVED',resolved_at=now(),updated_at=now()
         WHERE business_id=$1 AND branch_id IS NOT DISTINCT FROM $2::uuid
           AND rule_code=$3 AND state='OPEN'`,
        [input.businessId, input.branchId, LOW_DATA_RULE],
      );
    }

    const result = await client.query<AttentionRow>(
      `SELECT id,business_id,branch_id,source_key,rule_code,entity_type,entity_id,severity,state,title,summary,evidence,
              first_seen_at,last_seen_at,resolved_at,created_at,updated_at
       FROM business_attention_items
       WHERE business_id=$1 AND branch_id IS NOT DISTINCT FROM $2::uuid AND state='OPEN'
       ORDER BY CASE severity
         WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 4 ELSE 5 END,
         last_seen_at DESC,id`,
      [input.businessId, input.branchId],
    );
    return result.rows.map(mapAttention);
  });
}

async function detectLowDataSignal(
  client: DatabaseClient,
  input: { businessId: string; branchId: string | null },
): Promise<AttentionSignal | null> {
  const result = await client.query<{
    sale_count: string;
    active_sale_days: string;
    first_sale_at: Date | null;
    latest_sale_at: Date | null;
  }>(
    `SELECT count(*)::text AS sale_count,
            count(DISTINCT (completed_at AT TIME ZONE 'UTC')::date)::text AS active_sale_days,
            min(completed_at) AS first_sale_at,
            max(completed_at) AS latest_sale_at
     FROM sales
     WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2)
       AND status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
       AND completed_at >= now()-interval '30 days'`,
    [input.businessId, input.branchId],
  );
  const row = result.rows[0];
  const saleCount = Number(row?.sale_count ?? 0);
  const activeSaleDays = Number(row?.active_sale_days ?? 0);
  if (saleCount >= MIN_RECENT_SALES && activeSaleDays >= MIN_ACTIVE_SALE_DAYS) return null;

  const scopeId = input.branchId ?? input.businessId;
  return {
    sourceKey: `low-data-confidence:${input.branchId ?? "business"}`,
    ruleCode: LOW_DATA_RULE,
    severity: "INFO",
    title: "More operating history is needed",
    summary: "TradeOS does not yet have enough recent sales history to make reliable trend-based recommendations for this scope.",
    evidence: [
      evidence("BUSINESS_DATA", scopeId, "completedSalesLast30Days", saleCount),
      evidence("BUSINESS_DATA", scopeId, "activeSaleDaysLast30Days", activeSaleDays),
      evidence("BUSINESS_DATA", scopeId, "minimumCompletedSalesRequired", MIN_RECENT_SALES),
      evidence("BUSINESS_DATA", scopeId, "minimumActiveSaleDaysRequired", MIN_ACTIVE_SALE_DAYS),
      ...(row?.first_sale_at ? [evidence("BUSINESS_DATA", scopeId, "firstSaleAt", row.first_sale_at.toISOString())] : []),
      ...(row?.latest_sale_at ? [evidence("BUSINESS_DATA", scopeId, "latestSaleAt", row.latest_sale_at.toISOString())] : []),
    ],
  };
}

async function upsertSignal(
  client: DatabaseClient,
  input: { businessId: string; branchId: string | null },
  signal: AttentionSignal,
): Promise<void> {
  await client.query(
    `INSERT INTO business_attention_items(
       business_id,branch_id,source_key,rule_code,entity_type,entity_id,severity,state,title,summary,evidence,first_seen_at,last_seen_at
     ) VALUES($1,$2,$3,$4,'BUSINESS',$1,$5,'OPEN',$6,$7,$8::jsonb,now(),now())
     ON CONFLICT (business_id,branch_id,source_key) WHERE state='OPEN'
     DO UPDATE SET rule_code=EXCLUDED.rule_code,severity=EXCLUDED.severity,title=EXCLUDED.title,
       summary=EXCLUDED.summary,evidence=EXCLUDED.evidence,last_seen_at=now(),updated_at=now(),resolved_at=NULL`,
    [input.businessId,input.branchId,signal.sourceKey,signal.ruleCode,signal.severity,signal.title,signal.summary,JSON.stringify(signal.evidence)],
  );
}

function evidence(sourceType: string, sourceId: string, label: string, value: unknown): BusinessEvidence {
  return { sourceType, sourceId, label, value };
}

function mapAttention(row: AttentionRow): BusinessAttentionItem {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    sourceKey: row.source_key,
    ruleCode: row.rule_code,
    entityType: row.entity_type,
    entityId: row.entity_id,
    severity: row.severity,
    state: row.state,
    title: row.title,
    summary: row.summary,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
