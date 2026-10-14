import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
const PASSWORD = "correct-horse-123";

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users, businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("staff invitation registration", () => {
  it("creates the invited account, activates membership and issues a normal session", async () => {
    const owner = await register("registration-owner@tradeos.test", "registration-owner-device");
    const business = await onboard(owner.accessToken, "Registration Business");
    const staffId = await createStaff(owner.accessToken, business.businessId, "new.staff@tradeos.test", "CASHIER");
    const token = await invite(owner.accessToken, business.businessId, staffId);

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/staff/invitations/accept/register",
      payload: {
        acceptanceToken: token,
        displayName: "New Staff Account",
        password: PASSWORD,
        platform: "WEB",
        deviceKey: "new-staff-device",
        appVersion: "test-1.0.0",
      },
    });
    expect(accepted.statusCode, accepted.body).toBe(201);
    const body = accepted.json<{
      user: { id: string; email: string | null; phoneE164: string | null };
      session: { accessToken: string; refreshToken: string };
      acceptance: { businessId: string; staffId: string; role: string };
    }>();
    expect(body.user.email).toBe("new.staff@tradeos.test");
    expect(body.acceptance).toMatchObject({ businessId: business.businessId, staffId, role: "CASHIER" });
    expect(body.session.accessToken).toMatch(/^tos_access_/);
    expect(body.session.refreshToken).toMatch(/^tos_refresh_/);

    const membership = await pool.query<{ staff_id: string; role: string; status: string }>(
      "SELECT staff_id,role,status FROM business_memberships WHERE business_id=$1 AND user_id=$2",
      [business.businessId, body.user.id],
    );
    expect(membership.rows[0]).toMatchObject({ staff_id: staffId, role: "CASHIER", status: "ACTIVE" });

    const me = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(body.session.accessToken) });
    expect(me.statusCode, me.body).toBe(200);
  });

  it("rejects an invited identifier that already belongs to an account and leaves the invite pending", async () => {
    const owner = await register("existing-owner@tradeos.test", "existing-owner-device");
    const business = await onboard(owner.accessToken, "Existing Identifier Business");
    await register("existing.staff@tradeos.test", "existing-staff-device");
    const staffId = await createStaff(owner.accessToken, business.businessId, "existing.staff@tradeos.test", "VIEWER");
    const token = await invite(owner.accessToken, business.businessId, staffId);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/invitations/accept/register",
      payload: {
        acceptanceToken: token,
        displayName: "Existing Staff",
        password: PASSWORD,
        platform: "WEB",
        deviceKey: "duplicate-device",
        appVersion: "test-1.0.0",
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: string }>().error).toBe("ACCOUNT_EXISTS");
    const inviteRow = await pool.query<{ status: string }>("SELECT status FROM staff_invitations WHERE staff_id=$1", [staffId]);
    expect(inviteRow.rows[0]?.status).toBe("PENDING");
  });

  it("reuses normal client validation before accepting the invitation", async () => {
    const owner = await register("validation-owner@tradeos.test", "validation-owner-device");
    const business = await onboard(owner.accessToken, "Validation Business");
    const staffId = await createStaff(owner.accessToken, business.businessId, "validation.staff@tradeos.test", "STAFF");
    const token = await invite(owner.accessToken, business.businessId, staffId);

    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/invitations/accept/register",
      payload: {
        acceptanceToken: token,
        displayName: "Validation Staff",
        password: PASSWORD,
        platform: "UNKNOWN",
        deviceKey: "validation-device",
        appVersion: "test-1.0.0",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe("INVALID_PLATFORM");
  });
});

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: { displayName: "Registration Test User", email, password: PASSWORD, platform: "WEB", deviceKey, appVersion: "test-1.0.0" },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json<{ user: { id: string }; session: { accessToken: string } }>();
  return { userId: body.user.id, accessToken: body.session.accessToken };
}

async function onboard(accessToken: string, name: string) {
  const response = await app.inject({
    method: "POST", url: "/v1/onboarding/business", headers: bearer(accessToken),
    payload: { name, businessType: "SERVICES", branchName: "Main", countryCode: "GH", currencyCode: "GHS", timezone: "Africa/Accra" },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json<{ business: { id: string } }>();
  return { businessId: body.business.id };
}

async function createStaff(accessToken: string, businessId: string, email: string, role: string) {
  const response = await app.inject({
    method: "POST", url: "/v1/staff", headers: bearer(accessToken),
    payload: { businessId, displayName: "Invited Staff", email, role },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ staff: { id: string } }>().staff.id;
}

async function invite(accessToken: string, businessId: string, staffId: string) {
  const response = await app.inject({
    method: "POST", url: `/v1/staff/${staffId}/invitations`, headers: bearer(accessToken), payload: { businessId },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ acceptanceToken: string }>().acceptanceToken;
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
