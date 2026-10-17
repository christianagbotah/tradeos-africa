import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

type Tenant = { token: string; userId: string; businessId: string; branchId: string };

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
): Promise<{ id: string }> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_attention_items(
       business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
     ) VALUES($1,$2,$3,$4,$5,'OPEN',$6,$7,$8::jsonb)
     RETURNING id`,
    [
      tenant.businessId,
      tenant.branchId,
      `${ruleCode.toLowerCase()}:test`,
      ruleCode,
      severity,
      `${ruleCode} test signal`,
      "Test evidence-backed signal",
      JSON.stringify(evidence),
    ],
  );
  return { id: result.rows[0]!.id };
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
  return {
    token,
    userId,
    businessId: onboard.json().business.id,
    branchId: onboard.json().branch.id,
  };
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}
