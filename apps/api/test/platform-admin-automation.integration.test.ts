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

describe("platform automation enforcement", () => {
  it("enforces execution classes, idempotency, and the allow-listed low-risk path", async () => {
    await seedAdmin("automation-owner@tradeos.test", "SUPER_ADMIN");
    const cookie = await adminCookieFor("automation-owner@tradeos.test");

    const recordPolicy = await createPolicy(cookie, {
      code: "RECORD-ONLY",
      name: "Record only",
      actionType: "RECORD_ONLY",
      executionClass: 0,
      approvalRole: null,
      actionConfiguration: { note: "Observed only" },
    });
    expect(recordPolicy.statusCode, recordPolicy.body).toBe(201);
    const recordPolicyId = recordPolicy.json<{ policy: { id: string } }>().policy.id;

    const first = await evaluate(cookie, recordPolicyId, "record-correlation");
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<{ run: AutomationRun }>().run).toMatchObject({
      policyId: recordPolicyId,
      executionClass: 0,
      state: "SUCCEEDED",
      triggerCorrelationId: "record-correlation",
    });

    const repeated = await evaluate(cookie, recordPolicyId, "record-correlation");
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json<{ run: AutomationRun }>().run.id).toBe(first.json<{ run: AutomationRun }>().run.id);

    const attentionId = await seedAttention();
    const workflowPolicy = await createPolicy(cookie, {
      code: "RESOLVE-ATTENTION",
      name: "Resolve handled attention",
      actionType: "RESOLVE_ATTENTION",
      executionClass: 1,
      approvalRole: null,
      actionConfiguration: { attentionItemId: attentionId, reason: "Handled by approved low-risk workflow" },
    });
    expect(workflowPolicy.statusCode, workflowPolicy.body).toBe(201);
    const workflowRun = await evaluate(
      cookie,
      workflowPolicy.json<{ policy: { id: string } }>().policy.id,
      "resolve-attention-correlation",
    );
    expect(workflowRun.statusCode, workflowRun.body).toBe(200);
    expect(workflowRun.json<{ run: AutomationRun }>().run.state).toBe("SUCCEEDED");
    const attention = await pool.query<{ state: string }>("SELECT state FROM platform_attention_items WHERE id=$1", [attentionId]);
    expect(attention.rows[0]?.state).toBe("RESOLVED");

    const forbiddenClass = await createPolicy(cookie, {
      code: "CLASS-3-FORBIDDEN",
      name: "Never delegate this",
      actionType: "SECURITY_ROLE_CHANGE",
      executionClass: 3,
      approvalRole: "SUPER_ADMIN",
      actionConfiguration: {},
    });
    expect(forbiddenClass.statusCode, forbiddenClass.body).toBe(400);
    expect(forbiddenClass.json<{ error: string }>().error).toBe("ADMIN_AUTOMATION_CLASS3_FORBIDDEN");
  });

  it("holds Class 2 actions for authorized approval and executes the canonical tenant mutation once under an approval race", async () => {
    await seedAdmin("approver-a@tradeos.test", "SUPER_ADMIN");
    await seedAdmin("approver-b@tradeos.test", "SUPER_ADMIN");
    const cookieA = await adminCookieFor("approver-a@tradeos.test");
    const cookieB = await adminCookieFor("approver-b@tradeos.test");
    const tenant = await seedBusiness("Approval race tenant");

    const policy = await createTenantStatusPolicy(cookieA, tenant.id, tenant.updatedAt, "SUSPENDED", "Approval-race safety test");
    const runResponse = await evaluate(cookieA, policy.id, "approval-race-correlation");
    expect(runResponse.statusCode, runResponse.body).toBe(200);
    const run = runResponse.json<{ run: AutomationRun }>().run;
    expect(run.state).toBe("WAITING_APPROVAL");
    expect(run.executionClass).toBe(2);

    const [approvalA, approvalB] = await Promise.all([
      approve(cookieA, run.id, "Reviewed and approved"),
      approve(cookieB, run.id, "Reviewed and approved"),
    ]);
    const statuses = [approvalA.statusCode, approvalB.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const business = await pool.query<{ status: string }>("SELECT status FROM businesses WHERE id=$1", [tenant.id]);
    expect(business.rows[0]?.status).toBe("SUSPENDED");
    const canonicalAudit = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM platform_audit_events WHERE event_type='TENANT_STATUS_CHANGED' AND business_id=$1",
      [tenant.id],
    );
    expect(Number(canonicalAudit.rows[0]!.count)).toBe(1);

    const automationAudit = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM platform_audit_events
       WHERE entity_type='PLATFORM_AUTOMATION_RUN' AND entity_id=$1 ORDER BY occurred_at,id`,
      [run.id],
    );
    expect(automationAudit.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining([
      "AUTOMATION_RUN_CREATED",
      "AUTOMATION_RUN_APPROVED",
      "AUTOMATION_RUN_EXECUTED",
    ]));
  });

  it("revalidates stale Class 2 evidence immediately before canonical mutation", async () => {
    await seedAdmin("stale-approver@tradeos.test", "SUPER_ADMIN");
    const cookie = await adminCookieFor("stale-approver@tradeos.test");
    const tenant = await seedBusiness("Stale recommendation tenant");
    const policy = await createTenantStatusPolicy(cookie, tenant.id, tenant.updatedAt, "SUSPENDED", "Stale-target test");
    const runResponse = await evaluate(cookie, policy.id, "stale-target-correlation");
    const run = runResponse.json<{ run: AutomationRun }>().run;
    expect(run.state).toBe("WAITING_APPROVAL");

    await pool.query(
      "UPDATE businesses SET updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 second') WHERE id=$1",
      [tenant.id],
    );

    const approval = await approve(cookie, run.id, "Approve after source changed");
    expect(approval.statusCode, approval.body).toBe(409);
    expect(approval.json<{ error: string }>().error).toBe("ADMIN_AUTOMATION_TARGET_STALE");

    const storedRun = await pool.query<{ state: string; error_code: string | null }>(
      "SELECT state,error_code FROM platform_automation_runs WHERE id=$1",
      [run.id],
    );
    expect(storedRun.rows[0]).toMatchObject({ state: "FAILED", error_code: "ADMIN_AUTOMATION_TARGET_STALE" });
    const business = await pool.query<{ status: string }>("SELECT status FROM businesses WHERE id=$1", [tenant.id]);
    expect(business.rows[0]?.status).toBe("ACTIVE");
  });

  it("checks approver roles server-side and supports explicit rejection", async () => {
    await seedAdmin("policy-owner@tradeos.test", "SUPER_ADMIN");
    await seedAdmin("support-reviewer@tradeos.test", "SUPPORT");
    const ownerCookie = await adminCookieFor("policy-owner@tradeos.test");
    const supportCookie = await adminCookieFor("support-reviewer@tradeos.test");
    const tenant = await seedBusiness("Approval role tenant");
    const policy = await createTenantStatusPolicy(ownerCookie, tenant.id, tenant.updatedAt, "SUSPENDED", "Role enforcement test");

    const firstRun = (await evaluate(ownerCookie, policy.id, "role-check-correlation")).json<{ run: AutomationRun }>().run;
    const forbidden = await approve(supportCookie, firstRun.id, "Support cannot authorize this");
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    expect(forbidden.json<{ error: string }>().error).toBe("ADMIN_AUTOMATION_APPROVAL_FORBIDDEN");

    const rejected = await reject(ownerCookie, firstRun.id, "Risk not justified");
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json<{ run: AutomationRun }>().run.state).toBe("REJECTED");
    const business = await pool.query<{ status: string }>("SELECT status FROM businesses WHERE id=$1", [tenant.id]);
    expect(business.rows[0]?.status).toBe("ACTIVE");
  });

  it("requires privileged policy mutation but allows authenticated readers to inspect policies and runs", async () => {
    await seedAdmin("admin-automation@tradeos.test", "SUPER_ADMIN");
    await seedAdmin("support-automation@tradeos.test", "SUPPORT");
    const adminCookie = await adminCookieFor("admin-automation@tradeos.test");
    const supportCookie = await adminCookieFor("support-automation@tradeos.test");

    const created = await createPolicy(adminCookie, {
      code: "READABLE-POLICY",
      name: "Readable policy",
      actionType: "RECORD_ONLY",
      executionClass: 0,
      approvalRole: null,
      actionConfiguration: {},
    });
    expect(created.statusCode, created.body).toBe(201);

    const policies = await app.inject({ method: "GET", url: "/api/admin/automation/policies", headers: cookieHeader(supportCookie) });
    expect(policies.statusCode, policies.body).toBe(200);
    expect(policies.json<{ policies: unknown[] }>().policies).toHaveLength(1);

    const runs = await app.inject({ method: "GET", url: "/api/admin/automation/runs", headers: cookieHeader(supportCookie) });
    expect(runs.statusCode, runs.body).toBe(200);

    const forbidden = await createPolicy(supportCookie, {
      code: "SUPPORT-CANNOT-CREATE",
      name: "Forbidden",
      actionType: "RECORD_ONLY",
      executionClass: 0,
      approvalRole: null,
      actionConfiguration: {},
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    expect(forbidden.json<{ error: string }>().error).toBe("ADMIN_AUTOMATION_POLICY_FORBIDDEN");

    const unauthenticated = await app.inject({ method: "GET", url: "/api/admin/automation/runs" });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json<{ error: string }>().error).toBe("ADMIN_AUTH_REQUIRED");
  });
});

interface AutomationRun {
  id: string;
  policyId: string;
  executionClass: number;
  triggerCorrelationId: string;
  state: string;
}

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
      description: "Integration test policy",
      enabled: true,
      businessId: null,
      triggerType: "MANUAL",
      conditions: {},
      reason: "Automation integration test",
    },
  });
}

async function createTenantStatusPolicy(
  cookie: string,
  businessId: string,
  expectedUpdatedAt: string,
  status: "ACTIVE" | "SUSPENDED",
  reason: string,
): Promise<{ id: string }> {
  const response = await createPolicy(cookie, {
    code: `TENANT-STATUS-${businessId.slice(0, 8)}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "Tenant status approval",
    actionType: "TENANT_STATUS_CHANGE",
    executionClass: 2,
    approvalRole: "SUPER_ADMIN",
    actionConfiguration: { businessId, status, expectedUpdatedAt, reason },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ policy: { id: string } }>().policy;
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

async function reject(cookie: string, runId: string, reason: string) {
  return app.inject({
    method: "POST",
    url: `/api/admin/automation/runs/${runId}/reject`,
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
     ) VALUES('automation-low-risk','TEST_LOW_RISK','LOW','OPEN','Low-risk item','Ready for workflow resolution','[]'::jsonb,now(),now())
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
function cookieHeader(cookie: string) { return { cookie }; }
function jsonHeaders(cookie: string) { return { cookie, "content-type": "application/json" }; }
