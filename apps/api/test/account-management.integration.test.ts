import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
const PASSWORD = "correct-horse-123";

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE app_users, businesses CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("account profile and security management", () => {
  it("updates the signed-in user's display name and avatar without changing login identity", async () => {
    const account = await register({ email: "profile@tradeos.test", phone: "+233240000101", deviceKey: "profile-device" });

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: bearer(account.accessToken),
      payload: { displayName: "Ama Profile", avatarUrl: "https://cdn.tradeos.test/avatar/ama.png" },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ user: Record<string, unknown> }>().user).toMatchObject({
      displayName: "Ama Profile",
      email: "profile@tradeos.test",
      phoneE164: "+233240000101",
      avatarUrl: "https://cdn.tradeos.test/avatar/ama.png",
    });

    const me = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(account.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ user: Record<string, unknown> }>().user).toMatchObject({
      displayName: "Ama Profile",
      avatarUrl: "https://cdn.tradeos.test/avatar/ama.png",
    });
  });

  it("requires the current password for email or phone changes and preserves uniqueness", async () => {
    const account = await register({ email: "identity@tradeos.test", phone: "+233240000102", deviceKey: "identity-device" });
    await register({ email: "taken@tradeos.test", phone: "+233240000199", deviceKey: "taken-device" });

    const withoutPassword = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: bearer(account.accessToken),
      payload: { email: "new-identity@tradeos.test" },
    });
    expect(withoutPassword.statusCode).toBe(400);
    expect(withoutPassword.json<{ error: string }>().error).toBe("CURRENT_PASSWORD_REQUIRED");

    const wrongPassword = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: bearer(account.accessToken),
      payload: { email: "new-identity@tradeos.test", currentPassword: "wrong-password" },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json<{ error: string }>().error).toBe("CURRENT_PASSWORD_REJECTED");

    const collision = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: bearer(account.accessToken),
      payload: { email: "taken@tradeos.test", currentPassword: PASSWORD },
    });
    expect(collision.statusCode).toBe(409);
    expect(collision.json<{ error: string }>().error).toBe("ACCOUNT_EXISTS");

    const accepted = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: bearer(account.accessToken),
      payload: { email: "new-identity@tradeos.test", phone: null, currentPassword: PASSWORD },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json<{ user: Record<string, unknown> }>().user).toMatchObject({
      email: "new-identity@tradeos.test",
      phoneE164: null,
    });
  });

  it("never allows a profile update to remove every login identifier", async () => {
    const account = await register({ email: "only-email@tradeos.test", deviceKey: "only-email-device" });

    const response = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: bearer(account.accessToken),
      payload: { email: null, currentPassword: PASSWORD },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe("IDENTIFIER_REQUIRED");
    const row = await pool.query<{ email: string | null }>("SELECT email FROM app_users WHERE id=$1", [account.userId]);
    expect(row.rows[0]?.email).toBe("only-email@tradeos.test");
  });

  it("changes password while preserving the current session and revoking other sessions by default", async () => {
    const account = await register({ email: "password@tradeos.test", deviceKey: "password-current" });
    const other = await login("password@tradeos.test", PASSWORD, "password-other");

    const changed = await app.inject({
      method: "POST",
      url: "/v1/auth/change-password",
      headers: bearer(account.accessToken),
      payload: { currentPassword: PASSWORD, newPassword: "new-secure-password-456" },
    });
    expect(changed.statusCode, changed.body).toBe(204);

    const currentMe = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(account.accessToken) });
    expect(currentMe.statusCode).toBe(200);
    const otherMe = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(other.accessToken) });
    expect(otherMe.statusCode).toBe(401);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: loginPayload("password@tradeos.test", PASSWORD, "old-password-device"),
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: loginPayload("password@tradeos.test", "new-secure-password-456", "new-password-device"),
    });
    expect(newLogin.statusCode, newLogin.body).toBe(200);
  });

  it("lists sessions, revokes one owned session, and can revoke every other session", async () => {
    const account = await register({ email: "sessions@tradeos.test", deviceKey: "session-current" });
    const second = await login("sessions@tradeos.test", PASSWORD, "session-second");
    const third = await login("sessions@tradeos.test", PASSWORD, "session-third");

    const listed = await app.inject({ method: "GET", url: "/v1/auth/sessions", headers: bearer(account.accessToken) });
    expect(listed.statusCode, listed.body).toBe(200);
    const sessions = listed.json<{ sessions: Array<{ id: string; deviceKey: string; current: boolean }> }>().sessions;
    expect(sessions).toHaveLength(3);
    expect(sessions.find((session) => session.deviceKey === "session-current")?.current).toBe(true);
    const secondId = sessions.find((session) => session.deviceKey === "session-second")?.id;
    expect(secondId).toBeTruthy();

    const revoked = await app.inject({
      method: "DELETE",
      url: `/v1/auth/sessions/${secondId}`,
      headers: bearer(account.accessToken),
    });
    expect(revoked.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: bearer(second.accessToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: bearer(third.accessToken) })).statusCode).toBe(200);

    const allOthers = await app.inject({
      method: "POST",
      url: "/v1/auth/sessions/revoke-others",
      headers: bearer(account.accessToken),
    });
    expect(allOthers.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: bearer(third.accessToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: bearer(account.accessToken) })).statusCode).toBe(200);

    const audit = await pool.query<{ event_type: string; payload: Record<string, unknown> }>(
      "SELECT event_type,payload FROM account_security_events WHERE user_id=$1 ORDER BY occurred_at",
      [account.userId],
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining([
      "SESSION_REVOKED",
      "OTHER_SESSIONS_REVOKED",
    ]));
    expect(JSON.stringify(audit.rows)).not.toContain(PASSWORD);
  });
});

async function register(input: { email?: string; phone?: string; deviceKey: string }) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: "Test Owner",
      email: input.email,
      phone: input.phone,
      password: PASSWORD,
      platform: "WEB",
      deviceKey: input.deviceKey,
      appVersion: "test-1.0.0",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json<{ user: { id: string }; session: { accessToken: string; refreshToken: string } }>();
  return { userId: body.user.id, ...body.session };
}

async function login(identifier: string, password: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: loginPayload(identifier, password, deviceKey),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ session: { accessToken: string; refreshToken: string } }>().session;
}

function loginPayload(identifier: string, password: string, deviceKey: string) {
  return { identifier, password, platform: "WEB", deviceKey, appVersion: "test-1.0.0" };
}

function bearer(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}
