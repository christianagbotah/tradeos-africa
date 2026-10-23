import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "../src/migrations/migration-runner.js";
import {
  TenantBillingError,
  getTenantBillingInvoiceDetail,
  getTenantBillingOverview,
  listTenantBillingInvoices,
  listTenantBillingPayments,
} from "../src/billing/tenant-billing-service.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `tenant_billing_test_${crypto.randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");

const B1 = "91000000-0000-4000-8000-000000000001";
const B2 = "92000000-0000-4000-8000-000000000001";
const PLAN_BASIC = "91000000-0000-4000-8000-000000000010";
const PLAN_PLUS = "91000000-0000-4000-8000-000000000011";
const PLAN_INTERNAL = "91000000-0000-4000-8000-000000000012";
const SUB1 = "91000000-0000-4000-8000-000000000020";
const SUB2 = "92000000-0000-4000-8000-000000000020";
const INV1 = "91000000-0000-4000-8000-000000000030";
const INV2 = "92000000-0000-4000-8000-000000000030";
const PAY1 = "91000000-0000-4000-8000-000000000040";

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  await applyMigrations(pool, { migrationDirectory });
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE subscription_plans,businesses CASCADE");
  await seed();
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await adminPool.end();
});

describe("tenant billing read service", () => {
  it("returns current subscription, public plans and effective plan+override entitlements without provider internals", async () => {
    const overview = await getTenantBillingOverview(pool, { businessId: B1, role: "OWNER", now: new Date("2026-10-23T12:00:00Z") });

    expect(overview.businessId).toBe(B1);
    expect(overview.subscription).toMatchObject({
      id: SUB1,
      status: "ACTIVE",
      cancelAtPeriodEnd: false,
      plan: { id: PLAN_BASIC, code: "basic", amountMinor: 5000, currencyCode: "GHS" },
      supportedActions: ["CANCEL_AT_PERIOD_END"],
    });
    expect(overview.publicPlans.map((plan) => plan.code)).toEqual(["basic", "plus"]);
    expect(overview.effectiveEntitlements).toEqual([
      { code: "AI_ASSISTANT", value: true },
      { code: "USER_LIMIT", value: 3 },
    ]);
    expect(JSON.stringify(overview)).not.toMatch(/provider_customer|providerCustomer|provider_subscription|providerSubscription|override reason|updatedByPlatform/i);
  });

  it("keeps accountant overview read-only while preserving tenant-safe plan visibility", async () => {
    const overview = await getTenantBillingOverview(pool, { businessId: B1, role: "ACCOUNTANT" });
    expect(overview.subscription?.supportedActions).toEqual([]);
    expect(overview.publicPlans).toHaveLength(2);
  });

  it("returns tenant-scoped invoice/payment projections and computes invoice balance", async () => {
    const invoices = await listTenantBillingInvoices(pool, { businessId: B1, limit: 20 });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ id: INV1, invoiceNumber: "INV-B1-001", totalMinor: 5000, amountPaidMinor: 2000, balanceMinor: 3000 });
    expect(JSON.stringify(invoices[0])).not.toMatch(/providerInvoice|provider_event|providerEvent|providerTransaction|failureMessage/i);

    const payments = await listTenantBillingPayments(pool, { businessId: B1, limit: 20 });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ id: PAY1, invoiceId: INV1, invoiceNumber: "INV-B1-001", amountMinor: 2000, provider: "HUBTEL", status: "SUCCEEDED" });
    expect(JSON.stringify(payments[0])).not.toMatch(/providerEvent|providerTransaction|failureCode|failureMessage/i);
  });

  it("returns invoice detail with only same-tenant payments and hides a foreign invoice as not found", async () => {
    const detail = await getTenantBillingInvoiceDetail(pool, { businessId: B1, invoiceId: INV1 });
    expect(detail.id).toBe(INV1);
    expect(detail.payments.map((payment) => payment.id)).toEqual([PAY1]);

    await expect(getTenantBillingInvoiceDetail(pool, { businessId: B1, invoiceId: INV2 }))
      .rejects.toMatchObject<Partial<TenantBillingError>>({ statusCode: 404, code: "TENANT_BILLING_INVOICE_NOT_FOUND" });
  });
});

async function seed() {
  await pool.query(`INSERT INTO businesses(id,name,business_type,country_code,currency_code,timezone,status) VALUES
    ($1,'Tenant One','RETAIL','GH','GHS','Africa/Accra','ACTIVE'),
    ($2,'Tenant Two','RETAIL','GH','GHS','Africa/Accra','ACTIVE')`, [B1, B2]);

  await pool.query(`INSERT INTO subscription_plans(id,code,name,description,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active) VALUES
    ($1,'basic','Basic','Core TradeOS','GHS',5000,'MONTHLY',14,true,true),
    ($2,'plus','Plus','Growing teams','GHS',10000,'MONTHLY',14,true,true),
    ($3,'internal','Internal','Hidden plan','GHS',1,'CUSTOM',0,false,true)`, [PLAN_BASIC, PLAN_PLUS, PLAN_INTERNAL]);
  await pool.query(`INSERT INTO plan_entitlements(plan_id,entitlement_code,entitlement_value) VALUES
    ($1,'AI_ASSISTANT','false'::jsonb),($1,'USER_LIMIT','3'::jsonb),($2,'AI_ASSISTANT','true'::jsonb),($2,'USER_LIMIT','10'::jsonb)`, [PLAN_BASIC, PLAN_PLUS]);
  await pool.query(`INSERT INTO business_entitlement_overrides(business_id,entitlement_code,entitlement_value,reason,expires_at) VALUES
    ($1,'AI_ASSISTANT','true'::jsonb,'Temporary enablement',NULL),
    ($1,'USER_LIMIT','99'::jsonb,'Expired test',TIMESTAMPTZ '2026-01-01T00:00:00Z')`, [B1]);

  await pool.query(`INSERT INTO business_subscriptions(id,business_id,plan_id,status,provider,provider_customer_reference,provider_subscription_reference,current_period_starts_at,current_period_ends_at,cancel_at_period_end) VALUES
    ($1,$2,$3,'ACTIVE','HUBTEL','cust-secret','sub-secret',TIMESTAMPTZ '2026-10-01T00:00:00Z',TIMESTAMPTZ '2026-11-01T00:00:00Z',false),
    ($4,$5,$3,'ACTIVE','HUBTEL','foreign-cust','foreign-sub',TIMESTAMPTZ '2026-10-01T00:00:00Z',TIMESTAMPTZ '2026-11-01T00:00:00Z',false)`, [SUB1,B1,PLAN_BASIC,SUB2,B2]);

  await pool.query(`INSERT INTO subscription_invoices(id,business_id,subscription_id,invoice_number,currency_code,subtotal_minor,tax_minor,total_minor,amount_paid_minor,status,period_start,period_end,issued_at,due_at,provider,provider_invoice_reference) VALUES
    ($1,$2,$3,'INV-B1-001','GHS',5000,0,5000,2000,'PARTIALLY_PAID',TIMESTAMPTZ '2026-10-01T00:00:00Z',TIMESTAMPTZ '2026-11-01T00:00:00Z',TIMESTAMPTZ '2026-10-01T00:00:00Z',TIMESTAMPTZ '2026-10-08T00:00:00Z','HUBTEL','invoice-secret'),
    ($4,$5,$6,'INV-B2-001','GHS',5000,0,5000,0,'OPEN',TIMESTAMPTZ '2026-10-01T00:00:00Z',TIMESTAMPTZ '2026-11-01T00:00:00Z',TIMESTAMPTZ '2026-10-01T00:00:00Z',TIMESTAMPTZ '2026-10-08T00:00:00Z','HUBTEL','foreign-invoice')`, [INV1,B1,SUB1,INV2,B2,SUB2]);

  await pool.query(`INSERT INTO subscription_payments(id,business_id,invoice_id,amount_minor,currency_code,method,provider,provider_event_reference,provider_transaction_reference,status,received_at,reconciled_at) VALUES
    ($1,$2,$3,2000,'GHS','MOMO','HUBTEL','event-secret','txn-secret','SUCCEEDED',TIMESTAMPTZ '2026-10-02T10:00:00Z',TIMESTAMPTZ '2026-10-02T10:01:00Z')`, [PAY1,B1,INV1]);
}
