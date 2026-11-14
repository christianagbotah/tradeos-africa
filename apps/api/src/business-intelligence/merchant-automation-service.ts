import type {
  MerchantAlertThreshold, MerchantAutomationConfigUpdate, MerchantAutomationPolicy,
  MerchantAutomationRun, MerchantAutomationView,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

const CODE_PREFIX = "ALERT_FOLLOWUP:";
const SEVERITIES: readonly MerchantAlertThreshold[] = ["MEDIUM", "HIGH", "CRITICAL"];
const POLICY_SELECT = "id,business_id,branch_id,enabled,conditions,policy_version,approval_role,updated_at";
type PolicyRow = {
  id: string; business_id: string; branch_id: string; enabled: boolean;
  conditions: { minSeverity?: string }; policy_version: number;
  approval_role: "OWNER"; updated_at: Date;
};
type RunRow = {
  id: string; policy_version: number;
  state: "WAITING_APPROVAL" | "SUCCEEDED" | "REJECTED" | "CANCELED";
  structured_input: { sourceAttentionId?: string; title?: string; summary?: string; severity?: string };
  output_summary: Record<string, unknown>;
  created_at: Date; approved_at: Date | null; rejected_at: Date | null;
};

export class MerchantAutomationError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "MERCHANT_AUTOMATION_INVALID") {
    super(message);
  }
}

const RANK: Record<MerchantAlertThreshold, number> = { MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const alertRank: Record<string, number> = { INFO: -1, LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function isThreshold(value: unknown): value is MerchantAlertThreshold {
  return typeof value === "string" && SEVERITIES.includes(value as MerchantAlertThreshold);
}
function mapPolicy(row: PolicyRow): MerchantAutomationPolicy {
  return {
    id: row.id, businessId: row.business_id, branchId: row.branch_id,
    enabled: row.enabled, minSeverity: isThreshold(row.conditions?.minSeverity) ? row.conditions.minSeverity : "HIGH",
    policyVersion: row.policy_version, approvalRole: "OWNER", updatedAt: row.updated_at.toISOString(),
  };
}
function mapRun(row: RunRow): MerchantAutomationRun {
  return {
    id: row.id, policyVersion: row.policy_version, state: row.state,
    sourceAttentionId: row.structured_input?.sourceAttentionId ?? "",
    title: row.structured_input?.title ?? "Review business alert",
    summary: row.structured_input?.summary ?? "",
    severity: row.structured_input?.severity ?? "",
    createdAt: row.created_at.toISOString(),
    approvedAt: row.approved_at?.toISOString() ?? null,
    rejectedAt: row.rejected_at?.toISOString() ?? null,
    outputSummary: row.output_summary ?? {},
  };
}
function policyCode(branchId: string): string { return CODE_PREFIX + branchId; }

export async function readMerchantAutomation(
  pool: DatabasePool, businessId: string, branchId: string,
): Promise<MerchantAutomationView> {
  const found = await pool.query<PolicyRow>(
    "SELECT " + POLICY_SELECT + " FROM business_automation_policies " +
    "WHERE business_id=$1 AND branch_id=$2 AND code=$3 AND execution_class=2 AND action_type='CREATE_ACTION_ITEM'",
    [businessId, branchId, policyCode(branchId)],
  );
  const policy = found.rows[0];
  const runs: RunRow[] = [];
  if (policy) {
    const result = await pool.query<RunRow>(
      "SELECT id,policy_version,state,structured_input,output_summary,created_at,approved_at,rejected_at " +
      "FROM business_automation_runs " +
      "WHERE business_id=$1 AND branch_id=$2 AND policy_id=$3 " +
      "ORDER BY created_at DESC,id DESC LIMIT 100",
      [businessId, branchId, policy.id],
    );
    runs.push(...result.rows);
  }
  return {
    businessId, branchId, policy: policy ? mapPolicy(policy) : null,
    pending: runs.filter((row) => row.state === "WAITING_APPROVAL" &&
      row.policy_version === policy?.policy_version).slice(0, 50).map(mapRun),
    recent: runs.filter((row) => row.state !== "WAITING_APPROVAL").slice(0, 25).map(mapRun),
    generatedAt: new Date().toISOString(),
  };
}

/** Owner-only configuration; default disabled and always approval required. */
export async function configureMerchantAutomation(
  pool: DatabasePool, businessId: string, branchId: string,
  actorUserId: string, input: MerchantAutomationConfigUpdate,
): Promise<MerchantAutomationView> {
  if (!input || typeof input.enabled !== "boolean" || !isThreshold(input.minSeverity) ||
      (input.expectedVersion !== null &&
       (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion ?? 0) < 1))) {
    throw new MerchantAutomationError("Enabled, supported minimum severity and expected version are required.");
  }
  await withTransaction(pool, async (client) => {
    const scope = await client.query(
      "SELECT 1 FROM branches br JOIN businesses b ON b.id=br.business_id " +
      "WHERE b.id=$1 AND br.id=$2 AND b.status='ACTIVE' AND br.is_active=true",
      [businessId, branchId],
    );
    if (!scope.rows[0]) throw new MerchantAutomationError("Business branch is unavailable.", 404, "MERCHANT_BRANCH_NOT_FOUND");
    const old = await client.query<PolicyRow>(
      "SELECT " + POLICY_SELECT + " FROM business_automation_policies " +
      "WHERE business_id=$1 AND code=$2 FOR UPDATE",
      [businessId, policyCode(branchId)],
    );
    const existing = old.rows[0];
    if (existing && (input.expectedVersion !== existing.policy_version || existing.branch_id !== branchId)) {
      throw new MerchantAutomationError("Automation settings changed elsewhere. Refresh the page.", 409, "MERCHANT_POLICY_STALE");
    }
    if (!existing && input.expectedVersion !== null) {
      throw new MerchantAutomationError("Automation settings changed elsewhere. Refresh the page.", 409, "MERCHANT_POLICY_STALE");
    }

    let policyId: string;
    if (!existing) {
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO business_automation_policies (" +
        "business_id,branch_id,code,name,description,enabled,trigger_type,conditions," +
        "action_type,action_configuration,execution_class,approval_role,created_by_user_id,updated_by_user_id" +
        ") VALUES($1,$2,$3,'Owner alert approvals','Creates draft follow-up tasks for owner approval'," +
        "$4,'ATTENTION',$5::jsonb,'CREATE_ACTION_ITEM','{}'::jsonb,2,'OWNER',$6,$6) " +
        "ON CONFLICT (business_id,code) DO NOTHING RETURNING id",
        [businessId, branchId, policyCode(branchId), input.enabled,
          JSON.stringify({ minSeverity: input.minSeverity }), actorUserId],
      );
      if (!inserted.rows[0]) throw new MerchantAutomationError("Automation settings changed elsewhere.", 409, "MERCHANT_POLICY_STALE");
      policyId = inserted.rows[0].id;
    } else {
      const updated = await client.query<{ id: string }>(
        "UPDATE business_automation_policies " +
        "SET enabled=$3,conditions=$4::jsonb,policy_version=policy_version+1,updated_by_user_id=$5,updated_at=now() " +
        "WHERE business_id=$1 AND id=$2 RETURNING id",
        [businessId, existing.id, input.enabled, JSON.stringify({ minSeverity: input.minSeverity }), actorUserId],
      );
      policyId = updated.rows[0]!.id;
      // Existing pending proposals were evaluated under the old policy version.
      await client.query(
        "UPDATE business_automation_runs SET state='CANCELED',completed_at=now(),updated_at=now() " +
        "WHERE business_id=$1 AND policy_id=$2 AND state='WAITING_APPROVAL'",
        [businessId, policyId],
      );
    }
    await client.query(
      "INSERT INTO business_automation_audit_events (" +
      "business_id,policy_id,actor_user_id,actor_type,event_type,details" +
      ") VALUES($1,$2,$3,'USER',$4,$5::jsonb)",
      [businessId, policyId, actorUserId, existing ? "POLICY_UPDATED" : "POLICY_CREATED",
        JSON.stringify({ enabled: input.enabled, minSeverity: input.minSeverity })],
    );
  });
  return readMerchantAutomation(pool, businessId, branchId);
}

/** Called by the server-side attention scheduler only after a successful canonical evaluation.
 * Proposes actions; never creates tasks or changes money/stock automatically.
 */
export async function proposeMerchantAutomation(
  pool: DatabasePool, businessId: string, branchId: string,
): Promise<number> {
  return withTransaction(pool, async (client) => {
    const locked = await client.query<PolicyRow>(
      "SELECT " + POLICY_SELECT + " FROM business_automation_policies " +
      "WHERE business_id=$1 AND branch_id=$2 AND code=$3 AND enabled=true " +
      "AND execution_class=2 AND approval_role='OWNER' AND action_type='CREATE_ACTION_ITEM' FOR SHARE",
      [businessId, branchId, policyCode(branchId)],
    );
    const policy = locked.rows[0];
    if (!policy) return 0;
    const threshold = isThreshold(policy.conditions?.minSeverity) ? policy.conditions.minSeverity : "HIGH";
    const alerts = await client.query<{
      id: string; title: string; summary: string; severity: string;
    }>(
      "SELECT a.id,a.title,a.summary,a.severity FROM business_attention_items a " +
      "JOIN businesses b ON b.id=a.business_id " +
      "JOIN branches br ON br.id=a.branch_id AND br.business_id=b.id " +
      "WHERE a.business_id=$1 AND a.branch_id=$2 AND b.status='ACTIVE' AND br.is_active=true " +
      "AND a.state='OPEN' AND a.severity=ANY($3::text[]) " +
      "AND NOT EXISTS (SELECT 1 FROM business_action_items t " +
      "WHERE t.business_id=$1 AND t.idempotency_key='ATTENTION:' || a.id::text) " +
      "ORDER BY a.last_seen_at DESC,a.id LIMIT 25",
      [businessId, branchId, Object.keys(alertRank).filter((severity) => alertRank[severity]! >= RANK[threshold])],
    );
    let count = 0;
    for (const alert of alerts.rows) {
      const proposed = await client.query<{ id: string }>(
        "INSERT INTO business_automation_runs(" +
        "business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id," +
        "state,execution_class,approval_role,structured_input,proposed_action,approval_requested_at" +
        ") VALUES($1,$2,$3,$4,'ATTENTION',$5,'WAITING_APPROVAL',2,'OWNER',$6::jsonb,$7::jsonb,now()) " +
        "ON CONFLICT (business_id,policy_id,policy_version,trigger_correlation_id) DO NOTHING RETURNING id",
        [businessId, branchId, policy.id, policy.policy_version, "attention:" + alert.id,
          JSON.stringify({ sourceAttentionId: alert.id, title: alert.title, summary: alert.summary, severity: alert.severity }),
          JSON.stringify({ type: "CREATE_ACTION_ITEM", sourceAttentionId: alert.id })],
      );
      if (!proposed.rows[0]) continue;
      count++;
      await client.query(
        "INSERT INTO business_automation_audit_events(" +
        "business_id,policy_id,run_id,actor_type,event_type,details" +
        ") VALUES($1,$2,$3,'SYSTEM','RUN_PROPOSED',$4::jsonb)",
        [businessId, policy.id, proposed.rows[0].id, JSON.stringify({ sourceAttentionId: alert.id, severity: alert.severity })],
      );
    }
    return count;
  });
}

/** An OWNER must individually approve or reject each proposed follow-up task. */
export async function decideMerchantAutomationRun(
  pool: DatabasePool,
  input: { businessId: string; branchId: string; runId: string; actorUserId: string; decision: "APPROVE" | "REJECT" },
): Promise<MerchantAutomationRun> {
  if (input.decision !== "APPROVE" && input.decision !== "REJECT") {
    throw new MerchantAutomationError("Decision must be APPROVE or REJECT.");
  }
  const row = await withTransaction(pool, async (client) => {
    const res = await client.query<RunRow & { policy_id: string; business_id: string; branch_id: string }>(
      "SELECT id,policy_version,state,structured_input,output_summary,created_at,approved_at,rejected_at," +
      "policy_id,business_id,branch_id FROM business_automation_runs " +
      "WHERE id=$1 AND business_id=$2 AND branch_id=$3 FOR UPDATE",
      [input.runId, input.businessId, input.branchId],
    );
    const run = res.rows[0];
    if (!run) throw new MerchantAutomationError("Proposal not found.", 404, "MERCHANT_RUN_NOT_FOUND");
    if (run.state !== "WAITING_APPROVAL") {
      throw new MerchantAutomationError("This proposal is no longer awaiting approval.", 409, "MERCHANT_RUN_STALE");
    }
    const locked = await client.query<PolicyRow>(
      "SELECT " + POLICY_SELECT + " FROM business_automation_policies " +
      "WHERE id=$1 AND business_id=$2 AND branch_id=$3 FOR SHARE",
      [run.policy_id, input.businessId, input.branchId],
    );
    const policy = locked.rows[0];
    if (!policy || !policy.enabled || policy.policy_version !== run.policy_version) {
      throw new MerchantAutomationError("The approval policy has changed.", 409, "MERCHANT_POLICY_STALE");
    }
    let taskCreated = false;
    if (input.decision === "APPROVE") {
      const alertId = run.structured_input?.sourceAttentionId;
      if (!alertId) throw new MerchantAutomationError("Proposal has no source alert.", 409, "MERCHANT_SOURCE_MISSING");
      const alert = await client.query<{ title: string; summary: string; severity: string }>(
        "SELECT title,summary,severity FROM business_attention_items " +
        "WHERE id=$1 AND business_id=$2 AND branch_id=$3 AND state='OPEN' FOR SHARE",
        [alertId, input.businessId, input.branchId],
      );
      const source = alert.rows[0];
      const threshold = isThreshold(policy.conditions?.minSeverity) ? policy.conditions.minSeverity : "HIGH";
      if (!source || (alertRank[source.severity] ?? -1) < RANK[threshold]) {
        throw new MerchantAutomationError("The alert has resolved or no longer meets the policy.", 409, "MERCHANT_SOURCE_STALE");
      }
      const inserted = await client.query<{ id: string }>(
        "INSERT INTO business_action_items(" +
        "business_id,branch_id,title,reason,state,source_attention_id,source_automation_run_id,idempotency_key" +
        ") VALUES($1,$2,$3,$4,'OPEN',$5,$6,$7) " +
        "ON CONFLICT (business_id,idempotency_key) WHERE idempotency_key IS NOT NULL " +
        "DO NOTHING RETURNING id",
        [input.businessId, input.branchId, "Review: " + source.title, source.summary, alertId,
          run.id, "ATTENTION:" + alertId],
      );
      if (inserted.rows[0]) {
        taskCreated = true;
        await client.query(
          "INSERT INTO business_action_events (" +
          "business_id,action_id,actor_user_id,event_type,from_state,to_state,evidence" +
          ") VALUES($1,$2,$3,'CREATED',NULL,'OPEN',$4::jsonb)",
          [input.businessId, inserted.rows[0].id, input.actorUserId,
            JSON.stringify({ origin: "OWNER_APPROVED_AUTOMATION", runId: run.id })],
        );
      }
    }
    const updated = await client.query<RunRow>(
      "UPDATE business_automation_runs SET state=$3,approved_by_user_id=CASE WHEN $3='SUCCEEDED' THEN $4::uuid ELSE NULL END," +
      "executed_by_user_id=CASE WHEN $3='SUCCEEDED' THEN $4::uuid ELSE NULL END," +
      "rejected_by_user_id=CASE WHEN $3='REJECTED' THEN $4::uuid ELSE NULL END," +
      "approved_at=CASE WHEN $3='SUCCEEDED' THEN now() ELSE NULL END," +
      "rejected_at=CASE WHEN $3='REJECTED' THEN now() ELSE NULL END," +
      "completed_at=now(),updated_at=now(),output_summary=$5::jsonb " +
      "WHERE id=$1 AND business_id=$2 RETURNING " +
      "id,policy_version,state,structured_input,output_summary,created_at,approved_at,rejected_at",
      [run.id, input.businessId, input.decision === "APPROVE" ? "SUCCEEDED" : "REJECTED",
        input.actorUserId, JSON.stringify({ taskCreated, decision: input.decision })],
    );
    await client.query(
      "INSERT INTO business_automation_audit_events (" +
      "business_id,policy_id,run_id,actor_user_id,actor_type,event_type,details" +
      ") VALUES($1,$2,$3,$4,'USER',$5,$6::jsonb)",
      [input.businessId, run.policy_id, run.id, input.actorUserId,
        input.decision === "APPROVE" ? "RUN_APPROVED" : "RUN_REJECTED", JSON.stringify({ taskCreated })],
    );
    return updated.rows[0]!;
  });
  return mapRun(row);
}
