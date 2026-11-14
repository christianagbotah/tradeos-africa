import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function createOwner(label: string) {
  const auth = await app.inject({ method: "POST", url: "/v1/auth/register",
    payload: { displayName: "Stock Owner", email: "stock-ai-" + label + "@tradeos.test",
      password: "TradeOS-Test-1234", platform: "WEB", deviceKey: "stock-ai-" + label,
      appVersion: "test" },
  });
  expect(auth.statusCode).toBe(201);
  const headers = { authorization: "Bearer " + auth.json().session.accessToken };
  const register = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers,
    payload: { name: "Stock Business " + label, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(register.statusCode).toBe(201);
  return {
    businessId: register.json().business.id as string,
    branchId: register.json().branch.id as string, headers,
  };
}
type Owner = Awaited<ReturnType<typeof createOwner>>;

async function item(owner: Owner, name: string) {
  const row = await pool.query<{ id: string }>(
    "INSERT INTO catalog_items(business_id,name,kind,stock_unit_code,track_stock) " +
    "VALUES($1,$2,'PRODUCT','piece',true) RETURNING id",
    [owner.businessId, name],
  );
  return row.rows[0]!.id;
}
async function move(owner: Owner, itemId: string, reason: "OPENING_BALANCE" | "SALE" | "SALE_RETURN",
  quantity: number, daysAgo: number) {
  await pool.query(
    "INSERT INTO inventory_movements " +
    "(business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type," +
    "reason,reference_type,reference_id,idempotency_key,occurred_at) " +
    "VALUES($1,$2,$3,'piece',$4,'AVAILABLE',$5,'TEST',gen_random_uuid(),gen_random_uuid()::text," +
    "now()-($6::numeric*interval '1 day'))",
    [owner.businessId, owner.branchId, itemId, quantity, reason, daysAgo],
  );
}
function url(owner: Owner, horizon = 14) {
  return "/v1/intelligence/inventory?businessId=" + owner.businessId +
    "&branchId=" + owner.branchId + "&horizonDays=" + horizon;
}

describe("evidence-based inventory intelligence", () => {
  it("identifies reorder, stockout, slow stock, excess stock and low-data inventory without any postings", async () => {
    const owner = await createOwner("scenarios");
    const low = await item(owner, "A - Needs review");
    await move(owner, low, "OPENING_BALANCE", 40, 120);
    for (let day = 2; day <= 11; day++) await move(owner, low, "SALE", -3, day);
    const empty = await item(owner, "B - Stockout");
    await move(owner, empty, "OPENING_BALANCE", 12, 120);
    for (let day = 2; day <= 7; day++) await move(owner, empty, "SALE", -2, day);
    const slow = await item(owner, "C - No recent sales");
    await move(owner, slow, "OPENING_BALANCE", 80, 120);
    const newItem = await item(owner, "D - New SKU");
    await move(owner, newItem, "OPENING_BALANCE", 8, 2);
    const excess = await item(owner, "E - Excess inventory");
    await move(owner, excess, "OPENING_BALANCE", 500, 120);
    for (let day = 2; day <= 6; day++) await move(owner, excess, "SALE", -1, day);
    const before = await pool.query(
      "SELECT count(*)::int AS n FROM inventory_movements WHERE business_id=$1",
      [owner.businessId],
    );
    const res = await app.inject({ method: "GET", url: url(owner), headers: owner.headers });
    expect(res.statusCode).toBe(200);
    const report = res.json();
    expect(report).toMatchObject({
      businessId: owner.businessId, branchId: owner.branchId,
      planningHorizonDays: 14, observationWindowDays: 30, evaluatedItemCount: 5,
      truncated: false, summary: {
        outOfStock: 1, reorderReview: 1, slowMoving: 1, overstockReview: 1,
        insufficientData: 2,
      },
    });
    const byId = new Map<string, any>(report.items.map((x: { itemId: string }) => [x.itemId,x]));
    expect(byId.get(low)).toMatchObject({
      status: "REORDER_REVIEW", available: 10, netSold30Days: 30,
      confidence: "ESTABLISHED", suggestedReviewQuantity: 4,
    });
    expect(byId.get(empty)).toMatchObject({ status: "OUT_OF_STOCK", available: 0, netSold30Days: 12 });
    expect(byId.get(slow)).toMatchObject({ status: "SLOW_MOVING", suggestedReviewQuantity: null });
    expect(byId.get(newItem)).toMatchObject({
      status: "INSUFFICIENT_DATA", confidence: "INSUFFICIENT", suggestedReviewQuantity: null,
    });
    expect(byId.get(excess)).toMatchObject({ status: "OVERSTOCK_REVIEW", suggestedReviewQuantity: null });
    const after = await pool.query(
      "SELECT count(*)::int AS n FROM inventory_movements WHERE business_id=$1",
      [owner.businessId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(report.methodology).toMatch(/not a supplier lead time/i);
  });

  it("uses net sale-return movements and explicit 7/14/30-day scenarios", async () => {
    const owner = await createOwner("returns");
    const id = await item(owner, "Returnable product");
    await move(owner, id, "OPENING_BALANCE", 20, 100);
    for (let day = 2; day <= 6; day++) await move(owner, id, "SALE", -3, day);
    await move(owner, id, "SALE_RETURN", 3, 1);
    const short = await app.inject({ method: "GET", url: url(owner, 7), headers: owner.headers });
    expect(short.statusCode).toBe(200);
    expect(short.json().items[0]).toMatchObject({
      available: 8, netSold30Days: 12, status: "HEALTHY", suggestedReviewQuantity: null,
    });
    const mid = await app.inject({ method: "GET", url: url(owner, 14), headers: owner.headers });
    expect(mid.json().items[0]).toMatchObject({ status: "HEALTHY", suggestedReviewQuantity: null });
    const long = await app.inject({ method: "GET", url: url(owner, 30), headers: owner.headers });
    expect(long.json().items[0]).toMatchObject({ status: "REORDER_REVIEW", suggestedReviewQuantity: 4 });
  });

  it("fails closed on forged business, foreign branch, invalid horizon, cashier and suspended tenant", async () => {
    const a = await createOwner("scope-a"), b = await createOwner("scope-b");
    expect((await app.inject({ method: "GET", url: url(a) })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: url(a), headers: b.headers })).statusCode).toBe(403);
    const foreign = "/v1/intelligence/inventory?businessId=" + a.businessId +
      "&branchId=" + b.branchId;
    expect((await app.inject({ method: "GET", url: foreign, headers: a.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: url(a, 100), headers: a.headers })).statusCode).toBe(400);
    await pool.query("UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1", [a.businessId]);
    expect((await app.inject({ method: "GET", url: url(a), headers: a.headers })).statusCode).toBe(403);
    await pool.query("UPDATE business_memberships SET role='INVENTORY' WHERE business_id=$1", [a.businessId]);
    expect((await app.inject({ method: "GET", url: url(a), headers: a.headers })).statusCode).toBe(200);
    await pool.query("UPDATE businesses SET status='SUSPENDED' WHERE id=$1", [a.businessId]);
    expect((await app.inject({ method: "GET", url: url(a), headers: a.headers })).statusCode).toBe(403);
  });

  it("never recommends reorder quantities from too little stock history", async () => {
    const owner = await createOwner("lowdata");
    const id = await item(owner, "Recently stocked");
    await move(owner, id, "OPENING_BALANCE", 12, 10);
    for (let day = 2; day <= 6; day++) await move(owner, id, "SALE", -2, day);
    const res = await app.inject({ method: "GET", url: url(owner), headers: owner.headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0]).toMatchObject({
      confidence: "INSUFFICIENT", status: "INSUFFICIENT_DATA", suggestedReviewQuantity: null,
    });
  });
});
