import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users, businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("customer lifecycle and optimistic concurrency", () => {
  it("requires the current revision and separates profile edits from credit/status control", async () => {
    const owner = await register("customer-lifecycle@tradeos.test", "customer-lifecycle-device");
    const business = await createBusiness(owner.accessToken);
    const created = await createCustomer(owner.accessToken, business.businessId, {
      name: "Ama Mensah",
      phone: "0240000000",
      creditLimitMinor: 5000,
      creditTermsDays: 30,
    });

    await setOwnerRole(business.businessId, "CASHIER");
    const cashierProfile = await patchCustomer(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: created.updatedAt,
      name: "Ama A. Mensah",
    });
    expect(cashierProfile.statusCode).toBe(200);
    const afterCashier = cashierProfile.json<{ customer: { name: string; updatedAt: string } }>().customer;
    expect(afterCashier.name).toBe("Ama A. Mensah");

    const cashierCredit = await patchCustomer(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: afterCashier.updatedAt,
      creditLimitMinor: 9000,
    });
    expect(cashierCredit.statusCode).toBe(403);

    await setOwnerRole(business.businessId, "SALES");
    const salesProfile = await patchCustomer(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: afterCashier.updatedAt,
      phone: "0201112222",
    });
    expect(salesProfile.statusCode).toBe(200);
    const afterSales = salesProfile.json<{ customer: { phone: string; updatedAt: string } }>().customer;
    expect(afterSales.phone).toBe("0201112222");

    await setOwnerRole(business.businessId, "OWNER");
    const stale = await patchCustomer(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: created.updatedAt,
      email: "stale@example.com",
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: string }>().error).toBe("STALE_VERSION");

    const missingRevision = await patchCustomer(owner.accessToken, business.businessId, created.id, {
      email: "missing@example.com",
    });
    expect(missingRevision.statusCode).toBe(400);
  });

  it("deactivates/reactivates without rewriting history and blocks new account activity while inactive", async () => {
    const owner = await register("customer-history@tradeos.test", "customer-history-device");
    const business = await createBusiness(owner.accessToken);
    const serviceId = await createService(owner.accessToken, business.businessId);
    const created = await createCustomer(owner.accessToken, business.businessId, {
      name: "History Customer",
      creditLimitMinor: 5000,
      creditTermsDays: 30,
    });

    const sale = await sync(owner.accessToken, {
      clientId: "customer-history-device",
      clientMutationId: "customer-history-sale",
      businessId: business.businessId,
      branchId: business.branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        customerId: created.id,
        paymentMethod: "CUSTOMER_CREDIT",
        lines: [{ itemId: serviceId, quantity: 1, saleUnitCode: "service" }],
      },
    });
    expect(sale.status).toBe("APPLIED");

    const before = await getCustomer(owner.accessToken, business.businessId, created.id);
    expect(before.ledger).toHaveLength(1);
    expect(before.obligations).toHaveLength(1);

    const deactivate = await patchCustomer(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: before.customer.updatedAt,
      active: false,
    });
    expect(deactivate.statusCode).toBe(200);
    const inactive = deactivate.json<{ customer: { active: boolean; updatedAt: string } }>().customer;
    expect(inactive.active).toBe(false);

    const afterDeactivate = await getCustomer(owner.accessToken, business.businessId, created.id);
    expect(afterDeactivate.ledger).toHaveLength(1);
    expect(afterDeactivate.obligations).toHaveLength(1);

    const blockedSale = await sync(owner.accessToken, {
      clientId: "customer-history-device",
      clientMutationId: "customer-inactive-sale",
      businessId: business.businessId,
      branchId: business.branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        customerId: created.id,
        paymentMethod: "CUSTOMER_CREDIT",
        lines: [{ itemId: serviceId, quantity: 1, saleUnitCode: "service" }],
      },
    });
    expect(blockedSale).toMatchObject({ status: "REJECTED", errorCode: "CUSTOMER_INACTIVE" });

    const blockedPayment = await sync(owner.accessToken, {
      clientId: "customer-history-device",
      clientMutationId: "customer-inactive-payment",
      businessId: business.businessId,
      branchId: business.branchId,
      mutationType: "CUSTOMER_PAYMENT_CREATE",
      occurredAt: new Date().toISOString(),
      payload: { customerId: created.id, amountMinor: 100, method: "CASH" },
    });
    expect(blockedPayment).toMatchObject({ status: "REJECTED", errorCode: "CUSTOMER_INACTIVE" });

    const lifecycleEvents = await pool.query<{ event_type: string; payload: { changes?: Record<string, { before: unknown; after: unknown }> } }>(
      `SELECT event_type,payload FROM audit_events
       WHERE business_id=$1 AND entity_type='CUSTOMER' AND entity_id=$2
       ORDER BY occurred_at,id`,
      [business.businessId, created.id],
    );
    expect(lifecycleEvents.rows.some((row) => row.event_type === "CUSTOMER_DEACTIVATED")).toBe(true);
    const deactivation = lifecycleEvents.rows.find((row) => row.event_type === "CUSTOMER_DEACTIVATED");
    expect(deactivation?.payload.changes?.active).toEqual({ before: true, after: false });

    const reactivate = await patchCustomer(owner.accessToken, business.businessId, created.id, {
      expectedUpdatedAt: inactive.updatedAt,
      active: true,
    });
    expect(reactivate.statusCode).toBe(200);
    expect(reactivate.json<{ customer: { active: boolean } }>().customer.active).toBe(true);

    const eventsAfterReactivate = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM audit_events WHERE business_id=$1 AND entity_type='CUSTOMER' AND entity_id=$2`,
      [business.businessId, created.id],
    );
    expect(eventsAfterReactivate.rows.some((row) => row.event_type === "CUSTOMER_REACTIVATED")).toBe(true);
  });
});

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { displayName: "Customer Lifecycle Owner", email, password: "TradeOS-Test-1234", platform: "WEB", deviceKey, appVersion: "test" },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ session: { accessToken: string } }>().session;
}

async function createBusiness(accessToken: string) {
  const response = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers: bearer(accessToken), payload: { name: "Customer Lifecycle", businessType: "SERVICES", branchName: "Main" } });
  expect(response.statusCode).toBe(201);
  const body = response.json<{ business: { id: string }; branch: { id: string } }>();
  return { businessId: body.business.id, branchId: body.branch.id };
}

async function createCustomer(accessToken: string, businessId: string, fields: Record<string, unknown>) {
  const response = await app.inject({ method: "POST", url: "/v1/customers", headers: bearer(accessToken), payload: { businessId, ...fields } });
  expect(response.statusCode).toBe(201);
  return response.json<{ customer: { id: string; updatedAt: string } }>().customer;
}

async function patchCustomer(accessToken: string, businessId: string, customerId: string, fields: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/v1/customers/${customerId}`, headers: bearer(accessToken), payload: { businessId, ...fields } });
}

async function getCustomer(accessToken: string, businessId: string, customerId: string) {
  const response = await app.inject({ method: "GET", url: `/v1/customers/${customerId}?businessId=${businessId}`, headers: bearer(accessToken) });
  expect(response.statusCode).toBe(200);
  return response.json<{
    customer: { updatedAt: string; active: boolean };
    ledger: Array<unknown>;
    obligations: Array<unknown>;
  }>();
}

async function createService(accessToken: string, businessId: string): Promise<string> {
  const response = await app.inject({
    method: "POST", url: "/v1/catalog/items", headers: bearer(accessToken),
    payload: { businessId, name: "Lifecycle Service", kind: "SERVICE", units: [{ code: "service", label: "Service", canSell: true, defaultSalePriceMinor: 1000 }] },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ item: { id: string } }>().item.id;
}

async function sync(accessToken: string, mutation: Record<string, unknown>) {
  const response = await app.inject({ method: "POST", url: "/v1/sync", headers: bearer(accessToken), payload: { mutations: [mutation] } });
  expect(response.statusCode).toBe(200);
  return response.json<{ mutationResults: Array<{ status: string; errorCode?: string }> }>().mutationResults[0]!;
}

async function setOwnerRole(businessId: string, role: string): Promise<void> {
  await pool.query(`UPDATE business_memberships SET role=$2 WHERE business_id=$1 AND role IN ('OWNER','CASHIER','SALES')`, [businessId, role]);
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }
