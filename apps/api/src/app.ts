import Fastify from "fastify";
import type { SyncPushRequest } from "@tradeos/contracts";
import type { DatabasePool } from "./db.js";
import { ingestSyncBatch, SyncRequestError } from "./sync.js";

export function buildApp(pool: DatabasePool) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => {
    const result = await pool.query<{ now: Date }>("SELECT now() AS now");
    return {
      ok: true,
      service: "tradeos-api",
      databaseTime: result.rows[0]?.now.toISOString() ?? null,
    };
  });

  app.post<{ Body: SyncPushRequest }>("/v1/sync", async (request, reply) => {
    try {
      const response = await ingestSyncBatch(pool, request.body);
      return response;
    } catch (error) {
      if (error instanceof SyncRequestError) {
        return reply.code(error.statusCode).send({
          error: "INVALID_SYNC_REQUEST",
          message: error.message,
        });
      }
      request.log.error(error);
      return reply.code(500).send({
        error: "SYNC_FAILED",
        message: "The sync batch could not be processed.",
      });
    }
  });

  return app;
}
