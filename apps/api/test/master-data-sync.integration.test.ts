import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("conflict-safe customer and supplier master-data sync", () => {
  it("creates and updates customers branchlessly, replays idempotently, injects the real actor and rejects stale/sensitive edits", async () => {
    const owner = await register("customer-sync@tradeos.test", "customer-sync-device");
    const business = await createBusiness(owner.accessToken, "Customer Sync");
    const create = mutation("customer-sync-device", business.businessId, "customer-create", "CUSTOMER_CREATE", {
      name: "Offline Customer",
      phone: "0240000000",
      actorStaffId: "00000000-0000-4000-8000-000000000000",
      actorRole: "VIEWER",
    });

    const created = await push(owner.accessToken, create);
    expect(created.status).toBe("APPLIED");
    const customer = (created.result as { customer: { id: string; updatedAt: string } }).customer;
    const replay = await push(owner.accessToken, create);
    expect(replay.status).toBe("APPLIED");
    expect((replay.result as { customer: { id: string } }).customer.id).toBe(customer.id);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM customers WHERE business_id=$1`, [business.businessId])).rows[0].count)).toBe(1);

    const accepted = await push(owner.accessToken, mutation("customer-sync-device", business.businessId, "customer-update", "CUSTOMER_UPDATE", {
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt,
      name: "Offline Customer Updated",
      email: "offline@example.com",
    }));
    expect(accepted.status).toBe("APPLIED");
    expect((accepted.result as { customer: { name: string } }).customer.name).toBe("Offline Customer Updated");

    const stale = await push(owner.accessToken, mutation("customer-sync-device", business.businessId, "customer-stale", "CUSTOMER_UPDATE", {
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt,
      phone: "0200000000",
    }));
    expect(stale).toMatchObject({ status: "REJECTED", errorCode: "STALE_VERSION" });

    const sensitive = await push(owner.accessToken, mutation("customer-sync-device", business.businessId, "customer-sensitive", "CUSTOMER_UPDATE", {
      customerId: customer.id,
      expectedUpdatedAt: (accepted.result as { customer: { updatedAt: string } }).customer.updatedAt,
      creditLimitMinor: 5000,
    }));
    expect(sensitive).toMatchObject({ status: "REJECTED", errorCode: "MASTER_DATA_SYNC_SENSITIVE_CHANGE" });

    const actor = (await pool.query<{ staff_id: string }>(`SELECT staff_id FROM business_memberships WHERE business_id=$1`, [business.businessId])).rows[0]!.staff_id;
    const audits = await pool.query<{ actor_staff_id: string | null }>(`SELECT actor_staff_id FROM audit_events WHERE business_id=$1 AND entity_type='CUSTOMER'`, [business.businessId]);
    expect(audits.rows.length).toBeGreaterThanOrEqual(2);
    expect(audits.rows.every((row) => row.actor_staff_id === actor)).toBe(true);
  });

  it("syncs supplier profile mutations branchlessly for INVENTORY while keeping payment terms/status online-only", async () => {
    const owner = await register("supplier-sync@tradeos.test", "supplier-sync-device");
    const business = await createBusiness(owner.accessToken, "Supplier Sync");
    await pool.query(`UPDATE business_memberships SET role='INVENTORY' WHERE business_id=$1`, [business.businessId]);

    const created = await push(owner.accessToken, mutation("supplier-sync-device", business.businessId, "supplier-create", "SUPPLIER_CREATE", {
      name: "Offline Supplier",
      address: "Tema",
      actorStaffId: "00000000-0000-4000-8000-000000000000",
      actorRole: "OWNER",
    }));
    expect(created.status).toBe("APPLIED");
    const supplier = (created.result as { supplier: { id: string; updatedAt: string } }).supplier;

    const updated = await push(owner.accessToken, mutation("supplier-sync-device", business.businessId, "supplier-update", "SUPPLIER_UPDATE", {
      supplierId: supplier.id,
      expectedUpdatedAt: supplier.updatedAt,
      name: "Offline Supplier Ltd",
      phone: "0241112222",
    }));
    expect(updated.status).toBe("APPLIED");

    const sensitiveTerms = await push(owner.accessToken, mutation("supplier-sync-device", business.businessId, "supplier-terms", "SUPPLIER_UPDATE", {
      supplierId: supplier.id,
      expectedUpdatedAt: (updated.result as { supplier: { updatedAt: string } }).supplier.updatedAt,
      paymentTermsDays: 30,
    }));
    expect(sensitiveTerms).toMatchObject({ status: "REJECTED", errorCode: "MASTER_DATA_SYNC_SENSITIVE_CHANGE" });

    const sensitiveStatus = await push(owner.accessToken, mutation("supplier-sync-device", business.businessId, "supplier-status", "SUPPLIER_UPDATE", {
      supplierId: supplier.id,
      expectedUpdatedAt: (updated.result as { supplier: { updatedAt: string } }).supplier.updatedAt,
      active: false,
    }));
    expect(sensitiveStatus).toMatchObject({ status: "REJECTED", errorCode: "MASTER_DATA_SYNC_SENSITIVE_CHANGE" });

    const actor = (await pool.query<{ staff_id: string }>(`SELECT staff_id FROM business_memberships WHERE business_id=$1`, [business.businessId])).rows[0]!.staff_id;
    const audits = await pool.query<{ actor_staff_id: string | null }>(`SELECT actor_staff_id FROM audit_events WHERE business_id=$1 AND entity_type='SUPPLIER'`, [business.businessId]);
    expect(audits.rows.length).toBeGreaterThanOrEqual(2);
    expect(audits.rows.every((row) => row.actor_staff_id === actor)).toBe(true);
  });

  it("rejects unauthorized master-data sync before mutation ingestion", async () => {
    const owner = await register("master-sync-viewer@tradeos.test", "master-sync-viewer-device");
    const business = await createBusiness(owner.accessToken, "Viewer Sync");
    await pool.query(`UPDATE business_memberships SET role='VIEWER' WHERE business_id=$1`, [business.businessId]);
    const response = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: bearer(owner.accessToken),
      payload: { mutations: [mutation("master-sync-viewer-device", business.businessId, "viewer-create", "CUSTOMER_CREATE", { name: "Denied" })] },
    });
    expect(response.statusCode).toBe(403);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM sync_mutations WHERE business_id=$1`, [business.businessId])).rows[0].count)).toBe(0);
  });
});

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: { displayName: "Master Sync Owner", email, password: "TradeOS-Test-1234", platform: "WEB", deviceKey, appVersion: "test" },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ session: { accessToken: string } }>().session;
}

async function createBusiness(accessToken: string, name: string) {
  const response = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers: bearer(accessToken), payload: { name, businessType: "SERVICES", branchName: "Main" } });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json<{ business: { id: string }; branch: { id: string } }>();
  return { businessId: body.business.id, branchId: body.branch.id };
}

function mutation(clientId: string, businessId: string, clientMutationId: string, mutationType: string, payload: Record<string, unknown>) {
  return { clientId, clientMutationId, businessId, mutationType, occurredAt: new Date().toISOString(), payload };
}

async function push(accessToken: string, masterMutation: ReturnType<typeof mutation>) {
  const response = await app.inject({ method: "POST", url: "/v1/sync", headers: bearer(accessToken), payload: { mutations: [masterMutation] } });
  expect(response.statusCode).toBe(200);
  return response.json<{ mutationResults: Array<{ status: string; errorCode?: string; result?: unknown }> }>().mutationResults[0]!;
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
