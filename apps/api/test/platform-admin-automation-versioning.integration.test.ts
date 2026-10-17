import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/security.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
const PASSWORD = "admin-password-123";

beforeAll(async () => { await app.ready(); });
beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE
    platform_automation_runs,platform_automation_policies,platform_attention_items,
    subscription_payment_refunds,subscription_payments,subscription_invoices,
    platform_admin_sessions,platform_audit_events,business_entitlement_overrides,
    business_subscriptions,plan_entitlements,subscription_plans,registered_devices,
    client_releases,platform_users,businesses CASCADE`);
});
afterAll(async () => { await app.close(); await pool.end(); });

describe("platform automation policy versioning and retry", () => {
  it("pins a waiting approval to the proposed action and approval role from its policy version", async () => {
    await seedAdmin("version-owner@tradeos.test", "SUPER_ADMIN");
    await seedAdmin("operations-approver@tradeos.test", "OPERATIONS");
    const ownerCookie = await adminCookieFor("version-owner@tradeos.test");
    const operationsCookie = await adminCookieFor("operations-approver@tradeos.test");
    const original = await seedBusiness("Original approval target");
    const replacement = await seedBusiness("Replacement policy target");

    const created = await createPolicy(ownerCookie, {
      code: "PINNED-TENANT-STATUS",
      name: "Pinned tenant status",
      actionType: "TENANT_STATUS_CHANGE",
      executionClass: 2,
      approvalRole: "SUPER_ADMIN",
      actionConfiguration: {
        businessId: original.id,
        status: "SUSPENDED",
        expectedUpdatedAt: original.updatedAt,
        reason: "Original approved proposal",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const policy = created.json<{ policy: { id: string; policyVersion: number } }>().policy;
    expect(policy.policyVersion).toBe(1);

    const evaluated = await evaluate(ownerCookie, policy.id, "same-event");
    expect(evaluated.statusCode, evaluated.body).toBe(200);
    const firstRun = evaluated.json<{ run: { id: string; policyVersion: number; state: string } }>().run;
    expect(firstRun).toMatchObject({ policyVersion: 1, state: "WAITING_APPROVAL" });

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/admin/automation/policies/${policy.id}`,
      headers: jsonHeaders(ownerCookie),
      payload: {
        actionConfiguration: {
          businessId: replacement.id,
          status: "SUSPENDED",
          expectedUpdatedAt: replacement.updatedAt,
          reason: "Replacement proposal",
        },
        approvalRole: "OPERATIONS",
        reason: "Policy requirements changed after the first run was proposed",
      },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json<{ policy: { policyVersion: number } }>().policy.policyVersion).toBe(2);

    const operationsAttempt = await approve(operationsCookie, firstRun.id, "Operations must not inherit a later policy role");
    expect(operationsAttempt.statusCode, operationsAttempt.body).toBe(403);
    expect(operationsAttempt.json<{ error: string }>().error).toBe("ADMIN_AUTOMATION_APPROVAL_FORBIDDEN");

    const approved = await approve(ownerCookie, firstRun.id, "Approve the original version-one proposal");
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json<{ run: { state: string } }>().run.state).toBe("SUCCEEDED");

    const states = await pool.query<{ id: string; status: string }>(
      "SELECT id,status FROM businesses WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[original.id, replacement.id]],
    );
    const byId = new Map(states.rows.map((row) => [row.id, row.status]));
    expect(byId.get(original.id)).toBe("SUSPENDED");
    expect(byId.get(replacement.id)).toBe("ACTIVE");

    const secondEvaluation = await evaluate(ownerCookie, policy.id, "same-event");
    expect(secondEvaluation.statusCode, secondEvaluation.body).toBe(200);
    const secondRun = secondEvaluation.json<{ run: { id: string; policyVersion: number; state: string } }>().run;
    expect(secondRun.policyVersion).toBe(2);
    expect(secondRun.id).not.toBe(firstRun.id);
    expect(secondRun.state).toBe("WAITING_APPROVAL");
  });

  it("retries a failed low-risk run without changing its idempotency identity or proposed action", async () => {
    await seedAdmin("retry-owner@tradeos.test", "SUPER_ADMIN");
    const cookie = await adminCookieFor("retry-owner@tradeos.test");
    const attentionId = await seedAttention();

    const created = await createPolicy(cookie, {
      code: "RETRY-LOW-RISK",
      name: "Retry low risk",
      actionType: "RESOLVE_ATTENTION",
      executionClass: 1,
      approvalRole: null,
      actionConfiguration: { attentionItemId: attentionId, reason: "Resolve when ready" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const policyId = created.json<{ policy: { id: string } }>().policy.id;

    await pool.query("UPDATE platform_attention_items SET state='RESOLVED',resolved_at=now() WHERE id=$1", [attentionId]);
    const failedEvaluation = await evaluate(cookie, policyId, "retry-correlation");
    expect(failedEvaluation.statusCode, failedEvaluation.body).toBe(409);
    expect(failedEvaluation.json<{ error: string }>().error).toBe("ADMIN_AUTOMATION_TARGET_STALE");

    const failed = await pool.query<{ id: string; state: string; error_code: string | null }>(
      "SELECT id,state,error_code FROM platform_automation_runs WHERE policy_id=$1 AND trigger_correlation_id='retry-correlation'",
      [policyId],
    );
    expect(failed.rows[0]).toMatchObject({ state: "FAILED", error_code: "ADMIN_AUTOMATION_TARGET_STALE" });
    const runId = failed.rows[0]!.id;

    await pool.query("UPDATE platform_attention_items SET state='OPEN',resolved_at=NULL WHERE id=$1", [attentionId]);
    const retried = await app.inject({
      method: "POST",
      url: `/api/admin/automation/runs/${runId}/retry`,
      headers: jsonHeaders(cookie),
      payload: { reason: "Underlying condition is ready again" },
    });
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json<{ run: { id: string; state: string } }>().run).toMatchObject({ id: runId, state: "SUCCEEDED" });

    const item = await pool.query<{ state: string }>("SELECT state FROM platform_attention_items WHERE id=$1", [attentionId]);
    expect(item.rows[0]?.state).toBe("RESOLVED");
    const runCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM platform_automation_runs WHERE policy_id=$1 AND trigger_correlation_id='retry-correlation'",
      [policyId],
    );
    expect(Number(runCount.rows[0]!.count)).toBe(1);
  });
});

async function createPolicy(cookie: string, input: {
  code: string;
  name: string;
  actionType: string;
  executionClass: number;
  approvalRole: string | null;
  actionConfiguration: Record<string, unknown>;
}) {
  return app.inject({
    method: "POST",
    url: "/api/admin/automation/policies",
    headers: jsonHeaders(cookie),
    payload: {
      ...input,
      description: "Versioning integration test policy",
      enabled: true,
      businessId: null,
      triggerType: "MANUAL",
      conditions: {},
      reason: "Automation versioning integration test",
    },
  });
}

async function evaluate(cookie: string, policyId: string, correlationId: string) {
  return app.inject({
    method: "POST",
    url: "/api/admin/automation/evaluate",
    headers: jsonHeaders(cookie),
    payload: { policyId, correlationId, triggerSource: "MANUAL", structuredInput: {} },
  });
}

async function approve(cookie: string, runId: string, reason: string) {
  return app.inject({
    method: "POST",
    url: `/api/admin/automation/runs/${runId}/approve`,
    headers: jsonHeaders(cookie),
    payload: { reason },
  });
}

async function seedAdmin(email: string, role: string): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
     VALUES($1,$2,$3,true,$4,now()) RETURNING id`,
    [email, `${role} Operator`, role, passwordHash],
  );
  return result.rows[0]!.id;
}

async function adminCookieFor(email: string): Promise<string> {
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/session/login",
    payload: { identifier: email, password: PASSWORD, platform: "WEB", deviceKey: `${email}-device` },
  });
  expect(login.statusCode, login.body).toBe(200);
  return adminCookie(login.headers);
}

async function seedBusiness(name: string): Promise<{ id: string; updatedAt: string }> {
  const result = await pool.query<{ id: string; updated_at: Date }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES($1,'RETAIL','GH','GHS','Africa/Accra','ACTIVE') RETURNING id,updated_at`,
    [name],
  );
  return { id: result.rows[0]!.id, updatedAt: result.rows[0]!.updated_at.toISOString() };
}

async function seedAttention(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO platform_attention_items(
       source_key,rule_code,severity,state,title,summary,evidence,first_seen_at,last_seen_at
     ) VALUES('automation-retry','TEST_RETRY','LOW','OPEN','Retry item','Retry workflow target','[]'::jsonb,now(),now())
     RETURNING id`,
  );
  return result.rows[0]!.id;
}

function adminCookie(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["set-cookie"];
  const serialized = Array.isArray(raw) ? raw[0] : raw;
  expect(serialized).toBeTruthy();
  return serialized!.split(";", 1)[0]!;
}
function jsonHeaders(cookie: string) { return { cookie, "content-type": "application/json" }; }
