import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "../src/migrations/migration-runner.js";
import { recordProviderPayment, recordProviderRefund } from "../src/platform-admin/billing-service.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `subscription_billing_lifecycle_${crypto.randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");
const NOW = new Date("2026-10-27T08:00:00.000Z");
const PERIOD_START = new Date("2026-10-27T00:00:00.000Z");
const PERIOD_END = new Date("2026-11-27T00:00:00.000Z");

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  await applyMigrations(pool, { migrationDirectory });
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE businesses CASCADE");
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await adminPool.end();
});

describe("subscription billing lifecycle invoice issuance", () => {
  it("enforces one non-void invoice per subscription period at the database boundary", async () => {
    const fixture = await seedActiveSubscription(12500, "GHS");
    await insertPeriodInvoice(fixture, "TOS-ONE", "OPEN");

    await expect(insertPeriodInvoice(fixture, "TOS-TWO", "OPEN")).rejects.toMatchObject({ code: "23505" });
  });

  it("issues an exact plan snapshot once and reuses it across concurrent retries without tenant ledger writes", async () => {
    const fixture = await seedActiveSubscription(12500, "GHS");
    const before = await tenantLedgerCounts();
    const module = await import("../src/platform-admin/subscription-billing-lifecycle-service.js");
    const input = {
      businessId: fixture.businessId,
      subscriptionId: fixture.subscriptionId,
      currencyCode: "GHS",
      amountMinor: 12500,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      now: NOW,
    };

    const firstClient = await pool.connect();
    const secondClient = await pool.connect();
    try {
      const [first, second] = await Promise.all([
        module.issueSubscriptionPeriodInvoice(firstClient, input),
        module.issueSubscriptionPeriodInvoice(secondClient, input),
      ]);
      expect(first.invoiceId).toBe(second.invoiceId);
      expect([first.created, second.created].sort()).toEqual([false, true]);
    } finally {
      firstClient.release();
      secondClient.release();
    }

    const invoices = await pool.query<{
      id: string; invoice_number: string; currency_code: string; subtotal_minor: string; tax_minor: string;
      total_minor: string; amount_paid_minor: string; status: string; period_start: Date; period_end: Date;
      issued_at: Date; due_at: Date; provider: string | null; provider_invoice_reference: string | null;
    }>(`SELECT id,invoice_number,currency_code,subtotal_minor::text,tax_minor::text,total_minor::text,
              amount_paid_minor::text,status,period_start,period_end,issued_at,due_at,provider,provider_invoice_reference
         FROM subscription_invoices WHERE subscription_id=$1`, [fixture.subscriptionId]);
    expect(invoices.rows).toHaveLength(1);
    const invoice = invoices.rows[0]!;
    expect(invoice.invoice_number).toMatch(/^TOS-20261027-[0-9A-F]{8}$/);
    expect(invoice).toMatchObject({
      currency_code: "GHS",
      subtotal_minor: "12500",
      tax_minor: "0",
      total_minor: "12500",
      amount_paid_minor: "0",
      status: "OPEN",
      provider: null,
      provider_invoice_reference: null,
    });
    expect(invoice.period_start.toISOString()).toBe(PERIOD_START.toISOString());
    expect(invoice.period_end.toISOString()).toBe(PERIOD_END.toISOString());
    expect(invoice.issued_at.toISOString()).toBe(NOW.toISOString());
    expect(invoice.due_at.toISOString()).toBe("2026-11-03T08:00:00.000Z");

    const audits = await pool.query<{ event_type: string; entity_id: string }>(
      `SELECT event_type,entity_id FROM platform_audit_events WHERE event_type='SUBSCRIPTION_INVOICE_ISSUED'`,
    );
    expect(audits.rows).toEqual([{ event_type: "SUBSCRIPTION_INVOICE_ISSUED", entity_id: invoice.id }]);
    expect(await tenantLedgerCounts()).toEqual(before);
  });

  it("leaves a future trial untouched and converts an expired trial from its exact trial boundary", async () => {
    const module = await import("../src/platform-admin/subscription-billing-lifecycle-service.js");
    const future = await seedSubscription({ interval: "MONTHLY", status: "TRIALING", trialEndsAt: new Date("2026-10-28T00:00:00.000Z") });
    const expired = await seedSubscription({ interval: "MONTHLY", status: "TRIALING", trialEndsAt: new Date("2026-10-26T00:00:00.000Z") });

    const result = await module.processSubscriptionBillingCycle(pool, { now: NOW });
    expect(result.trialConverted).toBe(1);
    expect(await subscriptionState(future.subscriptionId)).toMatchObject({ status: "TRIALING", current_period_starts_at: null, current_period_ends_at: null });
    expect(await invoiceCount(future.subscriptionId)).toBe(0);
    expect(await subscriptionState(expired.subscriptionId)).toMatchObject({
      status: "ACTIVE",
      current_period_starts_at: new Date("2026-10-26T00:00:00.000Z"),
      current_period_ends_at: new Date("2026-11-26T00:00:00.000Z"),
    });
    expect(await invoiceCount(expired.subscriptionId)).toBe(1);
  });

  it("renews monthly and annual periods from the prior period end and honors cancel-at-period-end", async () => {
    const module = await import("../src/platform-admin/subscription-billing-lifecycle-service.js");
    const monthly = await seedSubscription({
      interval: "MONTHLY", status: "ACTIVE",
      periodStart: new Date("2026-09-27T00:00:00.000Z"), periodEnd: new Date("2026-10-27T00:00:00.000Z"),
    });
    const annual = await seedSubscription({
      interval: "ANNUAL", status: "ACTIVE",
      periodStart: new Date("2025-10-27T00:00:00.000Z"), periodEnd: new Date("2026-10-27T00:00:00.000Z"),
    });
    const canceled = await seedSubscription({
      interval: "MONTHLY", status: "ACTIVE", cancelAtPeriodEnd: true,
      periodStart: new Date("2026-09-27T00:00:00.000Z"), periodEnd: new Date("2026-10-27T00:00:00.000Z"),
    });

    const result = await module.processSubscriptionBillingCycle(pool, { now: NOW });
    expect(result.renewed).toBe(2);
    expect(result.canceled).toBe(1);
    expect(await subscriptionState(monthly.subscriptionId)).toMatchObject({
      status: "ACTIVE", current_period_starts_at: new Date("2026-10-27T00:00:00.000Z"), current_period_ends_at: new Date("2026-11-27T00:00:00.000Z"),
    });
    expect(await subscriptionState(annual.subscriptionId)).toMatchObject({
      status: "ACTIVE", current_period_starts_at: new Date("2026-10-27T00:00:00.000Z"), current_period_ends_at: new Date("2027-10-27T00:00:00.000Z"),
    });
    expect(await subscriptionState(canceled.subscriptionId)).toMatchObject({ status: "CANCELED", cancel_at_period_end: false });
    expect(await invoiceCount(canceled.subscriptionId)).toBe(1);
  });

  it("keeps CUSTOM plans manual and refreshes ACTIVE/PAST_DUE standing from authoritative invoice balance", async () => {
    const module = await import("../src/platform-admin/subscription-billing-lifecycle-service.js");
    const custom = await seedSubscription({ interval: "CUSTOM", status: "ACTIVE", periodStart: PERIOD_START, periodEnd: null });
    await module.processSubscriptionBillingCycle(pool, { now: NOW });
    expect(await invoiceCount(custom.subscriptionId)).toBe(0);
    expect(await subscriptionState(custom.subscriptionId)).toMatchObject({ status: "ACTIVE", current_period_ends_at: null });

    const billable = await seedSubscription({ interval: "MONTHLY", status: "ACTIVE", periodStart: PERIOD_START, periodEnd: PERIOD_END });
    const client = await pool.connect();
    try {
      const issued = await module.issueSubscriptionPeriodInvoice(client, {
        businessId: billable.businessId, subscriptionId: billable.subscriptionId, currencyCode: "GHS", amountMinor: 12500,
        periodStart: PERIOD_START, periodEnd: PERIOD_END, now: new Date("2026-10-01T08:00:00.000Z"),
      });
      expect(await module.refreshSubscriptionStanding(client, billable.subscriptionId, NOW)).toBe("PAST_DUE");
      await client.query(`UPDATE subscription_invoices SET amount_paid_minor=total_minor,status='PAID' WHERE id=$1`, [issued.invoiceId]);
      expect(await module.refreshSubscriptionStanding(client, billable.subscriptionId, NOW)).toBe("ACTIVE");
    } finally { client.release(); }
  });

  it("updates overdue subscription standing immediately after successful provider payments while partial payment stays past due", async () => {
    const module = await import("../src/platform-admin/subscription-billing-lifecycle-service.js");
    const billable = await seedSubscription({ interval: "MONTHLY", status: "ACTIVE", periodStart: PERIOD_START, periodEnd: PERIOD_END });
    const client = await pool.connect();
    let invoiceId: string;
    try {
      const issued = await module.issueSubscriptionPeriodInvoice(client, {
        businessId: billable.businessId, subscriptionId: billable.subscriptionId, currencyCode: "GHS", amountMinor: 12500,
        periodStart: PERIOD_START, periodEnd: PERIOD_END, now: new Date("2026-10-01T08:00:00.000Z"),
      });
      invoiceId = issued.invoiceId;
      expect(await module.refreshSubscriptionStanding(client, billable.subscriptionId, NOW)).toBe("PAST_DUE");
    } finally { client.release(); }

    await recordProviderPayment(pool, {
      businessId: billable.businessId, invoiceId, amountMinor: 5000, currencyCode: "GHS", method: "MOMO", provider: "TESTPAY",
      providerEventReference: "evt-standing-partial", providerTransactionReference: "txn-standing-partial", status: "SUCCEEDED", receivedAt: NOW.toISOString(),
    });
    expect((await subscriptionState(billable.subscriptionId)).status).toBe("PAST_DUE");

    await recordProviderPayment(pool, {
      businessId: billable.businessId, invoiceId, amountMinor: 7500, currencyCode: "GHS", method: "MOMO", provider: "TESTPAY",
      providerEventReference: "evt-standing-full", providerTransactionReference: "txn-standing-full", status: "SUCCEEDED", receivedAt: NOW.toISOString(),
    });
    expect((await subscriptionState(billable.subscriptionId)).status).toBe("ACTIVE");
  });

  it("marks a subscription past due immediately when a successful refund reopens an overdue balance", async () => {
    const module = await import("../src/platform-admin/subscription-billing-lifecycle-service.js");
    const billable = await seedSubscription({ interval: "MONTHLY", status: "ACTIVE", periodStart: PERIOD_START, periodEnd: PERIOD_END });
    const client = await pool.connect();
    let invoiceId: string;
    try {
      invoiceId = (await module.issueSubscriptionPeriodInvoice(client, {
        businessId: billable.businessId, subscriptionId: billable.subscriptionId, currencyCode: "GHS", amountMinor: 12500,
        periodStart: PERIOD_START, periodEnd: PERIOD_END, now: new Date("2026-10-01T08:00:00.000Z"),
      })).invoiceId;
    } finally { client.release(); }
    const payment = await recordProviderPayment(pool, {
      businessId: billable.businessId, invoiceId, amountMinor: 12500, currencyCode: "GHS", method: "MOMO", provider: "TESTPAY",
      providerEventReference: "evt-refund-base", providerTransactionReference: "txn-refund-base", status: "SUCCEEDED", receivedAt: NOW.toISOString(),
    });
    const client2 = await pool.connect();
    try { expect(await module.refreshSubscriptionStanding(client2, billable.subscriptionId, NOW)).toBe("ACTIVE"); }
    finally { client2.release(); }

    await recordProviderRefund(pool, {
      businessId: billable.businessId, paymentId: payment.id, amountMinor: 2500, currencyCode: "GHS", provider: "TESTPAY",
      providerEventReference: "evt-refund-standing", providerRefundReference: "refund-standing", status: "SUCCEEDED",
      requestedAt: NOW.toISOString(), completedAt: NOW.toISOString(),
    });
    expect((await subscriptionState(billable.subscriptionId)).status).toBe("PAST_DUE");
  });

  it("caps delayed renewal catch-up and isolates a malformed subscription from other tenants", async () => {
    const module = await import("../src/platform-admin/subscription-billing-lifecycle-service.js");
    const old = await seedSubscription({
      interval: "MONTHLY", status: "ACTIVE",
      periodStart: new Date("2024-10-27T00:00:00.000Z"), periodEnd: new Date("2024-11-27T00:00:00.000Z"),
    });
    await seedSubscription({ interval: "MONTHLY", status: "ACTIVE", periodStart: null, periodEnd: null });
    const healthy = await seedSubscription({ interval: "MONTHLY", status: "ACTIVE", periodStart: PERIOD_START, periodEnd: PERIOD_END });

    const result = await module.processSubscriptionBillingCycle(pool, { now: NOW, maxCatchUpPeriods: 12 });
    expect(result.catchUpDeferred).toBeGreaterThanOrEqual(1);
    expect(result.errors).toBe(1);
    expect(await invoiceCount(healthy.subscriptionId)).toBe(1);
    expect(await invoiceCount(old.subscriptionId)).toBe(13);
  });

});


async function seedSubscription(options: {
  interval: "MONTHLY" | "ANNUAL" | "CUSTOM";
  status: "TRIALING" | "ACTIVE" | "PAST_DUE";
  trialEndsAt?: Date | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}) {
  const business = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES($1,'RETAIL','GH','GHS','Africa/Accra','ACTIVE') RETURNING id`,
    [`Lifecycle ${crypto.randomBytes(3).toString("hex")}`],
  );
  const plan = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active)
     VALUES($1,'Lifecycle Plan','GHS',12500,$2,14,false,true) RETURNING id`,
    [`LIFE_${crypto.randomBytes(5).toString("hex")}`, options.interval],
  );
  const subscription = await pool.query<{ id: string }>(
    `INSERT INTO business_subscriptions(
       business_id,plan_id,status,trial_ends_at,current_period_starts_at,current_period_ends_at,cancel_at_period_end
     ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [business.rows[0]!.id, plan.rows[0]!.id, options.status, options.trialEndsAt ?? null,
     options.periodStart ?? null, options.periodEnd ?? null, options.cancelAtPeriodEnd ?? false],
  );
  return { businessId: business.rows[0]!.id, planId: plan.rows[0]!.id, subscriptionId: subscription.rows[0]!.id };
}

async function subscriptionState(subscriptionId: string) {
  const result = await pool.query<{
    status: string; current_period_starts_at: Date | null; current_period_ends_at: Date | null; cancel_at_period_end: boolean; canceled_at: Date | null;
  }>(`SELECT status,current_period_starts_at,current_period_ends_at,cancel_at_period_end,canceled_at FROM business_subscriptions WHERE id=$1`, [subscriptionId]);
  return result.rows[0]!;
}

async function invoiceCount(subscriptionId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM subscription_invoices WHERE subscription_id=$1`, [subscriptionId]);
  return result.rows[0]!.count;
}

async function seedActiveSubscription(amountMinor: number, currencyCode: string) {
  const business = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES('Lifecycle Tenant','RETAIL','GH',$1,'Africa/Accra','ACTIVE') RETURNING id`,
    [currencyCode],
  );
  const plan = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active)
     VALUES($1,'Lifecycle Monthly',$2,$3,'MONTHLY',0,false,true) RETURNING id`,
    [`LIFE_${crypto.randomBytes(4).toString("hex")}`, currencyCode, amountMinor],
  );
  const subscription = await pool.query<{ id: string }>(
    `INSERT INTO business_subscriptions(
       business_id,plan_id,status,current_period_starts_at,current_period_ends_at,cancel_at_period_end
     ) VALUES($1,$2,'ACTIVE',$3,$4,false) RETURNING id`,
    [business.rows[0]!.id, plan.rows[0]!.id, PERIOD_START, PERIOD_END],
  );
  return { businessId: business.rows[0]!.id, planId: plan.rows[0]!.id, subscriptionId: subscription.rows[0]!.id };
}

async function insertPeriodInvoice(
  fixture: { businessId: string; subscriptionId: string },
  invoiceNumber: string,
  status: "OPEN" | "VOID",
) {
  return pool.query(
    `INSERT INTO subscription_invoices(
       business_id,subscription_id,invoice_number,currency_code,subtotal_minor,tax_minor,total_minor,amount_paid_minor,
       status,period_start,period_end,issued_at,due_at
     ) VALUES($1,$2,$3,'GHS',12500,0,12500,0,$4,$5,$6,$7,$8)`,
    [fixture.businessId, fixture.subscriptionId, invoiceNumber, status, PERIOD_START, PERIOD_END, NOW, new Date(NOW.getTime() + 7 * 86400000)],
  );
}

async function tenantLedgerCounts() {
  const result = await pool.query<Record<string, number>>(`SELECT
    (SELECT count(*)::int FROM payments) AS payments,
    (SELECT count(*)::int FROM cashbook_entries) AS cashbook,
    (SELECT count(*)::int FROM sales) AS sales,
    (SELECT count(*)::int FROM inventory_movements) AS inventory,
    (SELECT count(*)::int FROM customer_credit_obligations) AS receivables,
    (SELECT count(*)::int FROM supplier_credit_obligations) AS payables,
    (SELECT count(*)::int FROM staff) AS staff,
    (SELECT count(*)::int FROM business_memberships) AS memberships`);
  return result.rows[0]!;
}
