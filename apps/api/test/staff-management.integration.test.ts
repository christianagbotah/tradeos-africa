import { randomUUID } from "node:crypto";
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

describe("staff directory and management authorization", () => {
  it("lets OWNER create/list/update staff without creating accounts and keeps linked access synchronized", async () => {
    const owner = await register("staff-owner@tradeos.test", "staff-owner-device");
    const business = await onboard(owner.accessToken, "Staff Owner Business");

    const created = await app.inject({
      method: "POST", url: "/v1/staff", headers: bearer(owner.accessToken),
      payload: {
        businessId: business.businessId, displayName: "Ama Cashier",
        email: "AMA.CASHIER@tradeos.test", phone: "+233240001234", role: "CASHIER",
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const staff = created.json<{ staff: { id: string; email: string; phone: string; role: string; active: boolean } }>().staff;
    expect(staff).toMatchObject({ email: "ama.cashier@tradeos.test", phone: "+233240001234", role: "CASHIER", active: true });

    expect((await pool.query("SELECT 1 FROM app_users WHERE lower(email)='ama.cashier@tradeos.test'")).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM business_memberships WHERE staff_id=$1", [staff.id])).rowCount).toBe(0);

    const listed = await app.inject({
      method: "GET", url: `/v1/staff?businessId=${business.businessId}`, headers: bearer(owner.accessToken),
    });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ staff: Array<{ id: string; access: { membershipStatus: string | null } }> }>().staff)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: staff.id, access: expect.objectContaining({ membershipStatus: null }) })]));

    const linkedUser = await register("linked-cashier@tradeos.test", "linked-cashier-device");
    const linkedStaffId = await addMembership(business.businessId, linkedUser.userId, "CASHIER", "Linked Cashier", {
      email: "linked-cashier@tradeos.test",
    });
    await pool.query(
      `INSERT INTO staff_invitations(
         business_id,staff_id,invited_email,role,token_hash,status,expires_at,created_by_user_id,created_by_staff_id
       ) VALUES($1,$2,$3,'CASHIER',$4,'PENDING',now()+interval '72 hours',$5,$6)`,
      [business.businessId, linkedStaffId, "linked-cashier@tradeos.test", "a".repeat(64), owner.userId, business.staffId],
    );

    const updated = await app.inject({
      method: "PATCH", url: `/v1/staff/${linkedStaffId}`, headers: bearer(owner.accessToken),
      payload: { businessId: business.businessId, email: "linked-sales@tradeos.test", role: "SALES" },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json<{ staff: { role: string; email: string } }>().staff)
      .toMatchObject({ role: "SALES", email: "linked-sales@tradeos.test" });

    const membership = await pool.query<{ role: string }>(
      "SELECT role FROM business_memberships WHERE business_id=$1 AND staff_id=$2",
      [business.businessId, linkedStaffId],
    );
    expect(membership.rows[0]?.role).toBe("SALES");
    const invitation = await pool.query<{ status: string }>("SELECT status FROM staff_invitations WHERE staff_id=$1", [linkedStaffId]);
    expect(invitation.rows[0]?.status).toBe("REVOKED");

    const audits = await pool.query<{ event_type: string; payload: Record<string, unknown> }>(
      "SELECT event_type,payload FROM audit_events WHERE business_id=$1 AND entity_type='STAFF' ORDER BY occurred_at",
      [business.businessId],
    );
    expect(audits.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining(["STAFF_CREATED", "STAFF_ROLE_CHANGED"]));
    expect(JSON.stringify(audits.rows)).not.toContain("a".repeat(64));
  });

  it("enforces OWNER/ADMIN/MANAGER/lower-role staff permissions server-side", async () => {
    const owner = await register("role-owner@tradeos.test", "role-owner-device");
    const business = await onboard(owner.accessToken, "Role Matrix Business");
    const admin = await register("role-admin@tradeos.test", "role-admin-device");
    const manager = await register("role-manager@tradeos.test", "role-manager-device");
    const cashier = await register("role-cashier@tradeos.test", "role-cashier-device");
    await addMembership(business.businessId, admin.userId, "ADMIN", "Business Admin", { email: "role-admin@tradeos.test" });
    await addMembership(business.businessId, manager.userId, "MANAGER", "Business Manager", { email: "role-manager@tradeos.test" });
    await addMembership(business.businessId, cashier.userId, "CASHIER", "Business Cashier", { email: "role-cashier@tradeos.test" });

    const adminCreate = await app.inject({
      method: "POST", url: "/v1/staff", headers: bearer(admin.accessToken),
      payload: { businessId: business.businessId, displayName: "Sales User", role: "SALES" },
    });
    expect(adminCreate.statusCode, adminCreate.body).toBe(201);

    const adminPrivileged = await app.inject({
      method: "POST", url: "/v1/staff", headers: bearer(admin.accessToken),
      payload: { businessId: business.businessId, displayName: "Another Admin", role: "ADMIN" },
    });
    expect(adminPrivileged.statusCode).toBe(403);
    expect(adminPrivileged.json<{ error: string }>().error).toBe("STAFF_ROLE_FORBIDDEN");

    const adminOwnerEdit = await app.inject({
      method: "PATCH", url: `/v1/staff/${business.staffId}`, headers: bearer(admin.accessToken),
      payload: { businessId: business.businessId, displayName: "Cannot Rename Owner" },
    });
    expect(adminOwnerEdit.statusCode).toBe(403);
    expect(adminOwnerEdit.json<{ error: string }>().error).toBe("STAFF_ROLE_FORBIDDEN");

    const managerList = await app.inject({
      method: "GET", url: `/v1/staff?businessId=${business.businessId}`, headers: bearer(manager.accessToken),
    });
    expect(managerList.statusCode, managerList.body).toBe(200);

    const managerCreate = await app.inject({
      method: "POST", url: "/v1/staff", headers: bearer(manager.accessToken),
      payload: { businessId: business.businessId, displayName: "No Mutation", role: "VIEWER" },
    });
    expect(managerCreate.statusCode).toBe(403);

    const cashierList = await app.inject({
      method: "GET", url: `/v1/staff?businessId=${business.businessId}`, headers: bearer(cashier.accessToken),
    });
    expect(cashierList.statusCode).toBe(403);
  });

  it("denies staff reads and mutations across business boundaries", async () => {
    const ownerA = await register("tenant-a@tradeos.test", "tenant-a-device");
    const businessA = await onboard(ownerA.accessToken, "Tenant A");
    const ownerB = await register("tenant-b@tradeos.test", "tenant-b-device");
    const businessB = await onboard(ownerB.accessToken, "Tenant B");

    const read = await app.inject({
      method: "GET", url: `/v1/staff?businessId=${businessB.businessId}`, headers: bearer(ownerA.accessToken),
    });
    expect(read.statusCode).toBe(403);

    const create = await app.inject({
      method: "POST", url: "/v1/staff", headers: bearer(ownerA.accessToken),
      payload: { businessId: businessB.businessId, displayName: "Cross Tenant", role: "STAFF" },
    });
    expect(create.statusCode).toBe(403);

    const update = await app.inject({
      method: "PATCH", url: `/v1/staff/${businessB.staffId}`, headers: bearer(ownerA.accessToken),
      payload: { businessId: businessB.businessId, displayName: "Cross Tenant Rename" },
    });
    expect(update.statusCode).toBe(403);

    const untouched = await pool.query<{ display_name: string }>("SELECT display_name FROM staff WHERE id=$1", [businessB.staffId]);
    expect(untouched.rows[0]?.display_name).toBe("Test Owner");
    expect(businessA.businessId).not.toBe(businessB.businessId);
  });
});

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: {
      displayName: "Test Owner", email, password: PASSWORD,
      platform: "WEB", deviceKey, appVersion: "test-1.0.0",
    },
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
  const body = response.json<{ business: { id: string }; branch: { id: string }; owner: { staffId: string } }>();
  return { businessId: body.business.id, branchId: body.branch.id, staffId: body.owner.staffId };
}

async function addMembership(
  businessId: string, userId: string, role: "ADMIN" | "MANAGER" | "CASHIER",
  displayName: string, contact: { email?: string; phone?: string } = {},
) {
  const staffId = randomUUID();
  await pool.query(
    "INSERT INTO staff(id,business_id,display_name,email,phone,role) VALUES($1,$2,$3,$4,$5,$6)",
    [staffId, businessId, displayName, contact.email ?? null, contact.phone ?? null, role],
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
