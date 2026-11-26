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
    platform_admin_sessions,platform_audit_events,platform_feature_flags,client_releases,
    business_entitlement_overrides,business_subscriptions,subscription_plans,registered_devices,
    business_memberships,staff,app_users,branches,platform_users,businesses CASCADE`);
});
afterAll(async () => { await app.close(); await pool.end(); });

describe("platform administrator tenant 360 and lifecycle", () => {
  it("returns tenant 360 from authoritative tenant, access, device, subscription, entitlement and audit data", async () => {
    await seedAdmin("viewer@tradeos.test", "SUPPORT");
    const businessId = await seedTenant360();
    const cookie = adminCookie((await adminLogin("viewer@tradeos.test", "viewer-device")).headers);

    const response = await app.inject({
      method: "GET",
      url: `/api/admin/tenants/${businessId}/overview`,
      headers: cookieHeader(cookie),
    });

    expect(response.statusCode, response.body).toBe(200);
    const tenant = response.json<{ tenant: Record<string, any> }>().tenant;
    expect(tenant).toMatchObject({
      id: businessId,
      name: "Tenant 360 Ltd",
      businessType: "RETAIL_HARDWARE",
      status: "ACTIVE",
      countryCode: "GH",
      currencyCode: "GHS",
      timezone: "Africa/Accra",
      branchCount: 2,
      deviceCount: 2,
      entitlementOverrideCount: 1,
      access: {
        staffTotal: 3,
        activeStaff: 2,
        membershipTotal: 3,
        activeMemberships: 2,
      },
      subscription: {
        planCode: "GROWTH",
        planName: "Growth",
        status: "ACTIVE",
        cancelAtPeriodEnd: false,
      },
      billing: {
        available: false,
        openInvoiceCount: null,
        overdueInvoiceCount: null,
        openBalanceMinor: null,
        overdueBalanceMinor: null,
      },
    });
    expect(tenant.createdAt).toEqual(expect.any(String));
    expect(tenant.updatedAt).toEqual(expect.any(String));
    expect(tenant.branches).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Main", code: "MAIN", active: true }),
      expect.objectContaining({ name: "Tema", code: "TEMA", active: false }),
    ]));
    expect(tenant.access.roles).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "OWNER", staffCount: 1, membershipCount: 1 }),
      expect.objectContaining({ role: "CASHIER", staffCount: 1, membershipCount: 1 }),
      expect.objectContaining({ role: "ACCOUNTANT", staffCount: 1, membershipCount: 1 }),
    ]));
    expect(tenant.access.membershipStatuses).toEqual(expect.arrayContaining([
      { status: "ACTIVE", count: 2 },
      { status: "SUSPENDED", count: 1 },
    ]));
    expect(tenant.contacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: "Business Owner", email: "owner@tenant.test", role: "OWNER", membershipStatus: "ACTIVE" }),
    ]));
    expect(tenant.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({ deviceKey: "tenant-web", platform: "WEB", status: "ACTIVE", health: "ONLINE" }),
      expect.objectContaining({ deviceKey: "tenant-pos", platform: "WINDOWS", status: "ACTIVE" }),
    ]));
    expect(tenant.recentActivity).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "TENANT_NOTE", businessId }),
    ]));
    expect(JSON.stringify(tenant)).not.toMatch(/password_hash|session_token|access_token|refresh_token/i);
  });

  it.each(["OPERATIONS", "PLATFORM_ADMIN", "SUPER_ADMIN"] as const)("allows %s to suspend and reactivate with audited before/after state", async (role) => {
    await seedAdmin(`${role.toLowerCase()}@tradeos.test`, role);
    const businessId = await seedTenant360();
    const cookie = adminCookie((await adminLogin(`${role.toLowerCase()}@tradeos.test`, `${role}-device`)).headers);
    const first = await tenantOverview(businessId, cookie);

    const suspended = await app.inject({
      method: "PATCH",
      url: `/api/admin/tenants/${businessId}/status`,
      headers: cookieHeader(cookie),
      payload: { status: "SUSPENDED", reason: "Compliance review", expectedUpdatedAt: first.updatedAt },
    });
    expect(suspended.statusCode, suspended.body).toBe(200);
    const suspendedTenant = suspended.json<{ tenant: { status: string; updatedAt: string } }>().tenant;
    expect(suspendedTenant.status).toBe("SUSPENDED");
    expect(suspendedTenant.updatedAt).not.toBe(first.updatedAt);

    const audit = await pool.query<{ reason: string | null; payload: Record<string, any> }>(
      `SELECT reason,payload FROM platform_audit_events
       WHERE business_id=$1 AND event_type='TENANT_STATUS_CHANGED' ORDER BY occurred_at DESC LIMIT 1`,
      [businessId],
    );
    expect(audit.rows[0]?.reason).toBe("Compliance review");
    expect(audit.rows[0]?.payload).toMatchObject({ previous: { status: "ACTIVE" }, next: { status: "SUSPENDED" } });

    const reactivated = await app.inject({
      method: "PATCH",
      url: `/api/admin/tenants/${businessId}/status`,
      headers: cookieHeader(cookie),
      payload: { status: "ACTIVE", reason: "Review complete", expectedUpdatedAt: suspendedTenant.updatedAt },
    });
    expect(reactivated.statusCode, reactivated.body).toBe(200);
    expect(reactivated.json<{ tenant: { status: string } }>().tenant.status).toBe("ACTIVE");
  });

  it.each(["SUPPORT", "BILLING", "DEVELOPER"] as const)("forbids %s from tenant lifecycle writes", async (role) => {
    await seedAdmin(`${role.toLowerCase()}@tradeos.test`, role);
    const businessId = await seedTenant360();
    const cookie = adminCookie((await adminLogin(`${role.toLowerCase()}@tradeos.test`, `${role}-device`)).headers);
    const current = await tenantOverview(businessId, cookie);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/admin/tenants/${businessId}/status`,
      headers: cookieHeader(cookie),
      payload: { status: "SUSPENDED", reason: "Not permitted", expectedUpdatedAt: current.updatedAt },
    });
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json<{ error: string }>().error).toBe("ADMIN_TENANT_STATUS_FORBIDDEN");
    const stored = await pool.query<{ status: string }>("SELECT status FROM businesses WHERE id=$1", [businessId]);
    expect(stored.rows[0]?.status).toBe("ACTIVE");
  });

  it("rejects blank reason and stale expectedUpdatedAt without overwriting newer state", async () => {
    await seedAdmin("ops@tradeos.test", "OPERATIONS");
    const businessId = await seedTenant360();
    const cookie = adminCookie((await adminLogin("ops@tradeos.test", "ops-device")).headers);
    const current = await tenantOverview(businessId, cookie);

    const blank = await app.inject({
      method: "PATCH",
      url: `/api/admin/tenants/${businessId}/status`,
      headers: cookieHeader(cookie),
      payload: { status: "SUSPENDED", reason: "   ", expectedUpdatedAt: current.updatedAt },
    });
    expect(blank.statusCode, blank.body).toBe(400);
    expect(blank.json<{ error: string }>().error).toBe("ADMIN_TENANT_REASON_REQUIRED");

    await pool.query("UPDATE businesses SET updated_at=now()+interval '1 second' WHERE id=$1", [businessId]);
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/admin/tenants/${businessId}/status`,
      headers: cookieHeader(cookie),
      payload: { status: "SUSPENDED", reason: "Stale request", expectedUpdatedAt: current.updatedAt },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json<{ error: string }>().error).toBe("ADMIN_TENANT_STALE");
    const stored = await pool.query<{ status: string }>("SELECT status FROM businesses WHERE id=$1", [businessId]);
    expect(stored.rows[0]?.status).toBe("ACTIVE");
  });
});

async function seedAdmin(email: string, role: string): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
     VALUES($1,$2,$3,true,$4,now()) RETURNING id`,
    [email, `${role} Operator`, role, passwordHash],
  );
  return inserted.rows[0]!.id;
}

async function seedTenant360(): Promise<string> {
  const business = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES('Tenant 360 Ltd','RETAIL_HARDWARE','GH','GHS','Africa/Accra','ACTIVE') RETURNING id`,
  );
  const businessId = business.rows[0]!.id;
  const branches = await pool.query<{ id: string; code: string }>(
    `INSERT INTO branches(business_id,name,code,timezone,is_active) VALUES
      ($1,'Main','MAIN','Africa/Accra',true),($1,'Tema','TEMA','Africa/Accra',false)
     RETURNING id,code`, [businessId],
  );
  const mainBranchId = branches.rows.find((row) => row.code === "MAIN")!.id;

  const ownerPassword = await hashPassword("tenant-user-password");
  for (const user of [
    ["Business Owner", "owner@tenant.test", "OWNER", "ACTIVE", true],
    ["Till Cashier", "cashier@tenant.test", "CASHIER", "ACTIVE", true],
    ["Accounts Person", "accounts@tenant.test", "ACCOUNTANT", "SUSPENDED", false],
  ] as const) {
    const staff = await pool.query<{ id: string }>(
      `INSERT INTO staff(business_id,display_name,email,role,is_active) VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [businessId, user[0], user[1], user[2], user[4]],
    );
    const appUser = await pool.query<{ id: string }>(
      `INSERT INTO app_users(display_name,email,password_hash,status) VALUES($1,$2,$3,'ACTIVE') RETURNING id`,
      [user[0], user[1], ownerPassword],
    );
    await pool.query(
      `INSERT INTO business_memberships(business_id,user_id,staff_id,role,status) VALUES($1,$2,$3,$4,$5)`,
      [businessId, appUser.rows[0]!.id, staff.rows[0]!.id, user[2], user[3]],
    );
  }

  const plan = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active)
     VALUES('GROWTH','Growth','GHS',15000,'MONTHLY',14,true,true) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO business_subscriptions(business_id,plan_id,status,current_period_starts_at,current_period_ends_at)
     VALUES($1,$2,'ACTIVE',now(),now()+interval '1 month')`, [businessId, plan.rows[0]!.id],
  );
  await pool.query(
    `INSERT INTO business_entitlement_overrides(business_id,entitlement_code,entitlement_value,reason)
     VALUES($1,'AI_INSIGHTS','true'::jsonb,'Pilot')`, [businessId],
  );
  await pool.query(
    `INSERT INTO registered_devices(business_id,branch_id,device_key,platform,app_version,status,last_seen_at,last_sync_at) VALUES
      ($1,$2,'tenant-web','WEB','2.0.0','ACTIVE',now(),now()),
      ($1,$2,'tenant-pos','WINDOWS','2.0.0','ACTIVE',now()-interval '2 hours',now()-interval '2 hours')`,
    [businessId, mainBranchId],
  );
  await pool.query(
    `INSERT INTO platform_audit_events(business_id,event_type,entity_type,entity_id,reason,payload)
     VALUES($1::uuid,'TENANT_NOTE','BUSINESS',($1::uuid)::text,'Seed activity','{}'::jsonb)`, [businessId],
  );
  return businessId;
}

async function tenantOverview(businessId: string, cookie: string) {
  const response = await app.inject({ method: "GET", url: `/api/admin/tenants/${businessId}/overview`, headers: cookieHeader(cookie) });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ tenant: { updatedAt: string } }>().tenant;
}

async function adminLogin(identifier: string, deviceKey: string) {
  return app.inject({ method: "POST", url: "/api/admin/session/login", payload: { identifier, password: PASSWORD, platform: "WEB", deviceKey } });
}

function adminCookie(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["set-cookie"];
  const serialized = Array.isArray(raw) ? raw[0] : raw;
  expect(serialized).toBeTruthy();
  return serialized!.split(";", 1)[0]!;
}
function cookieHeader(cookie: string) { return { cookie }; }
