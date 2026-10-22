import type {
  BusinessActionItem,
  BusinessAutomationPolicy,
  BusinessAutomationRun,
  BusinessEvidenceReference,
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
  assertActionAllowed(actor.role, parsed.actionType);
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
    assertActionAllowed(actor.role, actionType);

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

  return withTransaction(pool, async (client) => {
    await assertBranchScope(client, actor.businessId, branchId);
    const found = await client.query<PolicyRow>(
      `${POLICY_SELECT} WHERE id=$1 AND business_id=$2 FOR UPDATE`,
      [policyId, actor.businessId],
    );
    const policy = found.rows[0];
    if (!policy || !policy.enabled) {
      throw new BusinessAutomationError("Enabled automation policy was not found", 404, "BUSINESS_AUTOMATION_POLICY_NOT_FOUND");
    }
    if (policy.branch_id !== null && policy.branch_id !== branchId) {
      throw new BusinessAutomationError("Automation policy does not apply to this branch", 403, "BUSINESS_AUTOMATION_BRANCH_FORBIDDEN");
    }
    assertActionAllowed(actor.role, policy.action_type);

    const existing = await client.query<RunRow>(
      `${RUN_SELECT}
       WHERE business_id=$1 AND policy_id=$2 AND policy_version=$3 AND trigger_correlation_id=$4`,
      [actor.businessId, policy.id, policy.policy_version, correlationId],
    );
    if (existing.rows[0]) return mapRun(existing.rows[0]);

    const attention = triggerSource === "ATTENTION"
      ? await loadAttentionForTrigger(client, actor.businessId, branchId, correlationId, policy)
      : null;
    const evidence = attention?.evidence ?? [];

    const inserted = await client.query<RunRow>(
      `INSERT INTO business_automation_runs(
         business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,
         structured_input,output_summary,evidence,started_at
       ) VALUES($1,$2,$3,$4,$5,$6,'EVALUATING',$7::jsonb,'{}'::jsonb,$8::jsonb,now())
       RETURNING *`,
      [
        actor.businessId,
        branchId,
        policy.id,
        policy.policy_version,
        triggerSource,
        correlationId,
        JSON.stringify({ sourceAttentionItemId: attention?.id ?? null }),
        JSON.stringify(evidence),
      ],
    );
    const run = inserted.rows[0]!;

    const action = actionPresentation(policy.action_type, attention);
    const configuration = policy.action_configuration ?? {};
    const assignToActor = configuration.assignToActor === true;
    const dueAt = dueAtFromConfiguration(configuration);
    const actionInsert = await client.query<ActionRow>(
      `INSERT INTO business_action_items(
         business_id,branch_id,source_attention_item_id,source_automation_run_id,action_type,title,reason,
         evidence,assigned_user_id,assigned_staff_id,due_at,status
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'OPEN')
       RETURNING *`,
      [
        actor.businessId,
        branchId,
        attention?.id ?? null,
        run.id,
        policy.action_type,
        action.title,
        action.reason,
        JSON.stringify(evidence),
        assignToActor ? actor.userId : null,
        assignToActor ? actor.staffId : null,
        dueAt,
      ],
    );
    const actionItem = actionInsert.rows[0]!;

    const completed = await client.query<RunRow>(
      `UPDATE business_automation_runs
       SET state='SUCCEEDED',output_summary=$2::jsonb,completed_at=now(),updated_at=now()
       WHERE id=$1 RETURNING *`,
      [run.id, JSON.stringify({ actionItemId: actionItem.id, actionType: policy.action_type })],
    );
    return mapRun(completed.rows[0]!);
  });
}

export async function listBusinessActionItems(
  pool: DatabasePool,
  actor: Actor,
  branchId: string | null,
): Promise<BusinessActionItem[]> {
  const result = await pool.query<ActionRow>(
    `${ACTION_SELECT}
     WHERE business_id=$1 AND ($2::uuid IS NULL OR branch_id=$2)
     ORDER BY CASE status WHEN 'OPEN' THEN 0 WHEN 'SNOOZED' THEN 1 ELSE 2 END,due_at NULLS LAST,created_at DESC`,
    [actor.businessId, branchId],
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
): Promise<AttentionRow> {
  const match = /^attention:([0-9a-f-]{36})(?::|$)/i.exec(correlationId);
  if (!match || !UUID.test(match[1]!)) {
    throw new BusinessAutomationError("Attention trigger correlation is invalid", 400, "BUSINESS_AUTOMATION_TRIGGER_INVALID");
  }
  const result = await client.query<AttentionRow>(
    `SELECT id,business_id,branch_id,rule_code,severity,title,summary,evidence
     FROM business_attention_items
     WHERE id=$1 AND business_id=$2 AND state='OPEN'`,
    [match[1], businessId],
  );
  const attention = result.rows[0];
  if (!attention) throw new BusinessAutomationError("Attention item was not found", 404, "BUSINESS_AUTOMATION_ATTENTION_NOT_FOUND");
  if (attention.branch_id !== null && attention.branch_id !== branchId) {
    throw new BusinessAutomationError("Attention item is outside this branch", 403, "BUSINESS_AUTOMATION_BRANCH_FORBIDDEN");
  }
  const ruleCodes = stringArray(policy.conditions?.ruleCodes);
  const severities = stringArray(policy.conditions?.severities);
  if (ruleCodes.length > 0 && !ruleCodes.includes(attention.rule_code)) {
    throw new BusinessAutomationError("Attention item does not match this policy", 409, "BUSINESS_AUTOMATION_CONDITION_NOT_MET");
  }
  if (severities.length > 0 && !severities.includes(attention.severity)) {
    throw new BusinessAutomationError("Attention severity does not match this policy", 409, "BUSINESS_AUTOMATION_CONDITION_NOT_MET");
  }
  return attention;
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

function assertActionAllowed(role: BusinessRole, actionType: string): void {
  if (!SAFE_ACTION_TYPES.has(actionType)) {
    throw new BusinessAutomationError(
      "This action is not eligible for direct business automation",
      400,
      "BUSINESS_AUTOMATION_ACTION_FORBIDDEN",
    );
  }
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

function dueAtFromConfiguration(configuration: Record<string, unknown>): Date | null {
  const raw = configuration.dueInHours;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0 || raw > 24 * 365) {
    throw new BusinessAutomationError("dueInHours must be between 0 and 8760");
  }
  return new Date(Date.now() + raw * 3_600_000);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
const ACTION_SELECT = `SELECT id,business_id,branch_id,source_attention_item_id,source_automation_run_id,action_type,title,reason,
  evidence,assigned_user_id,assigned_staff_id,due_at,status,snoozed_until,completed_at,created_at,updated_at
  FROM business_action_items`;
