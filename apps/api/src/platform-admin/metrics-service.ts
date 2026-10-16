import type { AdminCurrencyAmount, AdminPlatformMetrics, AdminRecurringRevenue } from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import type { PlatformAdminContext } from "./security.js";

interface CountRow {
  total: string;
  active: string;
  suspended: string;
  closed: string;
}

interface SubscriptionCountRow {
  trialing: string;
  active: string;
  past_due: string;
  paused: string;
  canceled: string;
  expired: string;
}

interface RevenueRow {
  currency_code: string;
  mrr_minor: string;
  arr_minor: string;
}

interface InvoiceRow {
  currency_code: string;
  open_count: string;
  overdue_count: string;
  open_balance_minor: string;
  overdue_balance_minor: string;
}

interface CollectionRow {
  currency_code: string;
  succeeded_count: string;
  failed_count: string;
  succeeded_minor: string;
  failed_minor: string;
}

interface DeviceRow {
  total: string;
  online: string;
  stale: string;
  unknown: string;
  sync_risk_tenant_count: string;
}

interface ReleaseRow {
  draft: string;
  rollout: string;
  active: string;
  withdrawn: string;
}

export async function getPlatformMetrics(pool: DatabasePool, actor: PlatformAdminContext): Promise<AdminPlatformMetrics> {
  // Authentication is performed before this service is called. Keeping actor in
  // the signature makes that security boundary explicit for all control-plane reads.
  void actor;

  const [tenantResult, subscriptionResult, revenueResult, invoiceResult, collectionResult, deviceResult, releaseResult] = await Promise.all([
    pool.query<CountRow>(
      `SELECT
         count(*)::text AS total,
         count(*) FILTER (WHERE status='ACTIVE')::text AS active,
         count(*) FILTER (WHERE status='SUSPENDED')::text AS suspended,
         count(*) FILTER (WHERE status='CLOSED')::text AS closed
       FROM businesses`,
    ),
    pool.query<SubscriptionCountRow>(
      `WITH current_subscriptions AS (
         SELECT DISTINCT ON (business_id) business_id,status
         FROM business_subscriptions
         ORDER BY business_id,created_at DESC,id DESC
       )
       SELECT
         count(*) FILTER (WHERE status='TRIALING')::text AS trialing,
         count(*) FILTER (WHERE status='ACTIVE')::text AS active,
         count(*) FILTER (WHERE status='PAST_DUE')::text AS past_due,
         count(*) FILTER (WHERE status='PAUSED')::text AS paused,
         count(*) FILTER (WHERE status='CANCELED')::text AS canceled,
         count(*) FILTER (WHERE status='EXPIRED')::text AS expired
       FROM current_subscriptions`,
    ),
    pool.query<RevenueRow>(
      `WITH current_subscriptions AS (
         SELECT DISTINCT ON (business_id) business_id,plan_id,status
         FROM business_subscriptions
         ORDER BY business_id,created_at DESC,id DESC
       )
       SELECT
         sp.currency_code,
         sum(CASE
           WHEN sp.billing_interval='MONTHLY' THEN sp.amount_minor
           WHEN sp.billing_interval='ANNUAL' THEN sp.amount_minor / 12
           ELSE 0
         END)::text AS mrr_minor,
         sum(CASE
           WHEN sp.billing_interval='MONTHLY' THEN sp.amount_minor * 12
           WHEN sp.billing_interval='ANNUAL' THEN sp.amount_minor
           ELSE 0
         END)::text AS arr_minor
       FROM current_subscriptions bs
       JOIN subscription_plans sp ON sp.id=bs.plan_id
       WHERE bs.status='ACTIVE'
         AND sp.billing_interval IN ('MONTHLY','ANNUAL')
       GROUP BY sp.currency_code
       ORDER BY sp.currency_code`,
    ),
    pool.query<InvoiceRow>(
      `SELECT
         currency_code,
         count(*)::text AS open_count,
         count(*) FILTER (WHERE due_at < now())::text AS overdue_count,
         coalesce(sum(greatest(total_minor-amount_paid_minor,0)),0)::text AS open_balance_minor,
         coalesce(sum(greatest(total_minor-amount_paid_minor,0)) FILTER (WHERE due_at < now()),0)::text AS overdue_balance_minor
       FROM subscription_invoices
       WHERE status IN ('OPEN','PARTIALLY_PAID')
       GROUP BY currency_code
       ORDER BY currency_code`,
    ),
    pool.query<CollectionRow>(
      `SELECT
         currency_code,
         count(*) FILTER (WHERE status='SUCCEEDED')::text AS succeeded_count,
         count(*) FILTER (WHERE status='FAILED')::text AS failed_count,
         coalesce(sum(amount_minor) FILTER (WHERE status='SUCCEEDED'),0)::text AS succeeded_minor,
         coalesce(sum(amount_minor) FILTER (WHERE status='FAILED'),0)::text AS failed_minor
       FROM subscription_payments
       WHERE status IN ('SUCCEEDED','FAILED')
       GROUP BY currency_code
       ORDER BY currency_code`,
    ),
    pool.query<DeviceRow>(
      `SELECT
         count(*)::text AS total,
         count(*) FILTER (WHERE last_seen_at >= now()-interval '15 minutes')::text AS online,
         count(*) FILTER (WHERE last_seen_at < now()-interval '15 minutes')::text AS stale,
         count(*) FILTER (WHERE last_seen_at IS NULL)::text AS unknown,
         count(DISTINCT business_id) FILTER (
           WHERE last_seen_at IS NULL OR last_seen_at < now()-interval '15 minutes'
         )::text AS sync_risk_tenant_count
       FROM registered_devices
       WHERE status='ACTIVE'`,
    ),
    pool.query<ReleaseRow>(
      `SELECT
         count(*) FILTER (WHERE status='DRAFT')::text AS draft,
         count(*) FILTER (WHERE status='ROLLOUT')::text AS rollout,
         count(*) FILTER (WHERE status='ACTIVE')::text AS active,
         count(*) FILTER (WHERE status='WITHDRAWN')::text AS withdrawn
       FROM client_releases`,
    ),
  ]);

  const tenants = tenantResult.rows[0] ?? { total: "0", active: "0", suspended: "0", closed: "0" };
  const subscriptions = subscriptionResult.rows[0] ?? {
    trialing: "0", active: "0", past_due: "0", paused: "0", canceled: "0", expired: "0",
  };
  const devices = deviceResult.rows[0] ?? { total: "0", online: "0", stale: "0", unknown: "0", sync_risk_tenant_count: "0" };
  const releases = releaseResult.rows[0] ?? { draft: "0", rollout: "0", active: "0", withdrawn: "0" };

  return {
    generatedAt: new Date().toISOString(),
    tenants: {
      total: count(tenants.total),
      active: count(tenants.active),
      suspended: count(tenants.suspended),
      closed: count(tenants.closed),
    },
    subscriptions: {
      trialing: count(subscriptions.trialing),
      active: count(subscriptions.active),
      pastDue: count(subscriptions.past_due),
      paused: count(subscriptions.paused),
      canceled: count(subscriptions.canceled),
      expired: count(subscriptions.expired),
    },
    recurringRevenue: revenueResult.rows.map<AdminRecurringRevenue>((row) => ({
      currencyCode: row.currency_code,
      mrrMinor: money(row.mrr_minor),
      arrMinor: money(row.arr_minor),
    })),
    invoices: {
      openCount: invoiceResult.rows.reduce((sum, row) => sum + count(row.open_count), 0),
      overdueCount: invoiceResult.rows.reduce((sum, row) => sum + count(row.overdue_count), 0),
      openBalanceByCurrency: currencyAmounts(invoiceResult.rows, "open_balance_minor"),
      overdueBalanceByCurrency: currencyAmounts(invoiceResult.rows, "overdue_balance_minor"),
    },
    collections: {
      succeededCount: collectionResult.rows.reduce((sum, row) => sum + count(row.succeeded_count), 0),
      failedCount: collectionResult.rows.reduce((sum, row) => sum + count(row.failed_count), 0),
      succeededByCurrency: currencyAmounts(collectionResult.rows, "succeeded_minor"),
      failedByCurrency: currencyAmounts(collectionResult.rows, "failed_minor").filter((item) => item.amountMinor > 0),
    },
    devices: {
      total: count(devices.total),
      online: count(devices.online),
      stale: count(devices.stale),
      unknown: count(devices.unknown),
      syncRiskTenantCount: count(devices.sync_risk_tenant_count),
    },
    releases: {
      draft: count(releases.draft),
      rollout: count(releases.rollout),
      active: count(releases.active),
      withdrawn: count(releases.withdrawn),
    },
  };
}

function currencyAmounts<T extends { currency_code: string }>(rows: T[], field: keyof T): AdminCurrencyAmount[] {
  return rows.map((row) => ({
    currencyCode: row.currency_code,
    amountMinor: money(String(row[field] ?? "0")),
  }));
}

function count(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

function money(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed)) throw new Error("Platform metric exceeds JavaScript safe integer range");
  return parsed;
}
