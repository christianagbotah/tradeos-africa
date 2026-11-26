import type {
  AdminAutomationExecutionClass,
  AdminAutomationRun,
  AdminAutomationRunState,
  PlatformAdminRole,
} from "@tradeos/contracts";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { executeApprovedPlatformAction } from "./automation-actions.js";
import { PlatformAdminError } from "./security.js";

type PolicyRow = {
  id: string;
  business_id: string | null;
  enabled: boolean;
  action_type: string;
  action_configuration: Record<string, unknown>;
  execution_class: AdminAutomationExecutionClass;
  approval_role: PlatformAdminRole | null;
  policy_version: number;
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

export async function evaluateSystemAutomationPolicy(
  pool: DatabasePool,
  input: {
    policyId: string;
    correlationId: string;
    triggerSource: string;
    structuredInput?: Record<string, unknown>;
  },
): Promise<AdminAutomationRun> {
  const prepared = await withTransaction(pool, async (client) => {
    const found = await client.query<PolicyRow>(
      `SELECT id,business_id,enabled,action_type,action_configuration,execution_class,approval_role,policy_version
       FROM platform_automation_policies WHERE id=$1 FOR UPDATE`,
      [input.policyId],
    );
    const policy = found.rows[0];
    if (!policy || !policy.enabled) {
      throw new PlatformAdminError("Enabled automation policy was not found", 404, "ADMIN_AUTOMATION_POLICY_NOT_FOUND");
    }
    if (policy.execution_class === 3) {
      throw new PlatformAdminError("Class 3 actions cannot be delegated to automation", 400, "ADMIN_AUTOMATION_CLASS3_FORBIDDEN");
    }

    const existing = await client.query<RunRow>(
      `${RUN_SELECT} WHERE policy_id=$1 AND policy_version=$2 AND trigger_correlation_id=$3`,
      [policy.id, policy.policy_version, input.correlationId],
    );
    if (existing.rows[0]) return { run: mapRun(existing.rows[0]), execute: false, policy };

    const proposedAction = { type: policy.action_type, ...policy.action_configuration };
    const initialState: AdminAutomationRunState = policy.execution_class === 2 ? "WAITING_APPROVAL" : "EXECUTING";
    const inserted = await client.query<RunRow>(
      `INSERT INTO platform_automation_runs(
         policy_id,policy_version,business_id,trigger_source,trigger_correlation_id,state,execution_class,
         structured_input,output_summary,proposed_action,evidence,provider_metadata,executed_by_platform_user_id,
         approval_requested_at,execution_started_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'{}'::jsonb,$9::jsonb,'[]'::jsonb,
         $10::jsonb,NULL,
         CASE WHEN $6='WAITING_APPROVAL' THEN now() ELSE NULL END,
         CASE WHEN $6='EXECUTING' THEN now() ELSE NULL END)
       RETURNING *`,
      [
        policy.id,
        policy.policy_version,
        policy.business_id,
        input.triggerSource,
        input.correlationId,
        initialState,
        policy.execution_class,
        JSON.stringify(input.structuredInput ?? {}),
        JSON.stringify(proposedAction),
        JSON.stringify({ origin: "SYSTEM" }),
      ],
    );
    const run = inserted.rows[0]!;
    await writeSystemAudit(client, policy.business_id, "AUTOMATION_RUN_CREATED", run.id, {
      policyId: policy.id,
      policyVersion: policy.policy_version,
      executionClass: policy.execution_class,
      triggerSource: input.triggerSource,
      triggerCorrelationId: input.correlationId,
      initialState,
    });
    return { run: mapRun(run), execute: initialState === "EXECUTING", policy };
  });

  if (!prepared.execute) return prepared.run;
  return executeSystemRun(pool, prepared.run, prepared.policy);
}

async function executeSystemRun(pool: DatabasePool, run: AdminAutomationRun, policy: PolicyRow): Promise<AdminAutomationRun> {
  try {
    const output = await executeApprovedPlatformAction(pool, null, policy.action_type, policy.action_configuration);
    return withTransaction(pool, async (client) => {
      const updated = await client.query<RunRow>(
        `UPDATE platform_automation_runs
         SET state='SUCCEEDED',output_summary=$2::jsonb,completed_at=now(),error_code=NULL,error_message=NULL,updated_at=now()
         WHERE id=$1 AND state='EXECUTING' RETURNING *`,
        [run.id, JSON.stringify(output)],
      );
      const row = updated.rows[0];
      if (!row) throw new PlatformAdminError("Automation run is no longer executable", 409, "ADMIN_AUTOMATION_RUN_NOT_EXECUTABLE");
      await writeSystemAudit(client, row.business_id, "AUTOMATION_RUN_EXECUTED", row.id, {
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
      await writeSystemAudit(client, run.businessId, "AUTOMATION_RUN_FAILED", run.id, {
        actionType: policy.action_type,
        errorCode: platformError.code,
      });
    });
    throw platformError;
  }
}

async function writeSystemAudit(
  client: DatabaseClient,
  businessId: string | null,
  eventType: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO platform_audit_events(platform_user_id,business_id,event_type,entity_type,entity_id,reason,payload)
     VALUES(NULL,$1,$2,'PLATFORM_AUTOMATION_RUN',$3,NULL,$4::jsonb)`,
    [businessId, eventType, entityId, JSON.stringify({ ...payload, actor: "SYSTEM" })],
  );
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

const RUN_SELECT = `SELECT id,policy_id,policy_version,business_id,trigger_source,trigger_correlation_id,state,execution_class,
  structured_input,output_summary,proposed_action,evidence,provider_metadata,approved_by_platform_user_id,
  executed_by_platform_user_id,approval_requested_at,approved_at,rejected_at,execution_started_at,completed_at,
  error_code,error_message,created_at,updated_at FROM platform_automation_runs`;
