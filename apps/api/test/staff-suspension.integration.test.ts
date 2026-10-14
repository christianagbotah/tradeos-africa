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

describe("staff suspension and reactivation", () => {
  it("suspends only this business access, revokes pending invites, then reactivates a suspended membership", async () => {
    const owner = await register("suspend-owner@tradeos.test", "suspend-owner-device");
    const business = await onboard(owner.accessToken, "Suspend Business");
    const worker = await register("suspend-worker@tradeos.test", "suspend-worker-device");
    const staffId = await addMembership(business.businessId, worker.userId, "CASHIER", "Suspend Worker", "suspend-worker@tradeos.test");
    await pool.query(
      `INSERT INTO staff_invitations(business_id,staff_id,invited_email,role,token_hash,status,expires_at,created_by_user_id,created_by_staff_id)
       VALUES($1,$2,$3,'CASHIER',$4,'PENDING',now()+interval '72 hours',$5,$6)`,
      [business.businessId, staffId, "suspend-worker@tradeos.test", "a".repeat(64), owner.userId, business.staffId],
    );

    const suspended = await app.inject({
      method: "POST", url: `/v1/staff/${staffId}/suspend`, headers: bearer(owner.accessToken), payload: { businessId: business.businessId },
    });
    expect(suspended.statusCode, suspended.body).toBe(200);
    expect(suspended.json<{ staff: { active: boolean; access: { membershipStatus: string | null } } }>().staff)
      .toMatchObject({ active: false, access: { membershipStatus: "SUSPENDED" } });

    const invite = await pool.query<{ status: string }>("SELECT status FROM staff_invitations WHERE staff_id=$1", [staffId]);
    expect(invite.rows[0]?.status).toBe("REVOKED");
    const globalMe = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(worker.accessToken) });
    expect(globalMe.statusCode, globalMe.body).toBe(200);
    const businessDenied = await app.inject({
      method: "GET", url: `/v1/businesses/${business.businessId}/context`, headers: bearer(worker.accessToken),
    });
    expect(businessDenied.statusCode).toBe(403);

    const reactivated = await app.inject({
      method: "POST", url: `/v1/staff/${staffId}/reactivate`, headers: bearer(owner.accessToken), payload: { businessId: business.businessId },
    });
    expect(reactivated.statusCode, reactivated.body).toBe(200);
    expect(reactivated.json<{ staff: { active: boolean; access: { membershipStatus: string | null } } }>().staff)
      .toMatchObject({ active: true, access: { membershipStatus: "ACTIVE" } });
  });

  it("prevents ADMIN from suspending privileged staff and protects the last active OWNER", async () => {
    const owner = await register("owner-guard@tradeos.test", "owner-guard-device");
    const business = await onboard(owner.accessToken, "Owner Guard Business");
    const admin = await register("admin-guard@tradeos.test", "admin-guard-device");
    const adminStaffId = await addMembership(business.businessId, admin.userId, "ADMIN", "Guard Admin", "admin-guard@tradeos.test");

    const adminVsOwner = await app.inject({
      method: "POST", url: `/v1/staff/${business.staffId}/suspend`, headers: bearer(admin.accessToken), payload: { businessId: business.businessId },
    });
    expect(adminVsOwner.statusCode).toBe(403);
    expect(adminVsOwner.json<{ error: string }>().error).toBe("STAFF_ROLE_FORBIDDEN");

    const ownerVsLastOwner = await app.inject({
      method: "POST", url: `/v1/staff/${business.staffId}/suspend`, headers: bearer(owner.accessToken), payload: { businessId: business.businessId },
    });
    expect(ownerVsLastOwner.statusCode).toBe(409);
    expect(ownerVsLastOwner.json<{ error: string }>().error).toBe("LAST_OWNER_REQUIRED");

    const adminSelf = await app.inject({
      method: "POST", url: `/v1/staff/${adminStaffId}/suspend`, headers: bearer(admin.accessToken), payload: { businessId: business.businessId },
    });
    expect(adminSelf.statusCode).toBe(403);
  });

  it("serializes concurrent OWNER suspension so at least one active owner remains", async () => {
    const ownerA = await register("owner-a@tradeos.test", "owner-a-device");
    const business = await onboard(ownerA.accessToken, "Concurrent Owner Business");
    const ownerB = await register("owner-b@tradeos.test", "owner-b-device");
    const ownerBStaffId = await addMembership(business.businessId, ownerB.userId, "OWNER", "Owner B", "owner-b@tradeos.test");

    const [aSuspendsB, bSuspendsA] = await Promise.all([
      app.inject({ method: "POST", url: `/v1/staff/${ownerBStaffId}/suspend`, headers: bearer(ownerA.accessToken), payload: { businessId: business.businessId } }),
      app.inject({ method: "POST", url: `/v1/staff/${business.staffId}/suspend`, headers: bearer(ownerB.accessToken), payload: { businessId: business.businessId } }),
    ]);
    const statuses = [aSuspendsB.statusCode, bSuspendsA.statusCode].sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    const rejected = aSuspendsB.statusCode === 200 ? bSuspendsA : aSuspendsB;
    expect(["BUSINESS_ACCESS_DENIED", "LAST_OWNER_REQUIRED"]).toContain(rejected.json<{ error: string }>().error);
    const owners = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM business_memberships WHERE business_id=$1 AND role='OWNER' AND status='ACTIVE'",
      [business.businessId],
    );
    expect(Number(owners.rows[0]?.count ?? 0)).toBe(1);
  });
});

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: { displayName: "Staff Suspension User", email, password: PASSWORD, platform: "WEB", deviceKey, appVersion: "test-1.0.0" },
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

async function addMembership(businessId: string, userId: string, role: "OWNER" | "ADMIN" | "CASHIER", displayName: string, email: string) {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO staff(business_id,display_name,email,role) VALUES($1,$2,$3,$4) RETURNING id",
    [businessId, displayName, email, role],
  );
  const staffId = result.rows[0]!.id;
  await pool.query(
    `INSERT INTO business_memberships(business_id,user_id,staff_id,role,status,created_by_user_id)
     VALUES($1,$2,$3,$4,'ACTIVE',$2)`,
    [businessId, userId, staffId, role],
  );
  return staffId;
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
