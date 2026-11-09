import { buildApp } from "./app.js";
import { startTenantAutomationDispatcher } from "./business-intelligence/automation-dispatcher.js";
import { createPool } from "./db.js";
import { startPlatformAutomationScheduler } from "./platform-admin/automation-scheduler.js";
import { startSubscriptionBillingScheduler } from "./platform-admin/subscription-billing-scheduler.js";

const pool = createPool();
const app = buildApp(pool);
const automationScheduler = startPlatformAutomationScheduler(pool);

const subscriptionBillingEnabledValue = (process.env.SUBSCRIPTION_BILLING_SCHEDULER_ENABLED ?? "").trim().toLowerCase();
const subscriptionBillingEnabled = !["false", "0", "off"].includes(subscriptionBillingEnabledValue);
const subscriptionBillingIntervalValue = Number(process.env.SUBSCRIPTION_BILLING_SCHEDULER_INTERVAL_MS);
const subscriptionBillingIntervalMs = Number.isFinite(subscriptionBillingIntervalValue)
  ? Math.max(60_000, Math.floor(subscriptionBillingIntervalValue))
  : undefined;
const subscriptionBillingScheduler = startSubscriptionBillingScheduler(pool, {
  enabled: subscriptionBillingEnabled,
  ...(subscriptionBillingIntervalMs !== undefined ? { intervalMs: subscriptionBillingIntervalMs } : {}),
});

const tenantAutomationEnabledValue = (process.env.TENANT_AUTOMATION_SCHEDULER_ENABLED ?? "").trim().toLowerCase();
const tenantAutomationEnabled = !["false", "0", "off"].includes(tenantAutomationEnabledValue);
const tenantAutomationIntervalValue = Number(process.env.TENANT_AUTOMATION_SCHEDULER_INTERVAL_MS);
const tenantAutomationIntervalMs = Number.isFinite(tenantAutomationIntervalValue)
  ? Math.max(60_000, Math.floor(tenantAutomationIntervalValue))
  : undefined;
const tenantAutomationDispatcher = startTenantAutomationDispatcher(pool, {
  enabled: tenantAutomationEnabled,
  ...(tenantAutomationIntervalMs !== undefined ? { intervalMs: tenantAutomationIntervalMs } : {}),
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await tenantAutomationDispatcher.stop();
  await subscriptionBillingScheduler.stop();
  await automationScheduler.stop();
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port, host });
} catch (error) {
  await tenantAutomationDispatcher.stop();
  await subscriptionBillingScheduler.stop();
  await automationScheduler.stop();
  app.log.error(error);
  await pool.end();
  process.exit(1);
}
