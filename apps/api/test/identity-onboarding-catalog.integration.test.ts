import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

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

describe("identity, onboarding and flexible-unit catalog", () => {
  it("registers an owner, creates a business/catalog and sells a glass from ml stock", async () => {
    const owner = await register("owner@tradeos.test", "owner-device");

    const businessResponse = await app.inject({
      method: "POST",
      url: "/v1/onboarding/business",
      headers: bearer(owner.accessToken),
      payload: {
        name: "Accra Test Spot",
        businessType: "DRINKING_SPOT",
        branchName: "Osu Main",
      },
    });
    expect(businessResponse.statusCode).toBe(201);
    const businessBody = businessResponse.json<{
      business: { id: string };
      branch: { id: string };
      owner: { role: string };
    }>();
    expect(businessBody.owner.role).toBe("OWNER");

    const catalogResponse = await app.inject({
      method: "POST",
      url: "/v1/catalog/items",
      headers: bearer(owner.accessToken),
      payload: {
        businessId: businessBody.business.id,
        name: "750ml Whisky",
        sku: "WHISKY-750",
        kind: "PRODUCT",
        trackStock: true,
        stockUnitCode: "ml",
        units: [
          { code: "ml", label: "Millilitre", canStock: true },
          { code: "bottle", label: "Bottle", canPurchase: true, canSell: true, defaultSalePriceMinor: 15000 },
          { code: "glass", label: "Glass", canSell: true, defaultSalePriceMinor: 1800 },
        ],
        conversions: [
          { fromUnitCode: "bottle", toUnitCode: "ml", factor: 750 },
          { fromUnitCode: "glass", toUnitCode: "ml", factor: 50 },
        ],
        openingStock: { branchId: businessBody.branch.id, quantity: 750 },
      },
    });
    expect(catalogResponse.statusCode).toBe(201);
    const catalogBody = catalogResponse.json<{ item: { id: string } }>();

    const saleResponse = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: bearer(owner.accessToken),
      payload: {
        mutations: [{
          clientId: "owner-device",
          clientMutationId: "mobile-sale-001",
          businessId: businessBody.business.id,
          branchId: businessBody.branch.id,
          mutationType: "SALE_CREATE",
          occurredAt: new Date().toISOString(),
          payload: {
            currencyCode: "GHS",
            paymentMethod: "CASH",
            lines: [{ itemId: catalogBody.item.id, quantity: 2, saleUnitCode: "glass" }],
          },
        }],
      },
    });
    expect(saleResponse.statusCode).toBe(200);
    expect(saleResponse.json<{ mutationResults: Array<{ status: string }> }>().mutationResults[0]?.status).toBe("APPLIED");

    const stock = await pool.query<{ available: string }>(
      `SELECT COALESCE(SUM(quantity_delta),0)::text AS available
       FROM inventory_movements
       WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 AND location_type='AVAILABLE'`,
      [businessBody.business.id, businessBody.branch.id, catalogBody.item.id],
    );
    expect(Number(stock.rows[0]?.available)).toBe(650);

    const me = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(owner.accessToken) });
    expect(me.statusCode).toBe(200);
    const meBody = me.json<{ client: { platform: string; appVersion: string }; memberships: Array<{ businessId: string; role: string }> }>();
    expect(meBody.client).toEqual({ platform: "WEB", deviceKey: "owner-device", appVersion: "test-1.0.0" });
    expect(meBody.memberships).toContainEqual(expect.objectContaining({ businessId: businessBody.business.id, role: "OWNER" }));
  });

  it("rejects a tracked sell unit that cannot convert to the stock unit", async () => {
    const owner = await register("hardware@tradeos.test", "hardware-device");
    const created = await createBusiness(owner.accessToken, "Hardware Test", "RETAIL_HARDWARE");

    const response = await app.inject({
      method: "POST",
      url: "/v1/catalog/items",
      headers: bearer(owner.accessToken),
      payload: {
        businessId: created.businessId,
        name: "Iron Rod",
        kind: "PRODUCT",
        trackStock: true,
        stockUnitCode: "kg",
        units: [
          { code: "kg", label: "Kilogram", canStock: true, canPurchase: true },
          { code: "piece", label: "Piece", canSell: true, defaultSalePriceMinor: 9500 },
        ],
        conversions: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe("CONVERSION_PATH_REQUIRED");
  });

  it("prevents another tenant user from reading or syncing against the owner's business", async () => {
    const owner = await register("tenant-owner@tradeos.test", "owner-tenant-device");
    const outsider = await register("outsider@tradeos.test", "outsider-device");
    const created = await createBusiness(owner.accessToken, "Tenant A", "FOOD");

    const catalogRead = await app.inject({
      method: "GET",
      url: `/v1/catalog/items?businessId=${created.businessId}`,
      headers: bearer(outsider.accessToken),
    });
    expect(catalogRead.statusCode).toBe(403);

    const sync = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: bearer(outsider.accessToken),
      payload: {
        mutations: [{
          clientId: "outsider-device",
          clientMutationId: "cross-tenant-sale",
          businessId: created.businessId,
          branchId: created.branchId,
          mutationType: "SALE_CREATE",
          occurredAt: new Date().toISOString(),
          payload: { lines: [] },
        }],
      },
    });
    expect(sync.statusCode).toBe(403);
    expect(sync.json<{ error: string }>().error).toBe("BUSINESS_ACCESS_DENIED");
  });

  it("rejects a sync mutation whose client id does not match the authenticated device", async () => {
    const owner = await register("device-owner@tradeos.test", "known-device");
    const created = await createBusiness(owner.accessToken, "Device Test", "SERVICES");

    const response = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: bearer(owner.accessToken),
      payload: {
        mutations: [{
          clientId: "spoofed-device",
          clientMutationId: "spoofed-sale",
          businessId: created.businessId,
          branchId: created.branchId,
          mutationType: "SALE_CREATE",
          occurredAt: new Date().toISOString(),
          payload: { lines: [] },
        }],
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: string }>().error).toBe("DEVICE_MISMATCH");
  });

  it("rotates refresh tokens and revokes the previous access session", async () => {
    const owner = await register("refresh@tradeos.test", "refresh-device");

    const refresh = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: owner.refreshToken },
    });
    expect(refresh.statusCode).toBe(200);
    const refreshed = refresh.json<{ session: { accessToken: string; refreshToken: string } }>().session;
    expect(refreshed.accessToken).not.toBe(owner.accessToken);
    expect(refreshed.refreshToken).not.toBe(owner.refreshToken);

    const oldMe = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(owner.accessToken) });
    expect(oldMe.statusCode).toBe(401);

    const newMe = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(refreshed.accessToken) });
    expect(newMe.statusCode).toBe(200);
  });
});

async function register(email: string, deviceKey: string): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: "Test Owner",
      email,
      password: "TradeOS-Test-1234",
      platform: "WEB",
      deviceKey,
      appVersion: "test-1.0.0",
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ session: { accessToken: string; refreshToken: string } }>().session;
}

async function createBusiness(accessToken: string, name: string, businessType: string): Promise<{ businessId: string; branchId: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers: bearer(accessToken),
    payload: { name, businessType },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{ business: { id: string }; branch: { id: string } }>();
  return { businessId: body.business.id, branchId: body.branch.id };
}

function bearer(accessToken: string): { authorization: string } {
  return { authorization: `Bearer ${accessToken}` };
}
