import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations/migration-runner.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `ghana_market_pilot_${randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const app = buildApp(pool);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");

const OWNER_PHONE_INPUT = "+233 (24) 012-3456";
const OWNER_PHONE_E164 = "+233240123456";
const OWNER_PASSWORD = "Pilot-Test-Password-1234";
const OWNER_DEVICE = "ghana-market-owner-device";

let ownerToken = "";
let ownerUserId = "";
let businessId = "";
let branchId = "";
let supplierId = "";
let customerId = "";
let nailsItemId = "";

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  await applyMigrations(pool, { migrationDirectory });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await adminPool.end();
});

describe("Ghana market pilot readiness", () => {
  it("onboards a phone-first Ghana hardware business and creates realistic bulk-unit master data", async () => {
    const registration = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        displayName: "Kwame Mensah",
        phone: OWNER_PHONE_INPUT,
        password: OWNER_PASSWORD,
        platform: "WEB",
        deviceKey: OWNER_DEVICE,
        appVersion: "pilot-1.0.0",
      },
    });
    expect(registration.statusCode, registration.body).toBe(201);
    const registrationBody = registration.json<{
      user: { id: string; email: string | null; phoneE164: string | null };
      session: { accessToken: string };
    }>();
    expect(registrationBody.user).toMatchObject({ email: null, phoneE164: OWNER_PHONE_E164 });
    ownerToken = registrationBody.session.accessToken;
    ownerUserId = registrationBody.user.id;

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        identifier: OWNER_PHONE_INPUT,
        password: OWNER_PASSWORD,
        platform: "WEB",
        deviceKey: `${OWNER_DEVICE}-login`,
        appVersion: "pilot-1.0.0",
      },
    });
    expect(login.statusCode, login.body).toBe(200);

    const onboarding = await app.inject({
      method: "POST",
      url: "/v1/onboarding/business",
      headers: bearer(ownerToken),
      payload: {
        name: "Akwaaba Hardware & Building Supplies",
        businessType: "RETAIL_HARDWARE",
        branchName: "Kaneshie Main",
        countryCode: "GH",
        currencyCode: "GHS",
        timezone: "Africa/Accra",
        city: "Accra",
        region: "Greater Accra",
      },
    });
    expect(onboarding.statusCode, onboarding.body).toBe(201);
    const onboarded = onboarding.json<{
      business: { id: string; name: string; businessType: string; countryCode: string; currencyCode: string; timezone: string };
      branch: { id: string; name: string; timezone: string };
    }>();
    businessId = onboarded.business.id;
    branchId = onboarded.branch.id;
    expect(onboarded.business).toMatchObject({
      name: "Akwaaba Hardware & Building Supplies",
      businessType: "RETAIL_HARDWARE",
      countryCode: "GH",
      currencyCode: "GHS",
      timezone: "Africa/Accra",
    });
    expect(onboarded.branch).toMatchObject({ name: "Kaneshie Main", timezone: "Africa/Accra" });

    const supplier = await app.inject({
      method: "POST",
      url: "/v1/suppliers",
      headers: bearer(ownerToken),
      payload: { businessId, name: "Accra Fasteners Ltd", phone: "+233302555010", paymentTermsDays: 30 },
    });
    expect(supplier.statusCode, supplier.body).toBe(201);
    supplierId = supplier.json<{ supplier: { id: string } }>().supplier.id;

    const customer = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: bearer(ownerToken),
      payload: {
        businessId,
        name: "Ama Boateng",
        phone: "+233244555011",
        creditLimitMinor: 50000,
        creditTermsDays: 14,
      },
    });
    expect(customer.statusCode, customer.body).toBe(201);
    customerId = customer.json<{ customer: { id: string } }>().customer.id;

    const catalog = await app.inject({
      method: "POST",
      url: "/v1/catalog/items",
      headers: bearer(ownerToken),
      payload: {
        businessId,
        sku: "NAILS-ROOF-BOX",
        name: "Roofing Nails",
        kind: "PRODUCT",
        trackStock: true,
        stockUnitCode: "lb",
        units: [
          { code: "lb", label: "Pound", canStock: true, canSell: true, defaultSalePriceMinor: 3000 },
          { code: "box", label: "Box", canPurchase: true },
        ],
        conversions: [{ fromUnitCode: "box", toUnitCode: "lb", factor: 50 }],
      },
    });
    expect(catalog.statusCode, catalog.body).toBe(201);
    const item = catalog.json<{ item: { id: string; stockUnitCode: string; units: Array<{ code: string; defaultSalePriceMinor: number | null }>; conversions: Array<{ fromUnitCode: string; toUnitCode: string; factor: number }> } }>().item;
    nailsItemId = item.id;
    expect(item.stockUnitCode).toBe("lb");
    expect(item.units).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "lb", defaultSalePriceMinor: 3000 }),
      expect.objectContaining({ code: "box" }),
    ]));
    expect(item.conversions).toContainEqual(expect.objectContaining({ fromUnitCode: "box", toUnitCode: "lb", factor: 50 }));

    const membership = await pool.query<{ role: string; staff_id: string | null }>(
      `SELECT role,staff_id FROM business_memberships WHERE business_id=$1 AND user_id=$2`,
      [businessId, ownerUserId],
    );
    expect(membership.rows[0]).toMatchObject({ role: "OWNER" });
    expect(membership.rows[0]?.staff_id).toBeTruthy();

    expect(supplierId).toBeTruthy();
    expect(customerId).toBeTruthy();
    expect(nailsItemId).toBeTruthy();
  });

  it("runs a mixed Ghana trading day and reconciles stock, credit, cash and profit exactly", async () => {
    const occurredAt = new Date().toISOString();
    const reportFrom = new Date(Date.parse(occurredAt) - 60_000).toISOString();
    const reportTo = new Date(Date.parse(occurredAt) + 60_000).toISOString();

    const receiptPayload = {
      supplierId,
      settlementMethod: "SUPPLIER_CREDIT",
      lines: [{ itemId: nailsItemId, purchaseUnitCode: "box", quantity: 2, unitCostMinor: 50000 }],
    };
    const receipt = await syncOwner("pilot-purchase-credit", "PURCHASE_RECEIVE_CREATE", receiptPayload, occurredAt);
    expect(receipt.status).toBe("APPLIED");
    expect(receipt.result).toMatchObject({ totalMinor: 100000 });
    expect((await syncOwner("pilot-purchase-credit", "PURCHASE_RECEIVE_CREATE", receiptPayload, occurredAt)).status).toBe("APPLIED");

    const afterReceipt = await inventoryItem();
    expect(afterReceipt).toMatchObject({ available: 100, inventoryValueMinor: 100000 });

    const cashSale = await syncOwner("pilot-sale-cash", "SALE_CREATE", {
      currencyCode: "GHS",
      paymentMethod: "CASH",
      lines: [{ itemId: nailsItemId, saleUnitCode: "lb", quantity: 4 }],
    }, occurredAt);
    expect(cashSale.status).toBe("APPLIED");

    const creditSale = await syncOwner("pilot-sale-credit", "SALE_CREATE", {
      currencyCode: "GHS",
      customerId,
      paymentMethod: "CUSTOMER_CREDIT",
      lines: [{ itemId: nailsItemId, saleUnitCode: "lb", quantity: 3 }],
    }, occurredAt);
    expect(creditSale.status).toBe("APPLIED");

    const momoSale = await syncOwner("pilot-sale-momo", "SALE_CREATE", {
      currencyCode: "GHS",
      customerId,
      paymentMethod: "MOMO",
      lines: [{ itemId: nailsItemId, saleUnitCode: "lb", quantity: 2 }],
    }, occurredAt);
    expect(momoSale.status).toBe("APPLIED");

    const customerPayment = await syncOwner("pilot-customer-payment", "CUSTOMER_PAYMENT_CREATE", {
      customerId,
      amountMinor: 4000,
      method: "CASH",
      receivedByStaffId: "00000000-0000-4000-8000-000000000000",
    }, occurredAt);
    expect(customerPayment.status).toBe("APPLIED");

    const cashSaleLine = await pool.query<{ id: string }>(
      `SELECT id FROM sale_lines WHERE sale_id=$1`,
      [(cashSale.result as { saleId: string }).saleId],
    );
    const returned = await syncOwner("pilot-cash-return", "RETURN_CREATE", {
      originalSaleId: (cashSale.result as { saleId: string }).saleId,
      reason: "Customer bought one pound too many",
      refundMethod: "ORIGINAL_METHOD",
      lines: [{ saleLineId: cashSaleLine.rows[0]!.id, quantity: 1, disposition: "RESTOCK" }],
    }, occurredAt);
    expect(returned.status).toBe("APPLIED");

    const supplierPayment = await syncOwner("pilot-supplier-payment", "SUPPLIER_PAYMENT_CREATE", {
      supplierId,
      amountMinor: 5000,
      method: "MOMO",
      paidByStaffId: "00000000-0000-4000-8000-000000000000",
    }, occurredAt);
    expect(supplierPayment.status).toBe("APPLIED");

    const categories = await app.inject({
      method: "GET",
      url: `/v1/expense-categories?businessId=${businessId}`,
      headers: bearer(ownerToken),
    });
    expect(categories.statusCode, categories.body).toBe(200);
    const categoryId = categories.json<{ categories: Array<{ id: string }> }>().categories[0]!.id;
    const expense = await syncOwner("pilot-expense", "EXPENSE_CREATE", {
      categoryId,
      amountMinor: 2000,
      method: "CASH",
      description: "Delivery and loading transport",
      actorStaffId: "00000000-0000-4000-8000-000000000000",
    }, occurredAt);
    expect(expense.status).toBe("APPLIED");

    const stockBeforeRejectedCredit = (await inventoryItem()).available;
    const rejectedCredit = await syncOwner("pilot-credit-over-limit", "SALE_CREATE", {
      customerId,
      paymentMethod: "CUSTOMER_CREDIT",
      lines: [{ itemId: nailsItemId, saleUnitCode: "lb", quantity: 20 }],
    }, occurredAt);
    expect(rejectedCredit.status).toBe("REJECTED");
    expect(rejectedCredit.errorCode).toBe("CREDIT_LIMIT_EXCEEDED");
    expect((await inventoryItem()).available).toBe(stockBeforeRejectedCredit);

    expect((await syncOwner("pilot-sale-momo", "SALE_CREATE", {
      currencyCode: "GHS",
      customerId,
      paymentMethod: "MOMO",
      lines: [{ itemId: nailsItemId, saleUnitCode: "lb", quantity: 2 }],
    }, occurredAt)).status).toBe("APPLIED");
    expect((await syncOwner("pilot-customer-payment", "CUSTOMER_PAYMENT_CREATE", {
      customerId,
      amountMinor: 4000,
      method: "CASH",
    }, occurredAt)).status).toBe("APPLIED");

    const inventory = await inventoryItem();
    expect(inventory).toMatchObject({ available: 92, quarantine: 0, damaged: 0, waste: 0, inventoryValueMinor: 92000 });

    const customerDetail = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerId}?businessId=${businessId}`,
      headers: bearer(ownerToken),
    });
    expect(customerDetail.statusCode, customerDetail.body).toBe(200);
    expect(customerDetail.json<{ customer: { balanceMinor: number; availableCreditMinor: number | null }; obligations: Array<{ openMinor: number }> }>().customer)
      .toMatchObject({ balanceMinor: 5000, availableCreditMinor: 45000 });

    const suppliers = await app.inject({
      method: "GET",
      url: `/v1/suppliers?businessId=${businessId}`,
      headers: bearer(ownerToken),
    });
    expect(suppliers.statusCode, suppliers.body).toBe(200);
    expect(suppliers.json<{ suppliers: Array<{ id: string; balanceMinor: number }> }>().suppliers)
      .toContainEqual(expect.objectContaining({ id: supplierId, balanceMinor: 95000 }));

    const cashbook = await app.inject({
      method: "GET",
      url: `/v1/cashbook?businessId=${businessId}&branchId=${branchId}`,
      headers: bearer(ownerToken),
    });
    expect(cashbook.statusCode, cashbook.body).toBe(200);
    expect(cashbook.json<{ totals: Array<{ method: string; balanceMinor: number; inflowMinor: number; outflowMinor: number }> }>().totals)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ method: "CASH", balanceMinor: 11000, inflowMinor: 16000, outflowMinor: 5000 }),
        expect.objectContaining({ method: "MOMO", balanceMinor: 1000, inflowMinor: 6000, outflowMinor: 5000 }),
      ]));

    const reportResponse = await app.inject({
      method: "GET",
      url: `/v1/reports/financial-summary?businessId=${businessId}&branchId=${branchId}&from=${encodeURIComponent(reportFrom)}&to=${encodeURIComponent(reportTo)}`,
      headers: bearer(ownerToken),
    });
    expect(reportResponse.statusCode, reportResponse.body).toBe(200);
    const report = reportResponse.json<{
      flow: Record<string, number>;
      position: Record<string, number>;
      topItems: Array<Record<string, unknown>>;
    }>();
    expect(report.flow).toMatchObject({
      grossRevenueMinor: 27000,
      returnsRevenueMinor: 3000,
      netRevenueMinor: 24000,
      grossCogsMinor: 9000,
      cogsReversalMinor: 1000,
      netCogsMinor: 8000,
      grossProfitMinor: 16000,
      expenseMinor: 2000,
      operatingProfitMinor: 14000,
      salesCount: 3,
      returnCount: 1,
      cashInflowMinor: 22000,
      cashOutflowMinor: 10000,
      netCashMovementMinor: 12000,
    });
    expect(report.position).toMatchObject({
      cashBalanceMinor: 12000,
      receivablesMinor: 5000,
      payablesMinor: 95000,
      inventoryValueMinor: 92000,
      inventoryAvailableValueMinor: 92000,
    });
    expect(report.topItems[0]).toMatchObject({
      itemId: nailsItemId,
      quantitySold: 9,
      quantityReturned: 1,
      netRevenueMinor: 24000,
      netCogsMinor: 8000,
      grossProfitMinor: 16000,
    });

    const rowCounts = await pool.query<{ sales: number; purchases: number; customer_payments: number; supplier_payments: number }>(
      `SELECT
         (SELECT count(*)::int FROM sales WHERE business_id=$1) AS sales,
         (SELECT count(*)::int FROM purchases WHERE business_id=$1) AS purchases,
         (SELECT count(*)::int FROM customer_payments WHERE business_id=$1) AS customer_payments,
         (SELECT count(*)::int FROM supplier_payable_ledger WHERE business_id=$1 AND source_type='PAYMENT') AS supplier_payments`,
      [businessId],
    );
    expect(rowCounts.rows[0]).toEqual({ sales: 3, purchases: 1, customer_payments: 1, supplier_payments: 1 });
  });
});

function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function syncOwner(clientMutationId: string, mutationType: string, payload: unknown, occurredAt: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/sync",
    headers: bearer(ownerToken),
    payload: {
      mutations: [{
        clientId: OWNER_DEVICE,
        clientMutationId,
        businessId,
        branchId,
        mutationType,
        occurredAt,
        payload,
      }],
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ mutationResults: Array<{ status: string; errorCode?: string; result?: unknown }> }>().mutationResults[0]!;
}

async function inventoryItem() {
  const response = await app.inject({
    method: "GET",
    url: `/v1/inventory?businessId=${businessId}&branchId=${branchId}`,
    headers: bearer(ownerToken),
  });
  expect(response.statusCode, response.body).toBe(200);
  const items = response.json<{ items: Array<{ id: string; available: number; quarantine: number; damaged: number; waste: number; inventoryValueMinor: number }> }>().items;
  return items.find((item) => item.id === nailsItemId)!;
}
