import type {
  BusinessAutomationEffectiveness,
  BusinessAutomationEffectivenessPolicyRow,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";

const WINDOW_DAYS = 30 as const;

export class BusinessAutomationEffectivenessError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "BUSINESS_AUTOMATION_EFFECTIVENESS_INVALID",
  ) {
    super(message);
    this.name = "BusinessAutomationEffectivenessError";
  }
}

type PolicyAggregateRow = {
  policy_id: string;
  name: string;
  enabled: boolean;
  action_type: string;
  tasks_created: number;
  tasks_completed: number;
  tasks_open: number;
  tasks_snoozed: number;
  resolved: number;
  already_handled: number;
  not_relevant: number;
  no_action_needed: number;
  median_completion_hours: number | string | null;
  last_task_at: Date | string | null;
};

export async function getBusinessAutomationEffectiveness(
  pool: DatabasePool,
  input: { businessId: string; branchId: string; now?: Date },
): Promise<BusinessAutomationEffectiveness> {
  const now = input.now ?? new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const scope = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok
     FROM businesses b
     JOIN branches br ON br.business_id=b.id
     WHERE b.id=$1::uuid AND b.status='ACTIVE'
       AND br.id=$2::uuid AND br.is_active=true`,
    [input.businessId, input.branchId],
  );
  if (!scope.rows[0]) {
    throw new BusinessAutomationEffectivenessError(
      "Branch is unavailable in the authorized business.",
      404,
      "BUSINESS_AUTOMATION_EFFECTIVENESS_BRANCH_NOT_FOUND",
    );
  }

  const policyResult = await pool.query<PolicyAggregateRow>(
    `WITH automated_tasks AS (
       SELECT ai.*, r.policy_id,
              CASE WHEN ai.status='DONE' AND ai.completed_at IS NOT NULL
                   THEN EXTRACT(EPOCH FROM (ai.completed_at-ai.created_at))/3600.0
                   ELSE NULL END AS completion_hours
       FROM business_action_items ai
       JOIN business_automation_runs r
         ON r.id=ai.source_automation_run_id
        AND r.business_id=ai.business_id
       WHERE ai.business_id=$1::uuid
         AND ai.branch_id=$2::uuid
         AND ai.source_automation_run_id IS NOT NULL
         AND ai.created_at >= $3::timestamptz
         AND ai.created_at <= $4::timestamptz
     )
     SELECT p.id AS policy_id,p.name,p.enabled,p.action_type,
            count(t.id)::int AS tasks_created,
            count(t.id) FILTER (WHERE t.status='DONE')::int AS tasks_completed,
            count(t.id) FILTER (WHERE t.status='OPEN')::int AS tasks_open,
            count(t.id) FILTER (WHERE t.status='SNOOZED')::int AS tasks_snoozed,
            count(t.id) FILTER (WHERE t.completion_outcome='RESOLVED')::int AS resolved,
            count(t.id) FILTER (WHERE t.completion_outcome='ALREADY_HANDLED')::int AS already_handled,
            count(t.id) FILTER (WHERE t.completion_outcome='NOT_RELEVANT')::int AS not_relevant,
            count(t.id) FILTER (WHERE t.completion_outcome='NO_ACTION_NEEDED')::int AS no_action_needed,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY t.completion_hours)
              FILTER (WHERE t.completion_hours IS NOT NULL) AS median_completion_hours,
            max(t.created_at) AS last_task_at
     FROM business_automation_policies p
     LEFT JOIN automated_tasks t ON t.policy_id=p.id
     WHERE p.business_id=$1::uuid
       AND (
         p.branch_id IS NULL
         OR p.branch_id=$2::uuid
         OR EXISTS (SELECT 1 FROM automated_tasks historical WHERE historical.policy_id=p.id)
       )
     GROUP BY p.id,p.name,p.enabled,p.action_type,p.created_at
     ORDER BY p.enabled DESC,p.created_at,p.id`,
    [input.businessId, input.branchId, windowStart, now],
  );

  const manualResult = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count
     FROM business_action_items
     WHERE business_id=$1::uuid
       AND branch_id=$2::uuid
       AND source_automation_run_id IS NULL
       AND source_entity_type IS NOT NULL
       AND created_at >= $3::timestamptz
       AND created_at <= $4::timestamptz`,
    [input.businessId, input.branchId, windowStart, now],
  );

  const policies = policyResult.rows.map(mapPolicyRow);
  const totals = policyResult.rows.reduce((sum, row) => ({
    created: sum.created + row.tasks_created,
    completed: sum.completed + row.tasks_completed,
    open: sum.open + row.tasks_open,
    snoozed: sum.snoozed + row.tasks_snoozed,
    resolved: sum.resolved + row.resolved,
    alreadyHandled: sum.alreadyHandled + row.already_handled,
    notRelevant: sum.notRelevant + row.not_relevant,
    noActionNeeded: sum.noActionNeeded + row.no_action_needed,
  }), {
    created: 0,
    completed: 0,
    open: 0,
    snoozed: 0,
    resolved: 0,
    alreadyHandled: 0,
    notRelevant: 0,
    noActionNeeded: 0,
  });
  const completedWithOutcome = totals.resolved + totals.alreadyHandled + totals.notRelevant + totals.noActionNeeded;
  const relevant = totals.resolved + totals.alreadyHandled;
  const completionDurations = await pool.query<{ median_completion_hours: number | string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (
       ORDER BY EXTRACT(EPOCH FROM (ai.completed_at-ai.created_at))/3600.0
     ) AS median_completion_hours
     FROM business_action_items ai
     WHERE ai.business_id=$1::uuid
       AND ai.branch_id=$2::uuid
       AND ai.source_automation_run_id IS NOT NULL
       AND ai.status='DONE'
       AND ai.completed_at IS NOT NULL
       AND ai.created_at >= $3::timestamptz
       AND ai.created_at <= $4::timestamptz`,
    [input.businessId, input.branchId, windowStart, now],
  );

  return {
    businessId: input.businessId,
    branchId: input.branchId,
    generatedAt: now.toISOString(),
    windowDays: WINDOW_DAYS,
    summary: {
      automatedTasksCreated: totals.created,
      automatedTasksCompleted: totals.completed,
      automatedTasksOpen: totals.open,
      automatedTasksSnoozed: totals.snoozed,
      completionRate: rate(totals.completed, totals.created),
      relevantOutcomeRate: rate(relevant, completedWithOutcome),
      negativeOutcomeCount: totals.notRelevant + totals.noActionNeeded,
      medianCompletionHours: nullableNumber(completionDurations.rows[0]?.median_completion_hours ?? null),
      manualEntityReviewsCreated: manualResult.rows[0]?.count ?? 0,
    },
    outcomes: {
      resolved: totals.resolved,
      alreadyHandled: totals.alreadyHandled,
      notRelevant: totals.notRelevant,
      noActionNeeded: totals.noActionNeeded,
    },
    policies,
  };
}

function mapPolicyRow(row: PolicyAggregateRow): BusinessAutomationEffectivenessPolicyRow {
  const relevantOutcomes = row.resolved + row.already_handled;
  const negativeOutcomes = row.not_relevant + row.no_action_needed;
  const completedWithOutcome = relevantOutcomes + negativeOutcomes;
  return {
    policyId: row.policy_id,
    name: row.name,
    enabled: row.enabled,
    actionType: row.action_type,
    tasksCreated: row.tasks_created,
    tasksCompleted: row.tasks_completed,
    tasksOpen: row.tasks_open,
    tasksSnoozed: row.tasks_snoozed,
    relevantOutcomes,
    negativeOutcomes,
    completionRate: rate(row.tasks_completed, row.tasks_created),
    relevantOutcomeRate: rate(relevantOutcomes, completedWithOutcome),
    medianCompletionHours: nullableNumber(row.median_completion_hours),
    lastTaskAt: iso(row.last_task_at),
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function nullableNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
