import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword, verifyPassword } from "../src/auth/security.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
const PASSWORD = "admin-password-123";
const NEW_PASSWORD = "new-platform-password-456";

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE platform_admin_sessions, platform_audit_events, platform_users CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("platform administrator profile and security", () => {
  it("returns only safe profile identity fields", async () => {
    await seedAdmin("profile@tradeos.test", "Profile Operator");
    const login = await adminLogin("profile@tradeos.test", "profile-device");
    const cookie = adminCookie(login.headers);

    const response = await app.inject({ method: "GET", url: "/api/admin/profile", headers: cookieHeader(cookie) });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ profile: Record<string, unknown> }>();
    expect(body.profile).toMatchObject({
      email: "profile@tradeos.test",
      displayName: "Profile Operator",
      role: "SUPER_ADMIN",
    });
    expect(body.profile.id).toEqual(expect.any(String));
    expect(body.profile.lastLoginAt).toEqual(expect.any(String));
    expect(Object.keys(body.profile).sort()).toEqual(["displayName", "email", "id", "lastLoginAt", "role"]);
    expect(JSON.stringify(body)).not.toMatch(/password|session[_-]?token|token[_-]?hash/i);
  });

  it("normalizes profile updates, enforces unique email, and audits the mutation", async () => {
    const adminId = await seedAdmin("edit-profile@tradeos.test", "Before Name");
    await seedAdmin("taken@tradeos.test", "Taken Name");
    const login = await adminLogin("edit-profile@tradeos.test", "edit-device");
    const cookie = adminCookie(login.headers);

    const updated = await app.inject({
      method: "PATCH",
      url: "/api/admin/profile",
      headers: cookieHeader(cookie),
      payload: { email: "  NEW.EMAIL@TradeOS.Test  ", displayName: "  Updated Operator  " },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json<{ profile: Record<string, unknown> }>().profile).toMatchObject({
      id: adminId,
      email: "new.email@tradeos.test",
      displayName: "Updated Operator",
      role: "SUPER_ADMIN",
    });

    const stored = await pool.query<{ email: string; display_name: string }>(
      "SELECT email,display_name FROM platform_users WHERE id=$1",
      [adminId],
    );
    expect(stored.rows[0]).toEqual({ email: "new.email@tradeos.test", display_name: "Updated Operator" });

    const audit = await pool.query<{ event_type: string; entity_id: string | null; payload: Record<string, unknown> }>(
      "SELECT event_type,entity_id,payload FROM platform_audit_events WHERE platform_user_id=$1 AND event_type='ADMIN_PROFILE_UPDATED'",
      [adminId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]).toMatchObject({ event_type: "ADMIN_PROFILE_UPDATED", entity_id: adminId });
    expect(audit.rows[0]?.payload).toMatchObject({
      previous: { email: "edit-profile@tradeos.test", displayName: "Before Name" },
      next: { email: "new.email@tradeos.test", displayName: "Updated Operator" },
    });

    const conflict = await app.inject({
      method: "PATCH",
      url: "/api/admin/profile",
      headers: cookieHeader(cookie),
      payload: { email: "TAKEN@TRADEOS.TEST", displayName: "Should Not Persist" },
    });
    expect(conflict.statusCode, conflict.body).toBe(409);
    expect(conflict.json<{ error: string }>().error).toBe("ADMIN_EMAIL_CONFLICT");

    const afterConflict = await pool.query<{ email: string; display_name: string }>(
      "SELECT email,display_name FROM platform_users WHERE id=$1",
      [adminId],
    );
    expect(afterConflict.rows[0]).toEqual({ email: "new.email@tradeos.test", display_name: "Updated Operator" });
  });

  it("changes password only with the current password and revokes every other active session", async () => {
    const adminId = await seedAdmin("password@tradeos.test", "Password Operator");
    const firstLogin = await adminLogin("password@tradeos.test", "current-device");
    const currentCookie = adminCookie(firstLogin.headers);
    await adminLogin("password@tradeos.test", "other-device");

    const wrong = await app.inject({
      method: "POST",
      url: "/api/admin/profile/password",
      headers: cookieHeader(currentCookie),
      payload: { currentPassword: "wrong-current-password", newPassword: NEW_PASSWORD },
    });
    expect(wrong.statusCode, wrong.body).toBe(400);
    expect(wrong.json<{ error: string }>().error).toBe("ADMIN_CURRENT_PASSWORD_INVALID");

    const changed = await app.inject({
      method: "POST",
      url: "/api/admin/profile/password",
      headers: cookieHeader(currentCookie),
      payload: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(changed.statusCode, changed.body).toBe(204);

    const stored = await pool.query<{ password_hash: string; password_changed_at: Date | null }>(
      "SELECT password_hash,password_changed_at FROM platform_users WHERE id=$1",
      [adminId],
    );
    expect(stored.rows[0]?.password_hash).toMatch(/^scrypt:v1:/);
    expect(await verifyPassword(NEW_PASSWORD, stored.rows[0]!.password_hash)).toBe(true);
    expect(await verifyPassword(PASSWORD, stored.rows[0]!.password_hash)).toBe(false);
    expect(stored.rows[0]?.password_changed_at).toBeInstanceOf(Date);

    const sessions = await pool.query<{ device_key: string; revoked_at: Date | null }>(
      "SELECT device_key,revoked_at FROM platform_admin_sessions WHERE platform_user_id=$1 ORDER BY device_key",
      [adminId],
    );
    expect(sessions.rows).toEqual([
      { device_key: "current-device", revoked_at: null },
      { device_key: "other-device", revoked_at: expect.any(Date) },
    ]);

    const stillAuthenticated = await app.inject({ method: "GET", url: "/api/admin/profile", headers: cookieHeader(currentCookie) });
    expect(stillAuthenticated.statusCode, stillAuthenticated.body).toBe(200);

    const oldRejected = await adminLogin("password@tradeos.test", "old-password-check", PASSWORD);
    expect(oldRejected.statusCode).toBe(401);
    const newAccepted = await adminLogin("password@tradeos.test", "new-password-check", NEW_PASSWORD);
    expect(newAccepted.statusCode, newAccepted.body).toBe(200);

    const audit = await pool.query("SELECT 1 FROM platform_audit_events WHERE platform_user_id=$1 AND event_type='ADMIN_PASSWORD_CHANGED'", [adminId]);
    expect(audit.rowCount).toBe(1);
  });

  it("lists only own sessions, marks the current session, and cannot revoke another administrator session", async () => {
    const adminId = await seedAdmin("sessions@tradeos.test", "Session Operator");
    await seedAdmin("other-admin@tradeos.test", "Other Admin");
    const currentLogin = await adminLogin("sessions@tradeos.test", "session-current");
    const cookie = adminCookie(currentLogin.headers);
    await adminLogin("sessions@tradeos.test", "session-other");
    await adminLogin("other-admin@tradeos.test", "foreign-session");

    const listed = await app.inject({ method: "GET", url: "/api/admin/profile/sessions", headers: cookieHeader(cookie) });
    expect(listed.statusCode, listed.body).toBe(200);
    const body = listed.json<{ sessions: Array<{ id: string; deviceKey: string; current: boolean; revokedAt: string | null }> }>();
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ deviceKey: "session-current", current: true, revokedAt: null }),
      expect.objectContaining({ deviceKey: "session-other", current: false, revokedAt: null }),
    ]));
    expect(JSON.stringify(body)).not.toMatch(/token|hash/i);

    const ownOther = body.sessions.find((session) => session.deviceKey === "session-other");
    expect(ownOther?.id).toEqual(expect.any(String));
    const revokedOwn = await app.inject({
      method: "DELETE",
      url: `/api/admin/profile/sessions/${ownOther!.id}`,
      headers: cookieHeader(cookie),
    });
    expect(revokedOwn.statusCode, revokedOwn.body).toBe(204);

    const foreign = await pool.query<{ id: string }>(
      "SELECT s.id FROM platform_admin_sessions s JOIN platform_users u ON u.id=s.platform_user_id WHERE lower(u.email)='other-admin@tradeos.test' AND s.device_key='foreign-session'",
    );
    const rejectedForeign = await app.inject({
      method: "DELETE",
      url: `/api/admin/profile/sessions/${foreign.rows[0]!.id}`,
      headers: cookieHeader(cookie),
    });
    expect(rejectedForeign.statusCode, rejectedForeign.body).toBe(404);
    expect(rejectedForeign.json<{ error: string }>().error).toBe("ADMIN_SESSION_NOT_FOUND");

    const sessionRows = await pool.query<{ device_key: string; revoked_at: Date | null }>(
      "SELECT device_key,revoked_at FROM platform_admin_sessions WHERE platform_user_id=$1 ORDER BY device_key",
      [adminId],
    );
    expect(sessionRows.rows).toEqual([
      { device_key: "session-current", revoked_at: null },
      { device_key: "session-other", revoked_at: expect.any(Date) },
    ]);
  });
});

async function seedAdmin(email: string, displayName: string): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
     VALUES($1,$2,'SUPER_ADMIN',true,$3,now()) RETURNING id`,
    [email, displayName, passwordHash],
  );
  return inserted.rows[0]!.id;
}

async function adminLogin(identifier: string, deviceKey: string, password = PASSWORD) {
  return app.inject({
    method: "POST",
    url: "/api/admin/session/login",
    payload: { identifier, password, platform: "WEB", deviceKey },
  });
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
