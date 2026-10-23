import type {
  BusinessActionItem,
  BusinessAutomationPolicy,
  BusinessAutomationRun,
  BusinessEvidenceReference,
  BusinessEntityType,
} from "@tradeos/contracts";
import type { BusinessRole } from "../auth/authorization.js";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

const SAFE_ACTION_TYPES = new Set([
  "CREATE_FOLLOW_UP",
  "CREATE_REORDER_REVIEW",
  "CREATE_RECEIVABLE_FOLLOW_UP",
  "CREATE_CASH_REVIEW",
  "SNOOZE_ATTENTION",
]);
const SYSTEM_DISPATCH_ACTION_TYPES = new Set([
  "CREATE_FOLLOW_UP",
  "CREATE_REORDER_REVIEW",
  "CREATE_RECEIVABLE_FOLLOW_UP",
  "CREATE_CASH_REVIEW",
]);
const MANAGER_ACTION_TYPES = new Set(["CREATE_FOLLOW_UP", "CREATE_REORDER_REVIEW", "SNOOZE_ATTENTION"]);
const TRIGGER_TYPES = new Set(["ATTENTION", "SCHEDULE", "MANUAL", "EVENT"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Actor = {
  userId: string;
  businessId: string;
  role: BusinessRole;
  staffId: string | null;
};

type PolicyRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger_type: string;
  conditions: Record<string, unknown>;
  action_type: string;
  action_configuration: Record<string, unknown>;
  policy_version: number;
  created_by_user_id: string;
  updated_by_user_id: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type RunRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  policy_id: string;
  policy_version: number;
  trigger_source: string;
  trigger_correlation_id: string;
  state: "QUEUED" | "EVALUATING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  structured_input: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  evidence: BusinessEvidenceReference[];
  error_message: string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ActionRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  source_attention_item_id: string | null;
  source_automation_run_id: string | null;
  source_entity_type: BusinessEntityType | null;
  source_entity_id: string | null;
  created_by_user_id: string | null;
  action_type: string | null;
  title: string;
  reason: string;
  evidence: BusinessEvidenceReference[];
  assigned_user_id: string | null;
  assigned_staff_id: string | null;
  due_at: Date | string | null;
  status: "OPEN" | "DONE" | "SNOOZED" | "CANCELED";
  snoozed_until: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type AttentionRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  rule_code: string;
  severity: string;
  title: string;
  summary: string;
  evidence: BusinessEvidenceReference[];
};

export class BusinessAutomationError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "BUSINESS_AUTOMATION_INVALID",
  ) {
    super(message);
    this.name = "BusinessAutomationError";
  }
}

export async function listBusinessAutomationPolicies(
  pool: DatabasePool,
  actor: Actor,
  branchId: string | null,
): Promise<BusinessAutomationPolicy[]> {
  const result = await pool.query<PolicyRow>(
    `${POLICY_SELECT}
     WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2)
     ORDER BY enabled DESC,code,id`,
    [actor.businessId, branchId],
  );
  return result.rows.map(mapPolicy);
}

export async function createBusinessAutomationPolicy(
  pool: DatabasePool,
  actor: Actor,
  input: Record<string, unknown>,
): Promise<BusinessAutomationPolicy> {
  const parsed = parsePolicyInput(input);
  assertBusiness(actor, parsed.businessId);
  assertHumanActionAllowed(actor.role, parsed.actionType);
  const actionConfiguration = normalizeActionConfiguration(actor, parsed.actionConfiguration);

  try {
    return await withTransaction(pool, async (client) => {
      await assertBranchScope(client, actor.businessId, parsed.branchId);
      const inserted = await client.query<PolicyRow>(
        `INSERT INTO business_automation_policies(
           business_id,branch_id,code,name,description,enabled,trigger_type,conditions,action_type,
           action_configuration,policy_version,created_by_user_id,updated_by_user_id
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,1,$11,$11)
         RETURNING *`,
        [
          actor.businessId,
          parsed.branchId,
          parsed.code,
          parsed.name,
          parsed.description,
          parsed.enabled,
          parsed.triggerType,
          JSON.stringify(parsed.conditions),
          parsed.actionType,
          JSON.stringify(actionConfiguration),
          actor.userId,
        ],
      );
      return mapPolicy(inserted.rows[0]!);
    });
  } catch (error) {
    if (isPgCode(error, "23505")) {
      throw new BusinessAutomationError("Automation policy code already exists", 409, "BUSINESS_AUTOMATION_POLICY_CODE_CONFLICT");
    }
    throw error;
  }
}

export async function updateBusinessAutomationPolicy(
  pool: DatabasePool,
  actor: Actor,
  policyIdInput: string,
  input: Record<string, unknown>,
): Promise<BusinessAutomationPolicy> {
  const policyId = parseUuid(policyIdInput, "policyId");
  const expectedVersion = positiveInteger(input.expectedPolicyVersion, "expectedPolicyVersion");

  return withTransaction(pool, async (client) => {
    const found = await client.query<PolicyRow>(
      `${POLICY_SELECT} WHERE id=$1 AND business_id=$2 FOR UPDATE`,
      [policyId, actor.businessId],
    );
    const current = found.rows[0];
    if (!current) throw new BusinessAutomationError("Automation policy was not found", 404, "BUSINESS_AUTOMATION_POLICY_NOT_FOUND");
    if (current.policy_version !== expectedVersion) {
      throw new BusinessAutomationError("Automation policy changed; refresh and try again", 409, "BUSINESS_AUTOMATION_POLICY_VERSION_CONFLICT");
    }

    const branchId = input.branchId === undefined ? current.branch_id : optionalUuid(input.branchId, "branchId");
    await assertBranchScope(client, actor.businessId, branchId);
    const actionType = input.actionType === undefined ? current.action_type : requiredText(input.actionType, "actionType", 100);
    assertHumanActionAllowed(actor.role, actionType);

    const name = input.name === undefined ? current.name : requiredText(input.name, "name", 160);
    const description = input.description === undefined
      ? current.description
      : input.description === null ? null : requiredText(input.description, "description", 500);
    const enabled = input.enabled === undefined ? current.enabled : input.enabled === true;
    const triggerType = input.triggerType === undefined ? current.trigger_type : parseTriggerType(input.triggerType);
    const conditions = input.conditions === undefined ? current.conditions : objectValue(input.conditions, "conditions");
    const actionConfiguration = input.actionConfiguration === undefined
      ? current.action_configuration
      : normalizeActionConfiguration(actor, objectValue(input.actionConfiguration, "actionConfiguration"));

    const updated = await client.query<PolicyRow>(
      `UPDATE business_automation_policies
       SET branch_id=$3,name=$4,description=$5,enabled=$6,trigger_type=$7,conditions=$8::jsonb,
           action_type=$9,action_configuration=$10::jsonb,policy_version=policy_version+1,
           updated_by_user_id=$11,updated_at=now()
       WHERE id=$1 AND business_id=$2
       RETURNING *`,
      [
        policyId,
        actor.businessId,
        branchId,
        name,
        description,
        enabled,
        triggerType,
        JSON.stringify(conditions),
        actionType,
        JSON.stringify(actionConfiguration),
        actor.userId,
      ],
    );
    return mapPolicy(updated.rows[0]!);
  });
}

export async function evaluateBusinessAutomation(
  pool: DatabasePool,
  actor: Actor,
  input: Record<string, unknown>,
): Promise<BusinessAutomationRun> {
  const businessId = parseUuid(input.businessId, "businessId");
  assertBusiness(actor, businessId);
  const branchId = optionalUuid(input.branchId, "branchId");
  const policyId = parseUuid(input.policyId, "policyId");
  const triggerSource = requiredText(input.triggerSource ?? "MANUAL", "triggerSource", 80);
  const correlationId = requiredText(input.triggerCorrelationId, "triggerCorrelationId", 200);

  return evaluatePreparedBusinessAutomation(pool, {
    businessId,
    branchId,
    policyId,
    triggerSource,
    correlationId,
    origin: { kind: "HUMAN", actor },
  });
}

export async function evaluateBusinessAutomationSystem(
  pool: DatabasePool,
  input: {
    businessId: string;
    branchId: string;
    policyId: string;
    triggerSource: "ATTENTION";
    triggerCorrelationId: string;
    now?: Date;
  },
): Promise<BusinessAutomationRun> {
  const businessId = parseUuid(input.businessId, "businessId");
  const branchId = parseUuid(input.branchId, "branchId");
  const policyId = parseUuid(input.policyId, "policyId");
  if (input.triggerSource !== "ATTENTION") {
    throw new BusinessAutomationError("System dispatcher supports ATTENTION triggers only", 400, "BUSINESS_AUTOMATION_TRIGGER_INVALID");
  }
  const correlationId = requiredText(input.triggerCorrelationId, "triggerCorrelationId", 200);

  return evaluatePreparedBusinessAutomation(pool, {
    businessId,
    branchId,
    policyId,
    triggerSource: "ATTENTION",
    correlationId,
    origin: { kind: "SYSTEM_DISPATCHER" },
    ...(input.now ? { now: input.now } : {}),
  });
}

type AutomationExecutionOrigin =
  | { kind: "HUMAN"; actor: Actor }
  | { kind: "SYSTEM_DISPATCHER" };

type AutomationEvaluationInput = {
  businessId: string;
  branchId: string | null;
  policyId: string;
  triggerSource: string;
  correlationId: string;
  origin: AutomationExecutionOrigin;
  now?: Date;
};

type PreparedAutomationEvaluation = {
  run: BusinessAutomationRun;
  shouldExecute: boolean;
  policy: PolicyRow;
  attention: AttentionRow | null;
};

async function evaluatePreparedBusinessAutomation(
  pool: DatabasePool,
  input: AutomationEvaluationInput,
): Promise<BusinessAutomationRun> {
  const prepared = await prepareAutomationRun(pool, input);
  if (!prepared.shouldExecute) return prepared.run;

  try {
    return await withTransaction(pool, async (client) => {
      const locked = await client.query<RunRow>(`${RUN_SELECT} WHERE id=$1 FOR UPDATE`, [prepared.run.id]);
      const currentRun = locked.rows[0];
      if (!currentRun) {
        throw new BusinessAutomationError("Automation run was not found", 404, "BUSINESS_AUTOMATION_RUN_NOT_FOUND");
      }
      if (currentRun.state !== "EVALUATING") return mapRun(currentRun);

      const existingAction = await client.query<ActionRow>(
        `${ACTION_SELECT}
         WHERE source_automation_run_id=$1 AND business_id=$2
         ORDER BY created_at,id
         LIMIT 1
         FOR UPDATE`,
        [currentRun.id, input.businessId],
      );
      if (existingAction.rows[0]) {
        const actionItem = existingAction.rows[0];
        if (actionItem.action_type !== prepared.policy.action_type) {
          throw new BusinessAutomationError(
            "Existing automation action does not match the policy",
            409,
            "BUSINESS_AUTOMATION_RUN_ACTION_CONFLICT",
          );
        }
        const recovered = await client.query<RunRow>(
          `UPDATE business_automation_runs
           SET state='SUCCEEDED',output_summary=$2::jsonb,error_message=NULL,completed_at=now(),updated_at=now()
           WHERE id=$1 AND state='EVALUATING'
           RETURNING *`,
          [currentRun.id, JSON.stringify({ actionItemId: actionItem.id, actionType: prepared.policy.action_type })],
        );
        const recoveredRun = recovered.rows[0];
        if (!recoveredRun) {
          throw new BusinessAutomationError("Automation run is no longer executable", 409, "BUSINESS_AUTOMATION_RUN_NOT_EXECUTABLE");
        }
        return mapRun(recoveredRun);
      }

      const configuration = prepared.policy.action_configuration ?? {};
      const action = actionPresentation(prepared.policy.action_type, prepared.attention);
      const dueAt = dueAtFromConfiguration(configuration, input.now);
      const assignment = input.origin.kind === "HUMAN"
        ? configuration.assignToActor === true
          ? { userId: input.origin.actor.userId, staffId: input.origin.actor.staffId }
          : { userId: null, staffId: null }
        : await resolveSystemAssignment(client, prepared.policy);

      const actionInsert = await client.query<ActionRow>(
        `INSERT INTO business_action_items(
           business_id,branch_id,source_attention_item_id,source_automation_run_id,action_type,title,reason,
           evidence,assigned_user_id,assigned_staff_id,due_at,status
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'OPEN')
         RETURNING *`,
        [
          input.businessId,
          input.branchId,
          prepared.attention?.id ?? null,
          currentRun.id,
          prepared.policy.action_type,
          action.title,
          action.reason,
          JSON.stringify(currentRun.evidence),
          assignment.userId,
          assignment.staffId,
          dueAt,
        ],
      );
      const actionItem = actionInsert.rows[0]!;

      const completed = await client.query<RunRow>(
        `UPDATE business_automation_runs
         SET state='SUCCEEDED',output_summary=$2::jsonb,error_message=NULL,completed_at=now(),updated_at=now()
         WHERE id=$1 AND state='EVALUATING'
         RETURNING *`,
        [currentRun.id, JSON.stringify({ actionItemId: actionItem.id, actionType: prepared.policy.action_type })],
      );
      const row = completed.rows[0];
      if (!row) {
        throw new BusinessAutomationError("Automation run is no longer executable", 409, "BUSINESS_AUTOMATION_RUN_NOT_EXECUTABLE");
      }
      return mapRun(row);
    });
  } catch (error) {
    const failed = await markAutomationRunFailed(pool, prepared.run.id, error);
    if (input.origin.kind === "SYSTEM_DISPATCHER") return failed;
    if (error instanceof BusinessAutomationError) throw error;
    throw new BusinessAutomationError("Automation action failed", 500, "BUSINESS_AUTOMATION_EXECUTION_FAILED");
  }
}

async function prepareAutomationRun(
  pool: DatabasePool,
  input: AutomationEvaluationInput,
): Promise<PreparedAutomationEvaluation> {
  return withTransaction(pool, async (client) => {
    await assertBranchScope(client, input.businessId, input.branchId);
    const found = await client.query<PolicyRow>(
      `${POLICY_SELECT} WHERE id=$1 AND business_id=$2 FOR SHARE`,
      [input.policyId, input.businessId],
    );
    const policy = found.rows[0];
    if (!policy || !policy.enabled) {
      throw new BusinessAutomationError("Enabled automation policy was not found", 404, "BUSINESS_AUTOMATION_POLICY_NOT_FOUND");
    }
    if (policy.branch_id !== null && policy.branch_id !== input.branchId) {
      throw new BusinessAutomationError("Automation policy does not apply to this branch", 403, "BUSINESS_AUTOMATION_BRANCH_FORBIDDEN");
    }
    assertSafeActionType(policy.action_type);
    if (input.origin.kind === "HUMAN") assertHumanActionAllowed(input.origin.actor.role, policy.action_type);
    else assertSystemActionAllowed(policy.action_type);

    const existing = await client.query<RunRow>(
      `${RUN_SELECT}
       WHERE business_id=$1 AND policy_id=$2 AND policy_version=$3 AND trigger_correlation_id=$4`,
      [input.businessId, policy.id, policy.policy_version, input.correlationId],
    );
    if (existing.rows[0]) {
      const run = mapRun(existing.rows[0]);
      if (run.state !== "EVALUATING") return { run, shouldExecute: false, policy, attention: null };
      const recoveryAttention = input.triggerSource === "ATTENTION"
        ? await loadAttentionForTrigger(client, input.businessId, input.branchId, input.correlationId, policy, false)
        : null;
      return { run, shouldExecute: true, policy, attention: recoveryAttention };
    }

    const attention = input.triggerSource === "ATTENTION"
      ? await loadAttentionForTrigger(client, input.businessId, input.branchId, input.correlationId, policy)
      : null;
    const evidence = attention?.evidence ?? [];
    const inserted = await client.query<RunRow>(
      `INSERT INTO business_automation_runs(
         business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,
         structured_input,output_summary,evidence,started_at
       ) VALUES($1,$2,$3,$4,$5,$6,'EVALUATING',$7::jsonb,'{}'::jsonb,$8::jsonb,$9)
       ON CONFLICT (business_id,policy_id,policy_version,trigger_correlation_id) DO NOTHING
       RETURNING *`,
      [
        input.businessId,
        input.branchId,
        policy.id,
        policy.policy_version,
        input.triggerSource,
        input.correlationId,
        JSON.stringify({ sourceAttentionItemId: attention?.id ?? null, executionOrigin: input.origin.kind }),
        JSON.stringify(evidence),
        input.now ?? new Date(),
      ],
    );
    if (inserted.rows[0]) {
      return { run: mapRun(inserted.rows[0]), shouldExecute: true, policy, attention };
    }

    const replay = await client.query<RunRow>(
      `${RUN_SELECT}
       WHERE business_id=$1 AND policy_id=$2 AND policy_version=$3 AND trigger_correlation_id=$4`,
      [input.businessId, policy.id, policy.policy_version, input.correlationId],
    );
    const replayRow = replay.rows[0];
    if (!replayRow) {
      throw new BusinessAutomationError("Automation run could not be prepared", 500, "BUSINESS_AUTOMATION_RUN_PREPARE_FAILED");
    }
    const replayRun = mapRun(replayRow);
    if (replayRun.state !== "EVALUATING") return { run: replayRun, shouldExecute: false, policy, attention: null };
    const recoveryAttention = input.triggerSource === "ATTENTION"
      ? await loadAttentionForTrigger(client, input.businessId, input.branchId, input.correlationId, policy, false)
      : null;
    return { run: replayRun, shouldExecute: true, policy, attention: recoveryAttention };
  });
}

async function markAutomationRunFailed(
  pool: DatabasePool,
  runId: string,
  error: unknown,
): Promise<BusinessAutomationRun> {
  const errorMessage = error instanceof BusinessAutomationError ? error.message : "Automation action failed";
  const updated = await pool.query<RunRow>(
    `UPDATE business_automation_runs
     SET state='FAILED',error_message=$2,completed_at=now(),updated_at=now()
     WHERE id=$1 AND state='EVALUATING'
     RETURNING *`,
    [runId, errorMessage],
  );
  if (updated.rows[0]) return mapRun(updated.rows[0]);

  const current = await pool.query<RunRow>(`${RUN_SELECT} WHERE id=$1`, [runId]);
  const row = current.rows[0];
  if (!row) throw new BusinessAutomationError("Automation run was not found", 404, "BUSINESS_AUTOMATION_RUN_NOT_FOUND");
  return mapRun(row);
}

async function resolveSystemAssignment(
  client: DatabaseClient,
  policy: PolicyRow,
): Promise<{ userId: string | null; staffId: string | null }> {
  const configuration = policy.action_configuration ?? {};
  if (configuration.assignToActor !== true) return { userId: null, staffId: null };

  const rawUserId = configuration.assignedUserId;
  const rawStaffId = configuration.assignedStaffId;
  const hasBoundAssignment = rawUserId !== undefined || rawStaffId !== undefined;
  if (hasBoundAssignment && (typeof rawUserId !== "string" || !UUID.test(rawUserId))) {
    return { userId: null, staffId: null };
  }
  if (rawStaffId !== undefined && (typeof rawStaffId !== "string" || !UUID.test(rawStaffId))) {
    return { userId: null, staffId: null };
  }

  const userId = hasBoundAssignment ? rawUserId as string : policy.created_by_user_id;
  const expectedStaffId = typeof rawStaffId === "string" ? rawStaffId : null;
  const result = await client.query<{ user_id: string; staff_id: string }>(
    `SELECT u.id AS user_id,m.staff_id
     FROM app_users u
     JOIN business_memberships m ON m.user_id=u.id AND m.business_id=$1 AND m.status='ACTIVE'
     JOIN staff s ON s.id=m.staff_id AND s.business_id=m.business_id AND s.is_active=true
     WHERE u.id=$2 AND u.status='ACTIVE'
       AND m.staff_id IS NOT NULL
       AND ($3::uuid IS NULL OR m.staff_id=$3)
     LIMIT 1`,
    [policy.business_id, userId, expectedStaffId],
  );
  const row = result.rows[0];
  return row ? { userId: row.user_id, staffId: row.staff_id } : { userId: null, staffId: null };
}

export async function listBusinessActionItems(
  pool: DatabasePool,
  actor: Actor,
  branchId: string | null,
): Promise<BusinessActionItem[]> {
  const canReadFullQueue = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"].includes(actor.role);
  const result = await pool.query<ActionRow>(
    `${ACTION_SELECT}
     WHERE business_id=$1
       AND ($2::uuid IS NULL OR branch_id=$2)
       AND ($3::boolean OR assigned_user_id=$4 OR ($5::uuid IS NOT NULL AND assigned_staff_id=$5))
     ORDER BY CASE status WHEN 'OPEN' THEN 0 WHEN 'SNOOZED' THEN 1 ELSE 2 END,due_at NULLS LAST,created_at DESC`,
    [actor.businessId, branchId, canReadFullQueue, actor.userId, actor.staffId],
  );
  return result.rows.map(mapAction);
}

export async function snoozeBusinessActionItem(
  pool: DatabasePool,
  actor: Actor,
  actionIdInput: string,
  input: Record<string, unknown>,
): Promise<BusinessActionItem> {
  const actionId = parseUuid(actionIdInput, "actionItemId");
  const businessId = parseUuid(input.businessId, "businessId");
  assertBusiness(actor, businessId);
  const snoozedUntil = parseFutureDate(input.snoozedUntil, "snoozedUntil");

  return withTransaction(pool, async (client) => {
    const current = await getActionForUpdate(client, actor, actionId);
    if (current.status === "DONE" || current.status === "CANCELED") {
      throw new BusinessAutomationError("Completed or canceled action items cannot be snoozed", 409, "BUSINESS_ACTION_ITEM_FINAL");
    }
    const updated = await client.query<ActionRow>(
      `UPDATE business_action_items
       SET status='SNOOZED',snoozed_until=$3,updated_at=now()
       WHERE id=$1 AND business_id=$2 RETURNING *`,
      [actionId, actor.businessId, snoozedUntil],
    );
    return mapAction(updated.rows[0]!);
  });
}

export async function completeBusinessActionItem(
  pool: DatabasePool,
  actor: Actor,
  actionIdInput: string,
  input: Record<string, unknown>,
): Promise<BusinessActionItem> {
  const actionId = parseUuid(actionIdInput, "actionItemId");
  const businessId = parseUuid(input.businessId, "businessId");
  assertBusiness(actor, businessId);

  return withTransaction(pool, async (client) => {
    const current = await getActionForUpdate(client, actor, actionId);
    if (current.status === "CANCELED") {
      throw new BusinessAutomationError("Canceled action items cannot be completed", 409, "BUSINESS_ACTION_ITEM_FINAL");
    }
    if (current.status === "DONE") return mapAction(current);
    const updated = await client.query<ActionRow>(
      `UPDATE business_action_items
       SET status='DONE',completed_at=now(),snoozed_until=NULL,updated_at=now()
       WHERE id=$1 AND business_id=$2 RETURNING *`,
      [actionId, actor.businessId],
    );
    return mapAction(updated.rows[0]!);
  });
}

async function loadAttentionForTrigger(
  client: DatabaseClient,
  businessId: string,
  branchId: string | null,
  correlationId: string,
  policy: PolicyRow,
  requireOpen = true,
): Promise<AttentionRow> {
  const match = /^attention:([0-9a-f-]{36})(?::|$)/i.exec(correlationId);
  if (!match || !UUID.test(match[1]!)) {
    throw new BusinessAutomationError("Attention trigger correlation is invalid", 400, "BUSINESS_AUTOMATION_TRIGGER_INVALID");
  }
  const result = await client.query<AttentionRow>(
    `SELECT id,business_id,branch_id,rule_code,severity,title,summary,evidence
     FROM business_attention_items
     WHERE id=$1 AND business_id=$2${requireOpen ? " AND state='OPEN'" : ""}`,
    [match[1], businessId],
  );
  const attention = result.rows[0];
  if (!attention) throw new BusinessAutomationError("Attention item was not found", 404, "BUSINESS_AUTOMATION_ATTENTION_NOT_FOUND");
  if (attention.branch_id !== null && attention.branch_id !== branchId) {
    throw new BusinessAutomationError("Attention item is outside this branch", 403, "BUSINESS_AUTOMATION_BRANCH_FORBIDDEN");
  }
  if (!businessAutomationConditionsMatch(policy.conditions ?? {}, {
    ruleCode: attention.rule_code,
    severity: attention.severity,
  })) {
    throw new BusinessAutomationError("Attention item does not match this policy", 409, "BUSINESS_AUTOMATION_CONDITION_NOT_MET");
  }
  return attention;
}

export function businessAutomationConditionsMatch(
  conditions: Record<string, unknown>,
  attention: { ruleCode: string; severity: string },
): boolean {
  const ruleCodes = strictStringArray(conditions.ruleCodes);
  const severities = strictStringArray(conditions.severities);
  if (ruleCodes === null || severities === null) return false;
  if (ruleCodes.length > 0 && !ruleCodes.includes(attention.ruleCode)) return false;
  if (severities.length > 0 && !severities.includes(attention.severity)) return false;
  return true;
}

async function getActionForUpdate(client: DatabaseClient, actor: Actor, actionId: string): Promise<ActionRow> {
  const result = await client.query<ActionRow>(
    `${ACTION_SELECT} WHERE id=$1 AND business_id=$2 FOR UPDATE`,
    [actionId, actor.businessId],
  );
  const item = result.rows[0];
  if (!item) throw new BusinessAutomationError("Action item was not found", 404, "BUSINESS_ACTION_ITEM_NOT_FOUND");
  if (!["OWNER", "ADMIN", "MANAGER"].includes(actor.role)) {
    const assignedToActor = item.assigned_user_id === actor.userId
      || (actor.staffId !== null && item.assigned_staff_id === actor.staffId);
    if (!assignedToActor) {
      throw new BusinessAutomationError("This action item is not assigned to you", 403, "BUSINESS_ACTION_ITEM_FORBIDDEN");
    }
  }
  return item;
}

async function assertBranchScope(client: DatabaseClient, businessId: string, branchId: string | null): Promise<void> {
  if (branchId === null) return;
  const result = await client.query<{ ok: number }>(
    "SELECT 1 AS ok FROM branches WHERE id=$1 AND business_id=$2",
    [branchId, businessId],
  );
  if (!result.rows[0]) throw new BusinessAutomationError("Branch does not belong to this business", 403, "BUSINESS_AUTOMATION_BRANCH_FORBIDDEN");
}

function parsePolicyInput(input: Record<string, unknown>) {
  const businessId = parseUuid(input.businessId, "businessId");
  const branchId = optionalUuid(input.branchId, "branchId");
  const actionType = requiredText(input.actionType, "actionType", 100);
  return {
    businessId,
    branchId,
    code: parseCode(input.code),
    name: requiredText(input.name, "name", 160),
    description: input.description == null ? null : requiredText(input.description, "description", 500),
    enabled: input.enabled === undefined ? true : input.enabled === true,
    triggerType: parseTriggerType(input.triggerType ?? "MANUAL"),
    conditions: objectValue(input.conditions, "conditions"),
    actionType,
    actionConfiguration: objectValue(input.actionConfiguration, "actionConfiguration"),
  };
}

function normalizeActionConfiguration(
  actor: Actor,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const { assignedUserId: _ignoredUser, assignedStaffId: _ignoredStaff, ...configuration } = value;
  if (configuration.assignToActor !== true) return configuration;
  return {
    ...configuration,
    assignedUserId: actor.userId,
    ...(actor.staffId ? { assignedStaffId: actor.staffId } : {}),
  };
}

function assertSafeActionType(actionType: string): void {
  if (!SAFE_ACTION_TYPES.has(actionType)) {
    throw new BusinessAutomationError(
      "This action is not eligible for direct business automation",
      400,
      "BUSINESS_AUTOMATION_ACTION_FORBIDDEN",
    );
  }
}

function assertSystemActionAllowed(actionType: string): void {
  if (!SYSTEM_DISPATCH_ACTION_TYPES.has(actionType)) {
    throw new BusinessAutomationError(
      "This action is not enabled for system dispatch",
      400,
      "BUSINESS_AUTOMATION_SYSTEM_ACTION_FORBIDDEN",
    );
  }
}

function assertHumanActionAllowed(role: BusinessRole, actionType: string): void {
  assertSafeActionType(actionType);
  if (role === "MANAGER" && !MANAGER_ACTION_TYPES.has(actionType)) {
    throw new BusinessAutomationError(
      "Managers may configure operational workflow automations only",
      403,
      "BUSINESS_AUTOMATION_MANAGER_RESTRICTED",
    );
  }
}

function assertBusiness(actor: Actor, businessId: string): void {
  if (actor.businessId !== businessId) {
    throw new BusinessAutomationError("Automation scope is outside your business", 403, "BUSINESS_AUTOMATION_SCOPE_FORBIDDEN");
  }
}

function parseTriggerType(value: unknown): string {
  const parsed = requiredText(value, "triggerType", 40).toUpperCase();
  if (!TRIGGER_TYPES.has(parsed)) throw new BusinessAutomationError("Unsupported automation trigger type");
  return parsed;
}

function parseCode(value: unknown): string {
  const parsed = requiredText(value, "code", 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(parsed)) {
    throw new BusinessAutomationError("code may contain lowercase letters, numbers, dots, underscores and hyphens only");
  }
  return parsed;
}

function parseUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new BusinessAutomationError(`${label} must be a UUID`);
  }
  return value;
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return parseUuid(value, label);
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > max) {
    throw new BusinessAutomationError(`${label} is required and must be at most ${max} characters`);
  }
  return value.trim();
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new BusinessAutomationError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new BusinessAutomationError(`${label} must be a positive integer`);
  }
  return value;
}

function parseFutureDate(value: unknown, label: string): Date {
  if (typeof value !== "string") throw new BusinessAutomationError(`${label} must be an ISO timestamp`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
    throw new BusinessAutomationError(`${label} must be a future timestamp`);
  }
  return date;
}

function dueAtFromConfiguration(configuration: Record<string, unknown>, now?: Date): Date | null {
  const raw = configuration.dueInHours;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0 || raw > 24 * 365) {
    throw new BusinessAutomationError("dueInHours must be between 0 and 8760");
  }
  return new Date((now ?? new Date()).getTime() + raw * 3_600_000);
}

function strictStringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value as string[];
}

function actionPresentation(actionType: string, attention: AttentionRow | null) {
  const suffix = attention ? `: ${attention.title}` : "";
  const reason = attention?.summary ?? "TradeOS created this internal review item from an enabled workflow policy.";
  switch (actionType) {
    case "CREATE_REORDER_REVIEW": return { title: `Review stock reorder${suffix}`, reason };
    case "CREATE_RECEIVABLE_FOLLOW_UP": return { title: `Follow up receivable${suffix}`, reason };
    case "CREATE_CASH_REVIEW": return { title: `Review cash position${suffix}`, reason };
    case "SNOOZE_ATTENTION": return { title: `Review attention timing${suffix}`, reason };
    default: return { title: `Follow up${suffix}`, reason };
  }
}

function mapPolicy(row: PolicyRow): BusinessAutomationPolicy {
  return {
    businessId: row.business_id,
    branchId: row.branch_id,
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    triggerType: row.trigger_type,
    conditions: row.conditions ?? {},
    actionType: row.action_type,
    actionConfiguration: row.action_configuration ?? {},
    policyVersion: row.policy_version,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function mapRun(row: RunRow): BusinessAutomationRun {
  return {
    businessId: row.business_id,
    branchId: row.branch_id,
    id: row.id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    triggerSource: row.trigger_source,
    triggerCorrelationId: row.trigger_correlation_id,
    state: row.state,
    structuredInput: row.structured_input ?? {},
    outputSummary: row.output_summary ?? {},
    evidence: row.evidence ?? [],
    errorMessage: row.error_message,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function mapAction(row: ActionRow): BusinessActionItem {
  return {
    businessId: row.business_id,
    branchId: row.branch_id,
    id: row.id,
    sourceAttentionItemId: row.source_attention_item_id,
    sourceAutomationRunId: row.source_automation_run_id,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    createdByUserId: row.created_by_user_id,
    actionType: row.action_type,
    title: row.title,
    reason: row.reason,
    evidence: row.evidence ?? [],
    assignedUserId: row.assigned_user_id,
    assignedStaffId: row.assigned_staff_id,
    dueAt: iso(row.due_at),
    status: row.status,
    snoozedUntil: iso(row.snoozed_until),
    completedAt: iso(row.completed_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isPgCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

const POLICY_SELECT = `SELECT id,business_id,branch_id,code,name,description,enabled,trigger_type,conditions,action_type,
  action_configuration,policy_version,created_by_user_id,updated_by_user_id,created_at,updated_at
  FROM business_automation_policies`;
const RUN_SELECT = `SELECT id,business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,
  structured_input,output_summary,evidence,error_message,started_at,completed_at,created_at,updated_at
  FROM business_automation_runs`;
const ACTION_SELECT = `SELECT id,business_id,branch_id,source_attention_item_id,source_automation_run_id,source_entity_type,source_entity_id,created_by_user_id,action_type,title,reason,
  evidence,assigned_user_id,assigned_staff_id,due_at,status,snoozed_until,completed_at,created_at,updated_at
  FROM business_action_items`;
