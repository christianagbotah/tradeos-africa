import { randomUUID } from "node:crypto";
import { withTransaction, type DatabaseClient, type DatabasePool } from "../db.js";
import { PlatformAdminError } from "./security.js";

export type SubscriptionPeriodInvoiceInput = {
  businessId: string;
  subscriptionId: string;
  currencyCode: string;
  amountMinor: number;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
  dueDays?: number;
};

export async function issueSubscriptionPeriodInvoice(
  client: DatabaseClient,
  input: SubscriptionPeriodInvoiceInput,
): Promise<{ invoiceId: string; created: boolean }> {
  assertInvoiceInput(input);
  const scope = await client.query<{ business_id: string }>(
    `SELECT business_id FROM business_subscriptions WHERE id=$1`,
    [input.subscriptionId],
  );
  if (scope.rows[0]?.business_id !== input.businessId) {
    throw new PlatformAdminError(
      "Subscription invoice scope does not match the authorized business",
      409,
      "ADMIN_INVOICE_SCOPE_MISMATCH",
    );
  }
  const invoiceId = randomUUID();
  const invoiceNumber = `TOS-${dateStamp(input.now)}-${invoiceId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const dueAt = new Date(input.now.getTime() + (input.dueDays ?? 7) * 86_400_000);

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO subscription_invoices(
       id,business_id,subscription_id,invoice_number,currency_code,subtotal_minor,tax_minor,total_minor,
       amount_paid_minor,status,period_start,period_end,issued_at,due_at,provider,provider_invoice_reference
     ) VALUES($1,$2,$3,$4,$5,$6,0,$6,0,'OPEN',$7,$8,$9,$10,NULL,NULL)
     ON CONFLICT (subscription_id,period_start,period_end) WHERE status <> 'VOID'
     DO NOTHING
     RETURNING id`,
    [
      invoiceId,
      input.businessId,
      input.subscriptionId,
      invoiceNumber,
      input.currencyCode.trim().toUpperCase(),
      input.amountMinor,
      input.periodStart,
      input.periodEnd,
      input.now,
      dueAt,
    ],
  );
  const created = inserted.rows[0]?.id === invoiceId;
  const effectiveId = created
    ? invoiceId
    : await findExistingPeriodInvoice(client, input.subscriptionId, input.periodStart, input.periodEnd);

  if (created) {
    await client.query(
      `INSERT INTO platform_audit_events(
         platform_user_id,business_id,event_type,entity_type,entity_id,reason,payload
       ) VALUES(NULL,$1,'SUBSCRIPTION_INVOICE_ISSUED','SUBSCRIPTION_INVOICE',$2,$3,$4::jsonb)`,
      [
        input.businessId,
        invoiceId,
        "Subscription invoice issued by billing lifecycle",
        JSON.stringify({
          subscriptionId: input.subscriptionId,
          periodStart: input.periodStart.toISOString(),
          periodEnd: input.periodEnd.toISOString(),
          currencyCode: input.currencyCode.trim().toUpperCase(),
          totalMinor: input.amountMinor,
        }),
      ],
    );
  }
  return { invoiceId: effectiveId, created };
}

async function findExistingPeriodInvoice(
  client: DatabaseClient,
  subscriptionId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM subscription_invoices
     WHERE subscription_id=$1 AND period_start=$2 AND period_end=$3 AND status <> 'VOID'
     ORDER BY created_at,id LIMIT 1`,
    [subscriptionId, periodStart, periodEnd],
  );
  const id = existing.rows[0]?.id;
  if (!id) {
    throw new PlatformAdminError(
      "Subscription invoice could not be resolved after a concurrent issuance attempt",
      409,
      "ADMIN_INVOICE_PERIOD_CONFLICT",
    );
  }
  return id;
}

function assertInvoiceInput(input: SubscriptionPeriodInvoiceInput): void {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) {
    throw new PlatformAdminError("Subscription invoice amount is invalid", 400, "ADMIN_INVOICE_AMOUNT_INVALID");
  }
  if (!/^[A-Z]{3}$/.test(input.currencyCode.trim().toUpperCase())) {
    throw new PlatformAdminError("Subscription invoice currency is invalid", 400, "ADMIN_INVOICE_CURRENCY_INVALID");
  }
  if (!Number.isFinite(input.periodStart.getTime()) || !Number.isFinite(input.periodEnd.getTime()) || input.periodEnd <= input.periodStart) {
    throw new PlatformAdminError("Subscription invoice period is invalid", 400, "ADMIN_INVOICE_PERIOD_INVALID");
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw new PlatformAdminError("Subscription invoice issue time is invalid", 400, "ADMIN_INVOICE_TIME_INVALID");
  }
  const dueDays = input.dueDays ?? 7;
  if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365) {
    throw new PlatformAdminError("Subscription invoice due period is invalid", 400, "ADMIN_INVOICE_DUE_INVALID");
  }
}

function dateStamp(value: Date): string {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

export type BillingCycleResult = {
  processed: number;
  invoicesCreated: number;
  renewed: number;
  trialConverted: number;
  canceled: number;
  pastDue: number;
  restored: number;
  errors: number;
  catchUpDeferred: number;
};

type BillingInterval = "MONTHLY" | "ANNUAL";

type BillingSubscriptionRow = {
  id: string;
  business_id: string;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE";
  trial_ends_at: Date | null;
  current_period_starts_at: Date | null;
  current_period_ends_at: Date | null;
  cancel_at_period_end: boolean;
  plan_id: string;
  amount_minor: string | number;
  currency_code: string;
  billing_interval: BillingInterval;
};

type OneCycleResult = Omit<BillingCycleResult, "processed" | "errors">;

const EMPTY_ONE: OneCycleResult = {
  invoicesCreated: 0,
  renewed: 0,
  trialConverted: 0,
  canceled: 0,
  pastDue: 0,
  restored: 0,
  catchUpDeferred: 0,
};

export async function processSubscriptionBillingCycle(
  pool: DatabasePool,
  options: { now?: Date; maxCatchUpPeriods?: number } = {},
): Promise<BillingCycleResult> {
  const now = options.now ?? new Date();
  const maxCatchUpPeriods = options.maxCatchUpPeriods ?? 12;
  if (!Number.isFinite(now.getTime())) {
    throw new PlatformAdminError("Billing cycle time is invalid", 400, "ADMIN_BILLING_CYCLE_TIME_INVALID");
  }
  if (!Number.isInteger(maxCatchUpPeriods) || maxCatchUpPeriods < 1 || maxCatchUpPeriods > 12) {
    throw new PlatformAdminError("Billing catch-up limit is invalid", 400, "ADMIN_BILLING_CATCHUP_INVALID");
  }

  const candidates = await pool.query<{ id: string }>(
    `SELECT bs.id
     FROM business_subscriptions bs
     JOIN subscription_plans sp ON sp.id=bs.plan_id
     JOIN businesses b ON b.id=bs.business_id
     WHERE bs.status IN ('TRIALING','ACTIVE','PAST_DUE')
       AND sp.is_active=true
       AND sp.billing_interval IN ('MONTHLY','ANNUAL')
       AND b.status='ACTIVE'
     ORDER BY bs.id`,
  );
  const result: BillingCycleResult = {
    processed: 0,
    invoicesCreated: 0,
    renewed: 0,
    trialConverted: 0,
    canceled: 0,
    pastDue: 0,
    restored: 0,
    errors: 0,
    catchUpDeferred: 0,
  };

  for (const candidate of candidates.rows) {
    result.processed += 1;
    try {
      const one = await withTransaction(pool, (client) =>
        processOneSubscription(client, candidate.id, now, maxCatchUpPeriods),
      );
      addCycleResult(result, one);
    } catch {
      result.errors += 1;
    }
  }
  return result;
}

export async function refreshSubscriptionStanding(
  client: DatabaseClient,
  subscriptionId: string,
  now: Date,
): Promise<"ACTIVE" | "PAST_DUE" | null> {
  const result = await refreshSubscriptionStandingDetailed(client, subscriptionId, now);
  return result.status;
}

async function processOneSubscription(
  client: DatabaseClient,
  subscriptionId: string,
  now: Date,
  maxCatchUpPeriods: number,
): Promise<OneCycleResult> {
  const result = { ...EMPTY_ONE };
  const found = await client.query<BillingSubscriptionRow>(
    `SELECT bs.id,bs.business_id,bs.status,bs.trial_ends_at,bs.current_period_starts_at,bs.current_period_ends_at,
            bs.cancel_at_period_end,bs.plan_id,sp.amount_minor,sp.currency_code::text AS currency_code,
            sp.billing_interval
     FROM business_subscriptions bs
     JOIN subscription_plans sp ON sp.id=bs.plan_id AND sp.is_active=true
     WHERE bs.id=$1 AND bs.status IN ('TRIALING','ACTIVE','PAST_DUE')
       AND sp.billing_interval IN ('MONTHLY','ANNUAL')
     FOR UPDATE OF bs`,
    [subscriptionId],
  );
  const row = found.rows[0];
  if (!row) return result;
  const amountMinor = safeMinor(row.amount_minor);
  const currencyCode = row.currency_code.trim().toUpperCase();

  if (row.status === "TRIALING") {
    if (!row.trial_ends_at) {
      throw new PlatformAdminError("Trial subscription has no trial end", 409, "ADMIN_BILLING_TRIAL_PERIOD_INVALID");
    }
    if (row.trial_ends_at > now) return result;
    const periodStart = row.trial_ends_at;
    const periodEnd = await advancePeriodEnd(client, periodStart, row.billing_interval);
    await client.query(
      `UPDATE business_subscriptions
       SET status='ACTIVE',current_period_starts_at=$2,current_period_ends_at=$3,
           updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
       WHERE id=$1`,
      [row.id, periodStart, periodEnd],
    );
    await writeSystemAudit(client, row.business_id, "SUBSCRIPTION_TRIAL_CONVERTED", row.id,
      "Trial converted to its first paid billing period", {
        periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), planId: row.plan_id,
      });
    const issued = await issueSubscriptionPeriodInvoice(client, {
      businessId: row.business_id, subscriptionId: row.id, currencyCode, amountMinor,
      periodStart, periodEnd, now,
    });
    result.invoicesCreated += issued.created ? 1 : 0;
    result.trialConverted += 1;
    return result;
  }

  if (!row.current_period_starts_at || !row.current_period_ends_at || row.current_period_ends_at <= row.current_period_starts_at) {
    throw new PlatformAdminError("Subscription billing period is invalid", 409, "ADMIN_BILLING_PERIOD_INVALID");
  }

  let periodStart = row.current_period_starts_at;
  let periodEnd = row.current_period_ends_at;
  const currentInvoice = await issueSubscriptionPeriodInvoice(client, {
    businessId: row.business_id, subscriptionId: row.id, currencyCode, amountMinor,
    periodStart, periodEnd, now,
  });
  result.invoicesCreated += currentInvoice.created ? 1 : 0;

  if (periodEnd <= now && row.cancel_at_period_end) {
    await client.query(
      `UPDATE business_subscriptions
       SET status='CANCELED',cancel_at_period_end=false,canceled_at=$2,
           updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
       WHERE id=$1`,
      [row.id, now],
    );
    await writeSystemAudit(client, row.business_id, "SUBSCRIPTION_CANCELED_AT_PERIOD_END", row.id,
      "Subscription canceled at the configured period end", { periodEnd: periodEnd.toISOString() });
    result.canceled += 1;
    return result;
  }

  let renewals = 0;
  while (periodEnd <= now && renewals < maxCatchUpPeriods) {
    const nextStart = periodEnd;
    const nextEnd = await advancePeriodEnd(client, nextStart, row.billing_interval);
    await client.query(
      `UPDATE business_subscriptions
       SET current_period_starts_at=$2,current_period_ends_at=$3,
           updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
       WHERE id=$1`,
      [row.id, nextStart, nextEnd],
    );
    await writeSystemAudit(client, row.business_id, "SUBSCRIPTION_RENEWED", row.id,
      "Subscription advanced to the next billing period", {
        previousPeriodEnd: periodEnd.toISOString(), periodStart: nextStart.toISOString(), periodEnd: nextEnd.toISOString(),
      });
    const issued = await issueSubscriptionPeriodInvoice(client, {
      businessId: row.business_id, subscriptionId: row.id, currencyCode, amountMinor,
      periodStart: nextStart, periodEnd: nextEnd, now,
    });
    result.invoicesCreated += issued.created ? 1 : 0;
    result.renewed += 1;
    renewals += 1;
    periodStart = nextStart;
    periodEnd = nextEnd;
  }
  if (periodEnd <= now) result.catchUpDeferred += 1;

  const standing = await refreshSubscriptionStandingDetailed(client, row.id, now);
  if (standing.changed && standing.status === "PAST_DUE") result.pastDue += 1;
  if (standing.changed && standing.status === "ACTIVE") result.restored += 1;
  return result;
}

async function refreshSubscriptionStandingDetailed(
  client: DatabaseClient,
  subscriptionId: string,
  now: Date,
): Promise<{ status: "ACTIVE" | "PAST_DUE" | null; changed: boolean }> {
  const subscription = await client.query<{ status: string; business_id: string }>(
    `SELECT status,business_id FROM business_subscriptions WHERE id=$1`,
    [subscriptionId],
  );
  const row = subscription.rows[0];
  if (!row || (row.status !== "ACTIVE" && row.status !== "PAST_DUE")) return { status: null, changed: false };

  const overdue = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM subscription_invoices
       WHERE subscription_id=$1
         AND status IN ('OPEN','PARTIALLY_PAID')
         AND total_minor > amount_paid_minor
         AND due_at < $2
     ) AS exists`,
    [subscriptionId, now],
  );
  const next: "ACTIVE" | "PAST_DUE" = overdue.rows[0]?.exists ? "PAST_DUE" : "ACTIVE";
  if (next === row.status) return { status: next, changed: false };
  await client.query(
    `UPDATE business_subscriptions
     SET status=$2,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
     WHERE id=$1`,
    [subscriptionId, next],
  );
  await writeSystemAudit(
    client,
    row.business_id,
    next === "PAST_DUE" ? "SUBSCRIPTION_MARKED_PAST_DUE" : "SUBSCRIPTION_RESTORED_ACTIVE",
    subscriptionId,
    next === "PAST_DUE" ? "Subscription has an overdue unpaid invoice" : "Subscription no longer has an overdue unpaid invoice",
    { previousStatus: row.status, nextStatus: next, evaluatedAt: now.toISOString() },
  );
  return { status: next, changed: true };
}

async function advancePeriodEnd(client: DatabaseClient, start: Date, interval: BillingInterval): Promise<Date> {
  const result = await client.query<{ end_at: Date }>(
    `SELECT CASE $2::text
              WHEN 'MONTHLY' THEN (($1::timestamptz AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'
              WHEN 'ANNUAL' THEN (($1::timestamptz AT TIME ZONE 'UTC') + interval '1 year') AT TIME ZONE 'UTC'
            END AS end_at`,
    [start, interval],
  );
  const end = result.rows[0]?.end_at;
  if (!end || !Number.isFinite(end.getTime()) || end <= start) {
    throw new PlatformAdminError("Subscription billing interval is invalid", 409, "ADMIN_BILLING_INTERVAL_INVALID");
  }
  return end;
}

async function writeSystemAudit(
  client: DatabaseClient,
  businessId: string,
  eventType: string,
  entityId: string,
  reason: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO platform_audit_events(platform_user_id,business_id,event_type,entity_type,entity_id,reason,payload)
     VALUES(NULL,$1,$2,'BUSINESS_SUBSCRIPTION',$3,$4,$5::jsonb)`,
    [businessId, eventType, entityId, reason, JSON.stringify(payload)],
  );
}

function addCycleResult(target: BillingCycleResult, source: OneCycleResult): void {
  target.invoicesCreated += source.invoicesCreated;
  target.renewed += source.renewed;
  target.trialConverted += source.trialConverted;
  target.canceled += source.canceled;
  target.pastDue += source.pastDue;
  target.restored += source.restored;
  target.catchUpDeferred += source.catchUpDeferred;
}

function safeMinor(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PlatformAdminError("Stored subscription amount is invalid", 409, "ADMIN_BILLING_AMOUNT_INVALID");
  }
  return parsed;
}
