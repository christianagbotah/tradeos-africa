import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createPool } from "../src/db.js";
import {
  TENANT_AUTOMATION_DISPATCHER_LOCK_KEY,
  runTenantAutomationDispatcherTick,
  startTenantAutomationDispatcher,
} from "../src/business-intelligence/automation-dispatcher.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const apiRoot = path.resolve(__dirname, "../src");
const FIXED_NOW = new Date("2026-10-22T18:15:00.000Z");

type TenantSeed = {
  businessId: string;
  userId: string;
  staffId: string;
  branches: Array<{ id: string; active: boolean }>;
};

beforeAll(async () => { await pool.query("SELECT 1"); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await pool.end(); });

describe("tenant proactive automation dispatcher", () => {
  it("uses a dedicated PostgreSQL advisory lock so a competing evaluator skips", async () => {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1::bigint)", [TENANT_AUTOMATION_DISPATCHER_LOCK_KEY]);
      const result = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
      expect(result).toEqual({
        acquired: false,
        correlationId: null,
        scopesEvaluated: 0,
        policiesEvaluated: 0,
        matches: 0,
        feedbackCooldownSkips: 0,
        succeeded: 0,
        failed: 0,
      });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [TENANT_AUTOMATION_DISPATCHER_LOCK_KEY]);
      client.release();
    }
  });

  it("keeps overlapping scheduler instances idempotent and supports a disabled kill switch", async () => {
    const tenant = await seedTenant("Scheduler Tenant", [true]);
    const policyId = await seedPolicy(tenant, {
      code: "scheduled-low-data",
      branchId: tenant.branches[0]!.id,
    });

    const disabled = startTenantAutomationDispatcher(pool, { enabled: false, intervalMs: 40, now: () => FIXED_NOW });
    await disabled.stop();
    expect(await runCount(policyId)).toBe(0);

    const first = startTenantAutomationDispatcher(pool, { intervalMs: 40, now: () => FIXED_NOW });
    const second = startTenantAutomationDispatcher(pool, { intervalMs: 40, now: () => FIXED_NOW });
    await Promise.all([first.stop(), second.stop()]);

    expect(await runCount(policyId)).toBe(1);
    const actions = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business_action_items WHERE business_id=$1 AND action_type='CREATE_FOLLOW_UP'",
      [tenant.businessId],
    );
    expect(Number(actions.rows[0]!.count)).toBe(1);
  });

  it("dispatches a safe performance review as an internal-only action item", async () => {
    const tenant = await seedTenant("Performance Review Tenant", [true]);
    const branchId = tenant.branches[0]!.id;
    await seedPolicy(tenant, {
      code: "performance-review",
      branchId,
      actionType: "CREATE_PERFORMANCE_REVIEW",
    });
    const beforeSafety = await economicAndAccessCounts(tenant.businessId);

    const result = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(result).toMatchObject({ acquired: true, matches: 1, succeeded: 1, failed: 0 });
    const actions = await pool.query<{ action_type: string; title: string }>(
      "SELECT action_type,title FROM business_action_items WHERE business_id=$1 AND branch_id=$2",
      [tenant.businessId, branchId],
    );
    expect(actions.rows).toEqual([expect.objectContaining({
      action_type: "CREATE_PERFORMANCE_REVIEW",
      title: expect.stringMatching(/^Review business performance/),
    })]);
    expect(await economicAndAccessCounts(tenant.businessId)).toEqual(beforeSafety);
  });

  it("dispatches a safe inventory review as an internal-only action item", async () => {
    const tenant = await seedTenant("Inventory Review Tenant", [true]);
    const branchId = tenant.branches[0]!.id;
    await seedPolicy(tenant, {
      code: "inventory-review",
      branchId,
      actionType: "CREATE_INVENTORY_REVIEW",
    });
    const beforeSafety = await economicAndAccessCounts(tenant.businessId);

    const result = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(result).toMatchObject({ acquired: true, matches: 1, succeeded: 1, failed: 0 });
    const actions = await pool.query<{ action_type: string; title: string }>(
      "SELECT action_type,title FROM business_action_items WHERE business_id=$1 AND branch_id=$2",
      [tenant.businessId, branchId],
    );
    expect(actions.rows).toEqual([expect.objectContaining({
      action_type: "CREATE_INVENTORY_REVIEW",
      title: expect.stringMatching(/^Review inventory health/),
    })]);
    expect(await economicAndAccessCounts(tenant.businessId)).toEqual(beforeSafety);
  });

  it("dispatches a safe supplier payables review from the overdue-payables signal only", async () => {
    const tenant = await seedTenant("Supplier Payables Review Tenant", [true]);
    const branchId = tenant.branches[0]!.id;
    await seedOverduePayable(tenant, branchId);
    await seedPolicy(tenant, {
      code: "supplier-payables-review",
      branchId,
      conditions: { ruleCodes: ["PAYABLES_OVERDUE"], severities: ["HIGH", "CRITICAL"] },
      actionType: "CREATE_PAYABLES_REVIEW",
    });
    const beforeSafety = await economicAndAccessCounts(tenant.businessId);

    const result = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(result).toMatchObject({ acquired: true, matches: 1, succeeded: 1, failed: 0 });
    const replay = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(replay).toMatchObject({ acquired: true, matches: 1, succeeded: 1, failed: 0 });
    const actions = await pool.query<{ action_type: string; title: string }>(
      "SELECT action_type,title FROM business_action_items WHERE business_id=$1 AND branch_id=$2",
      [tenant.businessId, branchId],
    );
    expect(actions.rows).toEqual([expect.objectContaining({
      action_type: "CREATE_PAYABLES_REVIEW",
      title: expect.stringMatching(/^Review supplier payables/),
    })]);
    expect(await economicAndAccessCounts(tenant.businessId)).toEqual(beforeSafety);
  });

  it("fails closed when a system payables-review policy is paired with a non-payables signal", async () => {
    const tenant = await seedTenant("Mismatched Payables Review Tenant", [true]);
    const branchId = tenant.branches[0]!.id;
    await seedPolicy(tenant, {
      code: "mismatched-payables-review",
      branchId,
      conditions: { ruleCodes: ["LOW_DATA_CONFIDENCE"], severities: ["INFO"] },
      actionType: "CREATE_PAYABLES_REVIEW",
    });
    const beforeSafety = await economicAndAccessCounts(tenant.businessId);

    const result = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(result).toMatchObject({ acquired: true, matches: 1, succeeded: 0, failed: 1 });
    const actions = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business_action_items WHERE business_id=$1 AND branch_id=$2",
      [tenant.businessId, branchId],
    );
    expect(actions.rows[0]!.count).toBe("0");
    expect(await economicAndAccessCounts(tenant.businessId)).toEqual(beforeSafety);
  });

  it("dispatches a safe data-readiness review from low-data confidence only", async () => {
    const tenant = await seedTenant("Data Readiness Review Tenant", [true]);
    const branchId = tenant.branches[0]!.id;
    await seedPolicy(tenant, {
      code: "data-readiness-review",
      branchId,
      conditions: { ruleCodes: ["LOW_DATA_CONFIDENCE"], severities: [] },
      actionType: "CREATE_DATA_READINESS_REVIEW",
    });
    const beforeSafety = await economicAndAccessCounts(tenant.businessId);

    const result = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(result).toMatchObject({ acquired: true, matches: 1, succeeded: 1, failed: 0 });
    const replay = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(replay).toMatchObject({ acquired: true, matches: 1, succeeded: 1, failed: 0 });
    const actions = await pool.query<{ action_type: string; title: string }>(
      "SELECT action_type,title FROM business_action_items WHERE business_id=$1 AND branch_id=$2",
      [tenant.businessId, branchId],
    );
    expect(actions.rows).toEqual([expect.objectContaining({
      action_type: "CREATE_DATA_READINESS_REVIEW",
      title: expect.stringMatching(/^Review TradeOS data readiness/),
    })]);
    expect(await economicAndAccessCounts(tenant.businessId)).toEqual(beforeSafety);
  });

  it("skips repeated low-priority automatic reviews after negative feedback while keeping the attention visible", async () => {
    const tenant = await seedTenant("Feedback Cooldown Tenant", [true]);
    const branchId = tenant.branches[0]!.id;
    const policyId = await seedPolicy(tenant, { code: "feedback-low-data", branchId });
    const sourceKey = `low-data:${branchId}`;
    await seedNegativeAutomationFeedback(tenant, policyId, branchId, {
      ruleCode: "LOW_DATA_CONFIDENCE", sourceKey, completedAt: new Date(FIXED_NOW.getTime() - 5 * 86_400_000),
    });
    await seedNegativeAutomationFeedback(tenant, policyId, branchId, {
      ruleCode: "LOW_DATA_CONFIDENCE", sourceKey, outcome: "NO_ACTION_NEEDED", completedAt: new Date(FIXED_NOW.getTime() - 2 * 86_400_000),
    });
    const beforeRuns = await runCount(policyId);
    const beforeSafety = await economicAndAccessCounts(tenant.businessId);

    const result = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });

    expect(result).toMatchObject({
      acquired: true, matches: 1, feedbackCooldownSkips: 1, succeeded: 0, failed: 0,
    });
    expect(await runCount(policyId)).toBe(beforeRuns);
    const activeTasks = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business_action_items
       WHERE business_id=$1 AND branch_id=$2 AND status IN ('OPEN','SNOOZED')`,
      [tenant.businessId, branchId],
    );
    expect(activeTasks.rows[0]!.count).toBe("0");
    const currentAttention = await pool.query<{ state: string }>(
      `SELECT state FROM business_attention_items
       WHERE business_id=$1 AND branch_id=$2 AND rule_code='LOW_DATA_CONFIDENCE' AND source_key=$3
       ORDER BY created_at DESC LIMIT 1`,
      [tenant.businessId, branchId, sourceKey],
    );
    expect(currentAttention.rows[0]?.state).toBe("OPEN");
    expect(await economicAndAccessCounts(tenant.businessId)).toEqual(beforeSafety);
  });

  it("never cools a HIGH automatic review even when the same signal received repeated negative feedback", async () => {
    const tenant = await seedTenant("High Feedback Tenant", [true]);
    const branchId = tenant.branches[0]!.id;
    await seedOverduePayable(tenant, branchId);
    const policyId = await seedPolicy(tenant, {
      code: "high-payables-feedback",
      branchId,
      conditions: { ruleCodes: ["PAYABLES_OVERDUE"], severities: ["HIGH", "CRITICAL"] },
      actionType: "CREATE_PAYABLES_REVIEW",
    });
    const sourceKey = `payables:overdue:${branchId}`;
    await seedNegativeAutomationFeedback(tenant, policyId, branchId, {
      ruleCode: "PAYABLES_OVERDUE", sourceKey, severity: "HIGH", completedAt: new Date(FIXED_NOW.getTime() - 5 * 86_400_000),
    });
    await seedNegativeAutomationFeedback(tenant, policyId, branchId, {
      ruleCode: "PAYABLES_OVERDUE", sourceKey, severity: "HIGH", completedAt: new Date(FIXED_NOW.getTime() - 2 * 86_400_000),
    });
    const beforeRuns = await runCount(policyId);

    const result = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });

    expect(result).toMatchObject({ acquired: true, matches: 1, feedbackCooldownSkips: 0, succeeded: 1, failed: 0 });
    expect(await runCount(policyId)).toBe(beforeRuns + 1);
  });

  it("dispatches a branch-scoped attention policy only for its active branch", async () => {
    const tenant = await seedTenant("Branch Scoped Tenant", [true, true]);
    const targetBranchId = tenant.branches[0]!.id;
    const otherBranchId = tenant.branches[1]!.id;
    const policyId = await seedPolicy(tenant, { code: "branch-low-data", branchId: targetBranchId });
    const beforeSafety = await economicAndAccessCounts(tenant.businessId);

    const result = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(result).toMatchObject({ acquired: true, scopesEvaluated: 1, policiesEvaluated: 1, matches: 1, succeeded: 1, failed: 0 });

    const runs = await pool.query<{ branch_id: string; trigger_correlation_id: string; state: string }>(
      "SELECT branch_id,trigger_correlation_id,state FROM business_automation_runs WHERE policy_id=$1",
      [policyId],
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0]).toMatchObject({ branch_id: targetBranchId, state: "SUCCEEDED" });
    expect(runs.rows[0]!.trigger_correlation_id).toMatch(/^attention:[0-9a-f-]{36}$/i);
    const other = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business_action_items WHERE business_id=$1 AND branch_id=$2",
      [tenant.businessId, otherBranchId],
    );
    expect(other.rows[0]!.count).toBe("0");
    expect(await economicAndAccessCounts(tenant.businessId)).toEqual(beforeSafety);
  });

  it("expands business-wide policies across active branches once each without crossing tenants", async () => {
    const tenant = await seedTenant("Wide Tenant", [true, true, false]);
    const foreign = await seedTenant("Foreign Tenant", [true]);
    const policyId = await seedPolicy(tenant, { code: "wide-low-data", branchId: null });

    const result = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(result).toMatchObject({ acquired: true, scopesEvaluated: 2, policiesEvaluated: 2, matches: 2, succeeded: 2, failed: 0 });

    const runs = await pool.query<{ branch_id: string; state: string }>(
      "SELECT branch_id,state FROM business_automation_runs WHERE policy_id=$1 ORDER BY branch_id",
      [policyId],
    );
    const activeBranchIds = tenant.branches.filter((branch) => branch.active).map((branch) => branch.id).sort();
    expect(runs.rows).toEqual(activeBranchIds.map((branchId) => ({ branch_id: branchId, state: "SUCCEEDED" })));
    const inactive = tenant.branches.find((branch) => !branch.active)!;
    const inactiveCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business_action_items WHERE business_id=$1 AND branch_id=$2",
      [tenant.businessId, inactive.id],
    );
    expect(inactiveCount.rows[0]!.count).toBe("0");
    const foreignCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business_automation_runs WHERE business_id=$1",
      [foreign.businessId],
    );
    expect(foreignCount.rows[0]!.count).toBe("0");

    const replay = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(replay.succeeded).toBe(2);
    expect(await runCount(policyId)).toBe(2);
  });

  it("does not dispatch disabled, non-attention, rule-mismatched, or severity-mismatched policies", async () => {
    const tenant = await seedTenant("Filtered Tenant", [true]);
    const branchId = tenant.branches[0]!.id;
    await seedPolicy(tenant, { code: "disabled", branchId, enabled: false });
    await seedPolicy(tenant, { code: "manual", branchId, triggerType: "MANUAL" });
    await seedPolicy(tenant, {
      code: "wrong-rule",
      branchId,
      conditions: { ruleCodes: ["STOCKOUT_RISK"], severities: [] },
    });
    await seedPolicy(tenant, {
      code: "wrong-severity",
      branchId,
      conditions: { ruleCodes: ["LOW_DATA_CONFIDENCE"], severities: ["HIGH"] },
    });

    const result = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(result).toMatchObject({ acquired: true, scopesEvaluated: 1, policiesEvaluated: 2, matches: 0, succeeded: 0, failed: 0 });
    const count = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM business_automation_runs");
    expect(count.rows[0]!.count).toBe("0");
  });

  it("records one failed policy but continues to a succeeding tenant and later ticks", async () => {
    const failing = await seedTenant("Failing Tenant", [true]);
    const succeeding = await seedTenant("Succeeding Tenant", [true]);
    const failedPolicyId = await seedPolicy(failing, {
      code: "invalid-due",
      branchId: failing.branches[0]!.id,
      actionConfiguration: { dueInHours: 9001, assignToActor: false },
    });
    const successfulPolicyId = await seedPolicy(succeeding, {
      code: "valid-follow-up",
      branchId: succeeding.branches[0]!.id,
    });

    const first = await runTenantAutomationDispatcherTick(pool, { now: () => FIXED_NOW });
    expect(first).toMatchObject({ acquired: true, matches: 2, succeeded: 1, failed: 1 });
    expect(await policyRunState(failedPolicyId)).toBe("FAILED");
    expect(await policyRunState(successfulPolicyId)).toBe("SUCCEEDED");

    const second = await runTenantAutomationDispatcherTick(pool, { now: () => new Date("2026-10-22T18:30:00.000Z") });
    expect(second.acquired).toBe(true);
    expect(await runCount(failedPolicyId)).toBe(1);
    expect(await runCount(successfulPolicyId)).toBe(1);
  });

  it("wires the tenant dispatcher only into the real server lifecycle with environment controls", () => {
    const serverSource = fs.readFileSync(path.join(apiRoot, "server.ts"), "utf8");
    const appSource = fs.readFileSync(path.join(apiRoot, "app.ts"), "utf8");
    expect(serverSource).toContain("startTenantAutomationDispatcher");
    expect(serverSource).toContain("TENANT_AUTOMATION_SCHEDULER_ENABLED");
    expect(serverSource).toContain("TENANT_AUTOMATION_SCHEDULER_INTERVAL_MS");
    expect(serverSource.match(/await tenantAutomationDispatcher\.stop\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(appSource).not.toContain("startTenantAutomationDispatcher");
  });

  it("keeps the dispatcher deterministic and model-free", () => {
    const source = fs.readFileSync(path.join(apiRoot, "business-intelligence/automation-dispatcher.ts"), "utf8");
    expect(source).toContain("pg_try_advisory_lock");
    expect(source).not.toContain("AiTextProvider");
    expect(source).not.toContain("OpenAi");
    expect(source).not.toContain("intelligence-service");
  });
});

async function seedTenant(name: string, branchActivity: boolean[]): Promise<TenantSeed> {
  const business = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES($1,'RETAIL','GH','GHS','Africa/Accra','ACTIVE') RETURNING id`,
    [name],
  );
  const businessId = business.rows[0]!.id;
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@dispatcher.test`;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO app_users(display_name,email,password_hash,status)
     VALUES($1,$2,'test-hash','ACTIVE') RETURNING id`,
    [`${name} Owner`, email],
  );
  const userId = user.rows[0]!.id;
  const staff = await pool.query<{ id: string }>(
    `INSERT INTO staff(business_id,display_name,email,role,is_active)
     VALUES($1,$2,$3,'OWNER',true) RETURNING id`,
    [businessId, `${name} Owner`, email],
  );
  const staffId = staff.rows[0]!.id;
  await pool.query(
    `INSERT INTO business_memberships(business_id,user_id,staff_id,role,status,created_by_user_id)
     VALUES($1,$2,$3,'OWNER','ACTIVE',$2)`,
    [businessId, userId, staffId],
  );
  const branches: Array<{ id: string; active: boolean }> = [];
  for (const [index, active] of branchActivity.entries()) {
    const branch = await pool.query<{ id: string }>(
      `INSERT INTO branches(business_id,name,code,timezone,is_active)
       VALUES($1,$2,$3,'Africa/Accra',$4) RETURNING id`,
      [businessId, `${name} Branch ${index + 1}`, `B${index + 1}`, active],
    );
    branches.push({ id: branch.rows[0]!.id, active });
  }
  return { businessId, userId, staffId, branches };
}

async function seedOverduePayable(tenant: TenantSeed, branchId: string): Promise<void> {
  const supplier = await pool.query<{ id: string }>(
    `INSERT INTO suppliers(business_id,name,payment_terms_days,is_active)
     VALUES($1,'Overdue Supplier',14,true) RETURNING id`,
    [tenant.businessId],
  );
  const issuedAt = new Date(FIXED_NOW.getTime() - 10 * 86_400_000);
  const dueAt = new Date(FIXED_NOW.getTime() - 2 * 86_400_000);
  const purchase = await pool.query<{ id: string }>(
    `INSERT INTO purchases(
       business_id,branch_id,supplier_id,received_by_staff_id,status,currency_code,
       settlement_method,total_minor,client_mutation_id,received_at
     ) VALUES($1,$2,$3,$4,'RECEIVED','GHS','SUPPLIER_CREDIT',5000,$5,$6)
     RETURNING id`,
    [tenant.businessId, branchId, supplier.rows[0]!.id, tenant.staffId, `payables-dispatch-${tenant.businessId}`, issuedAt],
  );
  await pool.query(
    `INSERT INTO supplier_credit_obligations(
       business_id,branch_id,supplier_id,purchase_id,currency_code,original_minor,open_minor,issued_at,due_at
     ) VALUES($1,$2,$3,$4,'GHS',5000,5000,$5,$6)`,
    [tenant.businessId, branchId, supplier.rows[0]!.id, purchase.rows[0]!.id, issuedAt, dueAt],
  );
}

async function seedPolicy(
  tenant: TenantSeed,
  input: {
    code: string;
    branchId: string | null;
    enabled?: boolean;
    triggerType?: string;
    conditions?: Record<string, unknown>;
    actionConfiguration?: Record<string, unknown>;
    actionType?: string;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_automation_policies(
       business_id,branch_id,code,name,description,enabled,trigger_type,conditions,action_type,
       action_configuration,policy_version,created_by_user_id,updated_by_user_id
     ) VALUES($1,$2,$3,$3,'Dispatcher integration policy',$4,$5,$6::jsonb,$7,$8::jsonb,1,$9,$9)
     RETURNING id`,
    [
      tenant.businessId,
      input.branchId,
      input.code,
      input.enabled ?? true,
      input.triggerType ?? "ATTENTION",
      JSON.stringify(input.conditions ?? { ruleCodes: ["LOW_DATA_CONFIDENCE"], severities: ["INFO"] }),
      input.actionType ?? "CREATE_FOLLOW_UP",
      JSON.stringify(input.actionConfiguration ?? { dueInHours: 24, assignToActor: false }),
      tenant.userId,
    ],
  );
  return result.rows[0]!.id;
}

async function seedNegativeAutomationFeedback(
  tenant: TenantSeed,
  policyId: string,
  branchId: string,
  input: {
    ruleCode: string;
    sourceKey: string;
    completedAt: Date;
    severity?: string;
    outcome?: "NOT_RELEVANT" | "NO_ACTION_NEEDED";
  },
): Promise<void> {
  const attention = await pool.query<{ id: string }>(
    `INSERT INTO business_attention_items(
       business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence,
       first_seen_at,last_seen_at,resolved_at
     ) VALUES($1,$2,$3,$4,$5,'RESOLVED','Historical feedback','Historical feedback','[]',$6,$6,$6)
     RETURNING id`,
    [tenant.businessId, branchId, input.sourceKey, input.ruleCode, input.severity ?? "INFO", input.completedAt],
  );
  const run = await pool.query<{ id: string }>(
    `INSERT INTO business_automation_runs(
       business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,
       structured_input,output_summary,evidence,started_at,completed_at
     ) VALUES($1,$2,$3,1,'ATTENTION',$4,'SUCCEEDED','{}','{}','[]',$5,$5) RETURNING id`,
    [tenant.businessId, branchId, policyId, `historical-feedback:${attention.rows[0]!.id}`, input.completedAt],
  );
  await pool.query(
    `INSERT INTO business_action_items(
       business_id,branch_id,source_attention_item_id,source_automation_run_id,action_type,title,reason,evidence,
       status,completed_at,completion_outcome,completed_by_user_id
     ) VALUES($1,$2,$3,$4,'CREATE_FOLLOW_UP','Historical review','Historical review','[]','DONE',$5,$6,$7)`,
    [tenant.businessId, branchId, attention.rows[0]!.id, run.rows[0]!.id, input.completedAt, input.outcome ?? "NOT_RELEVANT", tenant.userId],
  );
}

async function economicAndAccessCounts(businessId: string) {
  const result = await pool.query<{
    sales: string;
    payments: string;
    refunds: string;
    inventory: string;
    cashbook: string;
    memberships: string;
    staff: string;
  }>(
    `SELECT
       (SELECT count(*) FROM sales WHERE business_id=$1)::text AS sales,
       (SELECT count(*) FROM payments WHERE business_id=$1)::text AS payments,
       (SELECT count(*) FROM refund_transactions WHERE business_id=$1)::text AS refunds,
       (SELECT count(*) FROM inventory_movements WHERE business_id=$1)::text AS inventory,
       (SELECT count(*) FROM cashbook_entries WHERE business_id=$1)::text AS cashbook,
       (SELECT count(*) FROM business_memberships WHERE business_id=$1)::text AS memberships,
       (SELECT count(*) FROM staff WHERE business_id=$1)::text AS staff`,
    [businessId],
  );
  return result.rows[0];
}

async function runCount(policyId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM business_automation_runs WHERE policy_id=$1",
    [policyId],
  );
  return Number(result.rows[0]!.count);
}

async function policyRunState(policyId: string): Promise<string | null> {
  const result = await pool.query<{ state: string }>(
    "SELECT state FROM business_automation_runs WHERE policy_id=$1 ORDER BY created_at DESC LIMIT 1",
    [policyId],
  );
  return result.rows[0]?.state ?? null;
}
