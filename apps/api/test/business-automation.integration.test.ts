import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { businessAutomationConditionsMatch, evaluateBusinessAutomationSystem } from "../src/business-intelligence/automation-service.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

type Tenant = { token: string; userId: string; staffId: string; businessId: string; branchId: string };

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("safe business workflow automation", () => {
  it("allows OWNER/ADMIN and only operational MANAGER policies while blocking lower roles", async () => {
    const tenant = await createTenant("automation-roles@tradeos.test", "Automation Roles");
    const headers = authHeaders(tenant.token);

    const owner = await createPolicy(tenant, headers, {
      code: "owner-cash-review",
      actionType: "CREATE_CASH_REVIEW",
    });
    expect(owner.statusCode).toBe(201);
    expect(owner.json().policy.actionType).toBe("CREATE_CASH_REVIEW");

    await setRole(tenant, "ADMIN");
    const admin = await createPolicy(tenant, headers, {
      code: "admin-receivable-follow-up",
      actionType: "CREATE_RECEIVABLE_FOLLOW_UP",
    });
    expect(admin.statusCode).toBe(201);

    await setRole(tenant, "MANAGER");
    const managerOperational = await createPolicy(tenant, headers, {
      code: "manager-reorder-review",
      actionType: "CREATE_REORDER_REVIEW",
    });
    expect(managerOperational.statusCode).toBe(201);

    const managerPerformance = await createPolicy(tenant, headers, {
      code: "manager-performance-review",
      actionType: "CREATE_PERFORMANCE_REVIEW",
    });
    expect(managerPerformance.statusCode).toBe(201);

    const managerFinancial = await createPolicy(tenant, headers, {
      code: "manager-cash-review",
      actionType: "CREATE_CASH_REVIEW",
    });
    expect(managerFinancial.statusCode).toBe(403);
    expect(managerFinancial.json().error).toBe("BUSINESS_AUTOMATION_MANAGER_RESTRICTED");

    for (const role of ["CASHIER", "STAFF", "VIEWER"] as const) {
      await setRole(tenant, role);
      const denied = await createPolicy(tenant, headers, {
        code: `${role.toLowerCase()}-follow-up`,
        actionType: "CREATE_FOLLOW_UP",
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error).toBe("ROLE_FORBIDDEN");
    }
  });

  it("binds Assign to me to the authenticated policy editor instead of trusting client assignee ids", async () => {
    const tenant = await createTenant("automation-assignment@tradeos.test", "Automation Assignment");
    const forgedUserId = "00000000-0000-4000-8000-000000000001";
    const forgedStaffId = "00000000-0000-4000-8000-000000000002";

    const created = await createPolicy(tenant, authHeaders(tenant.token), {
      code: "bound-assignment",
      actionConfiguration: {
        dueInHours: 24,
        assignToActor: true,
        assignedUserId: forgedUserId,
        assignedStaffId: forgedStaffId,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().policy.actionConfiguration).toMatchObject({
      dueInHours: 24,
      assignToActor: true,
      assignedUserId: tenant.userId,
      assignedStaffId: tenant.staffId,
    });

    const editor = await createBusinessEditor(tenant, "automation-editor@tradeos.test");
    const edited = await app.inject({
      method: "PATCH",
      url: `/v1/intelligence/automations/${created.json().policy.id}`,
      headers: authHeaders(editor.token),
      payload: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        expectedPolicyVersion: 1,
        actionConfiguration: {
          dueInHours: 12,
          assignToActor: true,
          assignedUserId: forgedUserId,
          assignedStaffId: forgedStaffId,
        },
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().policy.actionConfiguration).toMatchObject({
      dueInHours: 12,
      assignToActor: true,
      assignedUserId: editor.userId,
      assignedStaffId: editor.staffId,
    });

    const unassigned = await app.inject({
      method: "PATCH",
      url: `/v1/intelligence/automations/${created.json().policy.id}`,
      headers: authHeaders(editor.token),
      payload: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        expectedPolicyVersion: 2,
        actionConfiguration: { dueInHours: 12, assignToActor: false, assignedUserId: forgedUserId, assignedStaffId: forgedStaffId },
      },
    });
    expect(unassigned.statusCode).toBe(200);
    expect(unassigned.json().policy.actionConfiguration).toEqual({ dueInHours: 12, assignToActor: false });
  });

  it.each(["POST_PAYMENT", "REFUND", "STOCK_WRITE_OFF", "CHANGE_ROLE", "CREATE_PURCHASE", "CREATE_SALE"])(
    "rejects forbidden direct action %s",
    async (actionType) => {
      const tenant = await createTenant(`forbidden-${actionType.toLowerCase()}@tradeos.test`, `Forbidden ${actionType}`);
      const response = await createPolicy(tenant, authHeaders(tenant.token), {
        code: `forbidden-${actionType.toLowerCase()}`,
        actionType,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("BUSINESS_AUTOMATION_ACTION_FORBIDDEN");
    },
  );

  it("matches only configured attention rule codes and severities", () => {
    expect(businessAutomationConditionsMatch(
      { ruleCodes: ["STOCKOUT_RISK"], severities: ["HIGH", "CRITICAL"] },
      { ruleCode: "STOCKOUT_RISK", severity: "HIGH" },
    )).toBe(true);
    expect(businessAutomationConditionsMatch(
      { ruleCodes: ["STOCKOUT_RISK"], severities: ["HIGH", "CRITICAL"] },
      { ruleCode: "SLOW_STOCK", severity: "HIGH" },
    )).toBe(false);
    expect(businessAutomationConditionsMatch(
      { ruleCodes: ["STOCKOUT_RISK"], severities: ["HIGH", "CRITICAL"] },
      { ruleCode: "STOCKOUT_RISK", severity: "MEDIUM" },
    )).toBe(false);
    expect(businessAutomationConditionsMatch({}, { ruleCode: "SLOW_STOCK", severity: "INFO" })).toBe(true);
    expect(businessAutomationConditionsMatch(
      { ruleCodes: "STOCKOUT_RISK" },
      { ruleCode: "SLOW_STOCK", severity: "INFO" },
    )).toBe(false);
    expect(businessAutomationConditionsMatch(
      { severities: ["HIGH", 42] },
      { ruleCode: "SLOW_STOCK", severity: "HIGH" },
    )).toBe(false);
  });

  it("recovers an existing evaluating system run exactly once after an interrupted execution", async () => {
    const tenant = await createTenant("automation-system-recovery@tradeos.test", "Automation System Recovery");
    const attention = await seedAttention(tenant, "SLOW_STOCK", "MEDIUM", [], "recovery");
    const policyId = await seedDirectPolicy(tenant, {
      code: "recover-evaluating",
      actionType: "CREATE_FOLLOW_UP",
      conditions: { ruleCodes: ["SLOW_STOCK"], severities: ["MEDIUM"] },
      actionConfiguration: { dueInHours: 24, assignToActor: true },
    });
    const runId = await seedEvaluatingRun(tenant, policyId, attention.id, `attention:${attention.id}`);
    await pool.query(
      "UPDATE business_attention_items SET state='RESOLVED',resolved_at=now(),updated_at=now() WHERE id=$1 AND business_id=$2",
      [attention.id, tenant.businessId],
    );

    const input = {
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      policyId,
      triggerSource: "ATTENTION" as const,
      triggerCorrelationId: `attention:${attention.id}`,
    };
    const recovered = await evaluateBusinessAutomationSystem(pool, input);
    const replay = await evaluateBusinessAutomationSystem(pool, input);

    expect(recovered.id).toBe(runId);
    expect(recovered.state).toBe("SUCCEEDED");
    expect(replay.id).toBe(runId);
    expect(replay.state).toBe("SUCCEEDED");
    const actions = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business_action_items WHERE source_automation_run_id=$1",
      [runId],
    );
    expect(actions.rows[0]!.count).toBe("1");
  });

  it("finishes an interrupted evaluating run without duplicating an action item that already exists", async () => {
    const tenant = await createTenant("automation-system-action-recovery@tradeos.test", "Automation System Action Recovery");
    const attention = await seedAttention(tenant, "SLOW_STOCK", "MEDIUM", [], "action-recovery");
    const policyId = await seedDirectPolicy(tenant, {
      code: "recover-existing-action",
      actionType: "CREATE_FOLLOW_UP",
      conditions: { ruleCodes: ["SLOW_STOCK"], severities: ["MEDIUM"] },
      actionConfiguration: { dueInHours: 24, assignToActor: true },
    });
    const correlationId = `attention:${attention.id}`;
    const runId = await seedEvaluatingRun(tenant, policyId, attention.id, correlationId);
    const existingActionId = await seedRunActionItem(tenant, runId, attention.id);

    const recovered = await evaluateBusinessAutomationSystem(pool, {
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      policyId,
      triggerSource: "ATTENTION",
      triggerCorrelationId: correlationId,
    });

    expect(recovered.id).toBe(runId);
    expect(recovered.state).toBe("SUCCEEDED");
    expect(recovered.outputSummary).toMatchObject({ actionItemId: existingActionId, actionType: "CREATE_FOLLOW_UP" });
    const actions = await pool.query<{ id: string }>(
      "SELECT id FROM business_action_items WHERE source_automation_run_id=$1 ORDER BY created_at,id",
      [runId],
    );
    expect(actions.rows).toEqual([{ id: existingActionId }]);
  });

  it("deduplicates true concurrent system delivery and keeps the bound assignment without economic writes", async () => {
    const tenant = await createTenant("automation-system-race@tradeos.test", "Automation System Race");
    const attention = await seedAttention(tenant, "STOCKOUT_RISK", "HIGH", [
      { source: "inventory", entityType: "CATALOG_ITEM", label: "available:Race Item:EA", value: "0" },
    ], "race");
    const created = await createPolicy(tenant, authHeaders(tenant.token), {
      code: "system-race-reorder",
      triggerType: "ATTENTION",
      conditions: { ruleCodes: ["STOCKOUT_RISK"], severities: ["HIGH", "CRITICAL"] },
      actionType: "CREATE_REORDER_REVIEW",
      actionConfiguration: { dueInHours: 24, assignToActor: true },
    });
    expect(created.statusCode).toBe(201);
    const before = await economicCounts(tenant.businessId);
    const input = {
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      policyId: created.json().policy.id as string,
      triggerSource: "ATTENTION" as const,
      triggerCorrelationId: `attention:${attention.id}`,
    };

    const [first, second] = await Promise.all([
      evaluateBusinessAutomationSystem(pool, input),
      evaluateBusinessAutomationSystem(pool, input),
    ]);
    expect(second.id).toBe(first.id);
    expect(first.state).toBe("SUCCEEDED");

    const runs = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business_automation_runs
       WHERE business_id=$1 AND policy_id=$2 AND trigger_correlation_id=$3`,
      [tenant.businessId, input.policyId, input.triggerCorrelationId],
    );
    expect(runs.rows[0]!.count).toBe("1");
    const actions = await pool.query<{ assigned_user_id: string | null; assigned_staff_id: string | null }>(
      `SELECT assigned_user_id,assigned_staff_id FROM business_action_items
       WHERE business_id=$1 AND source_attention_item_id=$2`,
      [tenant.businessId, attention.id],
    );
    expect(actions.rows).toEqual([{ assigned_user_id: tenant.userId, assigned_staff_id: tenant.staffId }]);
    expect(await economicCounts(tenant.businessId)).toEqual(before);
  });

  it("creates system tasks unassigned when the saved assignee is no longer active", async () => {
    const tenant = await createTenant("automation-stale-assignee@tradeos.test", "Automation Stale Assignee");
    const created = await createPolicy(tenant, authHeaders(tenant.token), {
      code: "stale-assignee-follow-up",
      triggerType: "ATTENTION",
      conditions: { ruleCodes: ["SLOW_STOCK"] },
      actionType: "CREATE_FOLLOW_UP",
      actionConfiguration: { dueInHours: 24, assignToActor: true },
    });
    expect(created.statusCode).toBe(201);
    await pool.query("UPDATE staff SET is_active=false WHERE id=$1 AND business_id=$2", [tenant.staffId, tenant.businessId]);
    const attention = await seedAttention(tenant, "SLOW_STOCK", "MEDIUM", [], "stale-bound");

    const run = await evaluateBusinessAutomationSystem(pool, {
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      policyId: created.json().policy.id,
      triggerSource: "ATTENTION",
      triggerCorrelationId: `attention:${attention.id}`,
    });
    expect(run.state).toBe("SUCCEEDED");
    const action = await pool.query<{ assigned_user_id: string | null; assigned_staff_id: string | null }>(
      "SELECT assigned_user_id,assigned_staff_id FROM business_action_items WHERE source_automation_run_id=$1",
      [run.id],
    );
    expect(action.rows).toEqual([{ assigned_user_id: null, assigned_staff_id: null }]);
  });

  it("uses the active policy creator only as the legacy assignToActor fallback", async () => {
    const tenant = await createTenant("automation-legacy-assignee@tradeos.test", "Automation Legacy Assignee");
    const policyId = await seedDirectPolicy(tenant, {
      code: "legacy-assignee",
      actionType: "CREATE_FOLLOW_UP",
      conditions: { ruleCodes: ["SLOW_STOCK"] },
      actionConfiguration: { dueInHours: 24, assignToActor: true },
    });
    const firstAttention = await seedAttention(tenant, "SLOW_STOCK", "MEDIUM", [], "legacy-active");
    const first = await evaluateBusinessAutomationSystem(pool, {
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      policyId,
      triggerSource: "ATTENTION",
      triggerCorrelationId: `attention:${firstAttention.id}`,
    });
    const firstAction = await pool.query<{ assigned_user_id: string | null; assigned_staff_id: string | null }>(
      "SELECT assigned_user_id,assigned_staff_id FROM business_action_items WHERE source_automation_run_id=$1",
      [first.id],
    );
    expect(firstAction.rows).toEqual([{ assigned_user_id: tenant.userId, assigned_staff_id: tenant.staffId }]);

    await pool.query(
      "UPDATE business_memberships SET status='SUSPENDED' WHERE business_id=$1 AND user_id=$2",
      [tenant.businessId, tenant.userId],
    );
    const secondAttention = await seedAttention(tenant, "SLOW_STOCK", "MEDIUM", [], "legacy-suspended");
    const second = await evaluateBusinessAutomationSystem(pool, {
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      policyId,
      triggerSource: "ATTENTION",
      triggerCorrelationId: `attention:${secondAttention.id}`,
    });
    const secondAction = await pool.query<{ assigned_user_id: string | null; assigned_staff_id: string | null }>(
      "SELECT assigned_user_id,assigned_staff_id FROM business_action_items WHERE source_automation_run_id=$1",
      [second.id],
    );
    expect(secondAction.rows).toEqual([{ assigned_user_id: null, assigned_staff_id: null }]);
  });

  it("keeps SNOOZE_ATTENTION human-only until dispatcher semantics are explicitly supported", async () => {
    const tenant = await createTenant("automation-system-snooze@tradeos.test", "Automation System Snooze");
    const attention = await seedAttention(tenant, "SLOW_STOCK", "MEDIUM", [], "system-snooze");
    const policyId = await seedDirectPolicy(tenant, {
      code: "system-snooze-attention",
      actionType: "SNOOZE_ATTENTION",
      conditions: { ruleCodes: ["SLOW_STOCK"] },
      actionConfiguration: {},
    });

    await expect(evaluateBusinessAutomationSystem(pool, {
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      policyId,
      triggerSource: "ATTENTION",
      triggerCorrelationId: `attention:${attention.id}`,
    })).rejects.toMatchObject({ code: "BUSINESS_AUTOMATION_SYSTEM_ACTION_FORBIDDEN" });
    const actions = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business_action_items WHERE business_id=$1",
      [tenant.businessId],
    );
    expect(actions.rows[0]!.count).toBe("0");
  });

  it("rejects a corrupt forbidden system policy before any economic mutation", async () => {
    const tenant = await createTenant("automation-system-forbidden@tradeos.test", "Automation System Forbidden");
    const attention = await seedAttention(tenant, "SLOW_STOCK", "MEDIUM", [], "forbidden-system");
    const policyId = await seedDirectPolicy(tenant, {
      code: "corrupt-post-payment",
      actionType: "POST_PAYMENT",
      conditions: { ruleCodes: ["SLOW_STOCK"] },
      actionConfiguration: {},
    });
    const before = await economicCounts(tenant.businessId);

    await expect(evaluateBusinessAutomationSystem(pool, {
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      policyId,
      triggerSource: "ATTENTION",
      triggerCorrelationId: `attention:${attention.id}`,
    })).rejects.toMatchObject({ code: "BUSINESS_AUTOMATION_ACTION_FORBIDDEN" });
    expect(await economicCounts(tenant.businessId)).toEqual(before);
  });

  it("persists a failed system run when safe action configuration cannot execute", async () => {
    const tenant = await createTenant("automation-system-failure@tradeos.test", "Automation System Failure");
    const attention = await seedAttention(tenant, "SLOW_STOCK", "MEDIUM", [], "invalid-due");
    const policyId = await seedDirectPolicy(tenant, {
      code: "invalid-due-follow-up",
      actionType: "CREATE_FOLLOW_UP",
      conditions: { ruleCodes: ["SLOW_STOCK"] },
      actionConfiguration: { dueInHours: 9001, assignToActor: true },
    });
    const before = await economicCounts(tenant.businessId);

    const run = await evaluateBusinessAutomationSystem(pool, {
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      policyId,
      triggerSource: "ATTENTION",
      triggerCorrelationId: `attention:${attention.id}`,
    });
    expect(run.state).toBe("FAILED");
    expect(run.completedAt).toEqual(expect.any(String));
    expect(run.errorMessage).toContain("dueInHours");
    const stored = await pool.query<{ state: string; error_message: string | null; completed_at: Date | null }>(
      "SELECT state,error_message,completed_at FROM business_automation_runs WHERE id=$1",
      [run.id],
    );
    expect(stored.rows[0]).toMatchObject({ state: "FAILED", error_message: expect.stringContaining("dueInHours") });
    expect(stored.rows[0]!.completed_at).toBeTruthy();
    const actionCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business_action_items WHERE source_automation_run_id=$1",
      [run.id],
    );
    expect(actionCount.rows[0]!.count).toBe("0");
    expect(await economicCounts(tenant.businessId)).toEqual(before);
  });

  it("creates one evidence-backed assigned action item for duplicate trigger replays without economic writes", async () => {
    const tenant = await createTenant("automation-idempotent@tradeos.test", "Automation Idempotent");
    const headers = authHeaders(tenant.token);
    const attention = await seedAttention(tenant, "STOCKOUT_RISK", "HIGH", [
      { source: "inventory", entityType: "CATALOG_ITEM", label: "available:Demo Item:EA", value: "0" },
    ]);
    const before = await economicCounts(tenant.businessId);

    const policyResponse = await createPolicy(tenant, headers, {
      code: "stockout-reorder-review",
      triggerType: "ATTENTION",
      conditions: { ruleCodes: ["STOCKOUT_RISK"], severities: ["HIGH", "CRITICAL"] },
      actionType: "CREATE_REORDER_REVIEW",
      actionConfiguration: { dueInHours: 24, assignToActor: true },
    });
    expect(policyResponse.statusCode).toBe(201);
    const policyId = policyResponse.json().policy.id as string;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const evaluate = await app.inject({
        method: "POST",
        url: "/v1/intelligence/automations/evaluate",
        headers,
        payload: {
          businessId: tenant.businessId,
          branchId: tenant.branchId,
          policyId,
          triggerSource: "ATTENTION",
          triggerCorrelationId: `attention:${attention.id}:v1`,
        },
      });
      expect(evaluate.statusCode).toBe(200);
    }

    const runCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business_automation_runs
       WHERE business_id=$1 AND policy_id=$2 AND trigger_correlation_id=$3`,
      [tenant.businessId, policyId, `attention:${attention.id}:v1`],
    );
    expect(runCount.rows[0]?.count).toBe("1");

    const actionCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business_action_items
       WHERE business_id=$1 AND source_attention_item_id=$2 AND action_type='CREATE_REORDER_REVIEW'`,
      [tenant.businessId, attention.id],
    );
    expect(actionCount.rows[0]?.count).toBe("1");

    const listed = await app.inject({
      method: "GET",
      url: `/v1/intelligence/action-items?businessId=${tenant.businessId}&branchId=${tenant.branchId}`,
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        sourceAttentionItemId: attention.id,
        actionType: "CREATE_REORDER_REVIEW",
        assignedUserId: tenant.userId,
        status: "OPEN",
        dueAt: expect.any(String),
        evidence: expect.arrayContaining([
          expect.objectContaining({ source: "inventory", entityType: "CATALOG_ITEM" }),
        ]),
      }),
    ]));

    const after = await economicCounts(tenant.businessId);
    expect(after).toEqual(before);
  });

  it("increments policy version on change and keeps replay idempotency scoped to that version", async () => {
    const tenant = await createTenant("automation-version@tradeos.test", "Automation Version");
    const headers = authHeaders(tenant.token);
    const attention = await seedAttention(tenant, "SLOW_STOCK", "MEDIUM", [
      { source: "inventory", entityType: "CATALOG_ITEM", label: "slowStock:Demo", value: true },
    ]);

    const created = await createPolicy(tenant, headers, {
      code: "slow-stock-follow-up",
      triggerType: "ATTENTION",
      conditions: { ruleCodes: ["SLOW_STOCK"] },
      actionType: "CREATE_FOLLOW_UP",
      actionConfiguration: { dueInHours: 48, assignToActor: true },
    });
    expect(created.statusCode).toBe(201);
    const policy = created.json().policy;
    expect(policy.policyVersion).toBe(1);

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/intelligence/automations/${policy.id}`,
      headers,
      payload: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        expectedPolicyVersion: 1,
        name: "Slow stock follow-up — faster",
        actionConfiguration: { dueInHours: 24, assignToActor: true },
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().policy.policyVersion).toBe(2);

    const correlation = `attention:${attention.id}:stable`;
    const evaluated = await app.inject({
      method: "POST",
      url: "/v1/intelligence/automations/evaluate",
      headers,
      payload: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        policyId: policy.id,
        triggerSource: "ATTENTION",
        triggerCorrelationId: correlation,
      },
    });
    expect(evaluated.statusCode).toBe(200);

    const run = await pool.query<{ policy_version: number }>(
      `SELECT policy_version FROM business_automation_runs
       WHERE business_id=$1 AND policy_id=$2 AND trigger_correlation_id=$3`,
      [tenant.businessId, policy.id, correlation],
    );
    expect(run.rows).toHaveLength(1);
    expect(run.rows[0]?.policy_version).toBe(2);
  });

  it("completes and snoozes internal action items without touching economic ledgers", async () => {
    const tenant = await createTenant("automation-actions@tradeos.test", "Automation Actions");
    const headers = authHeaders(tenant.token);
    const before = await economicCounts(tenant.businessId);
    const actionId = await seedActionItem(tenant);

    const snooze = await app.inject({
      method: "POST",
      url: `/v1/intelligence/action-items/${actionId}/snooze`,
      headers,
      payload: { businessId: tenant.businessId, snoozedUntil: new Date(Date.now() + 3_600_000).toISOString() },
    });
    expect(snooze.statusCode).toBe(200);
    expect(snooze.json().item.status).toBe("SNOOZED");

    const complete = await app.inject({
      method: "POST",
      url: `/v1/intelligence/action-items/${actionId}/complete`,
      headers,
      payload: { businessId: tenant.businessId },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().item.status).toBe("DONE");
    expect(complete.json().item.completedAt).toEqual(expect.any(String));

    expect(await economicCounts(tenant.businessId)).toEqual(before);
  });
});

async function createPolicy(
  tenant: Tenant,
  headers: Record<string, string>,
  overrides: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: "/v1/intelligence/automations",
    headers,
    payload: {
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      code: "safe-follow-up",
      name: "Safe follow-up",
      description: "Creates an internal review task only.",
      enabled: true,
      triggerType: "MANUAL",
      conditions: {},
      actionType: "CREATE_FOLLOW_UP",
      actionConfiguration: { dueInHours: 24, assignToActor: true },
      ...overrides,
    },
  });
}

async function seedAttention(
  tenant: Tenant,
  ruleCode: string,
  severity: string,
  evidence: unknown[],
  sourceSuffix = "test",
): Promise<{ id: string }> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_attention_items(
       business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
     ) VALUES($1,$2,$3,$4,$5,'OPEN',$6,$7,$8::jsonb)
     RETURNING id`,
    [
      tenant.businessId,
      tenant.branchId,
      `${ruleCode.toLowerCase()}:${sourceSuffix}`,
      ruleCode,
      severity,
      `${ruleCode} test signal`,
      "Test evidence-backed signal",
      JSON.stringify(evidence),
    ],
  );
  return { id: result.rows[0]!.id };
}

async function seedDirectPolicy(
  tenant: Tenant,
  input: {
    code: string;
    actionType: string;
    conditions?: Record<string, unknown>;
    actionConfiguration?: Record<string, unknown>;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_automation_policies(
       business_id,branch_id,code,name,description,enabled,trigger_type,conditions,action_type,
       action_configuration,policy_version,created_by_user_id,updated_by_user_id
     ) VALUES($1,$2,$3,$3,'Direct integration policy',true,'ATTENTION',$4::jsonb,$5,$6::jsonb,1,$7,$7)
     RETURNING id`,
    [
      tenant.businessId,
      tenant.branchId,
      input.code,
      JSON.stringify(input.conditions ?? {}),
      input.actionType,
      JSON.stringify(input.actionConfiguration ?? {}),
      tenant.userId,
    ],
  );
  return result.rows[0]!.id;
}

async function seedEvaluatingRun(
  tenant: Tenant,
  policyId: string,
  attentionId: string,
  correlationId: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_automation_runs(
       business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,
       structured_input,output_summary,evidence,started_at
     ) VALUES($1,$2,$3,1,'ATTENTION',$4,'EVALUATING',$5::jsonb,'{}'::jsonb,'[]'::jsonb,now())
     RETURNING id`,
    [tenant.businessId, tenant.branchId, policyId, correlationId, JSON.stringify({ sourceAttentionItemId: attentionId, executionOrigin: "SYSTEM_DISPATCHER" })],
  );
  return result.rows[0]!.id;
}

async function seedRunActionItem(tenant: Tenant, runId: string, attentionId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_action_items(
       business_id,branch_id,source_attention_item_id,source_automation_run_id,action_type,title,reason,evidence,status
     ) VALUES($1,$2,$3,$4,'CREATE_FOLLOW_UP','Recovered follow-up','Existing action from interrupted execution','[]'::jsonb,'OPEN')
     RETURNING id`,
    [tenant.businessId, tenant.branchId, attentionId, runId],
  );
  return result.rows[0]!.id;
}

async function seedActionItem(tenant: Tenant): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_action_items(
       business_id,branch_id,action_type,title,reason,evidence,assigned_user_id,status
     ) VALUES($1,$2,'CREATE_FOLLOW_UP','Review item','Internal review only','[]'::jsonb,$3,'OPEN')
     RETURNING id`,
    [tenant.businessId, tenant.branchId, tenant.userId],
  );
  return result.rows[0]!.id;
}

async function economicCounts(businessId: string) {
  const result = await pool.query<{
    sales: string;
    payments: string;
    refunds: string;
    inventory: string;
    cashbook: string;
  }>(
    `SELECT
       (SELECT count(*) FROM sales WHERE business_id=$1)::text AS sales,
       (SELECT count(*) FROM payments WHERE business_id=$1)::text AS payments,
       (SELECT count(*) FROM refund_transactions WHERE business_id=$1)::text AS refunds,
       (SELECT count(*) FROM inventory_movements WHERE business_id=$1)::text AS inventory,
       (SELECT count(*) FROM cashbook_entries WHERE business_id=$1)::text AS cashbook`,
    [businessId],
  );
  return result.rows[0];
}

async function setRole(tenant: Tenant, role: string) {
  await pool.query(
    `UPDATE business_memberships SET role=$3
     WHERE business_id=$1 AND user_id=$2 AND status='ACTIVE'`,
    [tenant.businessId, tenant.userId, role],
  );
}

async function createTenant(email: string, name: string): Promise<Tenant> {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: name,
      email,
      password: "TradeOS-Test-1234",
      platform: "WEB",
      deviceKey: `device-${email}`,
      appVersion: "test",
    },
  });
  expect(registration.statusCode).toBe(201);
  const body = registration.json();
  const token = body.session.accessToken as string;
  const userId = body.user.id as string;

  const onboard = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers: authHeaders(token),
    payload: { name, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(onboard.statusCode).toBe(201);
  const businessId = onboard.json().business.id as string;
  const membership = await pool.query<{ staff_id: string }>(
    `SELECT staff_id FROM business_memberships WHERE business_id=$1 AND user_id=$2 AND status='ACTIVE'`,
    [businessId, userId],
  );
  return {
    token,
    userId,
    staffId: membership.rows[0]!.staff_id,
    businessId,
    branchId: onboard.json().branch.id,
  };
}

async function createBusinessEditor(tenant: Tenant, email: string): Promise<Pick<Tenant, "token" | "userId" | "staffId">> {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: "Automation Editor",
      email,
      password: "TradeOS-Test-1234",
      platform: "WEB",
      deviceKey: `device-${email}`,
      appVersion: "test",
    },
  });
  expect(registration.statusCode).toBe(201);
  const body = registration.json();
  const userId = body.user.id as string;
  const token = body.session.accessToken as string;
  const staff = await pool.query<{ id: string }>(
    `INSERT INTO staff(business_id,display_name,email,role,is_active)
     VALUES($1,'Automation Editor',$2,'ADMIN',true) RETURNING id`,
    [tenant.businessId, email],
  );
  await pool.query(
    `INSERT INTO business_memberships(business_id,user_id,staff_id,role,status,created_by_user_id)
     VALUES($1,$2,$3,'ADMIN','ACTIVE',$4)`,
    [tenant.businessId, userId, staff.rows[0]!.id, tenant.userId],
  );
  return { token, userId, staffId: staff.rows[0]!.id };
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}
