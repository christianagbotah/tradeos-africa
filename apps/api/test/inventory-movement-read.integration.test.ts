import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("inventory movement read model", () => {
  it("returns branch-scoped movement evidence and full derived balances without leaking another branch or tenant", async () => {
    const owner = await register("inventory-read-owner@tradeos.test", "inventory-read-device", "Inventory Owner");
    const primary = await createBusiness(owner.accessToken, "Inventory Read A");
    const actor = (await pool.query<{ staff_id: string; display_name: string }>(
      `SELECT bm.staff_id,st.display_name FROM business_memberships bm JOIN staff st ON st.id=bm.staff_id WHERE bm.business_id=$1`,
      [primary.businessId],
    )).rows[0]!;
    const item = await createProduct(owner.accessToken, primary.businessId, "Tracked Cement");
    const secondBranch = (await pool.query<{ id: string }>(
      `INSERT INTO branches (business_id,name,code) VALUES ($1,'Warehouse','WH') RETURNING id`,
      [primary.businessId],
    )).rows[0]!.id;

    await movement(primary.businessId, primary.branchId, item.id, 10, "AVAILABLE", "OPENING_BALANCE", actor.staff_id, "2026-10-08T09:00:00.000Z");
    await movement(primary.businessId, primary.branchId, item.id, -2, "AVAILABLE", "SALE", actor.staff_id, "2026-10-08T11:00:00.000Z");
    await movement(primary.businessId, primary.branchId, item.id, 1, "QUARANTINE", "SALE_RETURN", actor.staff_id, "2026-10-08T12:00:00.000Z");
    await movement(primary.businessId, secondBranch, item.id, 99, "AVAILABLE", "PURCHASE_RECEIPT", actor.staff_id, "2026-10-08T13:00:00.000Z");

    const response = await app.inject({
      method: "GET",
      url: `/v1/inventory/${item.id}?businessId=${primary.businessId}&branchId=${primary.branchId}&limit=2`,
      headers: bearer(owner.accessToken),
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{
      item: { id: string; name: string; stockUnitCode: string; available: number; quarantine: number; damaged: number; waste: number };
      movements: Array<{ quantityDelta: number; location: string; reason: string; referenceType: string; referenceId: string; actorStaffId: string | null; actorName: string | null; occurredAt: string }>;
    }>();
    expect(body.item).toMatchObject({ id: item.id, name: "Tracked Cement", stockUnitCode: "bag", available: 8, quarantine: 1, damaged: 0, waste: 0 });
    expect(body.movements).toHaveLength(2);
    expect(body.movements.map((entry) => [entry.reason, entry.location, entry.quantityDelta])).toEqual([
      ["SALE_RETURN", "QUARANTINE", 1],
      ["SALE", "AVAILABLE", -2],
    ]);
    expect(body.movements.every((entry) => entry.actorStaffId === actor.staff_id && entry.actorName === actor.display_name)).toBe(true);
    expect(body.movements.every((entry) => entry.referenceType === "TEST_MOVEMENT" && typeof entry.referenceId === "string")).toBe(true);
    expect(body.movements.some((entry) => entry.quantityDelta === 99)).toBe(false);

    const outsider = await register("inventory-read-outsider@tradeos.test", "inventory-read-outsider-device", "Outsider");
    const foreign = await createBusiness(outsider.accessToken, "Inventory Read B");
    const foreignItem = await createProduct(outsider.accessToken, foreign.businessId, "Foreign Stock");

    const foreignTenant = await app.inject({ method: "GET", url: `/v1/inventory/${foreignItem.id}?businessId=${foreign.businessId}&branchId=${foreign.branchId}`, headers: bearer(owner.accessToken) });
    expect(foreignTenant.statusCode).toBe(403);
    const foreignBranch = await app.inject({ method: "GET", url: `/v1/inventory/${item.id}?businessId=${primary.businessId}&branchId=${foreign.branchId}`, headers: bearer(owner.accessToken) });
    expect(foreignBranch.statusCode).toBe(404);
    const wrongItem = await app.inject({ method: "GET", url: `/v1/inventory/${foreignItem.id}?businessId=${primary.businessId}&branchId=${primary.branchId}`, headers: bearer(owner.accessToken) });
    expect(wrongItem.statusCode).toBe(404);
  });
});

async function register(email: string, deviceKey: string, displayName: string) {
  const response = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { displayName, email, password: "TradeOS-Test-1234", platform: "WEB", deviceKey, appVersion: "test" } });
  expect(response.statusCode).toBe(201);
  return response.json<{ session: { accessToken: string } }>().session;
}

async function createBusiness(accessToken: string, name: string) {
  const response = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers: bearer(accessToken), payload: { name, businessType: "RETAIL_HARDWARE", branchName: "Main" } });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json<{ business: { id: string }; branch: { id: string } }>();
  return { businessId: body.business.id, branchId: body.branch.id };
}

async function createProduct(accessToken: string, businessId: string, name: string) {
  const response = await app.inject({ method: "POST", url: "/v1/catalog/items", headers: bearer(accessToken), payload: {
    businessId, name, kind: "PRODUCT", trackStock: true, stockUnitCode: "bag",
    units: [{ code: "bag", label: "Bag", canStock: true, canPurchase: true, canSell: true, defaultSalePriceMinor: 5000 }],
  } });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ item: { id: string } }>().item;
}

async function movement(businessId: string, branchId: string, itemId: string, quantityDelta: number, location: string, reason: string, actorStaffId: string, occurredAt: string) {
  await pool.query(
    `INSERT INTO inventory_movements (business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type,reason,reference_type,reference_id,actor_staff_id,idempotency_key,occurred_at)
     VALUES ($1,$2,$3,'bag',$4,$5,$6,'TEST_MOVEMENT',$7,$8,$9,$10)`,
    [businessId, branchId, itemId, quantityDelta, location, reason, randomUUID(), actorStaffId, `read-model:${randomUUID()}`, occurredAt],
  );
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
