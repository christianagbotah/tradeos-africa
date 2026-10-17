import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

type Tenant = { token: string; userId: string; businessId: string; branchId: string };

describe("business daily briefing", () => {
  it("returns a deterministic evidence-backed low-data briefing with the planned sections", async () => {
    const tenant = await createTenant("briefing-owner@tradeos.test", "Briefing Shop");
    const response = await app.inject({
      method: "GET",
      url: `/v1/intelligence/briefing?businessId=${tenant.businessId}&branchId=${tenant.branchId}&range=today`,
      headers: authHeaders(tenant.token),
    });

    expectStatusWithBody(response, 200, "owner briefing");
    const body = response.json();
    expect(body).toEqual(expect.objectContaining({
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      range: "today",
      confidence: expect.objectContaining({ level: "LOW" }),
      dataQuality: expect.objectContaining({ completedSales30d: 0, sufficientForTrends: false }),
      generatedAt: expect.any(String),
    }));
    expect(body.headline.toLowerCase()).toContain("limited");
    expect(body.evidence.length).toBeGreaterThan(0);

    const codes = body.sections.map((section: { code: string }) => section.code);
    expect(codes).toEqual(expect.arrayContaining([
      "URGENT",
      "SALES",
      "CASH",
      "CUSTOMERS_CREDIT",
      "SUPPLIERS_PAYABLES",
      "INVENTORY",
      "OPPORTUNITIES",
    ]));

    const urgent = body.sections.find((section: { code: string }) => section.code === "URGENT");
    expect(urgent.attentionItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: "LOW_DATA_CONFIDENCE" }),
    ]));
  });

  it("rejects a branch that belongs to another business before composing facts", async () => {
    const tenantA = await createTenant("briefing-a@tradeos.test", "Briefing A");
    const tenantB = await createTenant("briefing-b@tradeos.test", "Briefing B");

    const response = await app.inject({
      method: "GET",
      url: `/v1/intelligence/briefing?businessId=${tenantA.businessId}&branchId=${tenantB.branchId}&range=week`,
      headers: authHeaders(tenantA.token),
    });

    expectStatusWithBody(response, 404, "cross-business branch briefing");
    expect(response.json().error).toBe("BRANCH_NOT_FOUND");
  });

  it("keeps the financial briefing restricted to financial-management roles", async () => {
    const tenant = await createTenant("briefing-cashier@tradeos.test", "Cashier Briefing Shop");
    await pool.query(
      `UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1 AND user_id=$2 AND status='ACTIVE'`,
      [tenant.businessId, tenant.userId],
    );

    const response = await app.inject({
      method: "GET",
      url: `/v1/intelligence/briefing?businessId=${tenant.businessId}&branchId=${tenant.branchId}&range=month`,
      headers: authHeaders(tenant.token),
    });

    expectStatusWithBody(response, 403, "cashier briefing");
    expect(response.json().error).toBe("ROLE_FORBIDDEN");
  });
});

async function createTenant(email: string, name: string): Promise<Tenant> {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: name,
      email,
      password: "TradeOS-Test-1234",
      platform: "WEB",
      deviceKey: `device-${email}`,
      appVersion: "test",
    },
  });
  expectStatusWithBody(registration, 201, "tenant registration");
  const body = registration.json();
  const token = body.session.accessToken as string;
  const userId = body.user.id as string;

  const onboard = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers: authHeaders(token),
    payload: { name, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expectStatusWithBody(onboard, 201, "tenant onboarding");
  return {
    token,
    userId,
    businessId: onboard.json().business.id,
    branchId: onboard.json().branch.id,
  };
}

function expectStatusWithBody(response: { statusCode: number; body: string }, expected: number, label: string): void {
  if (response.statusCode !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.statusCode}; body=${response.body}`);
  }
  expect(response.statusCode).toBe(expected);
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}
