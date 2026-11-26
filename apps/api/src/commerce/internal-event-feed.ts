import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

const MAX_BATCH = 25;
const DEFAULT_INTERVAL_MS = 30_000;

export interface FeedDeliveryResult {
  selected: number;
  acknowledged: number;
  destination: "INTERNAL_BUSINESS_EVENT_FEED";
}
interface EventIdentity {
  id: string;
  business_id: string;
  branch_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  occurred_at: Date;
}

/**
 * Real, durable, branch-scoped internal consumer. Each batch has one DB
 * transaction: lock unpublished source rows, insert immutable feed records,
 * verify that each source is present with identical identity/scope, and only
 * THEN acknowledge by published_at. Failed insert or mismatch rolls back ALL.
 *
 * SKIP LOCKED allows multiple API replicas without duplicate acknowledgement.
 * No network or provider side effects; no external-delivery claims.
 */
export async function deliverInternalEventFeedBatch(
  pool: DatabasePool,
  requestedBatchSize = MAX_BATCH,
): Promise<FeedDeliveryResult> {
  if (!Number.isSafeInteger(requestedBatchSize) ||
      requestedBatchSize < 1 || requestedBatchSize > MAX_BATCH) {
    throw new Error("Invalid internal outbox batch size");
  }
  return withTransaction(pool, async (tx) => {
    const selected = await tx.query<EventIdentity>(
      "SELECT id,business_id,branch_id,aggregate_type,aggregate_id,event_type,occurred_at " +
      "FROM outbox_events WHERE published_at IS NULL " +
      "ORDER BY occurred_at,id FOR UPDATE SKIP LOCKED LIMIT $1",
      [requestedBatchSize],
    );
    if (!selected.rows.length) return {
      selected: 0, acknowledged: 0,
      destination: "INTERNAL_BUSINESS_EVENT_FEED" as const,
    };
    const ids = selected.rows.map((row) => row.id);
    await tx.query(
      "INSERT INTO business_event_feed(outbox_event_id,business_id,branch_id," +
      "aggregate_type,aggregate_id,event_type,occurred_at) " +
      "SELECT id,business_id,branch_id,aggregate_type,aggregate_id,event_type,occurred_at " +
      "FROM outbox_events WHERE id=ANY($1::uuid[]) " +
      "ON CONFLICT (outbox_event_id) DO NOTHING",
      [ids],
    );
    // This join verifies source/destination identity and tenant/branch scope.
    // A conflicting receipt with mismatched details can never be acknowledged.
    const acknowledged = await tx.query<{ id: string }>(
      "UPDATE outbox_events o SET published_at=now() " +
      "WHERE o.id=ANY($1::uuid[]) AND o.published_at IS NULL " +
      "AND EXISTS (SELECT 1 FROM business_event_feed f WHERE " +
      "f.outbox_event_id=o.id AND f.business_id=o.business_id " +
      "AND f.branch_id IS NOT DISTINCT FROM o.branch_id " +
      "AND f.aggregate_type=o.aggregate_type AND f.aggregate_id=o.aggregate_id " +
      "AND f.event_type=o.event_type AND f.occurred_at=o.occurred_at) " +
      "RETURNING o.id",
      [ids],
    );
    if (acknowledged.rows.length !== selected.rows.length) {
      throw new Error("Internal event feed acknowledgement mismatch");
    }
    return {
      selected: selected.rows.length,
      acknowledged: acknowledged.rows.length,
      destination: "INTERNAL_BUSINESS_EVENT_FEED" as const,
    };
  });
}

/** Default OFF. Explicit enable only after migration, reviewer sign-off and
 * production operational safeguards. Deployment alone never drains backlog. */
export function startInternalEventFeedWorker(
  pool: DatabasePool,
  options: { enabled?: boolean; intervalMs?: number } = {},
): { stop(): void } {
  const enabled = options.enabled ??
    process.env.TRADEOS_OUTBOX_INTERNAL_FEED_ENABLED === "true";
  if (!enabled) return { stop() {} };
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1000) {
    throw new Error("Invalid internal event feed interval");
  }
  let stopped = false;
  let running = false;
  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      // Bounded to 25 rows per tick; never spin through historic data.
      await deliverInternalEventFeedBatch(pool);
    } catch (error) {
      console.error("TradeOS internal event delivery failed", {
        type: error instanceof Error ? error.name : "UNKNOWN",
      });
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();
  void tick();
  return {
    stop() { stopped = true; clearInterval(timer); },
  };
}

export interface BusinessFeedItem {
  id: string; eventType: string; aggregateType: string;
  aggregateId: string; occurredAt: string; deliveredAt: string;
}

/** Scoped, read-only subscriber endpoint. No raw event payloads. */
export async function listBusinessEventFeed(
  pool: DatabasePool, businessId: string, branchId: string, limit = 50,
): Promise<{ items: BusinessFeedItem[]; businessId: string; branchId: string }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid event feed limit");
  }
  const result = await pool.query<{
    outbox_event_id: string; event_type: string; aggregate_type: string;
    aggregate_id: string; occurred_at: Date; delivered_at: Date;
  }>(
    "SELECT outbox_event_id,event_type,aggregate_type,aggregate_id,occurred_at,delivered_at " +
    "FROM business_event_feed WHERE business_id=$1 AND (branch_id=$2 OR branch_id IS NULL) " +
    "ORDER BY occurred_at DESC,outbox_event_id DESC LIMIT $3",
    [businessId, branchId, limit],
  );
  return {
    businessId, branchId,
    items: result.rows.map((r) => ({
      id:r.outbox_event_id,eventType:r.event_type,aggregateType:r.aggregate_type,
      aggregateId:r.aggregate_id,occurredAt:r.occurred_at.toISOString(),
      deliveredAt:r.delivered_at.toISOString(),
    })),
  };
}
