import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";

const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function createFixture(deviceKey: string, email: string) {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: "Legacy Buyer",
      email,
      password: "TradeOS-Test-1234",
      platform: "WEB",
      deviceKey,
      appVersion: "legacy-test",
    },
  });
  expect(registration.statusCode).toBe(201);
  const headers = { authorization: `Bearer ${registration.json().session.accessToken}` };

  const onboard = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers,
    payload: { name: "Legacy Retry Shop", businessType: "DRINKING_SPOT", branchName: "Main" },
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

  const staff = await pool.query<{ id: string }>(
    `SELECT s.id
     FROM staff s
     JOIN business_memberships bm ON bm.staff_id=s.id
     WHERE bm.business_id=$1 AND bm.is_active=true
     LIMIT 1`,
    [businessId],
  );
  const receivedByStaffId = staff.rows[0]?.id;
  expect(receivedByStaffId).toBeTruthy();

  return {
    headers,
    businessId,
    branchId,
    supplierId,
    itemId: catalog.json().item.id as string,
    receivedByStaffId: receivedByStaffId!,
  };
}

function legacyMutation(input: {
  deviceKey: string;
  clientMutationId: string;
  businessId: string;
  branchId: string;
  supplierId: string;
  itemId: string;
  receivedByStaffId: string;
}) {
  return {
    clientId: input.deviceKey,
    clientMutationId: input.clientMutationId,
    businessId: input.businessId,
    branchId: input.branchId,
    mutationType: "PURCHASE_RECEIVE_CREATE",
    occurredAt: new Date().toISOString(),
    payload: {
      supplierId: input.supplierId,
      receivedByStaffId: input.receivedByStaffId,
      currencyCode: "GHS",
      lines: [{ itemId: input.itemId, quantity: 2, costMinor: 12000 }],
    },
  };
}

async function seedHistoricalRejection(mutation: ReturnType<typeof legacyMutation>, errorMessage: string) {
  await pool.query(
    `INSERT INTO sync_mutations (
       business_id,branch_id,client_id,client_mutation_id,mutation_type,request_payload,status,result_payload,applied_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'REJECTED',$7::jsonb,now())`,
    [
      mutation.businessId,
      mutation.branchId,
      mutation.clientId,
      mutation.clientMutationId,
      mutation.mutationType,
      JSON.stringify(mutation),
      JSON.stringify({ errorCode: "PURCHASE_INVALID", errorMessage }),
    ],
  );
}

describe("legacy rejected purchase retry compatibility", () => {
  it("reopens the historical missing-settlement rejection and applies the original mutation exactly once", async () => {
    const deviceKey = "legacy-retry-device";
    const fixture = await createFixture(deviceKey, "legacy-retry@tradeos.test");
    const mutation = legacyMutation({ deviceKey, clientMutationId: "legacy-rejected-payment-method", ...fixture });
    await seedHistoricalRejection(mutation, "Invalid settlement method");

    const sync = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: fixture.headers,
      payload: { mutations: [mutation] },
    });

    expect(sync.statusCode).toBe(200);
    expect(sync.json().mutationResults[0]).toMatchObject({
      clientMutationId: mutation.clientMutationId,
      status: "APPLIED",
    });

    const purchase = await pool.query<{ settlement_method: string; total_minor: string }>(
      `SELECT settlement_method,total_minor
       FROM purchases
       WHERE business_id=$1 AND client_mutation_id=$2`,
      [fixture.businessId, mutation.clientMutationId],
    );
    expect(purchase.rows).toEqual([{ settlement_method: "SUPPLIER_CREDIT", total_minor: "24000" }]);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: fixture.headers,
      payload: { mutations: [mutation] },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().mutationResults[0].status).toBe("APPLIED");

    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM purchases WHERE business_id=$1 AND client_mutation_id=$2`,
      [fixture.businessId, mutation.clientMutationId],
    );
    expect(Number(count.rows[0]!.count)).toBe(1);
  });

  it("keeps unrelated rejected mutations immutable", async () => {
    const deviceKey = "legacy-no-reopen-device";
    const fixture = await createFixture(deviceKey, "legacy-no-reopen@tradeos.test");
    const mutation = legacyMutation({ deviceKey, clientMutationId: "legacy-rejected-other-error", ...fixture });
    await seedHistoricalRejection(mutation, "Item/unit is not configured for purchasing");

    const sync = await app.inject({
      method: "POST",
      url: "/v1/sync",
      headers: fixture.headers,
      payload: { mutations: [mutation] },
    });

    expect(sync.statusCode).toBe(200);
    expect(sync.json().mutationResults[0]).toMatchObject({
      clientMutationId: mutation.clientMutationId,
      status: "REJECTED",
      errorCode: "PURCHASE_INVALID",
      errorMessage: "Item/unit is not configured for purchasing",
    });

    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM purchases WHERE business_id=$1 AND client_mutation_id=$2`,
      [fixture.businessId, mutation.clientMutationId],
    );
    expect(Number(count.rows[0]!.count)).toBe(0);
  });
});
