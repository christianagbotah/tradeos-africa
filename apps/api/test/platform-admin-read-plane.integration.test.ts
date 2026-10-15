import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/security.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
const PASSWORD = "admin-password-123";

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE
    platform_admin_sessions,
    platform_audit_events,
    platform_feature_flags,
    client_releases,
    business_entitlement_overrides,
    business_subscriptions,
    subscription_plans,
    registered_devices,
    platform_users,
    app_users,
    businesses
    CASCADE`);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("platform admin authentication", () => {
  it("uses an independent HttpOnly admin cookie and logs out server-side", async () => {
    await seedAdmin("ops@tradeos.test");
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/session/login",
      payload: { identifier: "OPS@TRADEOS.TEST", password: PASSWORD, platform: "WEB", deviceKey: "admin-browser-1" },
    });
    expect(login.statusCode, login.body).toBe(200);
    const first = login.json<{ adminUser: { email: string; role: string }; session: { expiresAt: string; idleExpiresAt: string } }>();
    expect(first.adminUser).toMatchObject({ email: "ops@tradeos.test", role: "SUPER_ADMIN" });
    expect(first.session.expiresAt).toBeTruthy();
    expect(first.session.idleExpiresAt).toBeTruthy();
    expect(JSON.stringify(first)).not.toMatch(/accessToken|refreshToken|tos_admin_session_/);

    const cookie = adminCookie(login.headers);
    expect(login.headers["set-cookie"]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]).toContain("Secure");
    expect(login.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(login.headers["set-cookie"]).toContain("Path=/");
    expect(login.headers["set-cookie"]).not.toContain("Domain=");

    const me = await app.inject({ method: "GET", url: "/api/admin/session/me", headers: cookieHeader(cookie) });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json<{ adminUser: { email: string } }>().adminUser.email).toBe("ops@tradeos.test");

    const noCookie = await app.inject({ method: "GET", url: "/api/admin/session/me" });
    expect(noCookie.statusCode).toBe(401);

    const logout = await app.inject({ method: "POST", url: "/api/admin/session/logout", headers: cookieHeader(cookie) });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    const afterLogout = await app.inject({ method: "GET", url: "/api/admin/session/me", headers: cookieHeader(cookie) });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("locks after five failed attempts without revealing account existence and resets after a later success", async () => {
    const adminId = await seedAdmin("lockout@tradeos.test");

    const unknown = await adminLogin("missing@tradeos.test", "wrong-password-123");
    const firstWrong = await adminLogin("lockout@tradeos.test", "wrong-password-123");
    expect(unknown.statusCode).toBe(401);
    expect(firstWrong.statusCode).toBe(401);
    expect(unknown.json<{ error: string }>().error).toBe("ADMIN_LOGIN_REJECTED");
    expect(firstWrong.json<{ error: string }>().error).toBe("ADMIN_LOGIN_REJECTED");

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      const rejected = await adminLogin("lockout@tradeos.test", "wrong-password-123");
      expect(rejected.statusCode).toBe(401);
      expect(rejected.json<{ error: string }>().error).toBe("ADMIN_LOGIN_REJECTED");
    }

    const locked = await pool.query<{ failed_login_count: number; locked_until: Date | null }>(
      "SELECT failed_login_count,locked_until FROM platform_users WHERE id=$1",
      [adminId],
    );
    expect(locked.rows[0]?.failed_login_count).toBe(5);
    expect(locked.rows[0]?.locked_until).toBeInstanceOf(Date);

    const correctWhileLocked = await adminLogin("lockout@tradeos.test");
    expect(correctWhileLocked.statusCode).toBe(401);
    expect(correctWhileLocked.json<{ error: string }>().error).toBe("ADMIN_LOGIN_REJECTED");

    const lockEvents = await pool.query(
      "SELECT 1 FROM platform_audit_events WHERE platform_user_id=$1 AND event_type='ADMIN_LOGIN_LOCKED'",
      [adminId],
    );
    expect(lockEvents.rowCount).toBe(1);

    await pool.query("UPDATE platform_users SET locked_until=now()-interval '1 second' WHERE id=$1", [adminId]);
    const recovered = await adminLogin("lockout@tradeos.test");
    expect(recovered.statusCode, recovered.body).toBe(200);

    const reset = await pool.query<{ failed_login_count: number; locked_until: Date | null }>(
      "SELECT failed_login_count,locked_until FROM platform_users WHERE id=$1",
      [adminId],
    );
    expect(reset.rows[0]).toMatchObject({ failed_login_count: 0, locked_until: null });
    const successEvents = await pool.query(
      "SELECT 1 FROM platform_audit_events WHERE platform_user_id=$1 AND event_type='ADMIN_LOGIN_SUCCEEDED'",
      [adminId],
    );
    expect(successEvents.rowCount).toBe(1);
  });

  it("rejects tenant access tokens and inactive or unprovisioned admins", async () => {
    const tenantRegister = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        displayName: "Tenant User",
        email: "tenant@tradeos.test",
        password: "tenant-password-123",
        platform: "WEB",
        deviceKey: "tenant-browser",
        appVersion: "test",
      },
    });
    expect(tenantRegister.statusCode, tenantRegister.body).toBe(201);
    const tenantToken = tenantRegister.json<{ session: { accessToken: string } }>().session.accessToken;
    const denied = await app.inject({ method: "GET", url: "/api/admin/session/me", headers: bearer(tenantToken) });
    expect(denied.statusCode).toBe(401);

    await seedAdmin("inactive@tradeos.test", false);
    const inactive = await adminLogin("inactive@tradeos.test");
    expect(inactive.statusCode).toBe(401);
    expect(inactive.json<{ error: string }>().error).toBe("ADMIN_LOGIN_REJECTED");

    await pool.query(
      `INSERT INTO platform_users(email,display_name,role,is_active,password_hash) VALUES($1,$2,'SUPPORT',true,NULL)`,
      ["unprovisioned@tradeos.test", "Unprovisioned"],
    );
    const unprovisioned = await adminLogin("unprovisioned@tradeos.test");
    expect(unprovisioned.statusCode).toBe(401);
    expect(unprovisioned.json<{ error: string }>().error).toBe("ADMIN_LOGIN_REJECTED");
  });
});

describe("platform admin read plane", () => {
  it("returns authoritative tenants, devices, audit events, releases and feature flags", async () => {
    const adminId = await seedAdmin("read@tradeos.test");
    const login = await adminLogin("read@tradeos.test");
    expect(login.statusCode, login.body).toBe(200);
    const cookie = adminCookie(login.headers);

    const business = await pool.query<{ id: string }>(
      `INSERT INTO businesses(name,country_code,currency_code,business_type,timezone)
       VALUES('Read Plane Shop','GH','GHS','RETAIL_HARDWARE','Africa/Accra') RETURNING id`,
    );
    const businessId = business.rows[0]!.id;
    const branch = await pool.query<{ id: string }>(
      `INSERT INTO branches(business_id,name,code,timezone) VALUES($1,'Main','MAIN','Africa/Accra') RETURNING id`,
      [businessId],
    );
    const plan = await pool.query<{ id: string }>(
      `INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval)
       VALUES('GROWTH','Growth','GHS',25000,'MONTHLY') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO business_subscriptions(business_id,plan_id,status,current_period_starts_at,current_period_ends_at)
       VALUES($1,$2,'ACTIVE',now(),now()+interval '30 days')`,
      [businessId, plan.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO registered_devices(business_id,branch_id,device_key,platform,app_version,last_seen_at,last_sync_at)
       VALUES($1,$2,'shop-web','WEB','1.2.3',now(),now())`,
      [businessId, branch.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO client_releases(platform,version,release_channel,status,minimum_supported_version,rollout_percent,released_at)
       VALUES('WEB','1.2.3','STABLE','ACTIVE','1.2.0',100,now())`,
    );
    await pool.query(
      `INSERT INTO platform_feature_flags(code,business_id,enabled,configuration,updated_by_platform_user_id)
       VALUES('AI_INSIGHTS',$1,true,'{"mode":"observe"}'::jsonb,$2)`,
      [businessId, adminId],
    );
    await pool.query(
      `INSERT INTO platform_audit_events(platform_user_id,business_id,event_type,entity_type,entity_id,reason,payload)
       VALUES($1,$2,'TENANT_VIEWED','BUSINESS',$3,'integration test','{"safe":true}'::jsonb)`,
      [adminId, businessId, businessId],
    );

    const tenants = await app.inject({ method: "GET", url: "/api/admin/tenants", headers: cookieHeader(cookie) });
    expect(tenants.statusCode, tenants.body).toBe(200);
    expect(tenants.json<{ tenants: Array<Record<string, unknown>> }>().tenants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: businessId,
        name: "Read Plane Shop",
        planCode: "GROWTH",
        subscriptionStatus: "ACTIVE",
        branchCount: 1,
        deviceCount: 1,
      }),
    ]));

    const detail = await app.inject({ method: "GET", url: `/api/admin/tenants/${businessId}`, headers: cookieHeader(cookie) });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json<{ tenant: { branches: unknown[]; subscription: { planCode: string } } }>().tenant).toMatchObject({
      branches: [expect.objectContaining({ code: "MAIN", active: true })],
      subscription: expect.objectContaining({ planCode: "GROWTH", status: "ACTIVE" }),
    });

    const devices = await app.inject({ method: "GET", url: "/api/admin/devices", headers: cookieHeader(cookie) });
    expect(devices.statusCode, devices.body).toBe(200);
    expect(devices.json<{ devices: Array<Record<string, unknown>> }>().devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ businessId, deviceKey: "shop-web", health: "ONLINE" }),
    ]));

    const audit = await app.inject({ method: "GET", url: "/api/admin/audit-events", headers: cookieHeader(cookie) });
    expect(audit.statusCode, audit.body).toBe(200);
    const auditBody = audit.json<{ events: Array<Record<string, unknown>> }>();
    expect(auditBody.events).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: "TENANT_VIEWED", businessId })]));
    expect(JSON.stringify(auditBody)).not.toMatch(/password_hash|access_token_hash|refresh_token_hash/i);

    const releases = await app.inject({ method: "GET", url: "/api/admin/releases", headers: cookieHeader(cookie) });
    expect(releases.statusCode, releases.body).toBe(200);
    expect(releases.json<{ releases: Array<Record<string, unknown>> }>().releases).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: "WEB", version: "1.2.3", status: "ACTIVE" }),
    ]));

    const flags = await app.inject({ method: "GET", url: "/api/admin/feature-flags", headers: cookieHeader(cookie) });
    expect(flags.statusCode, flags.body).toBe(200);
    expect(flags.json<{ flags: Array<Record<string, unknown>> }>().flags).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "AI_INSIGHTS", businessId, enabled: true }),
    ]));
  });

  it("requires platform authentication for every read endpoint and returns 404 for an unknown tenant", async () => {
    for (const url of ["/api/admin/tenants", "/api/admin/devices", "/api/admin/audit-events", "/api/admin/releases", "/api/admin/feature-flags"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(401);
    }
    await seedAdmin("not-found@tradeos.test");
    const login = await adminLogin("not-found@tradeos.test");
    const cookie = adminCookie(login.headers);
    const missing = await app.inject({
      method: "GET",
      url: "/api/admin/tenants/00000000-0000-0000-0000-000000000001",
      headers: cookieHeader(cookie),
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: string }>().error).toBe("ADMIN_TENANT_NOT_FOUND");
  });
});

async function seedAdmin(email: string, active = true): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO platform_users(email,display_name,role,is_active,password_hash)
     VALUES($1,'Platform Operator','SUPER_ADMIN',$2,$3) RETURNING id`,
    [email, active, passwordHash],
  );
  return inserted.rows[0]!.id;
}

async function adminLogin(identifier: string, password = PASSWORD) {
  return app.inject({
    method: "POST",
    url: "/api/admin/session/login",
    payload: { identifier, password, platform: "WEB", deviceKey: `device-${identifier}` },
  });
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function adminCookie(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["set-cookie"];
  const serialized = Array.isArray(raw) ? raw[0] : raw;
  expect(serialized).toBeTruthy();
  return serialized!.split(";", 1)[0]!;
}

function cookieHeader(cookie: string) {
  return { cookie };
}
