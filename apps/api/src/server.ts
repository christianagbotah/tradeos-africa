import { buildApp } from "./app.js";
import { createPool } from "./db.js";

const pool = createPool();
const app = buildApp(pool);

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}
