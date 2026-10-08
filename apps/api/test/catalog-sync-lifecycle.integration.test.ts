import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("catalog lifecycle durable sync", () => {
  it("creates, updates and archives catalog records without requiring branchId and replays idempotently", async () => {
    const owner = await register("catalog-sync-owner@tradeos.test", "catalog-sync-device");
    const business = await createBusiness(owner.accessToken, "Synced Catalog");

    const createMutation = mutation("catalog-sync-device", business.businessId, "catalog-create-1", "CATALOG_ITEM_CREATE", {
      name: "Offline consultation",
      kind: "SERVICE",
      units: [{ code: "service", label: "Service", canSell: true, defaultSalePriceMinor: 5000 }],
    });
    const created = await push(owner.accessToken, createMutation);
    expect(created.status).toBe("APPLIED");
    const item = (created.result as { item: { id: string; updatedAt: string } }).item;

    const replay = await push(owner.accessToken, createMutation);
    expect(replay.status).toBe("APPLIED");
    expect((replay.result as { item: { id: string } }).item.id).toBe(item.id);
    expect(Number((await pool.query(`SELECT COUNT(*) FROM catalog_items WHERE business_id=$1`, [business.businessId])).rows[0].count)).toBe(1);

    const updated = await push(owner.accessToken, mutation("catalog-sync-device", business.businessId, "catalog-update-1", "CATALOG_ITEM_UPDATE", {
      itemId: item.id,
      expectedUpdatedAt: item.updatedAt,
      name: "Offline premium consultation",
    }));
    expect(updated.status).toBe("APPLIED");
    const updatedItem = (updated.result as { item: { id: string; name: string; updatedAt: string } }).item;
    expect(updatedItem.name).toBe("Offline premium consultation");

    const archived = await push(owner.accessToken, mutation("catalog-sync-device", business.businessId, "catalog-archive-1", "CATALOG_ITEM_ARCHIVE", {
      itemId: item.id,
      expectedUpdatedAt: updatedItem.updatedAt,
    }));
    expect(archived.status).toBe("APPLIED");
    expect((archived.result as { item: { active: boolean } }).item.active).toBe(false);

    const actor = await pool.query<{ staff_id: string }>(`SELECT staff_id FROM business_memberships WHERE business_id=$1 AND role='OWNER'`, [business.businessId]);
    const audits = await pool.query<{ actor_staff_id: string | null }>(`SELECT actor_staff_id FROM audit_events WHERE business_id=$1 AND entity_type='CATALOG_ITEM'`, [business.businessId]);
    expect(audits.rows.length).toBeGreaterThanOrEqual(3);
    expect(audits.rows.every((row) => row.actor_staff_id === actor.rows[0]!.staff_id)).toBe(true);
  });

  it("rejects a queued stale catalog update with STALE_VERSION while preserving the accepted write", async () => {
    const owner = await register("catalog-stale-sync@tradeos.test", "catalog-stale-device");
    const business = await createBusiness(owner.accessToken, "Queued Conflict");
    const created = await push(owner.accessToken, mutation("catalog-stale-device", business.businessId, "stale-create", "CATALOG_ITEM_CREATE", {
      name: "Original",
      kind: "SERVICE",
      units: [{ code: "service", label: "Service", canSell: true, defaultSalePriceMinor: 1000 }],
    }));
    const item = (created.result as { item: { id: string; updatedAt: string } }).item;

    const accepted = await push(owner.accessToken, mutation("catalog-stale-device", business.businessId, "fresh-update", "CATALOG_ITEM_UPDATE", {
      itemId: item.id,
      expectedUpdatedAt: item.updatedAt,
      name: "Accepted",
    }));
    expect(accepted.status).toBe("APPLIED");

    const stale = await push(owner.accessToken, mutation("catalog-stale-device", business.businessId, "stale-update", "CATALOG_ITEM_UPDATE", {
      itemId: item.id,
      expectedUpdatedAt: item.updatedAt,
      name: "Rejected stale change",
    }));
    expect(stale.status).toBe("REJECTED");
    expect(stale.errorCode).toBe("STALE_VERSION");

    const current = await app.inject({ method: "GET", url: `/v1/catalog/items/${item.id}?businessId=${business.businessId}`, headers: bearer(owner.accessToken) });
    expect(current.json().item.name).toBe("Accepted");
  });

  it("keeps catalog sync tenant- and role-safe", async () => {
    const owner = await register("catalog-tenant-owner@tradeos.test", "catalog-owner-device-2");
    const outsider = await register("catalog-outsider@tradeos.test", "catalog-outsider-device");
    const business = await createBusiness(owner.accessToken, "Protected Catalog");

    const crossTenant = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: bearer(outsider.accessToken),
      payload: { mutations: [mutation("catalog-outsider-device", business.businessId, "cross-tenant-catalog", "CATALOG_ITEM_CREATE", {
        name: "Forbidden", kind: "SERVICE", units: [{ code: "service", label: "Service", canSell: true, defaultSalePriceMinor: 1000 }],
      })] },
    });
    expect(crossTenant.statusCode).toBe(403);
    expect(crossTenant.json().error).toBe("BUSINESS_ACCESS_DENIED");

    const viewer = await register("catalog-viewer@tradeos.test", "catalog-viewer-device");
    await grantRole(business.businessId, "catalog-viewer@tradeos.test", "VIEWER");
    const roleDenied = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: bearer(viewer.accessToken),
      payload: { mutations: [mutation("catalog-viewer-device", business.businessId, "viewer-catalog", "CATALOG_ITEM_CREATE", {
        name: "Viewer forbidden", kind: "SERVICE", units: [{ code: "service", label: "Service", canSell: true, defaultSalePriceMinor: 1000 }],
      })] },
    });
    expect(roleDenied.statusCode).toBe(403);
    expect(roleDenied.json().error).toBe("ROLE_FORBIDDEN");
  });
});

type SyncResult = { status: string; result?: unknown; errorCode?: string; errorMessage?: string };

function mutation(clientId: string, businessId: string, clientMutationId: string, mutationType: string, payload: unknown) {
  return { clientId, clientMutationId, businessId, mutationType, occurredAt: new Date().toISOString(), payload };
}

async function push(accessToken: string, oneMutation: ReturnType<typeof mutation>): Promise<SyncResult> {
  const response = await app.inject({ method: "POST", url: "/v1/sync", headers: bearer(accessToken), payload: { mutations: [oneMutation] } });
  expect(response.statusCode).toBe(200);
  return response.json<{ mutationResults: SyncResult[] }>().mutationResults[0]!;
}

async function register(email: string, deviceKey: string) {
  const response = await app.inject({ method: "POST", url: "/v1/auth/register", payload: {
    displayName: email.split("@")[0], email, password: "TradeOS-Test-1234", platform: "WEB", deviceKey, appVersion: "test",
  } });
  expect(response.statusCode).toBe(201);
  return response.json<{ session: { accessToken: string } }>().session;
}

async function createBusiness(accessToken: string, name: string) {
  const response = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers: bearer(accessToken), payload: { name, businessType: "SERVICES", branchName: "Main" } });
  expect(response.statusCode).toBe(201);
  return { businessId: response.json().business.id as string };
}

async function grantRole(businessId: string, email: string, role: "VIEWER") {
  const user = await pool.query<{ id: string }>(`SELECT id FROM app_users WHERE lower(email)=lower($1)`, [email]);
  const staff = await pool.query<{ id: string }>(`INSERT INTO staff (business_id,display_name,email,role) VALUES ($1,$2,$3,$4) RETURNING id`, [businessId,"Viewer",email,role]);
  await pool.query(`INSERT INTO business_memberships (business_id,user_id,staff_id,role,status) VALUES ($1,$2,$3,$4,'ACTIVE')`, [businessId,user.rows[0]!.id,staff.rows[0]!.id,role]);
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
