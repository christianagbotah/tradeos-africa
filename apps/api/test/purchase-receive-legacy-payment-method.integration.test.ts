import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";

const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("purchase receipt compatibility", () => {
  it("treats a legacy receipt with no settlement method as supplier credit without deducting cash", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        displayName: "Legacy Buyer",
        email: "legacy-purchase@tradeos.test",
        password: "TradeOS-Test-1234",
        platform: "WEB",
        deviceKey: "legacy-purchase-device",
        appVersion: "legacy-test",
      },
    });
    expect(registration.statusCode).toBe(201);
    const headers = { authorization: `Bearer ${registration.json().session.accessToken}` };

    const onboard = await app.inject({
      method: "POST",
      url: "/v1/onboarding/business",
      headers,
      payload: { name: "Legacy Shop", businessType: "DRINKING_SPOT", branchName: "Main" },
    });
    expect(onboard.statusCode).toBe(201);
    const businessId = onboard.json().business.id as string;
    const branchId = onboard.json().branch.id as string;

    const supplier = await app.inject({
      method: "POST",
      url: "/v1/suppliers",
      headers,
      payload: { businessId, name: "Legacy Supplier", paymentTermsDays: 30 },
    });
    expect(supplier.statusCode).toBe(201);
    const supplierId = supplier.json().supplier.id as string;

    const catalog = await app.inject({
      method: "POST",
      url: "/v1/catalog/items",
      headers,
      payload: {
        businessId,
        name: "Legacy Stock Item",
        kind: "PRODUCT",
        trackStock: true,
        stockUnitCode: "piece",
        units: [{ code: "piece", label: "Piece", canStock: true, canPurchase: true }],
      },
    });
    expect(catalog.statusCode).toBe(201);
    const itemId = catalog.json().item.id as string;

    const sync = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers,
      payload: {
        mutations: [{
          clientId: "legacy-purchase-device",
          clientMutationId: "legacy-receipt-no-method",
          businessId,
          branchId,
          mutationType: "PURCHASE_RECEIVE_CREATE",
          occurredAt: new Date().toISOString(),
          payload: {
            supplierId,
            lines: [{ itemId, purchaseUnitCode: "piece", quantity: 2, unitCostMinor: 12000 }],
          },
        }],
      },
    });

    expect(sync.statusCode).toBe(200);
    const result = sync.json().mutationResults[0];
    expect(result.status).toBe("APPLIED");
    expect(result.result.totalMinor).toBe(24000);

    const purchase = await pool.query<{ settlement_method: string; total_minor: string }>(
      `SELECT settlement_method,total_minor FROM purchases WHERE business_id=$1 AND client_mutation_id=$2`,
      [businessId, "legacy-receipt-no-method"],
    );
    expect(purchase.rows[0]).toMatchObject({ settlement_method: "SUPPLIER_CREDIT" });
    expect(Number(purchase.rows[0]!.total_minor)).toBe(24000);

    const payable = await pool.query<{ balance: string }>(
      `SELECT COALESCE(SUM(balance_delta_minor),0)::text AS balance
       FROM supplier_payable_ledger
       WHERE business_id=$1 AND supplier_id=$2`,
      [businessId, supplierId],
    );
    expect(Number(payable.rows[0]!.balance)).toBe(24000);

    const cashbook = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM cashbook_entries
       WHERE business_id=$1 AND source_type='PURCHASE'`,
      [businessId],
    );
    expect(Number(cashbook.rows[0]!.count)).toBe(0);
  });
});
