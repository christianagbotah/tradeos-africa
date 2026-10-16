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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLICY_WRITE_ROLES = new Set<PlatformAdminRole>(["SUPER_ADMIN", "PLATFORM_ADMIN"]);
const RETRY_ROLES = new Set<PlatformAdminRole>(["SUPER_ADMIN", "PLATFORM_ADMIN", "OPERATIONS"]);
const APPROVAL_ROLES = new Set<PlatformAdminRole>(["SUPER_ADMIN", "PLATFORM_ADMIN", "DEVELOPER", "SUPPORT", "BILLING", "OPERATIONS"]);

type PolicyRow = {
  id: string; code: string; name: string; description: string | null; enabled: boolean; business_id: string | null;
  trigger_type: string; conditions: Record<string, unknown>; action_type: string; action_configuration: Record<string, unknown>;
  execution_class: AdminAutomationExecutionClass; approval_role: PlatformAdminRole | null; policy_version: number;
  created_by_platform_user_id: string; updated_by_platform_user_id: string; created_at: Date; updated_at: Date;
};

type RunRow = {
  id: string; policy_id: string; policy_version: number; business_id: string | null; trigger_source: string;
  trigger_correlation_id: string; state: AdminAutomationRunState; execution_class: AdminAutomationExecutionClass;
  approval_role: PlatformAdminRole | null; structured_input: Record<string, unknown>; output_summary: Record<string, unknown>;
  proposed_action: Record<string, unknown>; evidence: unknown[]; provider_metadata: Record<string, unknown>;
  approved_by_platform_user_id: string | null; executed_by_platform_user_id: string | null;
  approval_requested_at: Date | null; approved_at: Date | null; rejected_at: Date | null;
  execution_started_at: Date | null; completed_at: Date | null; error_code: string | null; error_message: string | null;
  created_at: Date; updated_at: Date;
};

const POLICY_SELECT = `SELECT id,code,name,description,enabled,business_id,trigger_type,conditions,action_type,action_configuration,
  execution_class,approval_role,policy_version,created_by_platform_user_id,updated_by_platform_user_id,created_at,updated_at
  FROM platform_automation_policies`;
const RUN_SELECT = `SELECT id,policy_id,policy_version,business_id,trigger_source,trigger_correlation_id,state,execution_class,
  approval_role,structured_input,output_summary,proposed_action,evidence,provider_metadata,approved_by_platform_user_id,
  executed_by_platform_user_id,approval_requested_at,approved_at,rejected_at,execution_started_at,completed_at,
  error_code,error_message,created_at,updated_at FROM platform_automation_runs`;

export async function updateAutomationPolicyVersion(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  policyIdInput: string,
  input: Record<string, unknown>,
): Promise<AdminAutomationPolicy> {
  requirePolicyWriter(actor);
  const policyId = parseUuid(policyIdInput, "ADMIN_AUTOMATION_POLICY_NOT_FOUND");
  const reason = parseReason(input.reason);

  return withTransaction(pool, async (client) => {
    const found = await client.query<PolicyRow>(`${POLICY_SELECT} WHERE id=$1 FOR UPDATE`, [policyId]);
    const current = found.rows[0];
    if (!current) throw new PlatformAdminError("Automation policy was not found", 404, "ADMIN_AUTOMATION_POLICY_NOT_FOUND");

    const actionType = input.actionType === undefined
      ? current.action_type
      : parseIdentifier(input.actionType, "ADMIN_AUTOMATION_ACTION_INVALID", 100);
    const executionClass = input.executionClass === undefined
      ? current.execution_class
      : parseExecutionClass(input.executionClass);
    validateActionClass(actionType, executionClass);
    if (executionClass === 3) {
      throw new PlatformAdminError("Class 3 actions cannot be delegated to automation", 400, "ADMIN_AUTOMATION_CLASS3_FORBIDDEN");
    }
    const approvalRole = input.approvalRole === undefined
      ? current.approval_role
      : input.approvalRole === null ? null : parseApprovalRole(input.approvalRole);
    if (executionClass === 2 && !approvalRole) {
      throw new PlatformAdminError("Class 2 automation requires an approval role", 400, "ADMIN_AUTOMATION_APPROVAL_ROLE_REQUIRED");
    }

    const updated = await client.query<PolicyRow>(
      `UPDATE platform_automation_policies SET
         name=$2,description=$3,enabled=$4,business_id=$5,trigger_type=$6,conditions=$7::jsonb,
         action_type=$8,action_configuration=$9::jsonb,execution_class=$10,approval_role=$11,
         policy_version=policy_version+1,updated_by_platform_user_id=$12,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [
        policyId,
        input.name === undefined ? current.name : parseIdentifier(input.name, "ADMIN_AUTOMATION_NAME_REQUIRED", 160),
        input.description === undefined ? current.description : input.description === null ? null : parseIdentifier(input.description, "ADMIN_AUTOMATION_DESCRIPTION_INVALID", 500),
        input.enabled === undefined ? current.enabled : input.enabled === true,
        input.businessId === undefined ? current.business_id : input.businessId === null ? null : parseUuid(input.businessId, "ADMIN_AUTOMATION_BUSINESS_INVALID"),
        input.triggerType === undefined ? current.trigger_type : parseIdentifier(input.triggerType, "ADMIN_AUTOMATION_TRIGGER_INVALID", 80),
        JSON.stringify(input.conditions === undefined ? current.conditions : parseObject(input.conditions)),
        actionType,
        JSON.stringify(input.actionConfiguration === undefined ? current.action_configuration : parseObject(input.actionConfiguration)),
        executionClass,
        approvalRole,
        actor.id,
      ],
    );
    const row = updated.rows[0]!;
    await writeAudit(client, actor, row.business_id, "AUTOMATION_POLICY_UPDATED", "PLATFORM_AUTOMATION_POLICY", row.id, reason, {
      previousVersion: current.policy_version,
      policyVersion: row.policy_version,
      actionType: row.action_type,
      executionClass: row.execution_class,
      approvalRole: row.approval_role,
    });
    return mapPolicy(row);
  });
}

export async function approvePinnedAutomationRun(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  runIdInput: string,
  input: Record<string, unknown>,
): Promise<AdminAutomationRun> {
  const runId = parseUuid(runIdInput, "ADMIN_AUTOMATION_RUN_NOT_FOUND");
  const reason = parseReason(input.reason);
  const claimed = await withTransaction(pool, async (client) => {
    const result = await client.query<RunRow>(`${RUN_SELECT} WHERE id=$1 FOR UPDATE`, [runId]);
    const row = result.rows[0];
    if (!row) throw new PlatformAdminError("Automation run was not found", 404, "ADMIN_AUTOMATION_RUN_NOT_FOUND");
    if (row.state !== "WAITING_APPROVAL") {
      throw new PlatformAdminError("Automation run is no longer awaiting approval", 409, "ADMIN_AUTOMATION_RUN_NOT_WAITING");
    }
    if (!canApprove(actor.role, row.approval_role)) {
      throw new PlatformAdminError("Your platform role cannot approve this automation", 403, "ADMIN_AUTOMATION_APPROVAL_FORBIDDEN");
    }
    const updated = await client.query<RunRow>(
      `UPDATE platform_automation_runs SET state='EXECUTING',approved_by_platform_user_id=$2,
         executed_by_platform_user_id=$2,approved_at=now(),execution_started_at=now(),updated_at=now()
       WHERE id=$1 RETURNING *`,
      [runId, actor.id],
    );
    await writeAudit(client, actor, row.business_id, "AUTOMATION_RUN_APPROVED", "PLATFORM_AUTOMATION_RUN", row.id, reason, {
      requiredRole: row.approval_role,
      policyVersion: row.policy_version,
      proposedAction: row.proposed_action,
    });
    return mapRun(updated.rows[0]!);
  });
  return executePinnedRun(pool, actor, claimed);
}

export async function rejectPinnedAutomationRun(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  runIdInput: string,
  input: Record<string, unknown>,
): Promise<AdminAutomationRun> {
  const runId = parseUuid(runIdInput, "ADMIN_AUTOMATION_RUN_NOT_FOUND");
  const reason = parseReason(input.reason);
  return withTransaction(pool, async (client) => {
    const result = await client.query<RunRow>(`${RUN_SELECT} WHERE id=$1 FOR UPDATE`, [runId]);
    const row = result.rows[0];
    if (!row) throw new PlatformAdminError("Automation run was not found", 404, "ADMIN_AUTOMATION_RUN_NOT_FOUND");
    if (row.state !== "WAITING_APPROVAL") {
      throw new PlatformAdminError("Automation run is no longer awaiting approval", 409, "ADMIN_AUTOMATION_RUN_NOT_WAITING");
    }
    if (!canApprove(actor.role, row.approval_role)) {
      throw new PlatformAdminError("Your platform role cannot reject this automation", 403, "ADMIN_AUTOMATION_APPROVAL_FORBIDDEN");
    }
    const updated = await client.query<RunRow>(
      `UPDATE platform_automation_runs SET state='REJECTED',rejected_at=now(),completed_at=now(),updated_at=now()
       WHERE id=$1 RETURNING *`,
      [runId],
    );
    await writeAudit(client, actor, row.business_id, "AUTOMATION_RUN_REJECTED", "PLATFORM_AUTOMATION_RUN", row.id, reason, {
      requiredRole: row.approval_role,
      policyVersion: row.policy_version,
      proposedAction: row.proposed_action,
    });
    return mapRun(updated.rows[0]!);
  });
}

export async function retryFailedAutomationRun(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  runIdInput: string,
  input: Record<string, unknown>,
): Promise<AdminAutomationRun> {
  if (!RETRY_ROLES.has(actor.role)) {
    throw new PlatformAdminError("Your platform role cannot retry automation runs", 403, "ADMIN_AUTOMATION_RETRY_FORBIDDEN");
  }
  const runId = parseUuid(runIdInput, "ADMIN_AUTOMATION_RUN_NOT_FOUND");
  const reason = parseReason(input.reason);
  const claimed = await withTransaction(pool, async (client) => {
    const result = await client.query<RunRow>(`${RUN_SELECT} WHERE id=$1 FOR UPDATE`, [runId]);
    const row = result.rows[0];
    if (!row) throw new PlatformAdminError("Automation run was not found", 404, "ADMIN_AUTOMATION_RUN_NOT_FOUND");
    if (row.state !== "FAILED") {
      throw new PlatformAdminError("Only failed automation runs can be retried", 409, "ADMIN_AUTOMATION_RUN_NOT_FAILED");
    }
    if (row.execution_class > 1) {
      throw new PlatformAdminError("Approval-controlled automation must be re-evaluated instead of retried directly", 409, "ADMIN_AUTOMATION_RETRY_REQUIRES_APPROVAL");
    }
    const updated = await client.query<RunRow>(
      `UPDATE platform_automation_runs SET state='EXECUTING',executed_by_platform_user_id=$2,
         execution_started_at=now(),completed_at=NULL,error_code=NULL,error_message=NULL,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [runId, actor.id],
    );
    await writeAudit(client, actor, row.business_id, "AUTOMATION_RUN_RETRIED", "PLATFORM_AUTOMATION_RUN", row.id, reason, {
      policyId: row.policy_id,
      policyVersion: row.policy_version,
      triggerCorrelationId: row.trigger_correlation_id,
      proposedAction: row.proposed_action,
    });
    return mapRun(updated.rows[0]!);
  });
  return executePinnedRun(pool, actor, claimed);
}

async function executePinnedRun(pool: DatabasePool, actor: PlatformAdminContext, run: AdminAutomationRun): Promise<AdminAutomationRun> {
  const proposed = { ...run.proposedAction };
  const actionType = typeof proposed.type === "string" ? proposed.type : null;
  delete proposed.type;
  if (!actionType) throw new PlatformAdminError("Pinned automation action is invalid", 500, "ADMIN_AUTOMATION_ACTION_INVALID");
  try {
    const output = await executeApprovedPlatformAction(pool, actor, actionType, proposed);
    return withTransaction(pool, async (client) => {
      const updated = await client.query<RunRow>(
        `UPDATE platform_automation_runs SET state='SUCCEEDED',output_summary=$2::jsonb,completed_at=now(),
           error_code=NULL,error_message=NULL,updated_at=now() WHERE id=$1 AND state='EXECUTING' RETURNING *`,
        [run.id, JSON.stringify(output)],
      );
      const row = updated.rows[0];
      if (!row) throw new PlatformAdminError("Automation run is no longer executable", 409, "ADMIN_AUTOMATION_RUN_NOT_EXECUTABLE");
      await writeAudit(client, actor, row.business_id, "AUTOMATION_RUN_EXECUTED", "PLATFORM_AUTOMATION_RUN", row.id, null, {
        actionType,
        policyVersion: row.policy_version,
        output,
      });
      return mapRun(row);
    });
  } catch (error) {
    const failure = error instanceof PlatformAdminError
      ? error
      : new PlatformAdminError("Automation action failed", 500, "ADMIN_AUTOMATION_EXECUTION_FAILED");
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE platform_automation_runs SET state='FAILED',error_code=$2,error_message=$3,completed_at=now(),updated_at=now()
         WHERE id=$1 AND state='EXECUTING'`,
        [run.id, failure.code, failure.message],
      );
      await writeAudit(client, actor, run.businessId, "AUTOMATION_RUN_FAILED", "PLATFORM_AUTOMATION_RUN", run.id, null, {
        actionType,
        policyVersion: run.policyVersion,
        errorCode: failure.code,
      });
    });
    throw failure;
  }
}

function requirePolicyWriter(actor: PlatformAdminContext): void {
  if (!POLICY_WRITE_ROLES.has(actor.role)) {
    throw new PlatformAdminError("Your platform role cannot manage automation policies", 403, "ADMIN_AUTOMATION_POLICY_FORBIDDEN");
  }
}
function canApprove(actorRole: PlatformAdminRole, requiredRole: PlatformAdminRole | null): boolean {
  return Boolean(requiredRole && APPROVAL_ROLES.has(requiredRole) && (actorRole === "SUPER_ADMIN" || actorRole === requiredRole));
}
function validateActionClass(actionType: string, executionClass: AdminAutomationExecutionClass): void {
  const expected = actionType === "RECORD_ONLY" ? 0 : actionType === "RESOLVE_ATTENTION" ? 1 : actionType === "TENANT_STATUS_CHANGE" ? 2 : null;
  if (expected === null) throw new PlatformAdminError("Automation action is not allow-listed", 400, "ADMIN_AUTOMATION_ACTION_NOT_ALLOWED");
  if (expected !== executionClass) throw new PlatformAdminError("Automation execution class does not match the action risk", 400, "ADMIN_AUTOMATION_CLASS_INVALID");
}
function parseExecutionClass(value: unknown): AdminAutomationExecutionClass {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) throw new PlatformAdminError("Automation execution class must be 0, 1, 2, or 3", 400, "ADMIN_AUTOMATION_CLASS_INVALID");
  return value;
}
function parseApprovalRole(value: unknown): PlatformAdminRole {
  if (typeof value !== "string" || !APPROVAL_ROLES.has(value as PlatformAdminRole)) throw new PlatformAdminError("Automation approval role is invalid", 400, "ADMIN_AUTOMATION_APPROVAL_ROLE_INVALID");
  return value as PlatformAdminRole;
}
function parseIdentifier(value: unknown, code: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) throw new PlatformAdminError("Automation value is invalid", 400, code);
  return value.trim();
}
function parseReason(value: unknown): string { return parseIdentifier(value, "ADMIN_AUTOMATION_REASON_REQUIRED", 500); }
function parseUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new PlatformAdminError("Automation identifier is invalid", 400, code);
  return value;
}
function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformAdminError("Automation configuration must be an object", 400, "ADMIN_AUTOMATION_CONFIGURATION_INVALID");
  return value as Record<string, unknown>;
}
function mapPolicy(row: PolicyRow): AdminAutomationPolicy {
  return {
    id: row.id, code: row.code, name: row.name, description: row.description, enabled: row.enabled, businessId: row.business_id,
    triggerType: row.trigger_type, conditions: row.conditions ?? {}, actionType: row.action_type,
    actionConfiguration: row.action_configuration ?? {}, executionClass: row.execution_class, approvalRole: row.approval_role,
    policyVersion: row.policy_version, createdByPlatformUserId: row.created_by_platform_user_id,
    updatedByPlatformUserId: row.updated_by_platform_user_id, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}
function mapRun(row: RunRow): AdminAutomationRun {
  return {
    id: row.id, policyId: row.policy_id, policyVersion: row.policy_version, businessId: row.business_id,
    triggerSource: row.trigger_source, triggerCorrelationId: row.trigger_correlation_id, state: row.state,
    executionClass: row.execution_class, structuredInput: row.structured_input ?? {}, outputSummary: row.output_summary ?? {},
    proposedAction: row.proposed_action ?? {}, evidence: Array.isArray(row.evidence) ? row.evidence as AdminAutomationRun["evidence"] : [],
    providerMetadata: row.provider_metadata ?? {}, approvedByPlatformUserId: row.approved_by_platform_user_id,
    executedByPlatformUserId: row.executed_by_platform_user_id, approvalRequestedAt: iso(row.approval_requested_at),
    approvedAt: iso(row.approved_at), rejectedAt: iso(row.rejected_at), executionStartedAt: iso(row.execution_started_at),
    completedAt: iso(row.completed_at), errorCode: row.error_code, errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}
function iso(value: Date | null): string | null { return value?.toISOString() ?? null; }
async function writeAudit(
  client: DatabaseClient, actor: PlatformAdminContext, businessId: string | null, eventType: string,
  entityType: string, entityId: string, reason: string | null, payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO platform_audit_events(platform_user_id,business_id,event_type,entity_type,entity_id,reason,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [actor.id, businessId, eventType, entityType, entityId, reason, JSON.stringify(payload)],
  );
}
