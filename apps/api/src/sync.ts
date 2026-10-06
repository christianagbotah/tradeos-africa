import type { ClientMutation, MutationResult, SyncPushRequest, SyncResponse } from "@tradeos/contracts";
import type { DatabasePool } from "./db.js";

const MAX_BATCH_SIZE = 100;

export class SyncRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export async function ingestSyncBatch(pool: DatabasePool, request: SyncPushRequest): Promise<SyncResponse> {
  if (!Array.isArray(request.mutations)) {
    throw new SyncRequestError("mutations must be an array");
  }
  if (request.mutations.length > MAX_BATCH_SIZE) {
    throw new SyncRequestError(`A sync batch may contain at most ${MAX_BATCH_SIZE} mutations`, 413);
  }

  const mutationResults: MutationResult[] = [];
  for (const mutation of request.mutations) {
    mutationResults.push(await ingestMutation(pool, mutation));
  }

  return {
    mutationResults,
    events: [],
    ...(request.cursor ? { nextCursor: request.cursor } : {}),
  };
}

async function ingestMutation(pool: DatabasePool, mutation: ClientMutation): Promise<MutationResult> {
  assertMutationShape(mutation);
  const client = await pool.connect();
  const serverReceivedAt = new Date().toISOString();

  try {
    await client.query("BEGIN");

    const inserted = await client.query<{
      status: "RECEIVED" | "APPLIED" | "REJECTED";
      result_payload: unknown | null;
      received_at: Date;
    }>(
      `
        INSERT INTO sync_mutations (
          business_id,
          branch_id,
          client_id,
          client_mutation_id,
          mutation_type,
          request_payload,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'RECEIVED')
        ON CONFLICT (business_id, client_id, client_mutation_id) DO NOTHING
        RETURNING status, result_payload, received_at
      `,
      [
        mutation.businessId,
        mutation.branchId ?? null,
        mutation.clientId,
        mutation.clientMutationId,
        mutation.mutationType,
        JSON.stringify(mutation),
      ],
    );

    if ((inserted.rowCount ?? 0) === 1) {
      await client.query("COMMIT");
      return {
        clientMutationId: mutation.clientMutationId,
        status: "RECEIVED",
        serverReceivedAt,
      };
    }

    const existing = await client.query<{
      status: "RECEIVED" | "APPLIED" | "REJECTED";
      result_payload: unknown | null;
      received_at: Date;
    }>(
      `
        SELECT status, result_payload, received_at
        FROM sync_mutations
        WHERE business_id = $1 AND client_id = $2 AND client_mutation_id = $3
        FOR SHARE
      `,
      [mutation.businessId, mutation.clientId, mutation.clientMutationId],
    );

    const prior = existing.rows[0];
    if (!prior) {
      throw new Error("Idempotent mutation record disappeared during transaction");
    }

    await client.query("COMMIT");
    return {
      clientMutationId: mutation.clientMutationId,
      status: prior.status,
      serverReceivedAt: prior.received_at.toISOString(),
      ...(prior.result_payload !== null ? { result: prior.result_payload } : {}),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    const message = error instanceof Error ? error.message : "Unknown sync ingestion error";
    return {
      clientMutationId: mutation.clientMutationId,
      status: "REJECTED",
      serverReceivedAt,
      errorCode: "SYNC_INGEST_FAILED",
      errorMessage: message,
    };
  } finally {
    client.release();
  }
}

function assertMutationShape(mutation: ClientMutation): void {
  const required: Array<[string, unknown]> = [
    ["businessId", mutation.businessId],
    ["clientId", mutation.clientId],
    ["clientMutationId", mutation.clientMutationId],
    ["mutationType", mutation.mutationType],
    ["occurredAt", mutation.occurredAt],
  ];

  for (const [name, value] of required) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new SyncRequestError(`${name} is required`);
    }
  }

  if (Number.isNaN(Date.parse(mutation.occurredAt))) {
    throw new SyncRequestError("occurredAt must be an ISO date-time string");
  }
}
