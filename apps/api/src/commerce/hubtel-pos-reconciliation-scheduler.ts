import type { DatabaseClient, DatabasePool } from "../db.js";
import {
  hubtelPosGloballyEnabled,
} from "./hubtel-pos-config.js";
import {
  verifySaleHubtelCheckout,
  type SaleHubtelVerification,
} from "./hubtel-pos-service.js";

// A single reconciliation tick is elected across every running API process.
// The lock is session-scoped and is always released before the client returns
// to the pool. No remote payment or sale mutation is executed under a
// database transaction spanning an external HTTP request.
export const HUBTEL_POS_RECONCILIATION_LOCK_KEY = "8706112026111502";
const DEFAULT_INTERVAL_MS = 60_000;
const MIN_AGE_MS = 5 * 60_000;
const PREPARED_REVIEW_AGE_MS = 15 * 60_000;
const MAX_OPEN_AGE_MS = 24 * 60 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
const DEFAULT_BATCH_SIZE = 12;
const MAX_BATCH_SIZE = 25;

type Candidate = {
  id: string;
  business_id: string;
  branch_id: string;
  sale_id: string;
  state: "PREPARED" | "READY" | "PENDING_VERIFICATION";
  created_at: Date;
  status_check_attempts: number;
};
type Check = (pool: DatabasePool, input: { businessId: string; saleId: string }) =>
  Promise<SaleHubtelVerification>;

export interface HubtelPosReconciliationOptions {
  now?: () => Date;
  batchSize?: number;
  /** Injected checker is only for tests; production uses authenticated Hubtel status. */
  verify?: Check;
}
export interface HubtelPosReconciliationResult {
  enabled: boolean;
  acquired: boolean;
  attempted: number;
  paid: number;
  unpaid: number;
  failed: number;
  reviewRequired: number;
}

/** Never infer payment failure from elapsed time alone. */
export function hubtelReconciliationDecision(input: {
  state: Candidate["state"];
  ageMs: number;
  attempts: number;
  outcome: "PAID" | "UNPAID" | "REFUND_REVIEW" | "ERROR";
  errorCode?: string | undefined;
}): { action: "COMPLETE" | "RETRY" | "REVIEW"; retryAfterMs?: number; reason?: string } {
  if (input.state === "PREPARED") {
    return { action: "REVIEW", reason: "HUBTEL_POS_PREPARED_UNCERTAIN" };
  }
  if (input.outcome === "PAID") return { action: "COMPLETE" };
  if (input.outcome === "REFUND_REVIEW") {
    return { action: "REVIEW", reason: "HUBTEL_POS_REFUND_REVIEW" };
  }
  const permanent = new Set([
    "HUBTEL_STATUS_AMOUNT_MISMATCH",
    "HUBTEL_STATUS_REFERENCE_MISMATCH",
    "HUBTEL_STATUS_CURRENCY_MISMATCH",
    "HUBTEL_STATUS_INVALID",
    "HUBTEL_STATUS_AUTH_REJECTED",
    "HUBTEL_STATUS_ACCESS_DENIED",
    "HUBTEL_POS_ACCOUNT_MISMATCH",
    "HUBTEL_POS_PAYMENT_MISMATCH",
    "HUBTEL_POS_STATE_MISMATCH",
    "HUBTEL_POS_REPLAY_CONFLICT",
  ]);
  if (input.outcome === "ERROR" && permanent.has(input.errorCode ?? "")) {
    return { action: "REVIEW", reason: input.errorCode ?? "HUBTEL_POS_PAYMENT_MISMATCH" };
  }
  // An old unanswered checkout is sent to review, but its funds, stock,
  // ledger and pending sale remain untouched until a safe resolution.
  if (input.ageMs >= MAX_OPEN_AGE_MS) {
    return { action: "REVIEW", reason: "HUBTEL_POS_UNRESOLVED_24H" };
  }
  const attempts = Math.max(1, Math.min(12, Math.floor(input.attempts)));
  const retryAfterMs = Math.min(MAX_BACKOFF_MS, MIN_AGE_MS * 2 ** (attempts - 1));
  return { action: "RETRY", retryAfterMs };
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error &&
    typeof (error as Error & { code: unknown }).code === "string") {
    const code = (error as Error & { code: string }).code;
    // Stored and logged codes are from first-party enum validation only.
    if (/^[A-Z0-9_]{3,80}$/.test(code)) return code;
  }
  return "HUBTEL_POS_CHECK_ERROR";
}

async function markReview(
  client: DatabaseClient,
  candidate: Candidate,
  clock: Date,
  reason: string,
  result: "REFUNDED" | "ERROR" | "REVIEW_REQUIRED",
): Promise<boolean> {
  await client.query("BEGIN");
  try {
  // Only open, unresolved attempts are altered. A competing manual verifier
  // may already have settled this sale before we acquire the row lock.
  const changed = await client.query<{ id: string }>(
    "UPDATE hubtel_sale_checkout_attempts SET state='REVIEW_REQUIRED'," +
    "status_check_attempts=status_check_attempts+1,last_status_checked_at=$2," +
    "last_status_check_result=$3,next_status_check_at=NULL," +
    "last_status_error_code=$4,review_requested_at=$2,updated_at=now() " +
    "WHERE id=$1 AND state IN ('PREPARED','READY','PENDING_VERIFICATION') " +
    "RETURNING id",
    [candidate.id, clock.toISOString(), result, reason],
  );
  if (!changed.rows[0]) {
    await client.query("COMMIT");
    return false;
  }
  await client.query(
    "INSERT INTO audit_events(business_id,branch_id,actor_staff_id," +
    "event_type,entity_type,entity_id,payload,occurred_at) " +
    "VALUES($1,$2,NULL,'HUBTEL_POS_RECONCILIATION_REVIEW_REQUIRED'," +
    "'SALE',$3,$4::jsonb,$5)",
    [
      candidate.business_id,
      candidate.branch_id,
      candidate.sale_id,
      JSON.stringify({ attemptId: candidate.id, reason }),
      clock.toISOString(),
    ],
  );
  await client.query("COMMIT");
  return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Fair, bounded, multi-tenant status reconciliation. No stock is released. */
export async function runHubtelPosReconciliationTick(
  pool: DatabasePool,
  options: HubtelPosReconciliationOptions = {},
): Promise<HubtelPosReconciliationResult> {
  const result: HubtelPosReconciliationResult = {
    enabled: hubtelPosGloballyEnabled(),
    acquired: false, attempted: 0, paid: 0,
    unpaid: 0, failed: 0, reviewRequired: 0,
  };
  if (!result.enabled || process.env.TRADEOS_HUBTEL_POS_RECONCILIATION_ENABLED === "false") {
    return { ...result, enabled: false };
  }
  const clock = options.now?.() ?? new Date();
  if (!Number.isFinite(clock.getTime())) throw new Error("Invalid reconciliation clock");
  const limit = Math.max(1, Math.min(MAX_BATCH_SIZE,
    Math.floor(options.batchSize ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE));
  const verify = options.verify ?? verifySaleHubtelCheckout;

  const client = await pool.connect();
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [HUBTEL_POS_RECONCILIATION_LOCK_KEY],
    );
    if (lock.rows[0]?.acquired !== true) return result;
    result.acquired = true;

    const rows = await client.query<Candidate>(
      "SELECT a.id,a.business_id,a.branch_id,a.sale_id,a.state,a.created_at," +
      "a.status_check_attempts FROM hubtel_sale_checkout_attempts a " +
      "WHERE (a.state IN ('READY','PENDING_VERIFICATION') " +
      "AND a.created_at <= $1::timestamptz - interval '5 minutes' " +
      "AND (a.next_status_check_at IS NULL OR a.next_status_check_at <= $1)) " +
      "OR (a.state='PREPARED' AND " +
      "a.created_at <= $1::timestamptz - interval '15 minutes') " +
      "ORDER BY COALESCE(a.next_status_check_at,a.created_at),a.id LIMIT $2::int",
      [clock.toISOString(), limit],
    );

    for (const candidate of rows.rows) {
      result.attempted += 1;
      const ageMs = clock.getTime() - candidate.created_at.getTime();
      if (candidate.state === "PREPARED") {
        if (await markReview(client, candidate, clock,
          "HUBTEL_POS_PREPARED_UNCERTAIN", "REVIEW_REQUIRED")) {
          result.reviewRequired += 1;
        }
        continue;
      }
      let outcome: "PAID" | "UNPAID" | "REFUND_REVIEW" | "ERROR" = "ERROR";
      let code: string | undefined;
      try {
        const verified = await verify(pool, {
          businessId: candidate.business_id,
          saleId: candidate.sale_id,
        });
        outcome = verified.state;
      } catch (error) {
        code = errorCode(error);
        result.failed += 1;
        // No credentials, customer details or HTTP response bodies in logs.
        console.error("TradeOS merchant Hubtel status check unsuccessful", {
          businessId: candidate.business_id,
          attemptId: candidate.id,
          code,
        });
      }
      const decision = hubtelReconciliationDecision({
        state: candidate.state,
        ageMs,
        attempts: candidate.status_check_attempts + 1,
        outcome,
        errorCode: code,
      });
      if (decision.action === "COMPLETE") {
        result.paid += 1;
        await client.query(
          "UPDATE hubtel_sale_checkout_attempts SET " +
          "status_check_attempts=status_check_attempts+1,last_status_checked_at=$2," +
          "last_status_check_result='PAID',next_status_check_at=NULL," +
          "last_status_error_code=NULL,updated_at=now() " +
          "WHERE id=$1 AND state='RECONCILED'",
          [candidate.id, clock.toISOString()],
        );
      } else if (decision.action === "REVIEW") {
        if (await markReview(client, candidate, clock,
          decision.reason ?? "HUBTEL_POS_RECONCILIATION_REVIEW",
          outcome === "REFUND_REVIEW" ? "REFUNDED" :
            outcome === "ERROR" ? "ERROR" : "REVIEW_REQUIRED")) {
          result.reviewRequired += 1;
        }
      } else {
        if (outcome === "UNPAID") result.unpaid += 1;
        await client.query(
          "UPDATE hubtel_sale_checkout_attempts SET " +
          "status_check_attempts=status_check_attempts+1,last_status_checked_at=$2," +
          "last_status_check_result=$3,next_status_check_at=" +
          "$2::timestamptz + ($4::integer * interval '1 millisecond')," +
          "last_status_error_code=$5,updated_at=now() " +
          "WHERE id=$1 AND state IN ('READY','PENDING_VERIFICATION')",
          [candidate.id, clock.toISOString(),
            outcome === "UNPAID" ? "UNPAID" : "ERROR",
            decision.retryAfterMs, code ?? null],
        );
      }
    }
    return result;
  } finally {
    if (result.acquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)",
          [HUBTEL_POS_RECONCILIATION_LOCK_KEY]);
      } catch (error) {
        console.error("TradeOS merchant Hubtel reconciler could not unlock", error);
      }
    }
    client.release();
  }
}

/** Worker remains off when merchant POS is disabled. No HTTP call at startup. */
export function startHubtelPosReconciliationScheduler(
  pool: DatabasePool,
  options: HubtelPosReconciliationOptions & { intervalMs?: number } = {},
): { stop(): void } {
  if (!hubtelPosGloballyEnabled() ||
      process.env.TRADEOS_HUBTEL_POS_RECONCILIATION_ENABLED === "false") {
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
      await runHubtelPosReconciliationTick(pool, options);
    } catch (error) {
      console.error("TradeOS merchant Hubtel reconciler tick failed", {
        code: errorCode(error),
      });
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
