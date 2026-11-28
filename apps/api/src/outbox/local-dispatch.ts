import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

/**
 * Transactional local-consumer boundary. A consumer must write its actual
 * durable destination using ONLY the supplied transaction, then verify that
 * destination contains this exact event. External delivery requires a separate
 * leased/idempotent protocol; never use this interface for email, payments or HTTP.
 * No default consumers are installed and this primitive is not auto-started.
 */
export interface LocalOutboxEvent {
  id: string;
  business_id: string;
  branch_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  occurred_at: Date;
}
export interface LocalOutboxConsumer {
  /** One explicit local durable destination for this event type. */
  deliverAndVerify(client: DatabaseClient, event: Readonly<LocalOutboxEvent>): Promise<boolean>;
}
export type LocalDispatchResult = "EMPTY" | "DELIVERED";

/**
 * One claim per transaction; row lock is released on rollback/crash. Only
 * registered event types are eligible. A consumer failure aborts the transaction
 * including its writes and the acknowledgement. A caller must implement bounded
 * scheduling/backoff and poison-event review before wiring this into runtime.
 */
export async function dispatchOneLocalOutboxEvent(
  pool: DatabasePool,
  businessId: string,
  consumers: ReadonlyMap<string, LocalOutboxConsumer>,
): Promise<LocalDispatchResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(businessId)) {
    throw new Error("Valid business scope required");
  }
  const registry = new Map(consumers);
  const eventTypes = [...registry.keys()];
  if (eventTypes.length === 0) return "EMPTY";
  if (eventTypes.length > 100 || eventTypes.some(type => !/^[A-Z][A-Z0-9_]{0,79}$/.test(type))) {
    throw new Error("Invalid local consumer registry");
  }
  return withTransaction(pool, async client => {
    const selected = await client.query<LocalOutboxEvent>(
      `SELECT id,business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at
         FROM outbox_events
        WHERE business_id=$1 AND published_at IS NULL AND event_type=ANY($2::text[])
        ORDER BY occurred_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [businessId,eventTypes],
    );
    const event = selected.rows[0];
    if (!event) return "EMPTY";
    const consumer = registry.get(event.event_type);
    if (!consumer || event.business_id !== businessId) throw new Error("Outbox scope mismatch");
    // No delivery means no publication. Consumer must verify its durable
    // destination, not merely accept an in-memory message or log a record.
    if (await consumer.deliverAndVerify(client, Object.freeze(event)) !== true) {
      throw new Error("Local outbox delivery not verified");
    }
    const acknowledged = await client.query(
      `UPDATE outbox_events SET published_at=now()
        WHERE id=$1 AND business_id=$2 AND published_at IS NULL`,
      [event.id,businessId],
    );
    if (acknowledged.rowCount !== 1) throw new Error("Outbox acknowledgement lost");
    return "DELIVERED";
  });
}
