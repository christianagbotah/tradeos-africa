import type { DatabasePool } from "../db.js";
import { processSubscriptionBillingCycle, type BillingCycleResult } from "./subscription-billing-lifecycle-service.js";

export const SUBSCRIPTION_BILLING_SCHEDULER_LOCK_KEY = "8706112026102701";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const MIN_INTERVAL_MS = 60_000;

export async function runSubscriptionBillingSchedulerTick(
  pool: DatabasePool,
  options: { now?: () => Date; maxCatchUpPeriods?: number } = {},
): Promise<{ acquired: boolean; result: BillingCycleResult | null }> {
  const client = await pool.connect();
  let acquired = false;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [SUBSCRIPTION_BILLING_SCHEDULER_LOCK_KEY],
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) return { acquired: false, result: null };
    const now = options.now?.() ?? new Date();
    const result = await processSubscriptionBillingCycle(pool, {
      now,
      ...(options.maxCatchUpPeriods !== undefined ? { maxCatchUpPeriods: options.maxCatchUpPeriods } : {}),
    });
    return { acquired: true, result };
  } finally {
    if (acquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [SUBSCRIPTION_BILLING_SCHEDULER_LOCK_KEY]);
      } catch (error) {
        console.error("TradeOS subscription billing scheduler could not release its advisory lock", error);
      }
    }
    client.release();
  }
}

export function startSubscriptionBillingScheduler(
  pool: DatabasePool,
  options: { enabled?: boolean; intervalMs?: number; now?: () => Date } = {},
): { stop(): Promise<void> } {
  if (options.enabled === false) return { async stop() {} };
  const intervalMs = normalizeInterval(options.intervalMs);
  let stopped = false;
  let currentTick: Promise<void> | null = null;

  const tick = () => {
    if (stopped || currentTick) return;
    const pending = (async () => {
      try {
        const tickOptions = options.now ? { now: options.now } : {};
        await runSubscriptionBillingSchedulerTick(pool, tickOptions);
      } catch (error) {
        console.error("TradeOS subscription billing scheduler tick failed", error);
      }
    })();
    const tracked = pending.finally(() => {
      if (currentTick === tracked) currentTick = null;
    });
    currentTick = tracked;
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return {
    async stop() {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
      }
      const pending = currentTick;
      if (pending) await pending;
    },
  };
}

function normalizeInterval(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.floor(value));
}
