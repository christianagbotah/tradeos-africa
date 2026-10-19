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
  it("treats missing and blank legacy payment methods as supplier credit without deducting cash", async () => {
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
        mutations: [
          {
            clientId: "legacy-purchase-device",
            clientMutationId: "legacy-receipt-no-method",
            businessId,
            branchId,
            mutationType: "PURCHASE_RECEIVE_CREATE",
            occurredAt: new Date().toISOString(),
            payload: {
              supplierId,
              currencyCode: "GHS",
              lines: [{ itemId, quantity: 2, costMinor: 12000 }],
            },
          },
          {
            clientId: "legacy-purchase-device",
            clientMutationId: "legacy-receipt-blank-method",
            businessId,
            branchId,
            mutationType: "PURCHASE_RECEIVE_CREATE",
            occurredAt: new Date().toISOString(),
            payload: {
              supplierId,
              settlementMethod: "   ",
              currencyCode: "GHS",
              lines: [{ itemId, quantity: 1, costMinor: 5000 }],
            },
          },
        ],
      },
    });

    expect(sync.statusCode).toBe(200);
    const [missingMethod, blankMethod] = sync.json().mutationResults;
    expect(missingMethod.status).toBe("APPLIED");
    expect(missingMethod.result.totalMinor).toBe(24000);
    expect(blankMethod.status).toBe("APPLIED");
    expect(blankMethod.result.totalMinor).toBe(5000);

    const purchases = await pool.query<{ client_mutation_id: string; settlement_method: string; total_minor: string }>(
      `SELECT client_mutation_id,settlement_method,total_minor
       FROM purchases
       WHERE business_id=$1
       ORDER BY client_mutation_id`,
      [businessId],
    );
    expect(purchases.rows).toEqual([
      { client_mutation_id: "legacy-receipt-blank-method", settlement_method: "SUPPLIER_CREDIT", total_minor: "5000" },
      { client_mutation_id: "legacy-receipt-no-method", settlement_method: "SUPPLIER_CREDIT", total_minor: "24000" },
    ]);

    const payable = await pool.query<{ balance: string }>(
      `SELECT COALESCE(SUM(balance_delta_minor),0)::text AS balance
       FROM supplier_payable_ledger
       WHERE business_id=$1 AND supplier_id=$2`,
      [businessId, supplierId],
    );
    expect(Number(payable.rows[0]!.balance)).toBe(29000);

    const cashbook = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM cashbook_entries
       WHERE business_id=$1 AND source_type='PURCHASE'`,
      [businessId],
    );
    expect(Number(cashbook.rows[0]!.count)).toBe(0);
  });
});
