import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

type Fixture = {
  accessToken: string;
  deviceKey: string;
  businessId: string;
  branchId: string;
  actorStaffId: string;
  customerId: string;
  originalItemId: string;
  replacementItemId: string;
};

describe("exchange domain engine", () => {
  it("atomically exchanges a Walk-in sale at current server prices and replays idempotently", async () => {
    const f = await fixture("exchange-walkin@tradeos.test", "exchange-walkin-device", 1000, 1700);
    const original = await sale(f, "original-walkin", f.originalItemId, "CASH");
    const lineId = await saleLineId(original.saleId);

    const payload = {
      originalSaleId: original.saleId,
      reason: "Customer chose a different item",
      settlementMethod: "CASH",
      returnedLines: [{ saleLineId: lineId, quantity: 1, disposition: "RESTOCK" }],
      replacementLines: [{ itemId: f.replacementItemId, saleUnitCode: "piece", quantity: 1 }],
    };
    const first = await sync(f, "walkin-exchange", "EXCHANGE_CREATE", payload);
    expect(first.status).toBe("APPLIED");
    expect(first.result).toMatchObject({ netDifferenceMinor: 700, returnTotalMinor: 1000, replacementTotalMinor: 1700, status: "COMPLETED" });
    const result = first.result as { exchangeCaseId: string; returnCaseId: string; replacementSaleId: string };
    expect(result.exchangeCaseId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.returnCaseId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.replacementSaleId).toMatch(/^[0-9a-f-]{36}$/i);

    const replay = await sync(f, "walkin-exchange", "EXCHANGE_CREATE", payload);
    expect(replay.status).toBe("APPLIED");
    expect(replay.result).toMatchObject({ exchangeCaseId: result.exchangeCaseId, returnCaseId: result.returnCaseId, replacementSaleId: result.replacementSaleId });

    const replacement = (await pool.query<{ customer_id: string | null; total_minor: string }>(`SELECT customer_id,total_minor FROM sales WHERE id=$1`, [result.replacementSaleId])).rows[0]!;
    expect(replacement).toEqual({ customer_id: null, total_minor: "1700" });
    expect(Number((await pool.query(`SELECT COALESCE(SUM(amount_minor),0) AS amount FROM payments WHERE sale_id=$1`, [result.replacementSaleId])).rows[0].amount)).toBe(700);
    expect(await available(f.businessId, f.branchId, f.originalItemId)).toBe(5);
    expect(await available(f.businessId, f.branchId, f.replacementItemId)).toBe(4);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM exchange_cases WHERE business_id=$1`, [f.businessId])).rows[0].count)).toBe(1);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM return_cases WHERE business_id=$1`, [f.businessId])).rows[0].count)).toBe(1);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM sales WHERE business_id=$1`, [f.businessId])).rows[0].count)).toBe(2);

    const audit = await pool.query<{ event_type: string; actor_staff_id: string | null; payload: Record<string, unknown> }>(
      `SELECT event_type,actor_staff_id,payload FROM audit_events WHERE business_id=$1 AND entity_type='EXCHANGE_CASE' AND entity_id=$2`,
      [f.businessId, result.exchangeCaseId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ event_type: "EXCHANGE_COMPLETED", actor_staff_id: f.actorStaffId });
    expect(audit.rows[0]!.payload).toMatchObject({ originalSaleId: original.saleId, returnCaseId: result.returnCaseId, replacementSaleId: result.replacementSaleId, netDifferenceMinor: 700 });
  });

  it("preserves a named customer and refunds only a negative price difference, including pending original-method refunds", async () => {
    const f = await fixture("exchange-named@tradeos.test", "exchange-named-device", 2000, 1200);
    const original = await sale(f, "original-named", f.originalItemId, "CASH", f.customerId);
    const lineId = await saleLineId(original.saleId);
    const cheaper = await sync(f, "named-cheaper", "EXCHANGE_CREATE", {
      originalSaleId: original.saleId,
      reason: "Customer downgraded",
      settlementMethod: "CASH",
      returnedLines: [{ saleLineId: lineId, quantity: 1, disposition: "RESTOCK" }],
      replacementLines: [{ itemId: f.replacementItemId, saleUnitCode: "piece", quantity: 1 }],
    });
    expect(cheaper.status).toBe("APPLIED");
    expect(cheaper.result).toMatchObject({ netDifferenceMinor: -800, returnTotalMinor: 2000, replacementTotalMinor: 1200, status: "COMPLETED" });
    const cheaperResult = cheaper.result as { replacementSaleId: string; returnCaseId: string };
    expect((await pool.query<{ customer_id: string | null }>(`SELECT customer_id FROM sales WHERE id=$1`, [cheaperResult.replacementSaleId])).rows[0]?.customer_id).toBe(f.customerId);
    expect((await pool.query<{ customer_id: string | null }>(`SELECT customer_id FROM return_cases WHERE id=$1`, [cheaperResult.returnCaseId])).rows[0]?.customer_id).toBe(f.customerId);
    expect(Number((await pool.query(`SELECT COALESCE(SUM(amount_minor),0) AS amount FROM refund_transactions WHERE return_case_id=$1`, [cheaperResult.returnCaseId])).rows[0].amount)).toBe(800);

    const momoFixture = await fixture("exchange-momo@tradeos.test", "exchange-momo-device", 2000, 1200);
    const momoOriginal = await sale(momoFixture, "original-momo", momoFixture.originalItemId, "MOMO");
    const momoLine = await saleLineId(momoOriginal.saleId);
    const pending = await sync(momoFixture, "momo-cheaper", "EXCHANGE_CREATE", {
      originalSaleId: momoOriginal.saleId,
      reason: "Cheaper replacement",
      settlementMethod: "ORIGINAL_METHOD",
      returnedLines: [{ saleLineId: momoLine, quantity: 1, disposition: "RESTOCK" }],
      replacementLines: [{ itemId: momoFixture.replacementItemId, saleUnitCode: "piece", quantity: 1 }],
    });
    expect(pending.status).toBe("APPLIED");
    expect(pending.result).toMatchObject({ netDifferenceMinor: -800, status: "PROCESSING" });
    const pendingResult = pending.result as { returnCaseId: string };
    expect((await pool.query<{ method: string; status: string; amount_minor: string }>(`SELECT method,status,amount_minor FROM refund_transactions WHERE return_case_id=$1`, [pendingResult.returnCaseId])).rows[0]).toEqual({ method: "MOMO", status: "PENDING", amount_minor: "800" });
  });

  it("handles zero difference, prevents over-return and rejects unauthorized exchange ingestion", async () => {
    const f = await fixture("exchange-zero@tradeos.test", "exchange-zero-device", 1500, 1500);
    const original = await sale(f, "original-zero", f.originalItemId, "CASH");
    const lineId = await saleLineId(original.saleId);
    const payload = {
      originalSaleId: original.saleId,
      reason: "Like-for-like exchange",
      settlementMethod: "CASH",
      returnedLines: [{ saleLineId: lineId, quantity: 1, disposition: "RESTOCK" }],
      replacementLines: [{ itemId: f.replacementItemId, saleUnitCode: "piece", quantity: 1 }],
    };
    const zero = await sync(f, "zero-exchange", "EXCHANGE_CREATE", payload);
    expect(zero.status).toBe("APPLIED");
    expect(zero.result).toMatchObject({ netDifferenceMinor: 0, status: "COMPLETED" });
    const zeroResult = zero.result as { replacementSaleId: string; returnCaseId: string };
    expect(Number((await pool.query(`SELECT COUNT(*) FROM payments WHERE sale_id=$1`, [zeroResult.replacementSaleId])).rows[0].count)).toBe(0);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM refund_transactions WHERE return_case_id=$1`, [zeroResult.returnCaseId])).rows[0].count)).toBe(0);

    const second = await sync(f, "second-exchange", "EXCHANGE_CREATE", payload);
    expect(second.status).toBe("REJECTED");
    expect(second.errorCode).toMatch(/RETURN|EXCHANGE/);

    await pool.query(`UPDATE business_memberships SET role='VIEWER' WHERE business_id=$1`, [f.businessId]);
    const before = Number((await pool.query(`SELECT COUNT(*) FROM sync_mutations WHERE business_id=$1`, [f.businessId])).rows[0].count);
    const denied = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: bearer(f.accessToken),
      payload: { mutations: [mutation(f, "viewer-exchange", "EXCHANGE_CREATE", payload)] },
    });
    expect(denied.statusCode).toBe(403);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM sync_mutations WHERE business_id=$1`, [f.businessId])).rows[0].count)).toBe(before);
  });
});

async function fixture(email: string, deviceKey: string, originalPriceMinor: number, replacementPriceMinor: number): Promise<Fixture> {
  const registration = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { displayName: email.split("@")[0], email, password: "TradeOS-Test-1234", platform: "WEB", deviceKey, appVersion: "test" } });
  expect(registration.statusCode).toBe(201);
  const accessToken = registration.json<{ session: { accessToken: string } }>().session.accessToken;
  const onboard = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers: bearer(accessToken), payload: { name: `Exchange ${email}`, businessType: "RETAIL_HARDWARE", branchName: "Main" } });
  expect(onboard.statusCode, onboard.body).toBe(201);
  const businessId = onboard.json<{ business: { id: string } }>().business.id;
  const branchId = onboard.json<{ branch: { id: string } }>().branch.id;
  const actorStaffId = (await pool.query<{ staff_id: string }>(`SELECT staff_id FROM business_memberships WHERE business_id=$1`, [businessId])).rows[0]!.staff_id;
  const customer = await app.inject({ method: "POST", url: "/v1/customers", headers: bearer(accessToken), payload: { businessId, name: "Named Exchange Customer" } });
  expect(customer.statusCode).toBe(201);
  const customerId = customer.json<{ customer: { id: string } }>().customer.id;
  const originalItemId = await product(accessToken, businessId, branchId, "Original item", "ORIGINAL", originalPriceMinor);
  const replacementItemId = await product(accessToken, businessId, branchId, "Replacement item", "REPLACEMENT", replacementPriceMinor);
  return { accessToken, deviceKey, businessId, branchId, actorStaffId, customerId, originalItemId, replacementItemId };
}

async function product(accessToken: string, businessId: string, branchId: string, name: string, sku: string, priceMinor: number): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/catalog/items", headers: bearer(accessToken), payload: {
    businessId, name, sku, kind: "PRODUCT", trackStock: true, stockUnitCode: "piece",
    units: [{ code: "piece", label: "Piece", canStock: true, canPurchase: true, canSell: true, defaultSalePriceMinor: priceMinor }],
    openingStock: { branchId, quantity: 5 },
  } });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ item: { id: string } }>().item.id;
}

async function sale(f: Fixture, id: string, itemId: string, paymentMethod: string, customerId?: string) {
  const result = await sync(f, id, "SALE_CREATE", { ...(customerId ? { customerId } : {}), paymentMethod, lines: [{ itemId, saleUnitCode: "piece", quantity: 1 }] });
  expect(result.status).toBe("APPLIED");
  return result.result as { saleId: string; totalMinor: number };
}
async function saleLineId(saleId: string): Promise<string> { return (await pool.query<{ id: string }>(`SELECT id FROM sale_lines WHERE sale_id=$1`, [saleId])).rows[0]!.id; }
async function available(businessId: string, branchId: string, itemId: string): Promise<number> { return Number((await pool.query(`SELECT COALESCE(SUM(quantity_delta),0) AS quantity FROM inventory_movements WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 AND location_type='AVAILABLE'`, [businessId, branchId, itemId])).rows[0].quantity); }

function mutation(f: Fixture, id: string, type: string, payload: unknown) { return { clientId: f.deviceKey, clientMutationId: id, businessId: f.businessId, branchId: f.branchId, mutationType: type, occurredAt: new Date().toISOString(), payload }; }
async function sync(f: Fixture, id: string, type: string, payload: unknown) {
  const response = await app.inject({ method: "POST", url: "/v1/sync", headers: bearer(f.accessToken), payload: { mutations: [mutation(f, id, type, payload)] } });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ mutationResults: Array<{ status: string; errorCode?: string; result?: unknown }> }>().mutationResults[0]!;
}
function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
