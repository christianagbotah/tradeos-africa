import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("catalog lifecycle CRUD", () => {
  it("reads, updates, archives and reactivates a catalog item with revision audit", async () => {
    const owner = await register("catalog-owner@tradeos.test", "catalog-owner-device");
    const business = await createBusiness(owner.accessToken, "Catalog Lifecycle");
    const created = await createService(owner.accessToken, business.businessId, "Consultation", "CONSULT-1", 5000);

    const detail = await getItem(owner.accessToken, business.businessId, created.id);
    expect(detail.statusCode).toBe(200);
    const first = detail.json<{ item: CatalogItemView }>().item;
    expect(first).toMatchObject({ name: "Consultation", sku: "CONSULT-1", active: true });
    expect(first.createdAt).toBeTruthy();
    expect(first.updatedAt).toBeTruthy();

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/catalog/items/${created.id}`,
      headers: bearer(owner.accessToken),
      payload: {
        businessId: business.businessId,
        expectedUpdatedAt: first.updatedAt,
        name: "Premium consultation",
        units: [{ code: "service", label: "Service", canSell: true, defaultSalePriceMinor: 6500 }],
      },
    });
    expect(updated.statusCode).toBe(200);
    const second = updated.json<{ item: CatalogItemView }>().item;
    expect(second.name).toBe("Premium consultation");
    expect(second.units[0]?.defaultSalePriceMinor).toBe(6500);
    expect(second.updatedAt).not.toBe(first.updatedAt);

    const archived = await patchStatus(owner.accessToken, business.businessId, created.id, second.updatedAt, false);
    expect(archived.statusCode).toBe(200);
    const third = archived.json<{ item: CatalogItemView }>().item;
    expect(third.active).toBe(false);

    const reactivated = await patchStatus(owner.accessToken, business.businessId, created.id, third.updatedAt, true);
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json<{ item: CatalogItemView }>().item.active).toBe(true);

    const events = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_events WHERE business_id=$1 AND entity_type='CATALOG_ITEM' AND entity_id=$2 ORDER BY occurred_at,id`,
      [business.businessId, created.id],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining([
      "CATALOG_ITEM_CREATED",
      "CATALOG_ITEM_UPDATED",
      "CATALOG_ITEM_ARCHIVED",
      "CATALOG_ITEM_REACTIVATED",
    ]));
  });

  it("rejects stale catalog updates and preserves the newer server record", async () => {
    const owner = await register("stale-owner@tradeos.test", "stale-device");
    const business = await createBusiness(owner.accessToken, "Stale Catalog");
    const created = await createService(owner.accessToken, business.businessId, "Initial service", null, 3000);
    const initial = (await getItem(owner.accessToken, business.businessId, created.id)).json<{ item: CatalogItemView }>().item;

    const firstWrite = await app.inject({
      method: "PATCH",
      url: `/v1/catalog/items/${created.id}`,
      headers: bearer(owner.accessToken),
      payload: { businessId: business.businessId, expectedUpdatedAt: initial.updatedAt, name: "First writer" },
    });
    expect(firstWrite.statusCode).toBe(200);

    const staleWrite = await app.inject({
      method: "PATCH",
      url: `/v1/catalog/items/${created.id}`,
      headers: bearer(owner.accessToken),
      payload: { businessId: business.businessId, expectedUpdatedAt: initial.updatedAt, name: "Stale writer" },
    });
    expect(staleWrite.statusCode).toBe(409);
    expect(staleWrite.json<{ error: string }>().error).toBe("STALE_VERSION");

    const current = (await getItem(owner.accessToken, business.businessId, created.id)).json<{ item: CatalogItemView }>().item;
    expect(current.name).toBe("First writer");
  });

  it("allows only OWNER or ADMIN to permanently delete an unused item", async () => {
    const owner = await register("delete-owner@tradeos.test", "delete-owner-device");
    const business = await createBusiness(owner.accessToken, "Delete Catalog");
    const created = await createService(owner.accessToken, business.businessId, "Unused service", null, 2500);
    const item = (await getItem(owner.accessToken, business.businessId, created.id)).json<{ item: CatalogItemView }>().item;

    const inventory = await register("inventory-user@tradeos.test", "inventory-device");
    await grantRole(business.businessId, "inventory-user@tradeos.test", "INVENTORY");

    const denied = await app.inject({
      method: "DELETE",
      url: `/v1/catalog/items/${created.id}?businessId=${business.businessId}&expectedUpdatedAt=${encodeURIComponent(item.updatedAt)}`,
      headers: bearer(inventory.accessToken),
    });
    expect(denied.statusCode).toBe(403);

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/catalog/items/${created.id}?businessId=${business.businessId}&expectedUpdatedAt=${encodeURIComponent(item.updatedAt)}`,
      headers: bearer(owner.accessToken),
    });
    expect(removed.statusCode).toBe(204);
    expect((await getItem(owner.accessToken, business.businessId, created.id)).statusCode).toBe(404);
  });

  it("blocks delete and structural rewrites when inventory history exists", async () => {
    const owner = await register("inventory-history@tradeos.test", "inventory-history-device");
    const business = await createBusiness(owner.accessToken, "Inventory History");
    const created = await createTrackedProduct(owner.accessToken, business.businessId, business.branchId, "Tracked malt", true);
    const item = (await getItem(owner.accessToken, business.businessId, created.id)).json<{ item: CatalogItemView }>().item;

    const structural = await app.inject({
      method: "PATCH",
      url: `/v1/catalog/items/${created.id}`,
      headers: bearer(owner.accessToken),
      payload: {
        businessId: business.businessId,
        expectedUpdatedAt: item.updatedAt,
        stockUnitCode: "case",
        units: [{ code: "case", label: "Case", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 24000 }],
      },
    });
    expect(structural.statusCode).toBe(409);
    expect(structural.json<{ error: string }>().error).toBe("CATALOG_STRUCTURE_LOCKED");

    const removed = await deleteItem(owner.accessToken, business.businessId, created.id, item.updatedAt);
    expect(removed.statusCode).toBe(409);
    expect(removed.json<{ error: string }>().error).toBe("CATALOG_ITEM_IN_USE");
  });

  it("blocks permanent delete after sale or purchase history", async () => {
    const owner = await register("commerce-history@tradeos.test", "commerce-history-device");
    const business = await createBusiness(owner.accessToken, "Commerce History");

    const service = await createService(owner.accessToken, business.businessId, "Sold service", null, 4000);
    const sold = await sync(owner.accessToken, "commerce-history-device", business, "sale-history", "SALE_CREATE", {
      paymentMethod: "CASH",
      lines: [{ itemId: service.id, saleUnitCode: "service", quantity: 1 }],
    });
    expect(sold.status).toBe("APPLIED");
    const soldItem = (await getItem(owner.accessToken, business.businessId, service.id)).json<{ item: CatalogItemView }>().item;
    expect((await deleteItem(owner.accessToken, business.businessId, service.id, soldItem.updatedAt)).json<{ error: string }>().error).toBe("CATALOG_ITEM_IN_USE");

    const product = await createTrackedProduct(owner.accessToken, business.businessId, business.branchId, "Purchased product", false);
    const supplier = await app.inject({
      method: "POST",
      url: "/v1/suppliers",
      headers: bearer(owner.accessToken),
      payload: { businessId: business.businessId, name: "Lifecycle Supplier" },
    });
    expect(supplier.statusCode).toBe(201);
    const purchased = await sync(owner.accessToken, "commerce-history-device", business, "purchase-history", "PURCHASE_RECEIVE_CREATE", {
      supplierId: supplier.json().supplier.id,
      settlementMethod: "CASH",
      receivedByStaffId: "00000000-0000-4000-8000-000000000000",
      lines: [{ itemId: product.id, purchaseUnitCode: "piece", quantity: 1, unitCostMinor: 1200 }],
    });
    expect(purchased.status).toBe("APPLIED");
    const purchasedItem = (await getItem(owner.accessToken, business.businessId, product.id)).json<{ item: CatalogItemView }>().item;
    const deletePurchased = await deleteItem(owner.accessToken, business.businessId, product.id, purchasedItem.updatedAt);
    expect(deletePurchased.statusCode).toBe(409);
    expect(deletePurchased.json<{ error: string }>().error).toBe("CATALOG_ITEM_IN_USE");
  });

  it("blocks permanent delete when an item participates in a recipe definition", async () => {
    const owner = await register("recipe-history@tradeos.test", "recipe-history-device");
    const business = await createBusiness(owner.accessToken, "Recipe History");
    const output = await createService(owner.accessToken, business.businessId, "Recipe output", null, 5000);
    const component = await createTrackedProduct(owner.accessToken, business.businessId, business.branchId, "Recipe component", false);
    const definition = await pool.query<{ id: string }>(
      `INSERT INTO consumption_definitions (business_id,output_item_id,output_quantity,output_unit_code) VALUES ($1,$2,1,'service') RETURNING id`,
      [business.businessId, output.id],
    );
    await pool.query(
      `INSERT INTO consumption_components (definition_id,component_item_id,stock_unit_code,quantity_per_output,expected_waste_percent) VALUES ($1,$2,'piece',1,0)`,
      [definition.rows[0]!.id, component.id],
    );

    for (const itemId of [output.id, component.id]) {
      const item = (await getItem(owner.accessToken, business.businessId, itemId)).json<{ item: CatalogItemView }>().item;
      const response = await deleteItem(owner.accessToken, business.businessId, itemId, item.updatedAt);
      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: string }>().error).toBe("CATALOG_ITEM_IN_USE");
    }
  });
});

type CatalogItemView = {
  id: string;
  name: string;
  sku: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  units: Array<{ code: string; label: string; defaultSalePriceMinor: number | null }>;
};

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { displayName: email.split("@")[0], email, password: "TradeOS-Test-1234", platform: "WEB", deviceKey, appVersion: "test" },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ session: { accessToken: string } }>().session;
}

async function createBusiness(accessToken: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers: bearer(accessToken),
    payload: { name, businessType: "SERVICES", branchName: "Main" },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{ business: { id: string }; branch: { id: string } }>();
  return { businessId: body.business.id, branchId: body.branch.id };
}

async function createService(accessToken: string, businessId: string, name: string, sku: string | null, priceMinor: number) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/catalog/items",
    headers: bearer(accessToken),
    payload: {
      businessId,
      name,
      ...(sku ? { sku } : {}),
      kind: "SERVICE",
      units: [{ code: "service", label: "Service", canSell: true, defaultSalePriceMinor: priceMinor }],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ item: { id: string } }>().item;
}

async function createTrackedProduct(accessToken: string, businessId: string, branchId: string, name: string, openingStock: boolean) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/catalog/items",
    headers: bearer(accessToken),
    payload: {
      businessId,
      name,
      kind: "PRODUCT",
      trackStock: true,
      stockUnitCode: "piece",
      units: [{ code: "piece", label: "Piece", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 2000 }],
      ...(openingStock ? { openingStock: { branchId, quantity: 5 } } : {}),
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ item: { id: string } }>().item;
}

async function getItem(accessToken: string, businessId: string, itemId: string) {
  return app.inject({ method: "GET", url: `/v1/catalog/items/${itemId}?businessId=${businessId}`, headers: bearer(accessToken) });
}

async function patchStatus(accessToken: string, businessId: string, itemId: string, expectedUpdatedAt: string, active: boolean) {
  return app.inject({
    method: "PATCH",
    url: `/v1/catalog/items/${itemId}`,
    headers: bearer(accessToken),
    payload: { businessId, expectedUpdatedAt, active },
  });
}

async function deleteItem(accessToken: string, businessId: string, itemId: string, expectedUpdatedAt: string) {
  return app.inject({
    method: "DELETE",
    url: `/v1/catalog/items/${itemId}?businessId=${businessId}&expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`,
    headers: bearer(accessToken),
  });
}

async function sync(accessToken: string, clientId: string, business: { businessId: string; branchId: string }, mutationId: string, mutationType: string, payload: unknown) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/sync",
    headers: bearer(accessToken),
    payload: { mutations: [{ clientId, clientMutationId: mutationId, businessId: business.businessId, branchId: business.branchId, mutationType, occurredAt: new Date().toISOString(), payload }] },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ mutationResults: Array<{ status: string; errorCode?: string; result?: any }> }>().mutationResults[0]!;
}

async function grantRole(businessId: string, email: string, role: "INVENTORY") {
  const user = await pool.query<{ id: string }>(`SELECT id FROM app_users WHERE lower(email)=lower($1)`, [email]);
  const staff = await pool.query<{ id: string }>(
    `INSERT INTO staff (business_id,display_name,email,role) VALUES ($1,$2,$3,$4) RETURNING id`,
    [businessId, "Inventory User", email, role],
  );
  await pool.query(
    `INSERT INTO business_memberships (business_id,user_id,staff_id,role,status) VALUES ($1,$2,$3,$4,'ACTIVE')`,
    [businessId, user.rows[0]!.id, staff.rows[0]!.id, role],
  );
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
