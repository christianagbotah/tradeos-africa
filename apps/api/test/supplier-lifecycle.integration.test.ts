import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("supplier lifecycle and procurement safety", () => {
  it("requires the current revision and separates supplier profile edits from payment terms", async () => {
    const owner = await register("supplier-lifecycle@tradeos.test", "supplier-lifecycle-device");
    const business = await createBusiness(owner.accessToken);
    const created = await createSupplier(owner.accessToken, business.businessId, {
      name: "Accra Wholesale",
      phone: "0240000000",
      paymentTermsDays: 30,
    });

    await setRole(business.businessId, "INVENTORY");
    const inventoryProfile = await patchSupplier(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: created.updatedAt,
      name: "Accra Wholesale Ltd",
    });
    expect(inventoryProfile.statusCode).toBe(200);
    const afterInventory = inventoryProfile.json<{ supplier: { name: string; updatedAt: string } }>().supplier;
    expect(afterInventory.name).toBe("Accra Wholesale Ltd");

    const inventoryTerms = await patchSupplier(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: afterInventory.updatedAt,
      paymentTermsDays: 45,
    });
    expect(inventoryTerms.statusCode).toBe(403);
    expect(inventoryTerms.json<{ error: string }>().error).toBe("SUPPLIER_TERMS_FORBIDDEN");

    await setRole(business.businessId, "ACCOUNTANT");
    const accountantTerms = await patchSupplier(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: afterInventory.updatedAt,
      paymentTermsDays: 45,
    });
    expect(accountantTerms.statusCode).toBe(200);
    const afterAccountant = accountantTerms.json<{ supplier: { paymentTermsDays: number; updatedAt: string } }>().supplier;
    expect(afterAccountant.paymentTermsDays).toBe(45);

    await setRole(business.businessId, "OWNER");
    const stale = await patchSupplier(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: created.updatedAt,
      email: "stale@example.com",
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: string }>().error).toBe("STALE_VERSION");

    const missingRevision = await patchSupplier(owner.accessToken, business.businessId, created.id, {
      email: "missing@example.com",
    });
    expect(missingRevision.statusCode).toBe(400);
    expect(missingRevision.json<{ error: string }>().error).toBe("REVISION_REQUIRED");
  });

  it("archives/reactivates suppliers without losing payables, blocks new receiving, and audits lifecycle deltas", async () => {
    const owner = await register("supplier-history@tradeos.test", "supplier-history-device");
    const business = await createBusiness(owner.accessToken);
    const created = await createSupplier(owner.accessToken, business.businessId, { name: "History Supplier", paymentTermsDays: 14 });
    const itemId = await createPurchaseItem(owner.accessToken, business.businessId);

    const receiptPayload = {
      supplierId: created.id,
      settlementMethod: "SUPPLIER_CREDIT",
      lines: [{ itemId, purchaseUnitCode: "piece", quantity: 1, unitCostMinor: 1000 }],
    };
    const received = await sync(owner.accessToken, business, "supplier-history-receipt", "PURCHASE_RECEIVE_CREATE", receiptPayload);
    expect(received.status).toBe("APPLIED");

    const before = await getSupplier(owner.accessToken, business.businessId, created.id);
    expect(before.supplier.balanceMinor).toBe(1000);
    expect(before.obligations).toHaveLength(1);
    expect(before.ledger).toHaveLength(1);

    const deactivate = await patchSupplier(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: before.supplier.updatedAt,
      active: false,
    });
    expect(deactivate.statusCode).toBe(200);
    const inactive = deactivate.json<{ supplier: { active: boolean; updatedAt: string } }>().supplier;
    expect(inactive.active).toBe(false);

    const blockedReceipt = await sync(owner.accessToken, business, "supplier-inactive-receipt", "PURCHASE_RECEIVE_CREATE", receiptPayload);
    expect(blockedReceipt).toMatchObject({ status: "REJECTED", errorCode: "SUPPLIER_NOT_FOUND" });

    const historicalPayment = await sync(owner.accessToken, business, "supplier-history-payment", "SUPPLIER_PAYMENT_CREATE", {
      supplierId: created.id,
      amountMinor: 1000,
      method: "CASH",
    });
    expect(historicalPayment.status).toBe("APPLIED");

    const afterPayment = await getSupplier(owner.accessToken, business.businessId, created.id);
    expect(afterPayment.supplier.active).toBe(false);
    expect(afterPayment.supplier.balanceMinor).toBe(0);
    expect(afterPayment.obligations).toHaveLength(1);
    expect(afterPayment.obligations[0]?.openMinor).toBe(0);
    expect(afterPayment.ledger).toHaveLength(2);

    const audit = await pool.query<{ event_type: string; payload: { changes?: Record<string, { before: unknown; after: unknown }> } }>(
      `SELECT event_type,payload FROM audit_events WHERE business_id=$1 AND entity_type='SUPPLIER' AND entity_id=$2 ORDER BY occurred_at,id`,
      [business.businessId, created.id],
    );
    const deactivation = audit.rows.find((row) => row.event_type === "SUPPLIER_DEACTIVATED");
    expect(deactivation?.payload.changes?.active).toEqual({ before: true, after: false });

    const reactivate = await patchSupplier(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: inactive.updatedAt,
      active: true,
    });
    expect(reactivate.statusCode).toBe(200);
    expect(reactivate.json<{ supplier: { active: boolean } }>().supplier.active).toBe(true);

    const eventsAfterReactivate = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_events WHERE business_id=$1 AND entity_type='SUPPLIER' AND entity_id=$2`,
      [business.businessId, created.id],
    );
    expect(eventsAfterReactivate.rows.some((row) => row.event_type === "SUPPLIER_REACTIVATED")).toBe(true);
  });
});

async function register(email: string, deviceKey: string) {
  const response = await app.inject({ method: "POST", url: "/v1/auth/register", payload: { displayName: "Supplier Lifecycle Owner", email, password: "TradeOS-Test-1234", platform: "WEB", deviceKey, appVersion: "test" } });
  expect(response.statusCode).toBe(201);
  return response.json<{ session: { accessToken: string } }>().session;
}

async function createBusiness(accessToken: string) {
  const response = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers: bearer(accessToken), payload: { name: "Supplier Lifecycle", businessType: "RETAIL_HARDWARE", branchName: "Main" } });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json<{ business: { id: string }; branch: { id: string } }>();
  return { businessId: body.business.id, branchId: body.branch.id };
}

async function createSupplier(accessToken: string, businessId: string, fields: Record<string, unknown>) {
  const response = await app.inject({ method: "POST", url: "/v1/suppliers", headers: bearer(accessToken), payload: { businessId, ...fields } });
  expect(response.statusCode).toBe(201);
  return response.json<{ supplier: { id: string; updatedAt: string } }>().supplier;
}

async function patchSupplier(accessToken: string, businessId: string, supplierId: string, fields: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/v1/suppliers/${supplierId}`, headers: bearer(accessToken), payload: { businessId, ...fields } });
}

async function getSupplier(accessToken: string, businessId: string, supplierId: string) {
  const response = await app.inject({ method: "GET", url: `/v1/suppliers/${supplierId}?businessId=${businessId}`, headers: bearer(accessToken) });
  expect(response.statusCode).toBe(200);
  return response.json<{
    supplier: { active: boolean; balanceMinor: number; updatedAt: string };
    obligations: Array<{ openMinor: number }>;
    ledger: Array<unknown>;
  }>();
}

async function createPurchaseItem(accessToken: string, businessId: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/catalog/items", headers: bearer(accessToken), payload: {
    businessId, name: "Lifecycle Stock", kind: "PRODUCT", trackStock: true, stockUnitCode: "piece",
    units: [{ code: "piece", label: "Piece", canPurchase: true, canStock: true }],
  } });
  expect(response.statusCode).toBe(201);
  return response.json<{ item: { id: string } }>().item.id;
}

async function sync(accessToken: string, business: { businessId: string; branchId: string }, clientMutationId: string, mutationType: string, payload: unknown) {
  const response = await app.inject({ method: "POST", url: "/v1/sync", headers: bearer(accessToken), payload: { mutations: [{ clientId: "supplier-history-device", clientMutationId, businessId: business.businessId, branchId: business.branchId, mutationType, occurredAt: new Date().toISOString(), payload }] } });
  expect(response.statusCode).toBe(200);
  return response.json<{ mutationResults: Array<{ status: string; errorCode?: string }> }>().mutationResults[0]!;
}

async function setRole(businessId: string, role: string): Promise<void> {
  await pool.query(`UPDATE business_memberships SET role=$2 WHERE business_id=$1`, [businessId, role]);
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
