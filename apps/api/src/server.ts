import { buildApp } from "./app.js";
import { createPool } from "./db.js";
import { startPlatformAutomationScheduler } from "./platform-admin/automation-scheduler.js";
import { startBusinessAttentionScheduler } from "./business-intelligence/attention-scheduler.js";
import { startHubtelPosReconciliationScheduler } from "./commerce/hubtel-pos-reconciliation-scheduler.js";
import { startSupplierDeliveryScheduler } from "./supplier-document-delivery-worker.js";
import { startInternalEventFeedWorker } from "./commerce/internal-event-feed.js";

const pool = createPool();
const app = buildApp(pool);
const automationScheduler = startPlatformAutomationScheduler(pool);
const businessAttentionScheduler = startBusinessAttentionScheduler(pool);
const hubtelPosReconciliationScheduler = startHubtelPosReconciliationScheduler(pool);
const supplierDeliveryScheduler = startSupplierDeliveryScheduler(pool);
const internalEventFeedWorker = startInternalEventFeedWorker(pool);

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  automationScheduler.stop();
  businessAttentionScheduler.stop();
  hubtelPosReconciliationScheduler.stop();
  supplierDeliveryScheduler.stop();
  internalEventFeedWorker.stop();
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port, host });
} catch (error) {
  automationScheduler.stop();
  businessAttentionScheduler.stop();
  hubtelPosReconciliationScheduler.stop();
  supplierDeliveryScheduler.stop();
  internalEventFeedWorker.stop();
  app.log.error(error);
  await pool.end();
  process.exit(1);
}
