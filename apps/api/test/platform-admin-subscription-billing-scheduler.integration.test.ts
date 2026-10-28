import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const apiRoot = path.resolve(__dirname, "../src");
const NOW = new Date("2026-10-27T08:00:00.000Z");

beforeAll(async () => { await pool.query("SELECT 1"); });
beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE
    subscription_payment_refunds,subscription_payments,subscription_invoices,platform_audit_events,
    business_subscriptions,plan_entitlements,subscription_plans,businesses CASCADE`);
});
afterAll(async () => { await pool.end(); });

type SchedulerModule = {
  SUBSCRIPTION_BILLING_SCHEDULER_LOCK_KEY: string;
  runSubscriptionBillingSchedulerTick(
    pool: ReturnType<typeof createPool>,
    options?: { now?: () => Date; maxCatchUpPeriods?: number },
  ): Promise<{ acquired: boolean; result: { invoicesCreated: number } | null }>;
  startSubscriptionBillingScheduler(
    pool: ReturnType<typeof createPool>,
    options?: { enabled?: boolean; intervalMs?: number; now?: () => Date },
  ): { stop(): Promise<void> };
};

async function schedulerModule(): Promise<SchedulerModule> {
  const modulePath = "../src/platform-admin/" + "subscription-billing-scheduler.js";
  return await import(modulePath) as SchedulerModule;
}

describe("subscription billing scheduler", () => {
  it("uses a dedicated PostgreSQL advisory lock and skips while another instance owns it", async () => {
    const scheduler = await schedulerModule();
    const subscriptionId = await seedBillableSubscription();
    const blocker = await pool.connect();
    try {
      await blocker.query("SELECT pg_advisory_lock($1::bigint)", [scheduler.SUBSCRIPTION_BILLING_SCHEDULER_LOCK_KEY]);
      const skipped = await scheduler.runSubscriptionBillingSchedulerTick(pool, { now: () => NOW });
      expect(skipped).toEqual({ acquired: false, result: null });
      expect(await invoiceCount(subscriptionId)).toBe(0);
    } finally {
      await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [scheduler.SUBSCRIPTION_BILLING_SCHEDULER_LOCK_KEY]);
      blocker.release();
    }

    const processed = await scheduler.runSubscriptionBillingSchedulerTick(pool, { now: () => NOW });
    expect(processed.acquired).toBe(true);
    expect(processed.result?.invoicesCreated).toBe(1);
    expect(await invoiceCount(subscriptionId)).toBe(1);
  });

  it("drains overlapping immediate ticks on stop without duplicating a period invoice", async () => {
    const scheduler = await schedulerModule();
    const subscriptionId = await seedBillableSubscription();
    const first = scheduler.startSubscriptionBillingScheduler(pool, { intervalMs: 60_000, now: () => NOW });
    const second = scheduler.startSubscriptionBillingScheduler(pool, { intervalMs: 60_000, now: () => NOW });
    await Promise.all([first.stop(), second.stop()]);
    expect(await invoiceCount(subscriptionId)).toBe(1);
  });

  it("keeps billing ticks provider/model-free and wires disable, interval floor and shutdown draining into the server", async () => {
    const schedulerSource = fs.readFileSync(path.join(apiRoot, "platform-admin/subscription-billing-scheduler.ts"), "utf8");
    const serverSource = fs.readFileSync(path.join(apiRoot, "server.ts"), "utf8");
    expect(schedulerSource).toContain("15 * 60 * 1000");
    expect(schedulerSource).toContain("60_000");
    expect(schedulerSource).toContain("pg_try_advisory_lock");
    expect(schedulerSource).not.toMatch(/AiTextProvider|intelligence-service|Hubtel|Paystack/i);
    expect(serverSource).toContain("SUBSCRIPTION_BILLING_SCHEDULER_ENABLED");
    expect(serverSource).toContain("SUBSCRIPTION_BILLING_SCHEDULER_INTERVAL_MS");
    expect(serverSource).toContain("startSubscriptionBillingScheduler");
    expect(serverSource).toMatch(/Math\.max\(60_000,/);
    expect(serverSource.match(/await subscriptionBillingScheduler\.stop\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

async function seedBillableSubscription(): Promise<string> {
  const business = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES('Scheduler Billing Tenant','RETAIL','GH','GHS','Africa/Accra','ACTIVE') RETURNING id`,
  );
  const plan = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active)
     VALUES($1,'Scheduler Monthly','GHS',15000,'MONTHLY',0,false,true) RETURNING id`,
    [`SCHED_${Math.random().toString(16).slice(2)}`],
  );
  const subscription = await pool.query<{ id: string }>(
    `INSERT INTO business_subscriptions(
       business_id,plan_id,status,current_period_starts_at,current_period_ends_at,cancel_at_period_end
     ) VALUES($1,$2,'ACTIVE','2026-10-27T00:00:00Z','2026-11-27T00:00:00Z',false) RETURNING id`,
    [business.rows[0]!.id, plan.rows[0]!.id],
  );
  return subscription.rows[0]!.id;
}

async function invoiceCount(subscriptionId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM subscription_invoices WHERE subscription_id=$1`, [subscriptionId],
  );
  return result.rows[0]!.count;
}
