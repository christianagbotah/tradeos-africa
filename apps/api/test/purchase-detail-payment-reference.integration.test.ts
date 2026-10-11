import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_pr55_review";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("purchase detail and supplier payment evidence", () => {
  it("returns purchase receipt metadata and preserves supplier payment provider reference", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        displayName: "Buyer",
        email: "purchase-evidence@tradeos.test",
        password: "TradeOS-Test-1234",
        platform: "WEB",
        deviceKey: "purchase-evidence-device",
        appVersion: "test",
      },
    });
    expect(registration.statusCode).toBe(201);
    const headers = { authorization: `Bearer ${registration.json().session.accessToken}` };

    const onboard = await app.inject({
      method: "POST",
      url: "/v1/onboarding/business",
      headers,
      payload: { name: "Evidence Shop", businessType: "DISTRIBUTION", branchName: "Main" },
    });
    expect(onboard.statusCode).toBe(201);
    const businessId = onboard.json().business.id as string;
    const branchId = onboard.json().branch.id as string;

    const supplierResponse = await app.inject({
      method: "POST",
      url: "/v1/suppliers",
      headers,
      payload: { businessId, name: "Evidence Supplier" },
    });
    expect(supplierResponse.statusCode).toBe(201);
    const supplierId = supplierResponse.json().supplier.id as string;

    const catalog = await app.inject({
      method: "POST",
      url: "/v1/catalog/items",
      headers,
      payload: {
        businessId,
        name: "Evidence Item",
        kind: "PRODUCT",
        trackStock: true,
        stockUnitCode: "piece",
        units: [
          { code: "piece", label: "Piece", canStock: true, canPurchase: true, canSell: true, defaultSalePriceMinor: 500 },
        ],
      },
    });
    expect(catalog.statusCode).toBe(201);
    const itemId = catalog.json().item.id as string;

    const sync = async (clientMutationId: string, mutationType: string, payload: unknown) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/sync",
        headers,
        payload: {
          mutations: [{
            clientId: "purchase-evidence-device",
            clientMutationId,
            businessId,
            branchId,
            mutationType,
            occurredAt: new Date().toISOString(),
            payload,
          }],
        },
      });
      expect(response.statusCode).toBe(200);
      return response.json().mutationResults[0];
    };

    const received = await sync("receipt-evidence-1", "PURCHASE_RECEIVE_CREATE", {
      supplierId,
      settlementMethod: "SUPPLIER_CREDIT",
      supplierReference: "SUP-INV-2026-0042",
      lines: [{ itemId, purchaseUnitCode: "piece", quantity: 2, unitCostMinor: 300 }],
    });
    expect(received.status).toBe("APPLIED");
    const purchaseId = received.result.purchaseId as string;

    const purchaseDetail = await app.inject({
      method: "GET",
      url: `/v1/purchases/${purchaseId}?businessId=${businessId}`,
      headers,
    });
    expect(purchaseDetail.statusCode).toBe(200);
    expect(purchaseDetail.json().purchase).toMatchObject({
      id: purchaseId,
      supplierId,
      supplierName: "Evidence Supplier",
      supplierReference: "SUP-INV-2026-0042",
      status: "RECEIVED",
      receiverName: "Buyer",
    });
    expect(purchaseDetail.json().purchase.receivedAt).toEqual(expect.any(String));

    const paid = await sync("supplier-payment-evidence-1", "SUPPLIER_PAYMENT_CREATE", {
      supplierId,
      amountMinor: 200,
      method: "MOMO",
      providerReference: "MOMO-REF-2026-77",
    });
    expect(paid.status).toBe("APPLIED");

    const supplierDetail = await app.inject({
      method: "GET",
      url: `/v1/suppliers/${supplierId}?businessId=${businessId}`,
      headers,
    });
    expect(supplierDetail.statusCode).toBe(200);
    const paymentEntry = supplierDetail.json().ledger.find((entry: { sourceType: string }) => entry.sourceType === "PAYMENT");
    expect(paymentEntry).toMatchObject({
      method: "MOMO",
      providerReference: "MOMO-REF-2026-77",
      balanceDeltaMinor: -200,
    });
  });
});
