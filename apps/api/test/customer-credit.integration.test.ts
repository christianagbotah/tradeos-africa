import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users, businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("customer credit and receivables", () => {
  it("posts credit sales, enforces the limit, receives payment and reverses credit on refund", async () => {
    const owner = await register("credit-owner@tradeos.test", "credit-device");
    const business = await createBusiness(owner.accessToken);
    const serviceId = await createService(owner.accessToken, business.businessId, 5000);

    const customerResponse = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: bearer(owner.accessToken),
      payload: {
        businessId: business.businessId,
        name: "Ama Mensah",
        phone: "0240000000",
        creditLimitMinor: 6000,
        creditTermsDays: 30,
      },
    });
    expect(customerResponse.statusCode).toBe(201);
    const customer = customerResponse.json<{ customer: { id: string; creditLimitMinor: number; creditTermsDays: number } }>().customer;
    expect(customer.creditLimitMinor).toBe(6000);
    expect(customer.creditTermsDays).toBe(30);

    const creditSaleOccurredAt = new Date().toISOString();
    const firstSale = await sync(owner.accessToken, {
      clientId: "credit-device",
      clientMutationId: "credit-sale-001",
      businessId: business.businessId,
      branchId: business.branchId,
      mutationType: "SALE_CREATE",
      occurredAt: creditSaleOccurredAt,
      payload: {
        currencyCode: "GHS",
        customerId: customer.id,
        paymentMethod: "CUSTOMER_CREDIT",
        lines: [{ itemId: serviceId, quantity: 1, saleUnitCode: "service" }],
      },
    });
    expect(firstSale.status).toBe("APPLIED");

    let detail = await getCustomer(owner.accessToken, business.businessId, customer.id);
    expect(detail.customer.balanceMinor).toBe(5000);
    expect(detail.customer.availableCreditMinor).toBe(1000);
    expect(detail.ledger[0]).toMatchObject({ entryType: "CREDIT_SALE", balanceDeltaMinor: 5000, sourceType: "SALE" });
    expect(detail.obligations).toHaveLength(1);
    expect(detail.obligations[0]).toMatchObject({ originalMinor: 5000, openMinor: 5000 });
    expect(Date.parse(detail.obligations[0]!.dueAt) - Date.parse(creditSaleOccurredAt)).toBe(30 * 86_400_000);

    const overLimit = await sync(owner.accessToken, {
      clientId: "credit-device",
      clientMutationId: "credit-sale-over-limit",
      businessId: business.businessId,
      branchId: business.branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        currencyCode: "GHS",
        customerId: customer.id,
        paymentMethod: "CUSTOMER_CREDIT",
        lines: [{ itemId: serviceId, quantity: 1, saleUnitCode: "service" }],
      },
    });
    expect(overLimit.status).toBe("REJECTED");
    expect(overLimit.errorCode).toBe("CREDIT_LIMIT_EXCEEDED");
    expect(Number((await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sales WHERE business_id=$1`, [business.businessId],
    )).rows[0]?.count)).toBe(1);

    const spoofedStaffId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const payment = await sync(owner.accessToken, {
      clientId: "credit-device",
      clientMutationId: "customer-payment-001",
      businessId: business.businessId,
      branchId: business.branchId,
      mutationType: "CUSTOMER_PAYMENT_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        customerId: customer.id,
        amountMinor: 2000,
        method: "CASH",
        receivedByStaffId: spoofedStaffId,
      },
    });
    expect(payment.status).toBe("APPLIED");
    detail = await getCustomer(owner.accessToken, business.businessId, customer.id);
    expect(detail.customer.balanceMinor).toBe(3000);
    expect(detail.customer.availableCreditMinor).toBe(3000);
    expect(detail.ledger[0]).toMatchObject({ entryType: "PAYMENT", balanceDeltaMinor: -2000 });
    expect(detail.obligations[0]?.openMinor).toBe(3000);

    const actor = await pool.query<{ actor_staff_id: string | null; owner_staff_id: string }>(
      `SELECT cp.actor_staff_id,m.staff_id AS owner_staff_id
       FROM customer_payments cp
       JOIN business_memberships m ON m.business_id=cp.business_id AND m.role='OWNER'
       WHERE cp.business_id=$1 AND cp.client_mutation_id='customer-payment-001'`,
      [business.businessId],
    );
    expect(actor.rows[0]?.actor_staff_id).toBe(actor.rows[0]?.owner_staff_id);
    expect(actor.rows[0]?.actor_staff_id).not.toBe(spoofedStaffId);

    const sale = await pool.query<{ id: string; line_id: string }>(
      `SELECT s.id,sl.id AS line_id FROM sales s JOIN sale_lines sl ON sl.sale_id=s.id
       WHERE s.business_id=$1 AND s.client_mutation_id='credit-sale-001'`,
      [business.businessId],
    );
    const refund = await sync(owner.accessToken, {
      clientId: "credit-device",
      clientMutationId: "credit-refund-001",
      businessId: business.businessId,
      branchId: business.branchId,
      mutationType: "RETURN_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        originalSaleId: sale.rows[0]!.id,
        reason: "Partial service refund",
        refundMethod: "ORIGINAL_METHOD",
        lines: [{ saleLineId: sale.rows[0]!.line_id, quantity: 0.2, disposition: "NOT_APPLICABLE" }],
      },
    });
    expect(refund.status).toBe("APPLIED");
    detail = await getCustomer(owner.accessToken, business.businessId, customer.id);
    expect(detail.customer.balanceMinor).toBe(2000);
    expect(detail.customer.availableCreditMinor).toBe(4000);
    expect(detail.ledger[0]).toMatchObject({ entryType: "CREDIT_REFUND", balanceDeltaMinor: -1000 });
    expect(detail.obligations[0]?.openMinor).toBe(2000);

    const aging = await app.inject({ method: "GET", url: `/v1/reports/credit-aging?businessId=${business.businessId}&branchId=${business.branchId}`, headers: bearer(owner.accessToken) });
    expect(aging.statusCode).toBe(200);
    expect(aging.json<{receivables:{totalOpenMinor:number;notDueMinor:number;obligationCount:number}}>().receivables).toMatchObject({ totalOpenMinor: 2000, notDueMinor: 2000, obligationCount: 1 });

    const search = await app.inject({
      method: "GET",
      url: `/v1/customers?businessId=${business.businessId}&query=024000&limit=20`,
      headers: bearer(owner.accessToken),
    });
    expect(search.statusCode).toBe(200);
    expect(search.json<{ customers: Array<{ id: string; balanceMinor: number }> }>().customers)
      .toContainEqual(expect.objectContaining({ id: customer.id, balanceMinor: 2000 }));
  });

  it("snapshots changed terms per sale and allocates payments to the earliest due obligation", async () => {
    const owner = await register("credit-aging-fifo@tradeos.test", "credit-aging-fifo-device");
    const business = await createBusiness(owner.accessToken);
    const serviceId = await createService(owner.accessToken, business.businessId, 2500);
    const customerResponse = await app.inject({ method:"POST", url:"/v1/customers", headers:bearer(owner.accessToken), payload:{ businessId:business.businessId,name:"Terms Customer",creditLimitMinor:10000,creditTermsDays:30 } });
    expect(customerResponse.statusCode).toBe(201);
    const customer = customerResponse.json<{customer:{id:string;updatedAt:string}}>().customer;
    const customerId = customer.id;

    const saleOne = await sync(owner.accessToken,{ clientId:"credit-aging-fifo-device",clientMutationId:"terms-sale-1",businessId:business.businessId,branchId:business.branchId,mutationType:"SALE_CREATE",occurredAt:"2026-10-01T00:00:00.000Z",payload:{customerId,paymentMethod:"CUSTOMER_CREDIT",lines:[{itemId:serviceId,quantity:1,saleUnitCode:"service"}]} });
    expect(saleOne.status).toBe("APPLIED");
    const saleOneId=(saleOne.result as {saleId:string}).saleId;

    const termsPatch = await app.inject({ method:"PATCH",url:`/v1/customers/${customerId}`,headers:bearer(owner.accessToken),payload:{businessId:business.businessId,expectedUpdatedAt:customer.updatedAt,creditTermsDays:5} });
    expect(termsPatch.statusCode).toBe(200);

    const saleTwo = await sync(owner.accessToken,{ clientId:"credit-aging-fifo-device",clientMutationId:"terms-sale-2",businessId:business.businessId,branchId:business.branchId,mutationType:"SALE_CREATE",occurredAt:"2026-10-02T00:00:00.000Z",payload:{customerId,paymentMethod:"CUSTOMER_CREDIT",lines:[{itemId:serviceId,quantity:1,saleUnitCode:"service"}]} });
    expect(saleTwo.status).toBe("APPLIED");
    const saleTwoId=(saleTwo.result as {saleId:string}).saleId;

    const before = await pool.query<{sale_id:string;open_minor:string;due_at:Date}>(`SELECT sale_id,open_minor,due_at FROM customer_credit_obligations WHERE business_id=$1 AND customer_id=$2 ORDER BY due_at`,[business.businessId,customerId]);
    expect(before.rows.map(row=>[row.sale_id,Number(row.open_minor),row.due_at.toISOString()])).toEqual([
      [saleTwoId,2500,"2026-10-07T00:00:00.000Z"],
      [saleOneId,2500,"2026-10-31T00:00:00.000Z"],
    ]);

    const payment = await sync(owner.accessToken,{ clientId:"credit-aging-fifo-device",clientMutationId:"terms-payment-1",businessId:business.businessId,branchId:business.branchId,mutationType:"CUSTOMER_PAYMENT_CREATE",occurredAt:"2026-10-03T00:00:00.000Z",payload:{customerId,amountMinor:2500,method:"CASH"} });
    expect(payment.status).toBe("APPLIED");
    const after = await pool.query<{sale_id:string;open_minor:string}>(`SELECT sale_id,open_minor FROM customer_credit_obligations WHERE business_id=$1 AND customer_id=$2 ORDER BY sale_id`,[business.businessId,customerId]);
    expect(Number(after.rows.find(row=>row.sale_id===saleTwoId)!.open_minor)).toBe(0);
    expect(Number(after.rows.find(row=>row.sale_id===saleOneId)!.open_minor)).toBe(2500);
  });

  it("requires an enabled credit limit and protects customer data across tenants", async () => {
    const owner = await register("credit-disabled@tradeos.test", "credit-disabled-device");
    const outsider = await register("credit-outsider@tradeos.test", "credit-outsider-device");
    const business = await createBusiness(owner.accessToken);
    const serviceId = await createService(owner.accessToken, business.businessId, 2500);

    const customerResponse = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: bearer(owner.accessToken),
      payload: { businessId: business.businessId, name: "No Credit Customer", creditLimitMinor: null },
    });
    const customer = customerResponse.json<{ customer: { id: string } }>().customer;

    const creditSale = await sync(owner.accessToken, {
      clientId: "credit-disabled-device",
      clientMutationId: "disabled-credit-sale",
      businessId: business.businessId,
      branchId: business.branchId,
      mutationType: "SALE_CREATE",
      occurredAt: new Date().toISOString(),
      payload: {
        customerId: customer.id,
        paymentMethod: "CUSTOMER_CREDIT",
        lines: [{ itemId: serviceId, quantity: 1, saleUnitCode: "service" }],
      },
    });
    expect(creditSale.status).toBe("REJECTED");
    expect(creditSale.errorCode).toBe("CUSTOMER_CREDIT_NOT_ENABLED");

    const crossTenant = await app.inject({
      method: "GET",
      url: `/v1/customers/${customer.id}?businessId=${business.businessId}`,
      headers: bearer(outsider.accessToken),
    });
    expect(crossTenant.statusCode).toBe(403);
  });
});

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: "Credit Test Owner",
      email,
      password: "TradeOS-Test-1234",
      platform: "WEB",
      deviceKey,
      appVersion: "test-1.0.0",
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ session: { accessToken: string } }>().session;
}

async function createBusiness(accessToken: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers: bearer(accessToken),
    payload: { name: "Credit Test Business", businessType: "SERVICES", branchName: "Main" },
  });
  expect(response.statusCode).toBe(201);
  const body = response.json<{ business: { id: string }; branch: { id: string } }>();
  return { businessId: body.business.id, branchId: body.branch.id };
}

async function createService(accessToken: string, businessId: string, priceMinor: number): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/catalog/items",
    headers: bearer(accessToken),
    payload: {
      businessId,
      name: "Business Service",
      kind: "SERVICE",
      units: [{ code: "service", label: "Service", canSell: true, defaultSalePriceMinor: priceMinor }],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ item: { id: string } }>().item.id;
}

async function sync(accessToken: string, mutation: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/sync",
    headers: bearer(accessToken),
    payload: { mutations: [mutation] },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ mutationResults: Array<{ status: string; errorCode?: string; result?: unknown }> }>().mutationResults[0]!;
}

async function getCustomer(accessToken: string, businessId: string, customerId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/v1/customers/${customerId}?businessId=${businessId}`,
    headers: bearer(accessToken),
  });
  expect(response.statusCode).toBe(200);
  return response.json<{
    customer: { balanceMinor: number; availableCreditMinor: number | null };
    obligations: Array<{ originalMinor: number; openMinor: number; dueAt: string }>;
    ledger: Array<{ entryType: string; balanceDeltaMinor: number; sourceType: string }>;
  }>();
}

function bearer(accessToken: string): { authorization: string } {
  return { authorization: `Bearer ${accessToken}` };
}
