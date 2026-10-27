import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/security.js";
import { createPool } from "../src/db.js";
import {
  recordProviderPayment,
  recordProviderRefund,
} from "../src/platform-admin/billing-service.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
const PASSWORD = "admin-password-123";

beforeAll(async () => { await app.ready(); });
beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE
    subscription_payment_refunds,subscription_payments,subscription_invoices,
    platform_admin_sessions,platform_audit_events,business_subscriptions,
    plan_entitlements,subscription_plans,platform_users,payments,cashbook_entries,businesses
    CASCADE`);
});
afterAll(async () => { await app.close(); await pool.end(); });

describe("System Admin SaaS billing ledger", () => {
  it("persists dedicated billing tables and never reuses tenant payment ledgers", async () => {
    const tables = await pool.query<{ invoices: string | null; payments: string | null; refunds: string | null }>(
      `SELECT to_regclass('subscription_invoices')::text AS invoices,
              to_regclass('subscription_payments')::text AS payments,
              to_regclass('subscription_payment_refunds')::text AS refunds`,
    );
    expect(tables.rows[0]).toEqual({
      invoices: "subscription_invoices",
      payments: "subscription_payments",
      refunds: "subscription_payment_refunds",
    });

    const fixture = await seedInvoice(10000);
    const tenantBefore = await tenantLedgerCounts();

    const first = await recordProviderPayment(pool, {
      businessId: fixture.businessId,
      invoiceId: fixture.invoiceId,
      amountMinor: 6000,
      currencyCode: "GHS",
      method: "MOMO",
      provider: "TESTPAY",
      providerEventReference: "evt-pay-1",
      providerTransactionReference: "txn-pay-1",
      status: "SUCCEEDED",
      receivedAt: "2026-10-16T04:00:00.000Z",
    });
    const replay = await recordProviderPayment(pool, {
      businessId: fixture.businessId,
      invoiceId: fixture.invoiceId,
      amountMinor: 6000,
      currencyCode: "GHS",
      method: "MOMO",
      provider: "TESTPAY",
      providerEventReference: "evt-pay-1",
      providerTransactionReference: "txn-pay-1",
      status: "SUCCEEDED",
      receivedAt: "2026-10-16T04:00:00.000Z",
    });
    expect(replay.id).toBe(first.id);
    expect(await count("subscription_payments")).toBe(1);

    let invoice = await invoiceState(fixture.invoiceId);
    expect(invoice).toMatchObject({ amount_paid_minor: "6000", status: "PARTIALLY_PAID" });

    await recordProviderPayment(pool, {
      businessId: fixture.businessId,
      invoiceId: fixture.invoiceId,
      amountMinor: 4000,
      currencyCode: "GHS",
      method: "BANK",
      provider: "TESTPAY",
      providerEventReference: "evt-pay-2",
      providerTransactionReference: "txn-pay-2",
      status: "SUCCEEDED",
      receivedAt: "2026-10-16T04:05:00.000Z",
    });
    invoice = await invoiceState(fixture.invoiceId);
    expect(invoice).toMatchObject({ amount_paid_minor: "10000", status: "PAID" });
    expect(await tenantLedgerCounts()).toEqual(tenantBefore);
  });

  it("appends refunds without rewriting the original payment amount and replays idempotently", async () => {
    const fixture = await seedInvoice(10000);
    const payment = await recordProviderPayment(pool, {
      businessId: fixture.businessId,
      invoiceId: fixture.invoiceId,
      amountMinor: 10000,
      currencyCode: "GHS",
      method: "MOMO",
      provider: "TESTPAY",
      providerEventReference: "evt-paid",
      providerTransactionReference: "txn-paid",
      status: "SUCCEEDED",
      receivedAt: "2026-10-16T04:00:00.000Z",
    });

    const refund = await recordProviderRefund(pool, {
      businessId: fixture.businessId,
      paymentId: payment.id,
      amountMinor: 2500,
      currencyCode: "GHS",
      provider: "TESTPAY",
      providerEventReference: "evt-refund-1",
      providerRefundReference: "refund-1",
      status: "SUCCEEDED",
      completedAt: "2026-10-16T04:10:00.000Z",
    });
    const replay = await recordProviderRefund(pool, {
      businessId: fixture.businessId,
      paymentId: payment.id,
      amountMinor: 2500,
      currencyCode: "GHS",
      provider: "TESTPAY",
      providerEventReference: "evt-refund-1",
      providerRefundReference: "refund-1",
      status: "SUCCEEDED",
      completedAt: "2026-10-16T04:10:00.000Z",
    });
    expect(replay.id).toBe(refund.id);
    expect(await count("subscription_payment_refunds")).toBe(1);

    const stored = await pool.query<{ amount_minor: string; status: string }>(
      "SELECT amount_minor::text,status FROM subscription_payments WHERE id=$1",
      [payment.id],
    );
    expect(stored.rows[0]).toEqual({ amount_minor: "10000", status: "PARTIALLY_REFUNDED" });
    expect(await invoiceState(fixture.invoiceId)).toMatchObject({ amount_paid_minor: "7500", status: "PARTIALLY_PAID" });
  });

  it("serves invoice/payment reads and keeps reconciliation writes billing-authorized", async () => {
    const fixture = await seedInvoice(7500);
    const payment = await recordProviderPayment(pool, {
      businessId: fixture.businessId,
      invoiceId: fixture.invoiceId,
      amountMinor: 7500,
      currencyCode: "GHS",
      method: "BANK",
      provider: "TESTPAY",
      providerEventReference: "evt-pending",
      providerTransactionReference: "txn-pending",
      status: "PENDING",
      receivedAt: "2026-10-16T04:00:00.000Z",
    });

    const supportCookie = await adminCookieFor("support-billing@tradeos.test", "SUPPORT");
    const forbidden = await app.inject({
      method: "POST",
      url: `/api/admin/billing/payments/${payment.id}/reconcile`,
      headers: jsonHeaders(supportCookie),
      payload: { status: "SUCCEEDED", reason: "Support must not settle money" },
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    expect(forbidden.json<{ error: string }>().error).toBe("ADMIN_BILLING_WRITE_FORBIDDEN");

    const billingCookie = await adminCookieFor("billing-ledger@tradeos.test", "BILLING");
    const reconciled = await app.inject({
      method: "POST",
      url: `/api/admin/billing/payments/${payment.id}/reconcile`,
      headers: jsonHeaders(billingCookie),
      payload: { status: "SUCCEEDED", reason: "Provider settlement confirmed" },
    });
    expect(reconciled.statusCode, reconciled.body).toBe(200);
    expect(reconciled.json<{ payment: { status: string; reconciledAt: string | null } }>().payment).toMatchObject({
      status: "SUCCEEDED",
      reconciledAt: expect.any(String),
    });

    const invoices = await app.inject({ method: "GET", url: "/api/admin/billing/invoices", headers: cookieHeader(billingCookie) });
    expect(invoices.statusCode, invoices.body).toBe(200);
    expect(invoices.json<{ invoices: any[] }>().invoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.invoiceId, amountPaidMinor: 7500, status: "PAID" }),
    ]));

    const detail = await app.inject({ method: "GET", url: `/api/admin/billing/invoices/${fixture.invoiceId}`, headers: cookieHeader(billingCookie) });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json<{ invoice: { id: string } }>().invoice.id).toBe(fixture.invoiceId);

    const payments = await app.inject({ method: "GET", url: "/api/admin/billing/payments", headers: cookieHeader(billingCookie) });
    expect(payments.statusCode, payments.body).toBe(200);
    expect(payments.json<{ payments: any[] }>().payments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: payment.id, status: "SUCCEEDED", amountMinor: 7500 }),
    ]));
  });

  it("restores a past-due subscription immediately when a pending payment is reconciled successful", async () => {
    const fixture = await seedInvoice(7500);
    await pool.query(`UPDATE business_subscriptions SET status='PAST_DUE' WHERE id=$1`, [fixture.subscriptionId]);
    await pool.query(`UPDATE subscription_invoices SET due_at=now()-interval '1 day' WHERE id=$1`, [fixture.invoiceId]);
    const payment = await recordProviderPayment(pool, {
      businessId: fixture.businessId, invoiceId: fixture.invoiceId, amountMinor: 7500, currencyCode: "GHS", method: "MOMO",
      provider: "TESTPAY", providerEventReference: "evt-reconcile-standing", providerTransactionReference: "txn-reconcile-standing",
      status: "PENDING", receivedAt: "2026-10-16T04:00:00.000Z",
    });
    const billingCookie = await adminCookieFor("billing-standing@tradeos.test", "BILLING");
    const response = await app.inject({
      method: "POST", url: `/api/admin/billing/payments/${payment.id}/reconcile`, headers: jsonHeaders(billingCookie),
      payload: { status: "SUCCEEDED", reason: "Provider settlement confirmed" },
    });
    expect(response.statusCode, response.body).toBe(200);
    const state = await pool.query<{ status: string }>(`SELECT status FROM business_subscriptions WHERE id=$1`, [fixture.subscriptionId]);
    expect(state.rows[0]?.status).toBe("ACTIVE");
  });

  it("rejects divergent provider replays instead of silently changing money", async () => {
    const fixture = await seedInvoice(5000);
    await recordProviderPayment(pool, {
      businessId: fixture.businessId,
      invoiceId: fixture.invoiceId,
      amountMinor: 5000,
      currencyCode: "GHS",
      method: "MOMO",
      provider: "TESTPAY",
      providerEventReference: "evt-conflict",
      providerTransactionReference: "txn-conflict",
      status: "SUCCEEDED",
      receivedAt: "2026-10-16T04:00:00.000Z",
    });
    await expect(recordProviderPayment(pool, {
      businessId: fixture.businessId,
      invoiceId: fixture.invoiceId,
      amountMinor: 4000,
      currencyCode: "GHS",
      method: "MOMO",
      provider: "TESTPAY",
      providerEventReference: "evt-conflict",
      providerTransactionReference: "txn-conflict",
      status: "SUCCEEDED",
      receivedAt: "2026-10-16T04:00:00.000Z",
    })).rejects.toMatchObject({ code: "ADMIN_BILLING_IDEMPOTENCY_CONFLICT", statusCode: 409 });
    expect(await count("subscription_payments")).toBe(1);
    expect(await invoiceState(fixture.invoiceId)).toMatchObject({ amount_paid_minor: "5000", status: "PAID" });
  });
});

async function seedInvoice(totalMinor: number) {
  const business = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES('Billing Tenant','RETAIL','GH','GHS','Africa/Accra','ACTIVE') RETURNING id`,
  );
  const businessId = business.rows[0]!.id;
  const plan = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active)
     VALUES($1,'Billing Plan','GHS',$2,'MONTHLY',0,false,true) RETURNING id`,
    [`BILL_${Math.random().toString(16).slice(2)}`, totalMinor],
  );
  const subscription = await pool.query<{ id: string }>(
    `INSERT INTO business_subscriptions(business_id,plan_id,status,current_period_starts_at,current_period_ends_at)
     VALUES($1,$2,'ACTIVE',now(),now()+interval '1 month') RETURNING id`,
    [businessId, plan.rows[0]!.id],
  );
  const invoice = await pool.query<{ id: string }>(
    `INSERT INTO subscription_invoices(
       business_id,subscription_id,invoice_number,currency_code,subtotal_minor,tax_minor,total_minor,amount_paid_minor,
       status,period_start,period_end,issued_at,due_at
     ) VALUES($1,$2,$3,'GHS',$4,0,$4,0,'OPEN',now(),now()+interval '1 month',now(),now()+interval '7 days') RETURNING id`,
    [businessId, subscription.rows[0]!.id, `INV-${Date.now()}-${Math.random().toString(16).slice(2)}`, totalMinor],
  );
  return { businessId, invoiceId: invoice.rows[0]!.id, subscriptionId: subscription.rows[0]!.id };
}

async function seedAdmin(email: string, role: string): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);
  await pool.query(
    `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
     VALUES($1,$2,$3,true,$4,now())`,
    [email, `${role} Operator`, role, passwordHash],
  );
}
async function adminCookieFor(email: string, role: string): Promise<string> {
  await seedAdmin(email, role);
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/session/login",
    payload: { identifier: email, password: PASSWORD, platform: "WEB", deviceKey: `${role.toLowerCase()}-billing-device` },
  });
  expect(login.statusCode, login.body).toBe(200);
  return adminCookie(login.headers);
}
function adminCookie(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["set-cookie"];
  const serialized = Array.isArray(raw) ? raw[0] : raw;
  expect(serialized).toBeTruthy();
  return serialized!.split(";", 1)[0]!;
}
function cookieHeader(cookie: string) { return { cookie }; }
function jsonHeaders(cookie: string) { return { cookie, "content-type": "application/json" }; }
async function count(table: "subscription_payments" | "subscription_payment_refunds") {
  const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
  return Number(result.rows[0]!.count);
}
async function invoiceState(invoiceId: string) {
  const result = await pool.query<{ amount_paid_minor: string; status: string }>(
    "SELECT amount_paid_minor::text,status FROM subscription_invoices WHERE id=$1",
    [invoiceId],
  );
  return result.rows[0]!;
}
async function tenantLedgerCounts() {
  const result = await pool.query<{ payments: string; cashbook: string }>(
    "SELECT (SELECT count(*) FROM payments)::text AS payments,(SELECT count(*) FROM cashbook_entries)::text AS cashbook",
  );
  return result.rows[0]!;
}
