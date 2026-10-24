import type {
  BusinessActionItemExplanation,
  BusinessAttentionSeverity,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import {
  getBusinessActionItemForActor,
  isBusinessActionFinanciallyRestricted,
  type BusinessAutomationActor,
} from "./automation-service.js";

type RunPolicyRow = {
  run_id: string;
  policy_id: string;
  policy_version: number;
  trigger_source: string;
  run_created_at: Date | string;
  policy_name: string | null;
  trigger_type: string | null;
};

type AttentionRow = {
  id: string;
  rule_code: string;
  severity: string;
  title: string;
  summary: string;
  last_seen_at: Date | string;
};

export async function explainBusinessActionItem(
  pool: DatabasePool,
  actor: BusinessAutomationActor,
  actionItemId: string,
  now = new Date(),
): Promise<BusinessActionItemExplanation> {
  const action = await getBusinessActionItemForActor(pool, actor, actionItemId);

  const automation = action.sourceAutomationRunId
    ? await loadAutomation(pool, action.businessId, action.sourceAutomationRunId)
    : null;
  const attention = action.sourceAttentionItemId
    ? await loadAttention(pool, action.businessId, action.branchId, action.sourceAttentionItemId)
    : null;
  const entity = action.sourceEntityType && action.sourceEntityId
    ? { entityType: action.sourceEntityType, entityId: action.sourceEntityId }
    : null;
  const financialRestricted = isBusinessActionFinanciallyRestricted(
    actor.role,
    action.actionType,
    attention?.ruleCode ?? null,
  );
  const visibleAttention = financialRestricted ? null : attention;
  const visibleAction = financialRestricted ? { ...action, evidence: [] } : action;

  const sourceKind: BusinessActionItemExplanation["sourceKind"] = action.sourceAutomationRunId
    ? "AUTOMATION"
    : entity
      ? "ENTITY_REVIEW"
      : action.sourceAttentionItemId
        ? "ATTENTION"
        : "MANUAL";

  return {
    businessId: action.businessId,
    branchId: action.branchId,
    actionItemId: action.id,
    generatedAt: now.toISOString(),
    sourceKind,
    summary: explanationSummary(sourceKind, action.reason, automation?.policyName ?? null, visibleAttention?.title ?? null),
    action: visibleAction,
    ...(automation ? { automation } : {}),
    ...(visibleAttention ? { attention: visibleAttention } : {}),
    ...(entity ? { entity } : {}),
    evidence: visibleAction.evidence.slice(0, 12),
  };
}

async function loadAutomation(
  pool: DatabasePool,
  businessId: string,
  runId: string,
): Promise<NonNullable<BusinessActionItemExplanation["automation"]> | null> {
  const result = await pool.query<RunPolicyRow>(
    `SELECT r.id AS run_id,r.policy_id,r.policy_version,r.trigger_source,r.created_at AS run_created_at,
            p.name AS policy_name,p.trigger_type
     FROM business_automation_runs r
     LEFT JOIN business_automation_policies p ON p.id=r.policy_id AND p.business_id=r.business_id
     WHERE r.id=$1::uuid AND r.business_id=$2::uuid`,
    [runId, businessId],
  );
  const row = result.rows[0];
  if (!row || !row.policy_name || !row.trigger_type) return null;
  return {
    policyId: row.policy_id,
    policyName: row.policy_name,
    policyVersion: row.policy_version,
    triggerType: row.trigger_type,
    triggerSource: row.trigger_source,
    runId: row.run_id,
    runCreatedAt: iso(row.run_created_at),
  };
}

async function loadAttention(
  pool: DatabasePool,
  businessId: string,
  branchId: string | null,
  attentionId: string,
): Promise<NonNullable<BusinessActionItemExplanation["attention"]> | null> {
  const result = await pool.query<AttentionRow>(
    `SELECT id,rule_code,severity,title,summary,last_seen_at
     FROM business_attention_items
     WHERE id=$1::uuid AND business_id=$2::uuid
       AND (branch_id IS NULL OR branch_id IS NOT DISTINCT FROM $3::uuid)`,
    [attentionId, businessId, branchId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    ruleCode: row.rule_code,
    severity: severity(row.severity),
    title: row.title,
    summary: row.summary,
    lastSeenAt: iso(row.last_seen_at),
  };
}

function explanationSummary(
  sourceKind: BusinessActionItemExplanation["sourceKind"],
  reason: string,
  policyName: string | null,
  attentionTitle: string | null,
): string {
  switch (sourceKind) {
    case "AUTOMATION":
      return policyName
        ? `TradeOS created this review from automation policy “${policyName}”${attentionTitle ? ` after the signal “${attentionTitle}”.` : "."}`
        : `TradeOS created this review from an automation run. ${reason}`;
    case "ENTITY_REVIEW":
      return `TradeOS created this review from record intelligence. ${reason}`;
    case "ATTENTION":
      return attentionTitle
        ? `TradeOS created this review from the attention signal “${attentionTitle}”.`
        : `TradeOS created this review from an attention signal. ${reason}`;
    case "MANUAL":
      return reason;
  }
}

function severity(value: string): BusinessAttentionSeverity {
  return value === "CRITICAL" || value === "HIGH" || value === "MEDIUM" || value === "LOW" || value === "INFO"
    ? value
    : "INFO";
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
