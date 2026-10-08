import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

type Setup = {
  accessToken: string;
  deviceKey: string;
  businessId: string;
  branchId: string;
  itemId: string;
  actorStaffId: string;
};

describe("inventory adjustment engine", () => {
  it("reclassifies stock idempotently, preserves valuation and records the authenticated actor", async () => {
    const setup = await createInventory("adjust-owner@tradeos.test", "adjust-device", "Adjustment Shop", 10, 10_000);
    const payload = {
      itemId: setup.itemId,
      sourceLocation: "AVAILABLE",
      destinationLocation: "QUARANTINE",
      quantity: 4,
      reasonCode: "QUARANTINE",
      note: "Packaging damaged during count",
      actorStaffId: "00000000-0000-4000-8000-000000000000",
    };

    const first = await push(setup, "reclass-1", payload);
    expect(first.status).toBe("APPLIED");
    expect(first.result).toMatchObject({
      sourceLocation: "AVAILABLE",
      destinationLocation: "QUARANTINE",
      quantity: 4,
      movedValueMinor: 4000,
      balances: { AVAILABLE: 6, QUARANTINE: 4, DAMAGED: 0, WASTE: 0 },
      inventoryValueMinor: 10_000,
    });
    const adjustmentId = (first.result as { adjustmentId: string }).adjustmentId;
    expect(adjustmentId).toMatch(/^[0-9a-f-]{36}$/i);

    const replay = await push(setup, "reclass-1", payload);
    expect(replay.status).toBe("APPLIED");
    expect((replay.result as { adjustmentId: string }).adjustmentId).toBe(adjustmentId);

    const movements = await pool.query<{
      quantity_delta: string;
      location_type: string;
      actor_staff_id: string | null;
      reference_id: string;
    }>(
      `SELECT quantity_delta,location_type,actor_staff_id,reference_id
       FROM inventory_movements WHERE business_id=$1 AND reference_type='INVENTORY_ADJUSTMENT' ORDER BY quantity_delta`,
      [setup.businessId],
    );
    expect(movements.rows).toEqual([
      { quantity_delta: "-4.00000000", location_type: "AVAILABLE", actor_staff_id: setup.actorStaffId, reference_id: adjustmentId },
      { quantity_delta: "4.00000000", location_type: "QUARANTINE", actor_staff_id: setup.actorStaffId, reference_id: adjustmentId },
    ]);

    const valuations = await pool.query<{ location_type: string; quantity: string; value_minor: string }>(
      `SELECT location_type,quantity,value_minor FROM inventory_valuations
       WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 ORDER BY location_type`,
      [setup.businessId, setup.branchId, setup.itemId],
    );
    expect(valuations.rows).toEqual([
      { location_type: "AVAILABLE", quantity: "6.00000000", value_minor: "6000" },
      { location_type: "QUARANTINE", quantity: "4.00000000", value_minor: "4000" },
    ]);
    expect(Number((await pool.query(
      `SELECT COUNT(*) FROM inventory_movements WHERE business_id=$1 AND reference_type='INVENTORY_ADJUSTMENT'`,
      [setup.businessId],
    )).rows[0].count)).toBe(2);

    const audit = await pool.query<{ actor_staff_id: string | null; event_type: string; payload: Record<string, unknown> }>(
      `SELECT actor_staff_id,event_type,payload FROM audit_events
       WHERE business_id=$1 AND entity_type='INVENTORY_ADJUSTMENT' AND entity_id=$2`,
      [setup.businessId, adjustmentId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_staff_id: setup.actorStaffId, event_type: "INVENTORY_ADJUSTMENT_CREATED" });
    expect(audit.rows[0]!.payload).toMatchObject({ itemId: setup.itemId, reasonCode: "QUARANTINE", note: "Packaging damaged during count" });
  });

  it("rejects insufficient source stock and isolates adjustments by branch and tenant", async () => {
    const setup = await createInventory("adjust-isolation@tradeos.test", "adjust-isolation-device", "Isolation Shop", 5, 5000);
    const otherBranchId = (await pool.query<{ id: string }>(
      `INSERT INTO branches (business_id,name,code) VALUES ($1,'Warehouse','WH') RETURNING id`,
      [setup.businessId],
    )).rows[0]!.id;

    const tooMuch = await push(setup, "too-much", {
      itemId: setup.itemId,
      sourceLocation: "AVAILABLE",
      destinationLocation: "DAMAGED",
      quantity: 6,
      reasonCode: "DAMAGE",
      note: "Physical damage",
    });
    expect(tooMuch).toMatchObject({ status: "REJECTED", errorCode: "INVENTORY_INSUFFICIENT_STOCK" });

    const wrongBranch = await push({ ...setup, branchId: otherBranchId }, "wrong-branch", {
      itemId: setup.itemId,
      sourceLocation: "AVAILABLE",
      destinationLocation: "QUARANTINE",
      quantity: 1,
      reasonCode: "QUARANTINE",
    });
    expect(wrongBranch).toMatchObject({ status: "REJECTED", errorCode: "INVENTORY_INSUFFICIENT_STOCK" });

    const other = await createInventory("adjust-other@tradeos.test", "adjust-other-device", "Other Tenant", 3, 3000);
    const wrongTenantItem = await push(setup, "wrong-tenant-item", {
      itemId: other.itemId,
      sourceLocation: "AVAILABLE",
      destinationLocation: "WASTE",
      quantity: 1,
      reasonCode: "WASTE",
    });
    expect(wrongTenantItem).toMatchObject({ status: "REJECTED", errorCode: "INVENTORY_ITEM_NOT_FOUND" });

    expect(await locationBalance(setup, "AVAILABLE")).toBe(5);
    expect(await locationBalance(setup, "DAMAGED")).toBe(0);
  });

  it("supports count corrections with valuation-safe cost and blocks unauthorized roles before ingestion", async () => {
    const setup = await createInventory("adjust-count@tradeos.test", "adjust-count-device", "Count Shop", 8, 8000);

    const add = await push(setup, "count-add", {
      itemId: setup.itemId,
      destinationLocation: "AVAILABLE",
      quantity: 2,
      reasonCode: "COUNT_CORRECTION",
      note: "Two units found during physical count",
    });
    expect(add.status).toBe("APPLIED");
    expect(add.result).toMatchObject({ quantity: 2, movedValueMinor: 2000, balances: { AVAILABLE: 10 }, inventoryValueMinor: 10_000 });

    const remove = await push(setup, "count-remove", {
      itemId: setup.itemId,
      sourceLocation: "AVAILABLE",
      quantity: 1,
      reasonCode: "COUNT_CORRECTION",
      note: "One unit missing",
    });
    expect(remove.status).toBe("APPLIED");
    expect(remove.result).toMatchObject({ quantity: 1, movedValueMinor: 1000, balances: { AVAILABLE: 9 }, inventoryValueMinor: 9000 });

    for (const role of ["OWNER", "ADMIN", "MANAGER", "INVENTORY"]) {
      await pool.query(`UPDATE business_memberships SET role=$2 WHERE business_id=$1`, [setup.businessId, role]);
      const result = await push(setup, `role-${role}`, {
        itemId: setup.itemId,
        sourceLocation: "AVAILABLE",
        destinationLocation: "QUARANTINE",
        quantity: 0.1,
        reasonCode: "QUARANTINE",
      });
      expect(result.status).toBe("APPLIED");
    }

    await pool.query(`UPDATE business_memberships SET role='VIEWER' WHERE business_id=$1`, [setup.businessId]);
    const before = Number((await pool.query(`SELECT COUNT(*) FROM sync_mutations WHERE business_id=$1`, [setup.businessId])).rows[0].count);
    const denied = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: bearer(setup.accessToken),
      payload: {
        mutations: [mutation(setup, "viewer-adjust", {
          itemId: setup.itemId,
          sourceLocation: "AVAILABLE",
          destinationLocation: "WASTE",
          quantity: 0.1,
          reasonCode: "WASTE",
        })],
      },
    });
    expect(denied.statusCode).toBe(403);
    const after = Number((await pool.query(`SELECT COUNT(*) FROM sync_mutations WHERE business_id=$1`, [setup.businessId])).rows[0].count);
    expect(after).toBe(before);
  });
});

async function createInventory(email: string, deviceKey: string, name: string, quantity: number, valueMinor: number): Promise<Setup> {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { displayName: name, email, password: "TradeOS-Test-1234", platform: "WEB", deviceKey, appVersion: "test" },
  });
  expect(registration.statusCode).toBe(201);
  const accessToken = registration.json<{ session: { accessToken: string } }>().session.accessToken;
  const onboard = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers: bearer(accessToken),
    payload: { name, businessType: "RETAIL", branchName: "Main" },
  });
  expect(onboard.statusCode, onboard.body).toBe(201);
  const businessId = onboard.json<{ business: { id: string } }>().business.id;
  const branchId = onboard.json<{ branch: { id: string } }>().branch.id;
  const catalog = await app.inject({
    method: "POST",
    url: "/v1/catalog/items",
    headers: bearer(accessToken),
    payload: {
      businessId,
      name: `${name} Item`,
      kind: "PRODUCT",
      trackStock: true,
      stockUnitCode: "piece",
      units: [{ code: "piece", label: "Piece", canStock: true, canPurchase: true, canSell: true, defaultSalePriceMinor: 2500 }],
      openingStock: { branchId, quantity },
    },
  });
  expect(catalog.statusCode, catalog.body).toBe(201);
  const itemId = catalog.json<{ item: { id: string } }>().item.id;
  await pool.query(
    `INSERT INTO inventory_valuations (business_id,branch_id,item_id,location_type,quantity,value_minor)
     VALUES ($1,$2,$3,'AVAILABLE',$4,$5)
     ON CONFLICT (business_id,branch_id,item_id,location_type) DO UPDATE SET quantity=EXCLUDED.quantity,value_minor=EXCLUDED.value_minor`,
    [businessId, branchId, itemId, quantity, valueMinor],
  );
  const actorStaffId = (await pool.query<{ staff_id: string }>(
    `SELECT staff_id FROM business_memberships WHERE business_id=$1`, [businessId],
  )).rows[0]!.staff_id;
  return { accessToken, deviceKey, businessId, branchId, itemId, actorStaffId };
}

function mutation(setup: Setup, clientMutationId: string, payload: Record<string, unknown>) {
  return {
    clientId: setup.deviceKey,
    clientMutationId,
    businessId: setup.businessId,
    branchId: setup.branchId,
    mutationType: "INVENTORY_ADJUSTMENT_CREATE",
    occurredAt: new Date().toISOString(),
    payload,
  };
}

async function push(setup: Setup, clientMutationId: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/sync",
    headers: bearer(setup.accessToken),
    payload: { mutations: [mutation(setup, clientMutationId, payload)] },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ mutationResults: Array<{ status: string; errorCode?: string; result?: unknown }> }>().mutationResults[0]!;
}

async function locationBalance(setup: Setup, location: string): Promise<number> {
  return Number((await pool.query(
    `SELECT COALESCE(SUM(quantity_delta),0) AS quantity FROM inventory_movements
     WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 AND location_type=$4`,
    [setup.businessId, setup.branchId, setup.itemId, location],
  )).rows[0].quantity);
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
