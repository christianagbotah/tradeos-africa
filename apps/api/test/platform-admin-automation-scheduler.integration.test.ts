import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const apiRoot = path.resolve(__dirname, "../src");

type SchedulerModule = {
  PLATFORM_AUTOMATION_SCHEDULER_LOCK_KEY: string;
  runPlatformAutomationSchedulerTick(
    pool: ReturnType<typeof createPool>,
    options?: { now?: () => Date; intervalMs?: number },
  ): Promise<{ acquired: boolean; correlationId: string | null }>;
  evaluatePlatformEvent(
    pool: ReturnType<typeof createPool>,
    event: { eventType: string; entityType: string; entityId: string; businessId?: string; correlationId: string },
  ): Promise<{ runs: Array<{ id: string; state: string; triggerCorrelationId: string }> }>;
  startPlatformAutomationScheduler(
    pool: ReturnType<typeof createPool>,
    options?: { intervalMs?: number; now?: () => Date },
  ): { stop(): void };
};

async function schedulerModule(): Promise<SchedulerModule> {
  const modulePath = "../src/platform-admin/" + "automation-scheduler.js";
  return await import(modulePath) as SchedulerModule;
}

beforeAll(async () => {
  await pool.query("SELECT 1");
});

beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE
    platform_automation_runs,platform_automation_policies,platform_attention_items,
    subscription_payment_refunds,subscription_payments,subscription_invoices,
    platform_admin_sessions,platform_audit_events,business_entitlement_overrides,
    business_subscriptions,plan_entitlements,subscription_plans,registered_devices,
    client_releases,platform_users,businesses CASCADE`);
});

afterAll(async () => { await pool.end(); });

describe("platform proactive automation scheduler", () => {
  it("uses a PostgreSQL advisory lock so a second evaluator skips while the lock is held", async () => {
    const scheduler = await schedulerModule();
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1::bigint)", [scheduler.PLATFORM_AUTOMATION_SCHEDULER_LOCK_KEY]);
      const skipped = await scheduler.runPlatformAutomationSchedulerTick(pool, {
        now: () => new Date("2026-10-16T18:00:00.000Z"),
      });
      expect(skipped).toMatchObject({ acquired: false, correlationId: null });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [scheduler.PLATFORM_AUTOMATION_SCHEDULER_LOCK_KEY]);
      client.release();
    }

    const evaluated = await scheduler.runPlatformAutomationSchedulerTick(pool, {
      now: () => new Date("2026-10-16T18:00:00.000Z"),
    });
    expect(evaluated.acquired).toBe(true);
    expect(evaluated.correlationId).toBe("scheduled:2026-10-16T18:00:00.000Z");
  });

  it("evaluates a scheduled policy once per correlation even when two scheduler instances overlap", async () => {
    const scheduler = await schedulerModule();
    const creatorId = await seedPlatformUser();
    const policyId = await seedPolicy(creatorId, {
      code: "SCHEDULED-RECORD",
      triggerType: "SCHEDULED",
      conditions: {},
    });
    const fixedNow = () => new Date("2026-10-16T18:15:00.000Z");

    const first = scheduler.startPlatformAutomationScheduler(pool, { intervalMs: 20, now: fixedNow });
    const second = scheduler.startPlatformAutomationScheduler(pool, { intervalMs: 20, now: fixedNow });
    await sleep(90);
    first.stop();
    second.stop();

    const runs = await pool.query<{ state: string; trigger_correlation_id: string }>(
      "SELECT state,trigger_correlation_id FROM platform_automation_runs WHERE policy_id=$1 ORDER BY created_at",
      [policyId],
    );
    expect(runs.rows).toEqual([{ state: "SUCCEEDED", trigger_correlation_id: "scheduled:2026-10-16T18:15:00.000Z" }]);
  });

  it("deduplicates repeated event delivery by policy version and correlation id", async () => {
    const scheduler = await schedulerModule();
    const creatorId = await seedPlatformUser();
    const businessId = await seedBusiness();
    const policyId = await seedPolicy(creatorId, {
      code: "EVENT-RECORD",
      triggerType: "EVENT",
      conditions: { eventType: "TENANT_UPDATED", entityType: "BUSINESS" },
      businessId,
    });
    const event = {
      eventType: "TENANT_UPDATED",
      entityType: "BUSINESS",
      entityId: businessId,
      businessId,
      correlationId: "tenant-updated:revision-42",
    };

    const first = await scheduler.evaluatePlatformEvent(pool, event);
    const replay = await scheduler.evaluatePlatformEvent(pool, event);
    expect(first.runs).toHaveLength(1);
    expect(replay.runs).toHaveLength(1);
    expect(replay.runs[0]?.id).toBe(first.runs[0]?.id);
    expect(replay.runs[0]?.state).toBe("SUCCEEDED");

    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM platform_automation_runs WHERE policy_id=$1 AND trigger_correlation_id=$2",
      [policyId, event.correlationId],
    );
    expect(Number(count.rows[0]!.count)).toBe(1);
  });

  it("wires scheduler stop into server shutdown and keeps scheduled ticks model-free", async () => {
    const schedulerSource = fs.readFileSync(path.join(apiRoot, "platform-admin/automation-scheduler.ts"), "utf8");
    const serverSource = fs.readFileSync(path.join(apiRoot, "server.ts"), "utf8");
    expect(schedulerSource).toContain("15 * 60 * 1000");
    expect(schedulerSource).toContain("pg_try_advisory_lock");
    expect(schedulerSource).not.toContain("AiTextProvider");
    expect(schedulerSource).not.toContain("intelligence-service");
    expect(serverSource).toContain("startPlatformAutomationScheduler");
    expect(serverSource).toContain("automationScheduler.stop()");
  });
});

async function seedPlatformUser(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO platform_users(email,display_name,role,is_active)
     VALUES('scheduler-owner@tradeos.test','Scheduler Owner','SUPER_ADMIN',true) RETURNING id`,
  );
  return result.rows[0]!.id;
}

async function seedBusiness(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES('Scheduler Tenant','RETAIL','GH','GHS','Africa/Accra','ACTIVE') RETURNING id`,
  );
  return result.rows[0]!.id;
}

async function seedPolicy(
  creatorId: string,
  input: { code: string; triggerType: string; conditions: Record<string, unknown>; businessId?: string },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO platform_automation_policies(
       code,name,description,enabled,business_id,trigger_type,conditions,action_type,action_configuration,
       execution_class,approval_role,policy_version,created_by_platform_user_id,updated_by_platform_user_id
     ) VALUES($1,$1,'Scheduler integration test',true,$2,$3,$4::jsonb,'RECORD_ONLY','{}'::jsonb,0,NULL,1,$5,$5)
     RETURNING id`,
    [input.code, input.businessId ?? null, input.triggerType, JSON.stringify(input.conditions), creatorId],
  );
  return result.rows[0]!.id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
