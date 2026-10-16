import type { AdminAutomationRun } from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { evaluateSystemAutomationPolicy } from "./automation-system-service.js";

export const PLATFORM_AUTOMATION_SCHEDULER_LOCK_KEY = "8706112026101601";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

type PolicyTriggerRow = {
  id: string;
  business_id: string | null;
  trigger_type: string;
  conditions: Record<string, unknown>;
};

export async function runPlatformAutomationSchedulerTick(
  pool: DatabasePool,
  options: { intervalMs?: number; now?: () => Date } = {},
): Promise<{ acquired: boolean; correlationId: string | null }> {
  const intervalMs = normalizeInterval(options.intervalMs);
  const now = options.now?.() ?? new Date();
  const client = await pool.connect();
  let acquired = false;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [PLATFORM_AUTOMATION_SCHEDULER_LOCK_KEY],
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) return { acquired: false, correlationId: null };

    const bucketMs = Math.floor(now.getTime() / intervalMs) * intervalMs;
    const correlationId = `scheduled:${new Date(bucketMs).toISOString()}`;

    // Deterministic scheduling deliberately performs no model/provider call.
    // Attention facts are maintained by the deterministic attention engine;
    // scheduled policies consume only authoritative database state.
    const policies = await client.query<PolicyTriggerRow>(
      `SELECT id,business_id,trigger_type,conditions
       FROM platform_automation_policies
       WHERE enabled=true AND trigger_type='SCHEDULED'
       ORDER BY id`,
    );

    for (const policy of policies.rows) {
      await evaluateSystemAutomationPolicy(pool, {
        policyId: policy.id,
        correlationId,
        triggerSource: "SCHEDULED",
        structuredInput: {
          evaluatedAt: now.toISOString(),
          scheduleBucket: correlationId,
        },
      });
    }

    return { acquired: true, correlationId };
  } finally {
    if (acquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [PLATFORM_AUTOMATION_SCHEDULER_LOCK_KEY]);
      } catch (error) {
        console.error("TradeOS automation scheduler could not release its advisory lock", error);
      }
    }
    client.release();
  }
}

export async function evaluatePlatformEvent(
  pool: DatabasePool,
  event: {
    eventType: string;
    entityType: string;
    entityId: string;
    businessId?: string;
    correlationId: string;
  },
): Promise<{ runs: AdminAutomationRun[] }> {
  const policies = await pool.query<PolicyTriggerRow>(
    `SELECT id,business_id,trigger_type,conditions
     FROM platform_automation_policies
     WHERE enabled=true
       AND trigger_type='EVENT'
       AND (business_id IS NULL OR business_id=$1::uuid)
     ORDER BY id`,
    [event.businessId ?? null],
  );
  const matching = policies.rows.filter((policy) => eventMatches(policy.conditions ?? {}, event));
  const runs: AdminAutomationRun[] = [];
  for (const policy of matching) {
    const run = await evaluateSystemAutomationPolicy(pool, {
      policyId: policy.id,
      correlationId: event.correlationId,
      triggerSource: "EVENT",
      structuredInput: {
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        businessId: event.businessId ?? null,
      },
    });
    runs.push(run);
  }
  return { runs };
}

export function startPlatformAutomationScheduler(
  pool: DatabasePool,
  options: { intervalMs?: number; now?: () => Date } = {},
): { stop(): void } {
  const intervalMs = normalizeInterval(options.intervalMs);
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runPlatformAutomationSchedulerTick(pool, { intervalMs, now: options.now });
    } catch (error) {
      console.error("TradeOS platform automation scheduler tick failed", error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

function eventMatches(
  conditions: Record<string, unknown>,
  event: { eventType: string; entityType: string },
): boolean {
  const expectedEvent = typeof conditions.eventType === "string" ? conditions.eventType : null;
  const expectedEntity = typeof conditions.entityType === "string" ? conditions.entityType : null;
  if (expectedEvent && expectedEvent !== event.eventType) return false;
  if (expectedEntity && expectedEntity !== event.entityType) return false;
  return true;
}

function normalizeInterval(value: number | undefined): number {
  if (value === undefined) return 15 * 60 * 1000;
  if (!Number.isFinite(value) || value < 10) return DEFAULT_INTERVAL_MS;
  return Math.floor(value);
}
