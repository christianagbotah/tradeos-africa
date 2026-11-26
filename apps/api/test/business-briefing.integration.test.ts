import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function createOwner(suffix: string) {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: "Briefing Owner",
      email: `briefing-${suffix}@tradeos.test`,
      password: "TradeOS-Test-1234",
      platform: "WEB",
      deviceKey: `briefing-${suffix}`,
      appVersion: "test",
    },
  });
  expect(registration.statusCode).toBe(201);
  const headers = { authorization: `Bearer ${registration.json().session.accessToken}` };
  const onboarding = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers,
    payload: { name: `Briefing Shop ${suffix}`, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(onboarding.statusCode).toBe(201);
  return {
    headers,
    deviceKey: `briefing-${suffix}`,
    businessId: onboarding.json().business.id as string,
    branchId: onboarding.json().branch.id as string,
  };
}

function route(businessId: string, branchId?: string, range = "today") {
  return `/v1/intelligence/briefing?businessId=${businessId}${branchId ? `&branchId=${branchId}` : ""}&range=${range}`;
}

describe("tenant business briefing", () => {
  it("provides safe low-data facts without invented actions or predictions", async () => {
    const owner = await createOwner("empty");
    const response = await app.inject({
      method: "GET",
      url: route(owner.businessId, owner.branchId),
      headers: owner.headers,
    });
    expect(response.statusCode).toBe(200);
    const briefing = response.json();
    expect(briefing).toMatchObject({
      businessId: owner.businessId,
      branchId: owner.branchId,
      range: "today",
      engine: "DETERMINISTIC_HEALTH_V1",
      dataQuality: "INSUFFICIENT",
      health: { status: "INSUFFICIENT_DATA", score: null, confidence: "LOW" },
      metrics: { salesCount: 0, netRevenueMinor: 0, operatingProfitMinor: 0 },
      actions: [],
      signals: [],
    });
    expect(briefing.currencyCode).toBe("GHS");
    expect(Date.parse(briefing.generatedAt)).not.toBeNaN();
    expect(briefing.period.timezone).toBeTruthy();
    expect((await app.inject({ method: "GET", url: route(owner.businessId, owner.branchId, "year"), headers: owner.headers })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/intelligence/briefing?businessId=invalid", headers: owner.headers })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: route(owner.businessId, owner.branchId) })).statusCode).toBe(401);
  });

  it("denies forged tenant/branch scope and cashier/viewer financial intelligence", async () => {
    const a = await createOwner("scope-a");
    const b = await createOwner("scope-b");
    expect((await app.inject({ method: "GET", url: route(b.businessId, b.branchId), headers: a.headers })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: route(a.businessId, b.branchId), headers: a.headers })).statusCode).toBe(404);

    await pool.query("UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1", [a.businessId]);
    expect((await app.inject({ method: "GET", url: route(a.businessId, a.branchId), headers: a.headers })).statusCode).toBe(403);
    await pool.query("UPDATE business_memberships SET role='VIEWER' WHERE business_id=$1", [a.businessId]);
    expect((await app.inject({ method: "GET", url: route(a.businessId, a.branchId), headers: a.headers })).statusCode).toBe(403);

    await pool.query("UPDATE business_memberships SET role='OWNER' WHERE business_id=$1", [a.businessId]);
    await pool.query("UPDATE businesses SET status='SUSPENDED' WHERE id=$1", [a.businessId]);
    expect((await app.inject({ method: "GET", url: route(a.businessId, a.branchId), headers: a.headers })).statusCode).toBe(403);
  });

  it("matches authoritative posted sales and never invents separate accounting totals", async () => {
    const owner = await createOwner("posted");
    const supplier = await app.inject({ method: "POST", url: "/v1/suppliers", headers: owner.headers,
      payload: { businessId: owner.businessId, name: "Source Supplier" } });
    expect(supplier.statusCode).toBe(201);
    const catalog = await app.inject({ method: "POST", url: "/v1/catalog/items", headers: owner.headers,
      payload: { businessId: owner.businessId, name: "One Item", kind: "PRODUCT", trackStock: true,
        stockUnitCode: "piece", units: [{ code: "piece", label: "Piece", canStock: true, canPurchase: true, canSell: true, defaultSalePriceMinor: 500 }] } });
    expect(catalog.statusCode).toBe(201);
    const itemId = catalog.json().item.id;
    const mutations = [
      { clientId: owner.deviceKey, clientMutationId: "briefing-purchase", businessId: owner.businessId,
        branchId: owner.branchId, mutationType: "PURCHASE_RECEIVE_CREATE", occurredAt: new Date().toISOString(),
        payload: { supplierId: supplier.json().supplier.id, settlementMethod: "CASH", lines: [{ itemId, purchaseUnitCode: "piece", quantity: 4, unitCostMinor: 200 }] } },
      { clientId: owner.deviceKey, clientMutationId: "briefing-sale", businessId: owner.businessId,
        branchId: owner.branchId, mutationType: "SALE_CREATE", occurredAt: new Date().toISOString(),
        payload: { paymentMethod: "CASH", lines: [{ itemId, saleUnitCode: "piece", quantity: 2 }] } },
    ];
    for (const mutation of mutations) {
      const sync = await app.inject({ method: "POST", url: "/v1/sync", headers: owner.headers, payload: { mutations: [mutation] } });
      expect(sync.statusCode).toBe(200);
      expect(sync.json().mutationResults[0].status).toBe("APPLIED");
    }

    const briefingResponse = await app.inject({
      method: "GET", url: route(owner.businessId, owner.branchId), headers: owner.headers,
    });
    const financialResponse = await app.inject({
      method: "GET",
      url: `/v1/reports/financial-summary?businessId=${owner.businessId}&branchId=${owner.branchId}&range=today`,
      headers: owner.headers,
    });
    expect(briefingResponse.statusCode).toBe(200);
    expect(financialResponse.statusCode).toBe(200);
    const briefing = briefingResponse.json(), financial = financialResponse.json();
    expect(briefing.metrics.salesCount).toBe(1);
    expect(briefing.metrics.netRevenueMinor).toBe(1000);
    expect(briefing.metrics.netRevenueMinor).toBe(financial.flow.netRevenueMinor);
    expect(briefing.metrics.operatingProfitMinor).toBe(financial.flow.operatingProfitMinor);
    expect(briefing.metrics.cashBalanceMinor).toBe(financial.position.cashBalanceMinor);
    expect(briefing.metrics.receivablesMinor).toBe(financial.position.receivablesMinor);
    expect(briefing.actions.every((a: { href: string }) => a.href.startsWith("/") && !a.href.startsWith("//"))).toBe(true);
  });
});
