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
  await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("purchase settlement compatibility", () => {
  it("defaults a missing purchase settlement method to supplier credit without moving cash", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        displayName: "Purchase Owner",
        email: "purchase-method-compat@tradeos.test",
        password: "TradeOS-Test-1234",
        platform: "WEB",
        deviceKey: "purchase-method-compat-device",
        appVersion: "test",
      },
    });
    expect(registration.statusCode).toBe(201);
    const headers = { authorization: `Bearer ${registration.json().session.accessToken}` };

    const onboard = await app.inject({
      method: "POST",
      url: "/v1/onboarding/business",
      headers,
      payload: { name: "Compatibility Shop", businessType: "RETAIL", branchName: "Main" },
    });
    expect(onboard.statusCode).toBe(201);
    const businessId = onboard.json().business.id as string;
    const branchId = onboard.json().branch.id as string;

    const supplierResponse = await app.inject({
      method: "POST",
      url: "/v1/suppliers",
      headers,
      payload: { businessId, name: "Legacy Client Supplier", paymentTermsDays: 30 },
    });
    expect(supplierResponse.statusCode).toBe(201);
    const supplierId = supplierResponse.json().supplier.id as string;

    const catalogResponse = await app.inject({
      method: "POST",
      url: "/v1/catalog/items",
      headers,
      payload: {
        businessId,
        name: "Compatibility Item",
        kind: "PRODUCT",
        trackStock: true,
        stockUnitCode: "piece",
        units: [{ code: "piece", label: "Piece", canStock: true, canPurchase: true }],
      },
    });
    expect(catalogResponse.statusCode).toBe(201);
    const itemId = catalogResponse.json().item.id as string;

    const response = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers,
      payload: {
        mutations: [{
          clientId: "purchase-method-compat-device",
          clientMutationId: "purchase-without-settlement-method",
          businessId,
          branchId,
          mutationType: "PURCHASE_RECEIVE_CREATE",
          occurredAt: new Date().toISOString(),
          payload: {
            supplierId,
            lines: [{ itemId, purchaseUnitCode: "piece", quantity: 2, unitCostMinor: 1250 }],
          },
        }],
      },
    });

    expect(response.statusCode).toBe(200);
    const result = response.json().mutationResults[0];
    expect(result.status).toBe("APPLIED");
    expect(result.result.totalMinor).toBe(2500);

    const purchase = await pool.query<{ settlement_method: string }>(
      `SELECT settlement_method FROM purchases WHERE business_id=$1 AND client_mutation_id=$2`,
      [businessId, "purchase-without-settlement-method"],
    );
    expect(purchase.rows[0]?.settlement_method).toBe("SUPPLIER_CREDIT");

    const payable = await pool.query<{ count: string; balance: string }>(
      `SELECT COUNT(*)::text AS count, COALESCE(SUM(balance_delta_minor),0)::text AS balance
       FROM supplier_payable_ledger
       WHERE business_id=$1 AND supplier_id=$2 AND source_type='PURCHASE'`,
      [businessId, supplierId],
    );
    expect(Number(payable.rows[0]?.count ?? 0)).toBe(1);
    expect(Number(payable.rows[0]?.balance ?? 0)).toBe(2500);

    const obligations = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM supplier_credit_obligations WHERE business_id=$1 AND supplier_id=$2`,
      [businessId, supplierId],
    );
    expect(Number(obligations.rows[0]?.count ?? 0)).toBe(1);

    const cashbook = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM cashbook_entries WHERE business_id=$1`,
      [businessId],
    );
    expect(Number(cashbook.rows[0]?.count ?? 0)).toBe(0);
  });
});
