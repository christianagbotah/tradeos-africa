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
  await pool.query("TRUNCATE TABLE platform_admin_sessions,platform_audit_events,platform_users CASCADE");
});
afterAll(async () => { await app.close(); await pool.end(); });

describe("platform administrator lifecycle and RBAC", () => {
  it("lists only safe administrator metadata and creates credential-less admins only as SUPER_ADMIN", async () => {
    const superId = await seedAdmin("owner@tradeos.test", "SUPER_ADMIN", true, true);
    const supportCookie = await loginAs("support@tradeos.test", "SUPPORT");
    const superCookie = await loginExisting("owner@tradeos.test");

    const forbidden = await app.inject({
      method: "POST", url: "/api/admin/admins", headers: jsonHeaders(supportCookie),
      payload: { email: "new-admin@tradeos.test", displayName: "New Admin", role: "OPERATIONS", reason: "Need an operations admin" },
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    expect(forbidden.json<{ error: string }>().error).toBe("ADMIN_USER_WRITE_FORBIDDEN");

    const created = await app.inject({
      method: "POST", url: "/api/admin/admins", headers: jsonHeaders(superCookie),
      payload: { email: " NEW.ADMIN@TradeOS.Test ", displayName: " New Admin ", role: "OPERATIONS", reason: "Need an operations admin" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const createdAdmin = created.json<{ admin: Record<string, unknown> }>().admin;
    expect(createdAdmin).toMatchObject({ email: "new.admin@tradeos.test", displayName: "New Admin", role: "OPERATIONS", active: true, credentialProvisioned: false });
    expect(JSON.stringify(createdAdmin)).not.toMatch(/password|hash|token/i);

    const list = await app.inject({ method: "GET", url: "/api/admin/admins", headers: cookieHeader(superCookie) });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json<{ admins: Array<Record<string, unknown>> }>().admins).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: superId, email: "owner@tradeos.test", role: "SUPER_ADMIN", credentialProvisioned: true }),
      expect.objectContaining({ email: "new.admin@tradeos.test", role: "OPERATIONS", credentialProvisioned: false }),
    ]));
    expect(list.body).not.toMatch(/password_hash|session_token_hash|scrypt:v1/i);

    const stored = await pool.query<{ password_hash: string | null }>("SELECT password_hash FROM platform_users WHERE lower(email)='new.admin@tradeos.test'");
    expect(stored.rows[0]?.password_hash).toBeNull();
    const audit = await pool.query<{ platform_user_id: string | null; event_type: string }>("SELECT platform_user_id,event_type FROM platform_audit_events WHERE event_type='PLATFORM_ADMIN_CREATED'");
    expect(audit.rows).toEqual(expect.arrayContaining([expect.objectContaining({ platform_user_id: superId, event_type: "PLATFORM_ADMIN_CREATED" })]));
  });

  it("changes roles and activation only for SUPER_ADMIN and revokes sessions on deactivation", async () => {
    const superCookie = await loginAs("security-owner@tradeos.test", "SUPER_ADMIN");
    const targetId = await seedAdmin("ops-admin@tradeos.test", "OPERATIONS", true, true);
    const targetCookie = await loginExisting("ops-admin@tradeos.test");
    const supportCookie = await loginAs("security-support@tradeos.test", "SUPPORT");

    const forbidden = await app.inject({ method: "PATCH", url: `/api/admin/admins/${targetId}/role`, headers: jsonHeaders(supportCookie), payload: { role: "BILLING", reason: "Unauthorized role change" } });
    expect(forbidden.statusCode, forbidden.body).toBe(403);

    const roleChange = await app.inject({ method: "PATCH", url: `/api/admin/admins/${targetId}/role`, headers: jsonHeaders(superCookie), payload: { role: "BILLING", reason: "Move administrator to billing operations" } });
    expect(roleChange.statusCode, roleChange.body).toBe(200);
    expect(roleChange.json<{ admin: { role: string } }>().admin.role).toBe("BILLING");

    const disabled = await app.inject({ method: "PATCH", url: `/api/admin/admins/${targetId}/status`, headers: jsonHeaders(superCookie), payload: { active: false, reason: "Administrator left operations" } });
    expect(disabled.statusCode, disabled.body).toBe(200);
    expect(disabled.json<{ admin: { active: boolean } }>().admin.active).toBe(false);

    const afterDeactivate = await app.inject({ method: "GET", url: "/api/admin/session/me", headers: cookieHeader(targetCookie) });
    expect(afterDeactivate.statusCode).toBe(401);
    const sessions = await pool.query<{ revoked_at: Date | null }>("SELECT revoked_at FROM platform_admin_sessions WHERE platform_user_id=$1", [targetId]);
    expect(sessions.rows.length).toBeGreaterThan(0);
    expect(sessions.rows.every((row) => row.revoked_at instanceof Date)).toBe(true);
  });

  it("serializes concurrent removals so two SUPER_ADMINs can never remove the last active super admin", async () => {
    const adminAId = await seedAdmin("super-a@tradeos.test", "SUPER_ADMIN", true, true);
    const adminBId = await seedAdmin("super-b@tradeos.test", "SUPER_ADMIN", true, true);
    const cookieA = await loginExisting("super-a@tradeos.test");
    const cookieB = await loginExisting("super-b@tradeos.test");

    const [demoteB, deactivateA] = await Promise.all([
      app.inject({ method: "PATCH", url: `/api/admin/admins/${adminBId}/role`, headers: jsonHeaders(cookieA), payload: { role: "SUPPORT", reason: "Concurrent invariant test A" } }),
      app.inject({ method: "PATCH", url: `/api/admin/admins/${adminAId}/status`, headers: jsonHeaders(cookieB), payload: { active: false, reason: "Concurrent invariant test B" } }),
    ]);

    const statuses = [demoteB.statusCode, deactivateA.statusCode];
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.some((status) => status === 409 || status === 403)).toBe(true);
    const activeSupers = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM platform_users WHERE role='SUPER_ADMIN' AND is_active=true");
    expect(Number(activeSupers.rows[0]!.count)).toBe(1);
    const rejection = [demoteB, deactivateA].find((response) => response.statusCode !== 200)!;
    if (rejection.statusCode === 409) expect(rejection.json<{ error: string }>().error).toBe("ADMIN_LAST_SUPER_ADMIN");
  });

  it("rejects demoting or deactivating the sole active SUPER_ADMIN", async () => {
    const soleId = await seedAdmin("sole-super@tradeos.test", "SUPER_ADMIN", true, true);
    const cookie = await loginExisting("sole-super@tradeos.test");
    for (const request of [
      { url: `/api/admin/admins/${soleId}/role`, payload: { role: "PLATFORM_ADMIN", reason: "Must retain a super admin" } },
      { url: `/api/admin/admins/${soleId}/status`, payload: { active: false, reason: "Must retain a super admin" } },
    ]) {
      const response = await app.inject({ method: "PATCH", url: request.url, headers: jsonHeaders(cookie), payload: request.payload });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json<{ error: string }>().error).toBe("ADMIN_LAST_SUPER_ADMIN");
    }
  });
});

async function seedAdmin(email: string, role: string, active = true, withCredential = true): Promise<string> {
  const passwordHash = withCredential ? await hashPassword(PASSWORD) : null;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
     VALUES($1,$2,$3,$4,$5,CASE WHEN $5::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
    [email, `${role} Operator`, role, active, passwordHash],
  );
  return inserted.rows[0]!.id;
}
async function loginAs(email: string, role: string): Promise<string> { await seedAdmin(email, role, true, true); return loginExisting(email); }
async function loginExisting(email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/admin/session/login", payload: { identifier: email, password: PASSWORD, platform: "WEB", deviceKey: `device-${email}` } });
  expect(response.statusCode, response.body).toBe(200);
  return adminCookie(response.headers);
}
function adminCookie(headers: Record<string, string | string[] | undefined>): string { const raw=headers["set-cookie"]; const serialized=Array.isArray(raw)?raw[0]:raw; expect(serialized).toBeTruthy(); return serialized!.split(";",1)[0]!; }
function cookieHeader(cookie:string){return{cookie};}
function jsonHeaders(cookie:string){return{cookie,"content-type":"application/json"};}
