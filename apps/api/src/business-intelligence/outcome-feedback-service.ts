import type { BusinessAttentionSeverity } from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";

const COOLDOWN_ELIGIBLE_SEVERITIES = new Set<BusinessAttentionSeverity>(["INFO", "LOW"]);
const NEGATIVE_OUTCOMES = ["NOT_RELEVANT", "NO_ACTION_NEEDED"] as const;
const LEARNING_WINDOW_DAYS = 30;
const COOLDOWN_DAYS = 14;
const MIN_NEGATIVE_OUTCOMES = 2;

export type AttentionAutomationFeedbackInput = {
  businessId: string;
  branchId: string;
  ruleCode: string;
  sourceKey: string;
  severity: string;
  now: Date;
};

export type AttentionAutomationFeedbackDecision = {
  skip: boolean;
  negativeCount: number;
  cooldownUntil: string | null;
};

export async function shouldCooldownAttentionAutomation(
  pool: DatabasePool,
  input: AttentionAutomationFeedbackInput,
): Promise<AttentionAutomationFeedbackDecision> {
  if (!COOLDOWN_ELIGIBLE_SEVERITIES.has(input.severity as BusinessAttentionSeverity)) {
    return { skip: false, negativeCount: 0, cooldownUntil: null };
  }

  const result = await pool.query<{ negative_count: number; latest_completed_at: Date | string | null }>(
    `SELECT count(*)::int AS negative_count,max(action.completed_at) AS latest_completed_at
     FROM business_action_items action
     JOIN business_attention_items attention
       ON attention.id=action.source_attention_item_id
      AND attention.business_id=action.business_id
     WHERE action.business_id=$1
       AND action.branch_id IS NOT DISTINCT FROM $2::uuid
       AND attention.branch_id IS NOT DISTINCT FROM $2::uuid
       AND attention.rule_code=$3
       AND attention.source_key=$4
       AND action.source_automation_run_id IS NOT NULL
       AND action.status='DONE'
       AND action.completion_outcome = ANY($5::text[])
       AND action.completed_at >= $6::timestamptz - ($7::int * interval '1 day')
       AND action.completed_at <= $6::timestamptz`,
    [
      input.businessId,
      input.branchId,
      input.ruleCode,
      input.sourceKey,
      NEGATIVE_OUTCOMES,
      input.now.toISOString(),
      LEARNING_WINDOW_DAYS,
    ],
  );

  const negativeCount = result.rows[0]?.negative_count ?? 0;
  const latestRaw = result.rows[0]?.latest_completed_at ?? null;
  if (negativeCount < MIN_NEGATIVE_OUTCOMES || !latestRaw) {
    return { skip: false, negativeCount, cooldownUntil: null };
  }

  const latest = latestRaw instanceof Date ? latestRaw : new Date(latestRaw);
  const cooldownUntil = new Date(latest.getTime() + COOLDOWN_DAYS * 86_400_000);
  if (!Number.isFinite(cooldownUntil.getTime()) || input.now.getTime() >= cooldownUntil.getTime()) {
    return { skip: false, negativeCount, cooldownUntil: null };
  }

  return { skip: true, negativeCount, cooldownUntil: cooldownUntil.toISOString() };
}
