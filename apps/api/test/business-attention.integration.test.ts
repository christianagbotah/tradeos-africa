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

describe("deterministic business attention", () => {
  it("creates evidence-backed low-data attention once and updates it on reevaluation", async () => {
    const tenant = await createTenant("attention-owner@tradeos.test", "Attention Shop");
    const headers = authHeaders(tenant.token);

    const first = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "manual:first" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        ruleCode: "LOW_DATA_CONFIDENCE",
        state: "OPEN",
      }),
    ]));

    const lowData = first.json().items.find((item: { ruleCode: string }) => item.ruleCode === "LOW_DATA_CONFIDENCE");
    expect(lowData.sourceKey).toBe(`low-data:${tenant.branchId}`);
    expect(lowData.evidence.length).toBeGreaterThan(0);

    const second = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "manual:second" },
    });
    expect(second.statusCode).toBe(200);
    const lowDataAgain = second.json().items.find((item: { ruleCode: string }) => item.ruleCode === "LOW_DATA_CONFIDENCE");
    expect(lowDataAgain.id).toBe(lowData.id);

    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM business_attention_items
       WHERE business_id=$1 AND branch_id=$2 AND rule_code='LOW_DATA_CONFIDENCE' AND state='OPEN'`,
      [tenant.businessId, tenant.branchId],
    );
    expect(count.rows[0]?.count).toBe("1");

    const listed = await app.inject({
      method: "GET",
      url: `/v1/intelligence/attention?businessId=${tenant.businessId}&branchId=${tenant.branchId}`,
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.some((item: { id: string }) => item.id === lowData.id)).toBe(true);
  });

  it("rejects forged tenant scopes before returning or evaluating attention", async () => {
    const tenantA = await createTenant("attention-a@tradeos.test", "Tenant A");
    const tenantB = await createTenant("attention-b@tradeos.test", "Tenant B");
    const headersA = authHeaders(tenantA.token);

    const listed = await app.inject({
      method: "GET",
      url: `/v1/intelligence/attention?businessId=${tenantB.businessId}&branchId=${tenantB.branchId}`,
      headers: headersA,
    });
    expect(listed.statusCode).toBe(403);

    const evaluated = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers: headersA,
      payload: { businessId: tenantB.businessId, branchId: tenantB.branchId },
    });
    expect(evaluated.statusCode).toBe(403);
  });
});

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createTenant(email: string, businessName: string): Promise<Tenant> {
  const register = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "StrongPass123!", name: businessName },
  });
  expect(register.statusCode).toBe(201);
  const body = register.json();
  return {
    token: body.accessToken,
    userId: body.user.id,
    businessId: body.business.id,
    branchId: body.branch.id,
  };
}
