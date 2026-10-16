import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/security.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
const PASSWORD = "admin-password-123";

beforeAll(async () => { await app.ready(); });
beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE
    subscription_payment_refunds,subscription_payments,subscription_invoices,
    platform_admin_sessions,platform_audit_events,platform_feature_flags,client_releases,
    business_entitlement_overrides,business_subscriptions,subscription_plans,registered_devices,
    business_memberships,staff,app_users,branches,platform_users,businesses CASCADE`);
});
afterAll(async () => { await app.close(); await pool.end(); });

describe("platform command-center metrics", () => {
  it("returns deterministic tenant, subscription, billing, device and release metrics without mixing currencies", async () => {
    await seedAdmin("metrics@tradeos.test", "SUPPORT");
    const cookie = adminCookie((await adminLogin("metrics@tradeos.test")).headers);

    const monthlyGhs = await seedPlan("GHS-MONTHLY", "GHS", 30000, "MONTHLY");
    const annualGhs = await seedPlan("GHS-ANNUAL", "GHS", 120000, "ANNUAL");
    const monthlyUsd = await seedPlan("USD-MONTHLY", "USD", 5000, "MONTHLY");
    const customGhs = await seedPlan("GHS-CUSTOM", "GHS", 99999, "CUSTOM");

    const activeMonthly = await seedBusiness("Active Monthly", "ACTIVE");
    const activeAnnual = await seedBusiness("Active Annual", "ACTIVE");
    const activeUsd = await seedBusiness("Active USD", "ACTIVE");
    const activeCustom = await seedBusiness("Active Custom", "ACTIVE");
    const trialing = await seedBusiness("Trial Tenant", "ACTIVE");
    const pastDue = await seedBusiness("Past Due Tenant", "ACTIVE");
    const suspended = await seedBusiness("Suspended Tenant", "SUSPENDED");
    const closed = await seedBusiness("Closed Tenant", "CLOSED");

    const monthlySubscription = await seedSubscription(activeMonthly, monthlyGhs, "ACTIVE");
    const annualSubscription = await seedSubscription(activeAnnual, annualGhs, "ACTIVE");
    const usdSubscription = await seedSubscription(activeUsd, monthlyUsd, "ACTIVE");
    await seedSubscription(activeCustom, customGhs, "ACTIVE");
    await seedSubscription(trialing, monthlyGhs, "TRIALING");
    await seedSubscription(pastDue, monthlyGhs, "PAST_DUE");
    await seedSubscription(suspended, monthlyGhs, "CANCELED");
    await seedSubscription(closed, monthlyGhs, "EXPIRED");

    const overdueGhsInvoice = await seedInvoice(activeMonthly, monthlySubscription, "INV-GHS-OVERDUE", "GHS", 50000, 10000, "OPEN", "-1 day");
    await seedInvoice(activeAnnual, annualSubscription, "INV-GHS-OPEN", "GHS", 70000, 20000, "PARTIALLY_PAID", "+2 days");
    const overdueUsdInvoice = await seedInvoice(activeUsd, usdSubscription, "INV-USD-OVERDUE", "USD", 10000, 0, "OPEN", "-2 days");
    await seedInvoice(activeMonthly, monthlySubscription, "INV-GHS-PAID", "GHS", 30000, 30000, "PAID", "-5 days");

    await seedPayment(activeMonthly, overdueGhsInvoice, "GHS", 40000, "SUCCEEDED", "evt-ghs-ok", "txn-ghs-ok");
    await seedPayment(activeMonthly, overdueGhsInvoice, "GHS", 15000, "FAILED", "evt-ghs-fail", "txn-ghs-fail");
    await seedPayment(activeUsd, overdueUsdInvoice, "USD", 10000, "SUCCEEDED", "evt-usd-ok", "txn-usd-ok");

    await pool.query(
      `INSERT INTO registered_devices(business_id,device_key,platform,app_version,status,last_seen_at,last_sync_at)
       VALUES
         ($1,'online-web','WEB','2.0.0','ACTIVE',now()-interval '5 minutes',now()-interval '4 minutes'),
         ($2,'stale-pos','WINDOWS','1.9.0','ACTIVE',now()-interval '2 hours',now()-interval '2 hours'),
         ($3,'never-seen','ANDROID','2.0.0','ACTIVE',NULL,NULL)`,
      [activeMonthly, activeAnnual, activeUsd],
    );
    await pool.query(
      `INSERT INTO client_releases(platform,version,release_channel,status,rollout_percent)
       VALUES
         ('WEB','2.0.0','STABLE','ACTIVE',100),
         ('WINDOWS','2.1.0','STABLE','ROLLOUT',50),
         ('ANDROID','2.2.0','BETA','DRAFT',0),
         ('IOS','1.8.0','STABLE','WITHDRAWN',100)`,
    );

    const response = await app.inject({ method: "GET", url: "/api/admin/metrics", headers: { cookie } });
    expect(response.statusCode, response.body).toBe(200);
    const { metrics } = response.json<{ metrics: Record<string, any> }>();

    expect(metrics.tenants).toEqual({ total: 8, active: 6, suspended: 1, closed: 1 });
    expect(metrics.subscriptions).toEqual({ trialing: 1, active: 4, pastDue: 1, paused: 0, canceled: 1, expired: 1 });
    expect(metrics.recurringRevenue).toEqual([
      { currencyCode: "GHS", mrrMinor: 40000, arrMinor: 480000 },
      { currencyCode: "USD", mrrMinor: 5000, arrMinor: 60000 },
    ]);
    expect(metrics.invoices).toEqual({
      openCount: 3,
      overdueCount: 2,
      openBalanceByCurrency: [
        { currencyCode: "GHS", amountMinor: 90000 },
        { currencyCode: "USD", amountMinor: 10000 },
      ],
      overdueBalanceByCurrency: [
        { currencyCode: "GHS", amountMinor: 40000 },
        { currencyCode: "USD", amountMinor: 10000 },
      ],
    });
    expect(metrics.collections).toEqual({
      succeededCount: 2,
      failedCount: 1,
      succeededByCurrency: [
        { currencyCode: "GHS", amountMinor: 40000 },
        { currencyCode: "USD", amountMinor: 10000 },
      ],
      failedByCurrency: [{ currencyCode: "GHS", amountMinor: 15000 }],
    });
    expect(metrics.devices).toEqual({ total: 3, online: 1, stale: 1, unknown: 1, syncRiskTenantCount: 2 });
    expect(metrics.releases).toEqual({ draft: 1, rollout: 1, active: 1, withdrawn: 1 });
  });

  it("requires an authenticated platform administrator", async () => {
    const response = await app.inject({ method: "GET", url: "/api/admin/metrics" });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: string }>().error).toBe("ADMIN_AUTH_REQUIRED");
  });
});

async function seedAdmin(email: string, role: string): Promise<void> {
  const passwordHash = await hashPassword(PASSWORD);
  await pool.query(
    `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
     VALUES($1,'Metrics Operator',$2,true,$3,now())`,
    [email, role, passwordHash],
  );
}

async function adminLogin(email: string) {
  return app.inject({
    method: "POST",
    url: "/api/admin/session/login",
    payload: { identifier: email, password: PASSWORD, platform: "WEB", deviceKey: "metrics-device" },
  });
}

async function seedPlan(code: string, currencyCode: string, amountMinor: number, billingInterval: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,is_active,is_public)
     VALUES($1,$1,$2,$3,$4,true,true) RETURNING id`,
    [code, currencyCode, amountMinor, billingInterval],
  );
  return result.rows[0]!.id;
}

async function seedBusiness(name: string, status: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,status,country_code,currency_code)
     VALUES($1,'RETAIL',$2,'GH','GHS') RETURNING id`,
    [name, status],
  );
  return result.rows[0]!.id;
}

async function seedSubscription(businessId: string, planId: string, status: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_subscriptions(business_id,plan_id,status,current_period_starts_at,current_period_ends_at)
     VALUES($1,$2,$3,now()-interval '10 days',now()+interval '20 days') RETURNING id`,
    [businessId, planId, status],
  );
  return result.rows[0]!.id;
}

async function seedInvoice(
  businessId: string,
  subscriptionId: string,
  invoiceNumber: string,
  currencyCode: string,
  totalMinor: number,
  amountPaidMinor: number,
  status: string,
  dueOffset: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO subscription_invoices(
       business_id,subscription_id,invoice_number,currency_code,subtotal_minor,tax_minor,total_minor,amount_paid_minor,
       status,period_start,period_end,due_at,paid_at
     ) VALUES($1,$2,$3,$4,$5,0,$5,$6,$7,now()-interval '30 days',now(),now()+$8::interval,CASE WHEN $7='PAID' THEN now() ELSE NULL END)
     RETURNING id`,
    [businessId, subscriptionId, invoiceNumber, currencyCode, totalMinor, amountPaidMinor, status, dueOffset],
  );
  return result.rows[0]!.id;
}

async function seedPayment(
  businessId: string,
  invoiceId: string,
  currencyCode: string,
  amountMinor: number,
  status: string,
  eventReference: string,
  transactionReference: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO subscription_payments(
       business_id,invoice_id,amount_minor,currency_code,method,provider,provider_event_reference,
       provider_transaction_reference,status,received_at
     ) VALUES($1,$2,$3,$4,'MOMO','TEST',$5,$6,$7,now())`,
    [businessId, invoiceId, amountMinor, currencyCode, eventReference, transactionReference, status],
  );
}

function adminCookie(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["set-cookie"];
  const serialized = Array.isArray(raw) ? raw[0] : raw;
  expect(serialized).toBeTruthy();
  return serialized!.split(";", 1)[0]!;
}
