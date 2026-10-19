import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("business attention", () => {
  it("evaluates a new business conservatively and returns low-data confidence instead of invented trends", async () => {
    const owner = await registerOwner("attention-owner");
    const tenant = await onboard(owner.headers, "New AI Shop");

    const evaluated = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers: owner.headers,
      payload: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        correlationId: "attention:new-business:1",
      },
    });

    expect(evaluated.statusCode).toBe(200);
    const body = evaluated.json() as { items: Array<Record<string, unknown>> };
    const lowData = body.items.find((item) => item.ruleCode === "LOW_DATA_CONFIDENCE");
    expect(lowData).toMatchObject({
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      ruleCode: "LOW_DATA_CONFIDENCE",
      state: "OPEN",
    });
    expect(lowData?.evidence).toEqual(expect.any(Array));
    expect(JSON.stringify(lowData)).not.toMatch(/sales (fell|dropped|grew|increased)/i);

    const listed = await app.inject({
      method: "GET",
      url: `/v1/intelligence/attention?businessId=${tenant.businessId}&branchId=${tenant.branchId}`,
      headers: owner.headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: "LOW_DATA_CONFIDENCE", businessId: tenant.businessId }),
    ]));
  });

  it("denies a forged business scope before evaluating or listing another tenant's facts", async () => {
    const ownerA = await registerOwner("attention-a");
    const tenantA = await onboard(ownerA.headers, "Tenant A");
    const ownerB = await registerOwner("attention-b");
    const tenantB = await onboard(ownerB.headers, "Tenant B");

    const evaluateOther = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers: ownerA.headers,
      payload: {
        businessId: tenantB.businessId,
        branchId: tenantB.branchId,
        correlationId: "attention:forged-scope",
      },
    });
    expect(evaluateOther.statusCode).toBe(403);
    expect(evaluateOther.json()).toMatchObject({ error: "BUSINESS_ACCESS_DENIED" });

    const listOther = await app.inject({
      method: "GET",
      url: `/v1/intelligence/attention?businessId=${tenantB.businessId}&branchId=${tenantB.branchId}`,
      headers: ownerA.headers,
    });
    expect(listOther.statusCode).toBe(403);
    expect(listOther.json()).toMatchObject({ error: "BUSINESS_ACCESS_DENIED" });

    const own = await app.inject({
      method: "GET",
      url: `/v1/intelligence/attention?businessId=${tenantA.businessId}&branchId=${tenantA.branchId}`,
      headers: ownerA.headers,
    });
    expect(own.statusCode).toBe(200);
  });

  it("deduplicates an unchanged signal instead of creating a new open attention row", async () => {
    const owner = await registerOwner("attention-dedupe");
    const tenant = await onboard(owner.headers, "Dedupe Shop");

    for (const correlationId of ["attention:dedupe:1", "attention:dedupe:2"]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/intelligence/attention/evaluate",
        headers: owner.headers,
        payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId },
      });
      expect(response.statusCode).toBe(200);
    }

    const rows = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM business_attention_items
       WHERE business_id=$1 AND branch_id=$2 AND rule_code='LOW_DATA_CONFIDENCE' AND state='OPEN'`,
      [tenant.businessId, tenant.branchId],
    );
    expect(rows.rows[0]?.count).toBe("1");
  });
});

async function registerOwner(prefix: string): Promise<{ headers: { authorization: string } }> {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: "AI Owner",
      email: `${prefix}-${crypto.randomUUID()}@tradeos.test`,
      password: "TradeOS-Test-1234",
      platform: "WEB",
      deviceKey: `${prefix}-${crypto.randomUUID()}`,
      appVersion: "test",
    },
  });
  expect(registration.statusCode).toBe(201);
  return { headers: { authorization: `Bearer ${registration.json().session.accessToken}` } };
}

async function onboard(
  headers: { authorization: string },
  name: string,
): Promise<{ businessId: string; branchId: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers,
    payload: { name, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(response.statusCode).toBe(201);
  return { businessId: response.json().business.id, branchId: response.json().branch.id };
}
