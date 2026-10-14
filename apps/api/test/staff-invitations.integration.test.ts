import { createHash, randomUUID } from "node:crypto";
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

describe("staff invitations", () => {
  it("stores only a hash, expires in 72 hours and revokes the previous pending invitation", async () => {
    const owner = await register("invite-owner@tradeos.test", "invite-owner-device");
    const business = await onboard(owner.accessToken, "Invite Business");
    const staffId = await createStaff(owner.accessToken, business.businessId, {
      displayName: "Ama Invite", email: "ama.invite@tradeos.test", role: "CASHIER",
    });

    const first = await invite(owner.accessToken, business.businessId, staffId);
    expect(first.statusCode, first.body).toBe(201);
    const firstBody = first.json<{ invitation: { id: string; status: string; expiresAt: string }; acceptanceToken: string }>();
    expect(firstBody.invitation.status).toBe("PENDING");
    expect(firstBody.acceptanceToken.length).toBeGreaterThan(40);
    const hours = (Date.parse(firstBody.invitation.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);

    const stored = await pool.query<{ token_hash: string }>("SELECT token_hash FROM staff_invitations WHERE id=$1", [firstBody.invitation.id]);
    expect(stored.rows[0]?.token_hash).toBe(createHash("sha256").update(firstBody.acceptanceToken).digest("hex"));
    expect(stored.rows[0]?.token_hash).not.toBe(firstBody.acceptanceToken);

    const second = await invite(owner.accessToken, business.businessId, staffId);
    expect(second.statusCode, second.body).toBe(201);
    const statuses = await pool.query<{ id: string; status: string }>(
      "SELECT id,status FROM staff_invitations WHERE staff_id=$1 ORDER BY created_at",
      [staffId],
    );
    expect(statuses.rows.map((row) => row.status)).toEqual(["REVOKED", "PENDING"]);

    const audits = await pool.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM audit_events WHERE business_id=$1 AND event_type IN ('STAFF_INVITED','STAFF_INVITATION_REVOKED')",
      [business.businessId],
    );
    const auditText = JSON.stringify(audits.rows);
    expect(auditText).not.toContain(firstBody.acceptanceToken);
    expect(auditText).not.toContain(stored.rows[0]!.token_hash);
  });

  it("accepts an invitation for the matching existing account and is idempotent for that same user", async () => {
    const owner = await register("accept-owner@tradeos.test", "accept-owner-device");
    const business = await onboard(owner.accessToken, "Accept Business");
    const invitedUser = await register("accept-user@tradeos.test", "accept-user-device");
    const outsider = await register("accept-outsider@tradeos.test", "accept-outsider-device");
    const staffId = await createStaff(owner.accessToken, business.businessId, {
      displayName: "Accept User", email: "accept-user@tradeos.test", role: "SALES",
    });
    const invitation = await invite(owner.accessToken, business.businessId, staffId);
    const token = invitation.json<{ acceptanceToken: string }>().acceptanceToken;

    const mismatch = await app.inject({
      method: "POST", url: "/v1/staff/invitations/accept", headers: bearer(outsider.accessToken),
      payload: { acceptanceToken: token },
    });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json<{ error: string }>().error).toBe("INVITATION_IDENTITY_MISMATCH");

    const accepted = await app.inject({
      method: "POST", url: "/v1/staff/invitations/accept", headers: bearer(invitedUser.accessToken),
      payload: { acceptanceToken: token },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json<{ acceptance: Record<string, unknown> }>().acceptance)
      .toMatchObject({ businessId: business.businessId, staffId, role: "SALES" });

    const membership = await pool.query<{ user_id: string; staff_id: string; role: string; status: string }>(
      "SELECT user_id,staff_id,role,status FROM business_memberships WHERE business_id=$1 AND user_id=$2",
      [business.businessId, invitedUser.userId],
    );
    expect(membership.rows[0]).toMatchObject({ user_id: invitedUser.userId, staff_id: staffId, role: "SALES", status: "ACTIVE" });

    const secondAccept = await app.inject({
      method: "POST", url: "/v1/staff/invitations/accept", headers: bearer(invitedUser.accessToken),
      payload: { acceptanceToken: token },
    });
    expect(secondAccept.statusCode, secondAccept.body).toBe(200);

    const invitationRow = await pool.query<{ status: string; accepted_by_user_id: string }>(
      "SELECT status,accepted_by_user_id FROM staff_invitations WHERE staff_id=$1",
      [staffId],
    );
    expect(invitationRow.rows[0]).toMatchObject({ status: "ACCEPTED", accepted_by_user_id: invitedUser.userId });
  });

  it("rejects expired or stale invitations and refuses to rebind an existing business member", async () => {
    const owner = await register("edge-owner@tradeos.test", "edge-owner-device");
    const business = await onboard(owner.accessToken, "Invite Edge Business");
    const target = await register("edge-user@tradeos.test", "edge-user-device");

    const expiredStaff = await createStaff(owner.accessToken, business.businessId, {
      displayName: "Expired User", email: "edge-user@tradeos.test", role: "VIEWER",
    });
    const expiredInvite = await invite(owner.accessToken, business.businessId, expiredStaff);
    const expiredToken = expiredInvite.json<{ acceptanceToken: string }>().acceptanceToken;
    await pool.query("UPDATE staff_invitations SET expires_at=now()-interval '1 minute' WHERE staff_id=$1", [expiredStaff]);
    const expired = await app.inject({
      method: "POST", url: "/v1/staff/invitations/accept", headers: bearer(target.accessToken),
      payload: { acceptanceToken: expiredToken },
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json<{ error: string }>().error).toBe("INVITATION_EXPIRED");

    const staleStaff = await createStaff(owner.accessToken, business.businessId, {
      displayName: "Stale User", email: "edge-user@tradeos.test", role: "CASHIER",
    });
    const staleInvite = await invite(owner.accessToken, business.businessId, staleStaff);
    const staleToken = staleInvite.json<{ acceptanceToken: string }>().acceptanceToken;
    await pool.query("UPDATE staff SET role='SALES',updated_at=now() WHERE id=$1", [staleStaff]);
    const stale = await app.inject({
      method: "POST", url: "/v1/staff/invitations/accept", headers: bearer(target.accessToken),
      payload: { acceptanceToken: staleToken },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: string }>().error).toBe("INVITATION_INVALID");

    const linkedStaff = await addMembership(business.businessId, target.userId, "CASHIER", "Existing Link", "edge-user@tradeos.test");
    const otherStaff = await createStaff(owner.accessToken, business.businessId, {
      displayName: "Other Staff", email: "edge-user@tradeos.test", role: "STAFF",
    });
    const conflictInvite = await invite(owner.accessToken, business.businessId, otherStaff);
    const conflictToken = conflictInvite.json<{ acceptanceToken: string }>().acceptanceToken;
    const conflict = await app.inject({
      method: "POST", url: "/v1/staff/invitations/accept", headers: bearer(target.accessToken),
      payload: { acceptanceToken: conflictToken },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<{ error: string }>().error).toBe("USER_ALREADY_MEMBER");
    const stillLinked = await pool.query<{ staff_id: string }>(
      "SELECT staff_id FROM business_memberships WHERE business_id=$1 AND user_id=$2",
      [business.businessId, target.userId],
    );
    expect(stillLinked.rows[0]?.staff_id).toBe(linkedStaff);
  });
});

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: { displayName: "Invite Test User", email, password: PASSWORD, platform: "WEB", deviceKey, appVersion: "test-1.0.0" },
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
  const body = response.json<{ business: { id: string }; owner: { staffId: string } }>();
  return { businessId: body.business.id, staffId: body.owner.staffId };
}

async function createStaff(
  accessToken: string,
  businessId: string,
  input: { displayName: string; email?: string; phone?: string; role: string },
) {
  const response = await app.inject({
    method: "POST", url: "/v1/staff", headers: bearer(accessToken),
    payload: { businessId, ...input },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ staff: { id: string } }>().staff.id;
}

function invite(accessToken: string, businessId: string, staffId: string) {
  return app.inject({
    method: "POST",
    url: `/v1/staff/${staffId}/invitations`,
    headers: bearer(accessToken),
    payload: { businessId },
  });
}

async function addMembership(
  businessId: string,
  userId: string,
  role: "CASHIER",
  displayName: string,
  email: string,
) {
  const staffId = randomUUID();
  await pool.query(
    "INSERT INTO staff(id,business_id,display_name,email,role) VALUES($1,$2,$3,$4,$5)",
    [staffId, businessId, displayName, email, role],
  );
  await pool.query(
    `INSERT INTO business_memberships(business_id,user_id,staff_id,role,status,created_by_user_id)
     VALUES($1,$2,$3,$4,'ACTIVE',$2)`,
    [businessId, userId, staffId, role],
  );
  return staffId;
}

function bearer(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}
