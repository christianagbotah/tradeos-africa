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
    platform_admin_sessions,platform_audit_events,business_entitlement_overrides,
    business_subscriptions,plan_entitlements,subscription_plans,platform_users,businesses CASCADE`);
});
afterAll(async () => { await app.close(); await pool.end(); });

describe("System Admin plan and subscription management", () => {
  it("creates, lists and validates plans using integer minor units", async () => {
    const cookie = await adminCookieFor("billing@tradeos.test", "BILLING");
    const created = await createPlan(cookie, { code: "growth", amountMinor: 12500, billingInterval: "MONTHLY", trialDays: 14 });
    expect(created).toMatchObject({
      code: "GROWTH", name: "Growth", currencyCode: "GHS", amountMinor: 12500,
      billingInterval: "MONTHLY", trialDays: 14, public: true, active: true,
    });
    expect(created.updatedAt).toEqual(expect.any(String));

    const list = await app.inject({ method: "GET", url: "/api/admin/plans", headers: cookieHeader(cookie) });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json<{ plans: any[] }>().plans).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, code: "GROWTH" })]));

    for (const payload of [
      { code: "BADFLOAT", amountMinor: 10.5, billingInterval: "MONTHLY", trialDays: 0 },
      { code: "BADNEG", amountMinor: -1, billingInterval: "MONTHLY", trialDays: 0 },
      { code: "BADINT", amountMinor: 100, billingInterval: "WEEKLY", trialDays: 0 },
    ]) {
      const response = await app.inject({
        method: "POST", url: "/api/admin/plans", headers: jsonHeaders(cookie),
        payload: { ...payload, name: "Invalid", currencyCode: "GHS", isPublic: true, isActive: true, reason: "validation" },
      });
      expect(response.statusCode, response.body).toBe(400);
    }
  });

  it("updates plans with stale-write protection and replaces entitlements atomically", async () => {
    const cookie = await adminCookieFor("platform@tradeos.test", "PLATFORM_ADMIN");
    const plan = await createPlan(cookie, { code: "starter", amountMinor: 5000, billingInterval: "MONTHLY", trialDays: 7 });

    const updated = await app.inject({
      method: "PATCH", url: `/api/admin/plans/${plan.id}`, headers: jsonHeaders(cookie),
      payload: { name: "Starter Plus", amountMinor: 6500, expectedUpdatedAt: plan.updatedAt, reason: "Price review" },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const next = updated.json<{ plan: any }>().plan;
    expect(next).toMatchObject({ name: "Starter Plus", amountMinor: 6500 });
    expect(next.updatedAt).not.toBe(plan.updatedAt);

    const stale = await app.inject({
      method: "PATCH", url: `/api/admin/plans/${plan.id}`, headers: jsonHeaders(cookie),
      payload: { name: "Stale overwrite", expectedUpdatedAt: plan.updatedAt, reason: "Old form" },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json<{ error: string }>().error).toBe("ADMIN_PLAN_STALE");

    const entitlements = await app.inject({
      method: "PUT", url: `/api/admin/plans/${plan.id}/entitlements`, headers: jsonHeaders(cookie),
      payload: {
        entitlements: [
          { code: "AI_INSIGHTS", value: true },
          { code: "MAX_BRANCHES", value: 5 },
        ],
        expectedUpdatedAt: next.updatedAt,
        reason: "Enable growth features",
      },
    });
    expect(entitlements.statusCode, entitlements.body).toBe(200);
    expect(entitlements.json<{ plan: any }>().plan.entitlements).toEqual([
      { code: "AI_INSIGHTS", value: true },
      { code: "MAX_BRANCHES", value: 5 },
    ]);

    const replaced = await app.inject({
      method: "PUT", url: `/api/admin/plans/${plan.id}/entitlements`, headers: jsonHeaders(cookie),
      payload: {
        entitlements: [{ code: "MAX_BRANCHES", value: 10 }],
        expectedUpdatedAt: entitlements.json<{ plan: any }>().plan.updatedAt,
        reason: "Replace limits",
      },
    });
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect(replaced.json<{ plan: any }>().plan.entitlements).toEqual([{ code: "MAX_BRANCHES", value: 10 }]);
  });

  it("assigns one current subscription and supports trial/activate/change-plan/pause/reactivate/cancel-at-period-end/resume/cancel", async () => {
    const cookie = await adminCookieFor("super@tradeos.test", "SUPER_ADMIN");
    const businessId = await seedBusiness("Lifecycle Tenant");
    const starter = await createPlan(cookie, { code: "starter", amountMinor: 5000, billingInterval: "MONTHLY", trialDays: 7 });
    const growth = await createPlan(cookie, { code: "growth", amountMinor: 15000, billingInterval: "ANNUAL", trialDays: 14 });

    const assigned = await app.inject({
      method: "POST", url: `/api/admin/tenants/${businessId}/subscription`, headers: jsonHeaders(cookie),
      payload: { planId: starter.id, mode: "TRIAL", reason: "New tenant trial" },
    });
    expect(assigned.statusCode, assigned.body).toBe(201);
    let subscription = assigned.json<{ subscription: any }>().subscription;
    expect(subscription).toMatchObject({ businessId, planId: starter.id, status: "TRIALING", cancelAtPeriodEnd: false });
    expect(subscription.trialEndsAt).toEqual(expect.any(String));

    const duplicate = await app.inject({
      method: "POST", url: `/api/admin/tenants/${businessId}/subscription`, headers: jsonHeaders(cookie),
      payload: { planId: growth.id, mode: "ACTIVE", reason: "Should not duplicate" },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json<{ error: string }>().error).toBe("ADMIN_SUBSCRIPTION_CURRENT_EXISTS");

    subscription = await transition(cookie, subscription, "ACTIVATE", {});
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.currentPeriodEndsAt).toEqual(expect.any(String));

    subscription = await transition(cookie, subscription, "CHANGE_PLAN", { planId: growth.id });
    expect(subscription.planId).toBe(growth.id);
    expect(subscription.status).toBe("ACTIVE");

    subscription = await transition(cookie, subscription, "PAUSE", {});
    expect(subscription.status).toBe("PAUSED");
    subscription = await transition(cookie, subscription, "REACTIVATE", {});
    expect(subscription.status).toBe("ACTIVE");

    subscription = await transition(cookie, subscription, "CANCEL_AT_PERIOD_END", {});
    expect(subscription.cancelAtPeriodEnd).toBe(true);
    subscription = await transition(cookie, subscription, "RESUME", {});
    expect(subscription.cancelAtPeriodEnd).toBe(false);

    subscription = await transition(cookie, subscription, "CANCEL", {});
    expect(subscription.status).toBe("CANCELED");
    expect(subscription.canceledAt).toEqual(expect.any(String));

    const all = await app.inject({ method: "GET", url: "/api/admin/subscriptions", headers: cookieHeader(cookie) });
    expect(all.statusCode, all.body).toBe(200);
    expect(all.json<{ subscriptions: any[] }>().subscriptions).toEqual(expect.arrayContaining([expect.objectContaining({ id: subscription.id, status: "CANCELED" })]));
  });

  it("rejects stale subscription transitions without changing current state", async () => {
    const cookie = await adminCookieFor("stale@tradeos.test", "BILLING");
    const businessId = await seedBusiness("Stale Tenant");
    const plan = await createPlan(cookie, { code: "stale", amountMinor: 1000, billingInterval: "MONTHLY", trialDays: 0 });
    const created = await app.inject({
      method: "POST", url: `/api/admin/tenants/${businessId}/subscription`, headers: jsonHeaders(cookie),
      payload: { planId: plan.id, mode: "ACTIVE", reason: "Create" },
    });
    let subscription = created.json<{ subscription: any }>().subscription;
    const staleUpdatedAt = subscription.updatedAt;
    subscription = await transition(cookie, subscription, "PAUSE", {});

    const stale = await app.inject({
      method: "PATCH", url: `/api/admin/subscriptions/${subscription.id}`, headers: jsonHeaders(cookie),
      payload: { action: "REACTIVATE", reason: "Old form", expectedUpdatedAt: staleUpdatedAt },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json<{ error: string }>().error).toBe("ADMIN_SUBSCRIPTION_STALE");
    const row = await pool.query<{ status: string }>("SELECT status FROM business_subscriptions WHERE id=$1", [subscription.id]);
    expect(row.rows[0]?.status).toBe("PAUSED");
  });

  it.each(["SUPPORT", "OPERATIONS", "DEVELOPER"] as const)("keeps %s read-only for plan/subscription writes", async (role) => {
    const cookie = await adminCookieFor(`${role.toLowerCase()}@tradeos.test`, role);
    const businessId = await seedBusiness(`${role} Tenant`);
    const response = await app.inject({
      method: "POST", url: "/api/admin/plans", headers: jsonHeaders(cookie),
      payload: { code: `NO_${role}`, name: "Forbidden", currencyCode: "GHS", amountMinor: 0, billingInterval: "MONTHLY", trialDays: 0, isPublic: false, isActive: true, reason: "No" },
    });
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json<{ error: string }>().error).toBe("ADMIN_SUBSCRIPTION_WRITE_FORBIDDEN");

    const plan = await seedPlanDirect(`DIRECT_${role}`);
    const assign = await app.inject({
      method: "POST", url: `/api/admin/tenants/${businessId}/subscription`, headers: jsonHeaders(cookie),
      payload: { planId: plan, mode: "ACTIVE", reason: "No" },
    });
    expect(assign.statusCode, assign.body).toBe(403);
    expect(assign.json<{ error: string }>().error).toBe("ADMIN_SUBSCRIPTION_WRITE_FORBIDDEN");
  });

  it("audits plan and subscription writes with actor, target, reason and before/after data", async () => {
    const adminId = await seedAdmin("audit-billing@tradeos.test", "BILLING");
    const cookie = adminCookie((await adminLogin("audit-billing@tradeos.test", "audit-device")).headers);
    const businessId = await seedBusiness("Audit Tenant");
    const plan = await createPlan(cookie, { code: "audit", amountMinor: 9000, billingInterval: "MONTHLY", trialDays: 0 });
    const assigned = await app.inject({
      method: "POST", url: `/api/admin/tenants/${businessId}/subscription`, headers: jsonHeaders(cookie),
      payload: { planId: plan.id, mode: "ACTIVE", reason: "Paid onboarding" },
    });
    const subscription = assigned.json<{ subscription: any }>().subscription;
    await transition(cookie, subscription, "PAUSE", {});

    const audit = await pool.query<{ event_type: string; business_id: string | null; reason: string | null; payload: Record<string, any> }>(
      `SELECT event_type,business_id,reason,payload FROM platform_audit_events
       WHERE platform_user_id=$1 AND event_type IN ('PLAN_CREATED','SUBSCRIPTION_CREATED','SUBSCRIPTION_TRANSITIONED')
       ORDER BY occurred_at`, [adminId],
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual(["PLAN_CREATED", "SUBSCRIPTION_CREATED", "SUBSCRIPTION_TRANSITIONED"]);
    expect(audit.rows[1]).toMatchObject({ business_id: businessId, reason: "Paid onboarding" });
    expect(audit.rows[2]?.payload).toMatchObject({ previous: { status: "ACTIVE" }, next: { status: "PAUSED" } });
  });
});

async function createPlan(cookie: string, input: { code: string; amountMinor: number; billingInterval: string; trialDays: number }) {
  const response = await app.inject({
    method: "POST", url: "/api/admin/plans", headers: jsonHeaders(cookie),
    payload: { code: input.code, name: title(input.code), description: `${title(input.code)} plan`, currencyCode: "GHS", amountMinor: input.amountMinor, billingInterval: input.billingInterval, trialDays: input.trialDays, isPublic: true, isActive: true, reason: "Create plan" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ plan: any }>().plan;
}

async function transition(cookie: string, subscription: any, action: string, extra: Record<string, unknown>) {
  const response = await app.inject({
    method: "PATCH", url: `/api/admin/subscriptions/${subscription.id}`, headers: jsonHeaders(cookie),
    payload: { action, reason: `${action} transition`, expectedUpdatedAt: subscription.updatedAt, ...extra },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ subscription: any }>().subscription;
}

async function seedAdmin(email: string, role: string): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
     VALUES($1,$2,$3,true,$4,now()) RETURNING id`, [email, `${role} Operator`, role, passwordHash],
  );
  return result.rows[0]!.id;
}
async function adminCookieFor(email: string, role: string): Promise<string> {
  await seedAdmin(email, role);
  return adminCookie((await adminLogin(email, `${role}-device`)).headers);
}
async function adminLogin(identifier: string, deviceKey: string) {
  return app.inject({ method: "POST", url: "/api/admin/session/login", payload: { identifier, password: PASSWORD, platform: "WEB", deviceKey } });
}
async function seedBusiness(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES($1,'RETAIL','GH','GHS','Africa/Accra','ACTIVE') RETURNING id`, [name],
  );
  return result.rows[0]!.id;
}
async function seedPlanDirect(code: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active)
     VALUES($1,$1,'GHS',0,'MONTHLY',0,false,true) RETURNING id`, [code],
  );
  return result.rows[0]!.id;
}
function adminCookie(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["set-cookie"]; const serialized = Array.isArray(raw) ? raw[0] : raw;
  expect(serialized).toBeTruthy(); return serialized!.split(";", 1)[0]!;
}
function cookieHeader(cookie: string) { return { cookie }; }
function jsonHeaders(cookie: string) { return { cookie, "content-type": "application/json" }; }
function title(value: string) { const normalized = value.toLowerCase(); return normalized.charAt(0).toUpperCase() + normalized.slice(1); }
