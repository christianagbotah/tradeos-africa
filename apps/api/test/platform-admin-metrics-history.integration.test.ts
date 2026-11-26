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
    subscription_payment_refunds,subscription_payments,subscription_invoices,
    platform_admin_sessions,platform_audit_events,platform_feature_flags,client_releases,
    business_entitlement_overrides,business_subscriptions,subscription_plans,registered_devices,
    business_memberships,staff,app_users,branches,platform_users,businesses CASCADE`);
});
afterAll(async () => { await app.close(); await pool.end(); });

describe("platform command-center current subscription semantics", () => {
  it("counts only the latest subscription row for each tenant", async () => {
    const passwordHash = await hashPassword(PASSWORD);
    await pool.query(
      `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
       VALUES('history-metrics@tradeos.test','History Metrics','SUPER_ADMIN',true,$1,now())`,
      [passwordHash],
    );
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/session/login",
      payload: { identifier: "history-metrics@tradeos.test", password: PASSWORD, platform: "WEB", deviceKey: "history-metrics" },
    });
    expect(login.statusCode, login.body).toBe(200);
    const rawCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(";", 1)[0]!;

    const business = await pool.query<{ id: string }>(
      `INSERT INTO businesses(name,business_type,status,country_code,currency_code)
       VALUES('History Tenant','RETAIL','ACTIVE','GH','GHS') RETURNING id`,
    );
    const plan = await pool.query<{ id: string }>(
      `INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,is_active,is_public)
       VALUES('HISTORY-MONTHLY','History Monthly','GHS',24000,'MONTHLY',true,true) RETURNING id`,
    );

    await pool.query(
      `INSERT INTO business_subscriptions(
         business_id,plan_id,status,current_period_starts_at,current_period_ends_at,created_at,updated_at
       ) VALUES($1,$2,'CANCELED',now()-interval '2 months',now()-interval '1 month',now()-interval '2 months',now()-interval '1 month')`,
      [business.rows[0]!.id, plan.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO business_subscriptions(
         business_id,plan_id,status,current_period_starts_at,current_period_ends_at,created_at,updated_at
       ) VALUES($1,$2,'ACTIVE',now()-interval '1 day',now()+interval '29 days',now()-interval '1 day',now()-interval '1 day')`,
      [business.rows[0]!.id, plan.rows[0]!.id],
    );

    const response = await app.inject({ method: "GET", url: "/api/admin/metrics", headers: { cookie } });
    expect(response.statusCode, response.body).toBe(200);
    const { metrics } = response.json<{ metrics: Record<string, any> }>();

    expect(metrics.subscriptions).toEqual({ trialing: 0, active: 1, pastDue: 0, paused: 0, canceled: 0, expired: 0 });
    expect(metrics.recurringRevenue).toEqual([{ currencyCode: "GHS", mrrMinor: 24000, arrMinor: 288000 }]);
  });
});
