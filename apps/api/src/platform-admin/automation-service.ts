import type {
  AdminAutomationExecutionClass,
  AdminAutomationPolicy,
  AdminAutomationRun,
  AdminAutomationRunState,
  PlatformAdminRole,
} from "@tradeos/contracts";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { executeApprovedPlatformAction } from "./automation-actions.js";
import { PlatformAdminError, type PlatformAdminContext } from "./security.js";

const POLICY_WRITE_ROLES = new Set<PlatformAdminRole>(["SUPER_ADMIN", "PLATFORM_ADMIN"]);
const EVALUATE_ROLES = new Set<PlatformAdminRole>(["SUPER_ADMIN", "PLATFORM_ADMIN", "OPERATIONS"]);
const APPROVAL_ROLES = new Set<PlatformAdminRole>(["SUPER_ADMIN", "PLATFORM_ADMIN", "DEVELOPER", "SUPPORT", "BILLING", "OPERATIONS"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PolicyRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  business_id: string | null;
  trigger_type: string;
  conditions: Record<string, unknown>;
  action_type: string;
  action_configuration: Record<string, unknown>;
  execution_class: AdminAutomationExecutionClass;
  approval_role: PlatformAdminRole | null;
  policy_version: number;
  created_by_platform_user_id: string;
  updated_by_platform_user_id: string;
  created_at: Date;
  updated_at: Date;
};

type RunRow = {
  id: string;
  policy_id: string;
  policy_version: number;
  business_id: string | null;
  trigger_source: string;
  trigger_correlation_id: string;
  state: AdminAutomationRunState;
  execution_class: AdminAutomationExecutionClass;
  structured_input: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  proposed_action: Record<string, unknown>;
  evidence: unknown[];
  provider_metadata: Record<string, unknown>;
  approved_by_platform_user_id: string | null;
  executed_by_platform_user_id: string | null;
  approval_requested_at: Date | null;
  approved_at: Date | null;
  rejected_at: Date | null;
  execution_started_at: Date | null;
  completed_at: Date | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function listAutomationPolicies(
  pool: DatabasePool,
  _actor: PlatformAdminContext,
): Promise<AdminAutomationPolicy[]> {
  const result = await pool.query<PolicyRow>(`${POLICY_SELECT} ORDER BY enabled DESC,code,id`);
  return result.rows.map(mapPolicy);
}

export async function listAutomationRuns(
  pool: DatabasePool,
  _actor: PlatformAdminContext,
): Promise<AdminAutomationRun[]> {
  const result = await pool.query<RunRow>(`${RUN_SELECT} ORDER BY created_at DESC,id DESC LIMIT 250`);
  return result.rows.map(mapRun);
}

export async function createAutomationPolicy(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  input: Record<string, unknown>,
): Promise<AdminAutomationPolicy> {
  requirePolicyWriter(actor);
  const parsed = parsePolicyInput(input);
  if (parsed.executionClass === 3) {
    throw new PlatformAdminError("Class 3 actions cannot be delegated to automation", 400, "ADMIN_AUTOMATION_CLASS3_FORBIDDEN");
  }
  validateActionClass(parsed.actionType, parsed.executionClass);
  if (parsed.executionClass === 2 && !parsed.approvalRole) {
    throw new PlatformAdminError("Class 2 automation requires an approval role", 400, "ADMIN_AUTOMATION_APPROVAL_ROLE_REQUIRED");
  }
  const reason = parseReason(input.reason);

  try {
    const id = await withTransaction(pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO platform_automation_policies(
           code,name,description,enabled,business_id,trigger_type,conditions,action_type,action_configuration,
           execution_class,approval_role,policy_version,created_by_platform_user_id,updated_by_platform_user_id
         ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,1,$12,$12) RETURNING id`,
        [
          parsed.code, parsed.name, parsed.description, parsed.enabled, parsed.businessId, parsed.triggerType,
          JSON.stringify(parsed.conditions), parsed.actionType, JSON.stringify(parsed.actionConfiguration),
          parsed.executionClass, parsed.approvalRole, actor.id,
        ],
      );
      const policyId = inserted.rows[0]!.id;
      await writeAudit(client, actor, parsed.businessId, "AUTOMATION_POLICY_CREATED", "PLATFORM_AUTOMATION_POLICY", policyId, reason, {
        code: parsed.code,
        actionType: parsed.actionType,
        executionClass: parsed.executionClass,
        approvalRole: parsed.approvalRole,
      });
      return policyId;
    });
    return getPolicy(pool, id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PlatformAdminError("Automation policy code already exists", 409, "ADMIN_AUTOMATION_POLICY_CODE_CONFLICT");
    }
    throw error;
  }
}

export async function evaluateAutomationPolicy(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  input: Record<string, unknown>,
): Promise<AdminAutomationRun> {
  if (!EVALUATE_ROLES.has(actor.role)) {
    throw new PlatformAdminError("Your platform role cannot evaluate automation policies", 403, "ADMIN_AUTOMATION_EVALUATE_FORBIDDEN");
  }
  const policyId = parseUuid(input.policyId, "ADMIN_AUTOMATION_POLICY_NOT_FOUND");
  const correlationId = parseIdentifier(input.correlationId, "ADMIN_AUTOMATION_CORRELATION_REQUIRED", 200);
  const triggerSource = parseIdentifier(input.triggerSource ?? "MANUAL", "ADMIN_AUTOMATION_TRIGGER_INVALID", 80);
  const structuredInput = parseObject(input.structuredInput, {});

  const prepared = await withTransaction(pool, async (client) => {
    const found = await client.query<PolicyRow>(`${POLICY_SELECT} WHERE id=$1 FOR UPDATE`, [policyId]);
    const policy = found.rows[0];
    if (!policy || !policy.enabled) {
      throw new PlatformAdminError("Enabled automation policy was not found", 404, "ADMIN_AUTOMATION_POLICY_NOT_FOUND");
    }

    const existing = await client.query<RunRow>(
      `${RUN_SELECT} WHERE policy_id=$1 AND policy_version=$2 AND trigger_correlation_id=$3`,
      [policy.id, policy.policy_version, correlationId],
    );
    if (existing.rows[0]) return { run: mapRun(existing.rows[0]), execute: false, policy };

    const proposedAction = { type: policy.action_type, ...policy.action_configuration };
    const initialState: AdminAutomationRunState = policy.execution_class === 2 ? "WAITING_APPROVAL" : "EXECUTING";
    const inserted = await client.query<RunRow>(
      `INSERT INTO platform_automation_runs(
         policy_id,policy_version,business_id,trigger_source,trigger_correlation_id,state,execution_class,
         structured_input,output_summary,proposed_action,evidence,provider_metadata,executed_by_platform_user_id,
         approval_requested_at,execution_started_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'{}'::jsonb,$9::jsonb,'[]'::jsonb,'{}'::jsonb,$10,
         CASE WHEN $6='WAITING_APPROVAL' THEN now() ELSE NULL END,
         CASE WHEN $6='EXECUTING' THEN now() ELSE NULL END)
       RETURNING *`,
      [
        policy.id, policy.policy_version, policy.business_id, triggerSource, correlationId, initialState,
        policy.execution_class, JSON.stringify(structuredInput), JSON.stringify(proposedAction),
        initialState === "EXECUTING" ? actor.id : null,
      ],
    );
    const run = inserted.rows[0]!;
    await writeAudit(client, actor, policy.business_id, "AUTOMATION_RUN_CREATED", "PLATFORM_AUTOMATION_RUN", run.id, null, {
      policyId: policy.id,
      policyVersion: policy.policy_version,
      executionClass: policy.execution_class,
      triggerSource,
      triggerCorrelationId: correlationId,
      initialState,
    });
    return { run: mapRun(run), execute: initialState === "EXECUTING", policy };
  });

  if (!prepared.execute) return prepared.run;
  return executeClaimedRun(pool, actor, prepared.run, prepared.policy);
}

export async function approveAutomationRun(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  runIdInput: string,
  input: Record<string, unknown>,
): Promise<AdminAutomationRun> {
  const runId = parseUuid(runIdInput, "ADMIN_AUTOMATION_RUN_NOT_FOUND");
  const reason = parseReason(input.reason);

  const claimed = await withTransaction(pool, async (client) => {
    const result = await client.query<RunRow & { action_type: string; action_configuration: Record<string, unknown>; approval_role: PlatformAdminRole | null }>(
      `${RUN_POLICY_SELECT} WHERE r.id=$1 FOR UPDATE OF r`,
      [runId],
    );
    const row = result.rows[0];
    if (!row) throw new PlatformAdminError("Automation run was not found", 404, "ADMIN_AUTOMATION_RUN_NOT_FOUND");
    if (row.state !== "WAITING_APPROVAL") {
      throw new PlatformAdminError("Automation run is no longer awaiting approval", 409, "ADMIN_AUTOMATION_RUN_NOT_WAITING");
    }
    if (!canApprove(actor.role, row.approval_role)) {
      throw new PlatformAdminError("Your platform role cannot approve this automation", 403, "ADMIN_AUTOMATION_APPROVAL_FORBIDDEN");
    }

    const updated = await client.query<RunRow>(
      `UPDATE platform_automation_runs
       SET state='EXECUTING',approved_by_platform_user_id=$2,executed_by_platform_user_id=$2,
           approved_at=now(),execution_started_at=now(),updated_at=now()
       WHERE id=$1 RETURNING *`,
      [runId, actor.id],
    );
    await writeAudit(client, actor, row.business_id, "AUTOMATION_RUN_APPROVED", "PLATFORM_AUTOMATION_RUN", runId, reason, {
      requiredRole: row.approval_role,
      actionType: row.action_type,
    });
    const policy = await getPolicyRow(client, row.policy_id);
    return { run: mapRun(updated.rows[0]!), policy };
  });

  return executeClaimedRun(pool, actor, claimed.run, claimed.policy);
}

export async function rejectAutomationRun(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  runIdInput: string,
  input: Record<string, unknown>,
): Promise<AdminAutomationRun> {
  const runId = parseUuid(runIdInput, "ADMIN_AUTOMATION_RUN_NOT_FOUND");
  const reason = parseReason(input.reason);
  return withTransaction(pool, async (client) => {
    const result = await client.query<RunRow & { approval_role: PlatformAdminRole | null; action_type: string }>(
      `${RUN_POLICY_SELECT} WHERE r.id=$1 FOR UPDATE OF r`,
      [runId],
    );
    const row = result.rows[0];
    if (!row) throw new PlatformAdminError("Automation run was not found", 404, "ADMIN_AUTOMATION_RUN_NOT_FOUND");
    if (row.state !== "WAITING_APPROVAL") {
      throw new PlatformAdminError("Automation run is no longer awaiting approval", 409, "ADMIN_AUTOMATION_RUN_NOT_WAITING");
    }
    if (!canApprove(actor.role, row.approval_role)) {
      throw new PlatformAdminError("Your platform role cannot reject this automation", 403, "ADMIN_AUTOMATION_APPROVAL_FORBIDDEN");
    }
    const updated = await client.query<RunRow>(
      `UPDATE platform_automation_runs
       SET state='REJECTED',rejected_at=now(),completed_at=now(),updated_at=now()
       WHERE id=$1 RETURNING *`,
      [runId],
    );
    await writeAudit(client, actor, row.business_id, "AUTOMATION_RUN_REJECTED", "PLATFORM_AUTOMATION_RUN", runId, reason, {
      actionType: row.action_type,
    });
    return mapRun(updated.rows[0]!);
  });
}

async function executeClaimedRun(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  run: AdminAutomationRun,
  policy: PolicyRow,
): Promise<AdminAutomationRun> {
  try {
    const output = await executeApprovedPlatformAction(pool, actor, policy.action_type, policy.action_configuration);
    return withTransaction(pool, async (client) => {
      const updated = await client.query<RunRow>(
        `UPDATE platform_automation_runs
         SET state='SUCCEEDED',output_summary=$2::jsonb,completed_at=now(),error_code=NULL,error_message=NULL,updated_at=now()
         WHERE id=$1 AND state='EXECUTING' RETURNING *`,
        [run.id, JSON.stringify(output)],
      );
      const row = updated.rows[0];
      if (!row) throw new PlatformAdminError("Automation run is no longer executable", 409, "ADMIN_AUTOMATION_RUN_NOT_EXECUTABLE");
      await writeAudit(client, actor, row.business_id, "AUTOMATION_RUN_EXECUTED", "PLATFORM_AUTOMATION_RUN", row.id, null, {
        actionType: policy.action_type,
        output,
      });
      return mapRun(row);
    });
  } catch (error) {
    const platformError = error instanceof PlatformAdminError
      ? error
      : new PlatformAdminError("Automation action failed", 500, "ADMIN_AUTOMATION_EXECUTION_FAILED");
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE platform_automation_runs
         SET state='FAILED',error_code=$2,error_message=$3,completed_at=now(),updated_at=now()
         WHERE id=$1 AND state='EXECUTING'`,
        [run.id, platformError.code, platformError.message],
      );
      await writeAudit(client, actor, run.businessId, "AUTOMATION_RUN_FAILED", "PLATFORM_AUTOMATION_RUN", run.id, null, {
        actionType: policy.action_type,
        errorCode: platformError.code,
      });
    });
    throw platformError;
  }
}

async function getPolicy(pool: DatabasePool, id: string): Promise<AdminAutomationPolicy> {
  const row = await getPolicyRow(pool, id);
  return mapPolicy(row);
}

async function getPolicyRow(queryable: Pick<DatabasePool, "query"> | Pick<DatabaseClient, "query">, id: string): Promise<PolicyRow> {
  const result = await queryable.query<PolicyRow>(`${POLICY_SELECT} WHERE id=$1`, [id]);
  const row = result.rows[0];
  if (!row) throw new PlatformAdminError("Automation policy was not found", 404, "ADMIN_AUTOMATION_POLICY_NOT_FOUND");
  return row;
}

function parsePolicyInput(input: Record<string, unknown>) {
  const executionClass = parseExecutionClass(input.executionClass);
  const approvalRole = input.approvalRole == null ? null : parseApprovalRole(input.approvalRole);
  const businessId = input.businessId == null ? null : parseUuid(input.businessId, "ADMIN_AUTOMATION_BUSINESS_INVALID");
  return {
    code: parseCode(input.code),
    name: parseIdentifier(input.name, "ADMIN_AUTOMATION_NAME_REQUIRED", 160),
    description: input.description == null ? null : parseIdentifier(input.description, "ADMIN_AUTOMATION_DESCRIPTION_INVALID", 500),
    enabled: input.enabled === undefined ? true : input.enabled === true,
    businessId,
    triggerType: parseIdentifier(input.triggerType, "ADMIN_AUTOMATION_TRIGGER_INVALID", 80),
    conditions: parseObject(input.conditions, {}),
    actionType: parseIdentifier(input.actionType, "ADMIN_AUTOMATION_ACTION_INVALID", 100),
    actionConfiguration: parseObject(input.actionConfiguration, {}),
    executionClass,
    approvalRole,
  };
}

function validateActionClass(actionType: string, executionClass: AdminAutomationExecutionClass): void {
  const expected = actionType === "RECORD_ONLY" ? 0
    : actionType === "RESOLVE_ATTENTION" ? 1
    : actionType === "TENANT_STATUS_CHANGE" ? 2
    : null;
  if (expected == null) {
    throw new PlatformAdminError("Automation action is not allow-listed", 400, "ADMIN_AUTOMATION_ACTION_NOT_ALLOWED");
  }
  if (executionClass !== expected) {
    throw new PlatformAdminError("Automation execution class does not match the action risk", 400, "ADMIN_AUTOMATION_CLASS_INVALID");
  }
}

function requirePolicyWriter(actor: PlatformAdminContext): void {
  if (!POLICY_WRITE_ROLES.has(actor.role)) {
    throw new PlatformAdminError("Your platform role cannot manage automation policies", 403, "ADMIN_AUTOMATION_POLICY_FORBIDDEN");
  }
}

function canApprove(actorRole: PlatformAdminRole, requiredRole: PlatformAdminRole | null): boolean {
  if (!requiredRole || !APPROVAL_ROLES.has(requiredRole)) return false;
  return actorRole === "SUPER_ADMIN" || actorRole === requiredRole;
}

function parseExecutionClass(value: unknown): AdminAutomationExecutionClass {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) {
    throw new PlatformAdminError("Automation execution class must be 0, 1, 2, or 3", 400, "ADMIN_AUTOMATION_CLASS_INVALID");
  }
  return value;
}

function parseApprovalRole(value: unknown): PlatformAdminRole {
  const allowed = new Set<PlatformAdminRole>(["SUPER_ADMIN", "PLATFORM_ADMIN", "DEVELOPER", "SUPPORT", "BILLING", "OPERATIONS"]);
  if (typeof value !== "string" || !allowed.has(value as PlatformAdminRole)) {
    throw new PlatformAdminError("Automation approval role is invalid", 400, "ADMIN_AUTOMATION_APPROVAL_ROLE_INVALID");
  }
  return value as PlatformAdminRole;
}

function parseCode(value: unknown): string {
  const code = parseIdentifier(value, "ADMIN_AUTOMATION_CODE_REQUIRED", 100).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code)) {
    throw new PlatformAdminError("Automation policy code is invalid", 400, "ADMIN_AUTOMATION_CODE_INVALID");
  }
  return code;
}

function parseIdentifier(value: unknown, code: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new PlatformAdminError("Automation value is invalid", 400, code);
  }
  return value.trim();
}

function parseReason(value: unknown): string {
  const reason = parseIdentifier(value, "ADMIN_AUTOMATION_REASON_REQUIRED", 500);
  return reason;
}

function parseUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new PlatformAdminError("Automation identifier is invalid", 400, code);
  }
  return value;
}

function parseObject(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (value === undefined) return fallback;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlatformAdminError("Automation configuration must be an object", 400, "ADMIN_AUTOMATION_CONFIGURATION_INVALID");
  }
  return value as Record<string, unknown>;
}

function mapPolicy(row: PolicyRow): AdminAutomationPolicy {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    businessId: row.business_id,
    triggerType: row.trigger_type,
    conditions: row.conditions ?? {},
    actionType: row.action_type,
    actionConfiguration: row.action_configuration ?? {},
    executionClass: row.execution_class,
    approvalRole: row.approval_role,
    policyVersion: row.policy_version,
    createdByPlatformUserId: row.created_by_platform_user_id,
    updatedByPlatformUserId: row.updated_by_platform_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRun(row: RunRow): AdminAutomationRun {
  return {
    id: row.id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    businessId: row.business_id,
    triggerSource: row.trigger_source,
    triggerCorrelationId: row.trigger_correlation_id,
    state: row.state,
    executionClass: row.execution_class,
    structuredInput: row.structured_input ?? {},
    outputSummary: row.output_summary ?? {},
    proposedAction: row.proposed_action ?? {},
    evidence: Array.isArray(row.evidence) ? row.evidence as AdminAutomationRun["evidence"] : [],
    providerMetadata: row.provider_metadata ?? {},
    approvedByPlatformUserId: row.approved_by_platform_user_id,
    executedByPlatformUserId: row.executed_by_platform_user_id,
    approvalRequestedAt: iso(row.approval_requested_at),
    approvedAt: iso(row.approved_at),
    rejectedAt: iso(row.rejected_at),
    executionStartedAt: iso(row.execution_started_at),
    completedAt: iso(row.completed_at),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function iso(value: Date | null): string | null { return value?.toISOString() ?? null; }
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

async function writeAudit(
  client: DatabaseClient,
  actor: PlatformAdminContext,
  businessId: string | null,
  eventType: string,
  entityType: string,
  entityId: string,
  reason: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO platform_audit_events(platform_user_id,business_id,event_type,entity_type,entity_id,reason,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [actor.id, businessId, eventType, entityType, entityId, reason, JSON.stringify(payload)],
  );
}

const POLICY_SELECT = `SELECT id,code,name,description,enabled,business_id,trigger_type,conditions,action_type,action_configuration,
  execution_class,approval_role,policy_version,created_by_platform_user_id,updated_by_platform_user_id,created_at,updated_at
  FROM platform_automation_policies`;

const RUN_SELECT = `SELECT id,policy_id,policy_version,business_id,trigger_source,trigger_correlation_id,state,execution_class,
  structured_input,output_summary,proposed_action,evidence,provider_metadata,approved_by_platform_user_id,
  executed_by_platform_user_id,approval_requested_at,approved_at,rejected_at,execution_started_at,completed_at,
  error_code,error_message,created_at,updated_at FROM platform_automation_runs`;

const RUN_POLICY_SELECT = `SELECT r.id,r.policy_id,r.policy_version,r.business_id,r.trigger_source,r.trigger_correlation_id,r.state,
  r.execution_class,r.structured_input,r.output_summary,r.proposed_action,r.evidence,r.provider_metadata,
  r.approved_by_platform_user_id,r.executed_by_platform_user_id,r.approval_requested_at,r.approved_at,r.rejected_at,
  r.execution_started_at,r.completed_at,r.error_code,r.error_message,r.created_at,r.updated_at,
  p.action_type,p.action_configuration,p.approval_role
  FROM platform_automation_runs r JOIN platform_automation_policies p ON p.id=r.policy_id`;
