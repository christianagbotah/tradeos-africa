import type { DatabasePool } from "../db.js";
import { evaluateBusinessAttention } from "./attention-service.js";

export const BUSINESS_ATTENTION_SCHEDULER_LOCK_KEY = "8706112026111401";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const SUCCESS_RECHECK_MS = 60 * 60 * 1000;
const FAILURE_RETRY_MS = 15 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 12;
const MAX_BATCH_SIZE = 30;

type Candidate = { business_id: string; branch_id: string };
export type BusinessAttentionSchedulerResult = {
  acquired: boolean;
  attempted: number;
  succeeded: number;
  failed: number;
};
export interface BusinessAttentionSchedulerOptions {
  now?: () => Date;
  batchSize?: number;
  /** Test seam only. Production always evaluates actual canonical reports. */
  evaluate?: typeof evaluateBusinessAttention;
}

/** Bounded and cross-process-serialized evaluation of active tenant branches.
 * Each merchant receives a fair due time; errors do not block other businesses.
 * Only advisory alerts are generated. No economic transaction is posted.
 */
export async function runBusinessAttentionSchedulerTick(
  pool: DatabasePool,
  options: BusinessAttentionSchedulerOptions = {},
): Promise<BusinessAttentionSchedulerResult> {
  const now = options.now?.() ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error("Invalid scheduler clock");
  const size = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(size) || DEFAULT_BATCH_SIZE));
  const evaluate = options.evaluate ?? evaluateBusinessAttention;
  const result: BusinessAttentionSchedulerResult = { acquired: false, attempted: 0, succeeded: 0, failed: 0 };
  const client = await pool.connect();
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [BUSINESS_ATTENTION_SCHEDULER_LOCK_KEY],
    );
    if (lock.rows[0]?.acquired !== true) return result;
    result.acquired = true;
    const due = await client.query<Candidate>(
      "SELECT b.id AS business_id,br.id AS branch_id " +
      "FROM branches br JOIN businesses b ON b.id=br.business_id " +
      "LEFT JOIN business_attention_schedule_checkpoints c ON c.business_id=b.id AND c.branch_id=br.id " +
      "WHERE b.status='ACTIVE' AND br.is_active=true " +
      "AND (c.next_due_at IS NULL OR c.next_due_at <= $1::timestamptz) " +
      "ORDER BY c.next_due_at ASC NULLS FIRST,b.id,br.id LIMIT $2::integer",
      [now.toISOString(), batchSize],
    );

    for (const candidate of due.rows) {
      result.attempted += 1;
      let passed = false;
      try {
        await evaluate(pool, candidate.business_id, candidate.branch_id);
        passed = true;
        result.succeeded += 1;
      } catch (error) {
        result.failed += 1;
        console.error("TradeOS tenant attention evaluation failed", {
          businessId: candidate.business_id,
          branchId: candidate.branch_id,
          cause: error instanceof Error ? error.name : "UNKNOWN",
        });
      }
      await client.query(
        "INSERT INTO business_attention_schedule_checkpoints (" +
        "business_id,branch_id,last_attempt_at,last_success_at,next_due_at,failure_count,last_result,last_error_code,updated_at" +
        ") VALUES ($1,$2,$3," +
        "CASE WHEN $4::boolean THEN $3::timestamptz ELSE NULL END," +
        "$3::timestamptz + ($5::integer * interval '1 millisecond')," +
        "CASE WHEN $4::boolean THEN 0 ELSE 1 END," +
        "CASE WHEN $4::boolean THEN 'SUCCESS' ELSE 'FAILED' END," +
        "CASE WHEN $4::boolean THEN NULL ELSE 'EVALUATION_FAILED' END,now()) " +
        "ON CONFLICT (business_id,branch_id) DO UPDATE SET " +
        "last_attempt_at=EXCLUDED.last_attempt_at," +
        "last_success_at=CASE WHEN $4::boolean THEN EXCLUDED.last_success_at ELSE business_attention_schedule_checkpoints.last_success_at END," +
        "next_due_at=EXCLUDED.next_due_at," +
        "failure_count=CASE WHEN $4::boolean THEN 0 ELSE business_attention_schedule_checkpoints.failure_count+1 END," +
        "last_result=EXCLUDED.last_result,last_error_code=EXCLUDED.last_error_code,updated_at=now()",
        [
          candidate.business_id, candidate.branch_id, now.toISOString(), passed,
          passed ? SUCCESS_RECHECK_MS : FAILURE_RETRY_MS,
        ],
      );
    }
    return result;
  } finally {
    if (result.acquired) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock($1::bigint)",
          [BUSINESS_ATTENTION_SCHEDULER_LOCK_KEY],
        );
      } catch (error) {
        console.error("TradeOS tenant attention scheduler could not unlock", error);
      }
    }
    client.release();
  }
}

/** Each API instance has a timer; the database advisory lock elects one worker. */
export function startBusinessAttentionScheduler(
  pool: DatabasePool,
  options: BusinessAttentionSchedulerOptions & { intervalMs?: number } = {},
): { stop(): void } {
  // Operational kill switch for database incidents; default enabled.
  if (process.env.TRADEOS_BUSINESS_ATTENTION_SCHEDULER_ENABLED === "false") {
    return { stop() {} };
  }
  const intervalMs = options.intervalMs !== undefined &&
    Number.isSafeInteger(options.intervalMs) && options.intervalMs >= 1000
    ? options.intervalMs : DEFAULT_INTERVAL_MS;
  let running = false;
  let stopped = false;
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      await runBusinessAttentionSchedulerTick(pool, options);
    } catch (error) {
      console.error("TradeOS tenant attention scheduler tick failed", error);
    } finally {
      running = false;
    }
  }
  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
