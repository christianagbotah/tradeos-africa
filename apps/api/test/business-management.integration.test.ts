import { randomUUID } from "node:crypto";
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

describe("business and branch lifecycle management", () => {
  it("creates a second business for the same account with its own MAIN branch and OWNER membership", async () => {
    const owner = await register("multi-owner@tradeos.test", "multi-owner-device");
    const first = await onboard(owner.accessToken, "First Enterprise");

    const response = await app.inject({
      method: "POST",
      url: "/v1/businesses",
      headers: bearer(owner.accessToken),
      payload: {
        name: "Second Enterprise",
        businessType: "SERVICES",
        branchName: "Head Office",
        countryCode: "GH",
        currencyCode: "GHS",
        timezone: "Africa/Accra",
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    const second = response.json<{
      business: { id: string; name: string; currencyCode: string };
      branch: { id: string; code: string; name: string };
      owner: { role: string; staffId: string };
    }>();
    expect(second.business.id).not.toBe(first.businessId);
    expect(second.business).toMatchObject({ name: "Second Enterprise", currencyCode: "GHS" });
    expect(second.branch).toMatchObject({ code: "MAIN", name: "Head Office" });
    expect(second.owner.role).toBe("OWNER");

    const me = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(owner.accessToken) });
    expect(me.statusCode).toBe(200);
    const memberships = me.json<{ memberships: Array<{ businessId: string; role: string }> }>().memberships;
    expect(memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({ businessId: first.businessId, role: "OWNER" }),
      expect.objectContaining({ businessId: second.business.id, role: "OWNER" }),
    ]));

    const device = await pool.query<{ branch_id: string }>(
      "SELECT branch_id FROM registered_devices WHERE business_id=$1 AND device_key='multi-owner-device'",
      [second.business.id],
    );
    expect(device.rows[0]?.branch_id).toBe(second.branch.id);
  });

  it("creates a business with the complete profile and rolls back invalid profile data", async () => {
    const owner = await register("complete-business@tradeos.test", "complete-business-device");

    const created = await app.inject({
      method: "POST",
      url: "/v1/businesses",
      headers: bearer(owner.accessToken),
      payload: {
        name: "Complete Retail",
        legalName: "Complete Retail Limited",
        businessType: "RETAIL_HARDWARE",
        branchName: "Warehouse",
        email: "hello@complete.test",
        phone: "+233240009999",
        registrationNumber: "CS-COMPLETE-1",
        taxId: "GHA-COMPLETE-TAX",
        addressLine1: "10 Market Road",
        addressLine2: "Block B",
        city: "Accra",
        region: "Greater Accra",
        postalCode: "GA-999-0001",
        countryCode: "GH",
        currencyCode: "GHS",
        timezone: "Africa/Accra",
        logoUrl: "https://cdn.tradeos.test/logo/complete.png",
      },
    });

    expect(created.statusCode, created.body).toBe(201);
    const body = created.json<{ business: Record<string, unknown>; branch: { name: string; code: string } }>();
    expect(body.business).toMatchObject({
      name: "Complete Retail",
      legalName: "Complete Retail Limited",
      businessType: "RETAIL_HARDWARE",
      email: "hello@complete.test",
      phone: "+233240009999",
      registrationNumber: "CS-COMPLETE-1",
      taxId: "GHA-COMPLETE-TAX",
      addressLine1: "10 Market Road",
      addressLine2: "Block B",
      city: "Accra",
      region: "Greater Accra",
      postalCode: "GA-999-0001",
      countryCode: "GH",
      currencyCode: "GHS",
      timezone: "Africa/Accra",
      logoUrl: "https://cdn.tradeos.test/logo/complete.png",
    });
    expect(body.branch).toMatchObject({ name: "Warehouse", code: "MAIN" });

    const context = await app.inject({
      method: "GET",
      url: `/v1/businesses/${String(body.business.id)}/context`,
      headers: bearer(owner.accessToken),
    });
    expect(context.statusCode, context.body).toBe(200);
    expect(context.json<{ business: Record<string, unknown> }>().business).toMatchObject(body.business);

    const invalid = await app.inject({
      method: "POST",
      url: "/v1/businesses",
      headers: bearer(owner.accessToken),
      payload: {
        name: "Should Roll Back",
        businessType: "SERVICES",
        email: "not-an-email",
        countryCode: "GH",
        currencyCode: "GHS",
        timezone: "Africa/Accra",
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<{ error: string }>().error).toBe("INVALID_EMAIL");
    const leaked = await pool.query("SELECT 1 FROM businesses WHERE name='Should Roll Back'");
    expect(leaked.rowCount).toBe(0);
  });

  it("lets OWNER and ADMIN update business details while denying outsiders", async () => {
    const owner = await register("business-owner@tradeos.test", "business-owner-device");
    const created = await onboard(owner.accessToken, "Original Business");
    const admin = await register("business-admin@tradeos.test", "business-admin-device");
    await addMembership(created.businessId, admin.userId, "ADMIN", "Business Admin");
    const outsider = await register("business-outsider@tradeos.test", "business-outsider-device");

    const ownerEdit = await app.inject({
      method: "PATCH",
      url: `/v1/businesses/${created.businessId}`,
      headers: bearer(owner.accessToken),
      payload: {
        legalName: "Original Business Limited",
        email: "hello@original.test",
        phone: "+233240001111",
        registrationNumber: "CS123456",
        taxId: "GHA-TAX-001",
        addressLine1: "1 Independence Avenue",
        city: "Accra",
        region: "Greater Accra",
        postalCode: "GA-100-1000",
        logoUrl: "https://cdn.tradeos.test/logo/original.png",
      },
    });
    expect(ownerEdit.statusCode, ownerEdit.body).toBe(200);

    const adminEdit = await app.inject({
      method: "PATCH",
      url: `/v1/businesses/${created.businessId}`,
      headers: bearer(admin.accessToken),
      payload: { name: "Original Business Ghana", timezone: "Africa/Accra" },
    });
    expect(adminEdit.statusCode, adminEdit.body).toBe(200);

    const denied = await app.inject({
      method: "PATCH",
      url: `/v1/businesses/${created.businessId}`,
      headers: bearer(outsider.accessToken),
      payload: { name: "Hijacked Business" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json<{ error: string }>().error).toBe("BUSINESS_ACCESS_DENIED");

    const context = await app.inject({
      method: "GET",
      url: `/v1/businesses/${created.businessId}/context`,
      headers: bearer(owner.accessToken),
    });
    expect(context.statusCode, context.body).toBe(200);
    expect(context.json<{ business: Record<string, unknown> }>().business).toMatchObject({
      name: "Original Business Ghana",
      legalName: "Original Business Limited",
      email: "hello@original.test",
      phone: "+233240001111",
      registrationNumber: "CS123456",
      taxId: "GHA-TAX-001",
      city: "Accra",
      region: "Greater Accra",
      postalCode: "GA-100-1000",
      logoUrl: "https://cdn.tradeos.test/logo/original.png",
    });
  });

  it("allows base currency changes before activity and rejects them after business activity exists", async () => {
    const owner = await register("currency-owner@tradeos.test", "currency-owner-device");
    const created = await onboard(owner.accessToken, "Currency Business");

    const beforeActivity = await app.inject({
      method: "PATCH",
      url: `/v1/businesses/${created.businessId}`,
      headers: bearer(owner.accessToken),
      payload: { currencyCode: "NGN" },
    });
    expect(beforeActivity.statusCode, beforeActivity.body).toBe(200);
    expect(beforeActivity.json<{ business: { currencyCode: string } }>().business.currencyCode).toBe("NGN");

    await pool.query(
      `INSERT INTO sales (business_id,branch_id,status,currency_code,client_mutation_id)
       VALUES ($1,$2,'COMPLETED','NGN',$3)`,
      [created.businessId, created.branchId, `history-${randomUUID()}`],
    );

    const afterActivity = await app.inject({
      method: "PATCH",
      url: `/v1/businesses/${created.businessId}`,
      headers: bearer(owner.accessToken),
      payload: { currencyCode: "GHS" },
    });
    expect(afterActivity.statusCode).toBe(409);
    expect(afterActivity.json<{ error: string }>().error).toBe("BASE_CURRENCY_LOCKED");
  });

  it("creates and edits branches with unique immutable codes", async () => {
    const owner = await register("branch-owner@tradeos.test", "branch-owner-device");
    const created = await onboard(owner.accessToken, "Branch Business");

    const added = await app.inject({
      method: "POST",
      url: `/v1/businesses/${created.businessId}/branches`,
      headers: bearer(owner.accessToken),
      payload: {
        name: "Tema Community 25",
        code: "TEMA25",
        timezone: "Africa/Accra",
        phone: "+233240002222",
        email: "tema@branch.test",
        addressLine1: "Community 25",
        city: "Tema",
        region: "Greater Accra",
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    const branch = added.json<{ branch: { id: string; code: string } }>().branch;
    expect(branch.code).toBe("TEMA25");

    const edited = await app.inject({
      method: "PATCH",
      url: `/v1/businesses/${created.businessId}/branches/${branch.id}`,
      headers: bearer(owner.accessToken),
      payload: { name: "Tema C25", phone: "+233240002223" },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json<{ branch: Record<string, unknown> }>().branch).toMatchObject({
      name: "Tema C25",
      code: "TEMA25",
      phone: "+233240002223",
    });

    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/businesses/${created.businessId}/branches`,
      headers: bearer(owner.accessToken),
      payload: { name: "Duplicate Tema", code: "TEMA25", timezone: "Africa/Accra" },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json<{ error: string }>().error).toBe("BRANCH_CODE_EXISTS");
  });

  it("generates a branch code when omitted and protects the last active branch", async () => {
    const owner = await register("branch-state@tradeos.test", "branch-state-device");
    const created = await onboard(owner.accessToken, "Branch State Business");

    const lastActive = await app.inject({
      method: "POST",
      url: `/v1/businesses/${created.businessId}/branches/${created.branchId}/deactivate`,
      headers: bearer(owner.accessToken),
    });
    expect(lastActive.statusCode).toBe(409);
    expect(lastActive.json<{ error: string }>().error).toBe("LAST_ACTIVE_BRANCH");

    const added = await app.inject({
      method: "POST",
      url: `/v1/businesses/${created.businessId}/branches`,
      headers: bearer(owner.accessToken),
      payload: { name: "Kasoa New Market", timezone: "Africa/Accra" },
    });
    expect(added.statusCode, added.body).toBe(201);
    const branch = added.json<{ branch: { id: string; code: string; active: boolean } }>().branch;
    expect(branch.code).toMatch(/^KASOA-NEW-MARKET(?:-\d+)?$/);
    expect(branch.active).toBe(true);

    const deactivated = await app.inject({
      method: "POST",
      url: `/v1/businesses/${created.businessId}/branches/${branch.id}/deactivate`,
      headers: bearer(owner.accessToken),
    });
    expect(deactivated.statusCode, deactivated.body).toBe(200);
    expect(deactivated.json<{ branch: { active: boolean } }>().branch.active).toBe(false);

    const reactivated = await app.inject({
      method: "POST",
      url: `/v1/businesses/${created.businessId}/branches/${branch.id}/reactivate`,
      headers: bearer(owner.accessToken),
    });
    expect(reactivated.statusCode, reactivated.body).toBe(200);
    expect(reactivated.json<{ branch: { active: boolean } }>().branch.active).toBe(true);

    const audit = await pool.query<{ event_type: string }>(
      "SELECT event_type FROM audit_events WHERE business_id=$1 ORDER BY occurred_at",
      [created.businessId],
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining([
      "BRANCH_CREATED",
      "BRANCH_DEACTIVATED",
      "BRANCH_REACTIVATED",
    ]));
  });
});

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: "Test Owner",
      email,
      password: PASSWORD,
      platform: "WEB",
      deviceKey,
      appVersion: "test-1.0.0",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json<{ user: { id: string }; session: { accessToken: string } }>();
  return { userId: body.user.id, accessToken: body.session.accessToken };
}

async function onboard(accessToken: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers: bearer(accessToken),
    payload: { name, businessType: "SERVICES", branchName: "Main", countryCode: "GH", currencyCode: "GHS", timezone: "Africa/Accra" },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json<{ business: { id: string }; branch: { id: string }; owner: { staffId: string } }>();
  return { businessId: body.business.id, branchId: body.branch.id, staffId: body.owner.staffId };
}

async function addMembership(businessId: string, userId: string, role: "ADMIN", displayName: string) {
  const staffId = randomUUID();
  await pool.query(
    "INSERT INTO staff(id,business_id,display_name,role) VALUES($1,$2,$3,$4)",
    [staffId, businessId, displayName, role],
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
