import type {
  TenantBillingEntitlement,
  TenantBillingInvoiceDetail,
  TenantBillingInvoiceStatus,
  TenantBillingInvoiceSummary,
  TenantBillingOverview,
  TenantBillingPaymentStatus,
  TenantBillingPaymentSummary,
  TenantBillingPlan,
  TenantBillingSubscriptionStatus,
} from "@tradeos/contracts";
import type { BusinessRole } from "../auth/authorization.js";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { isCurrentSubscriptionStatus } from "../subscriptions/subscription-lifecycle.js";

const MUTATION_ROLES = new Set<BusinessRole>(["OWNER", "ADMIN"]);

export class TenantBillingError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "TENANT_BILLING_INVALID",
  ) {
    super(message);
    this.name = "TenantBillingError";
  }
}

type PlanRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  currency_code: string;
  amount_minor: string | number;
  billing_interval: "MONTHLY" | "ANNUAL" | "CUSTOM";
  trial_days: number;
};

type SubscriptionRow = {
  id: string;
  business_id: string;
  plan_id: string;
  status: TenantBillingSubscriptionStatus;
  trial_ends_at: Date | null;
  current_period_starts_at: Date | null;
  current_period_ends_at: Date | null;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  currency_code: string;
  subtotal_minor: string | number;
  tax_minor: string | number;
  total_minor: string | number;
  amount_paid_minor: string | number;
  status: TenantBillingInvoiceStatus;
  period_start: Date;
  period_end: Date;
  issued_at: Date | null;
  due_at: Date | null;
  paid_at: Date | null;
  created_at: Date;
};

type PaymentRow = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  currency_code: string;
  amount_minor: string | number;
  provider: string;
  status: TenantBillingPaymentStatus;
  received_at: Date;
  reconciled_at: Date | null;
  created_at: Date;
};

export async function getTenantBillingOverview(
  pool: DatabasePool,
  input: { businessId: string; role: BusinessRole; now?: Date },
): Promise<TenantBillingOverview> {
  await assertActiveBusiness(pool, input.businessId);
  const now = input.now ?? new Date();
  const publicPlanRows = await pool.query<PlanRow>(
    `SELECT id,code,name,description,currency_code,amount_minor,billing_interval,trial_days
     FROM subscription_plans
     WHERE is_public=true AND is_active=true
     ORDER BY amount_minor,code,id`,
  );
  const publicPlanEntitlements = await loadPlanEntitlements(pool, publicPlanRows.rows.map((row) => row.id));
  const publicPlans = publicPlanRows.rows.map((row) => mapPlan(row, publicPlanEntitlements.get(row.id) ?? []));

  const subscriptionResult = await pool.query<SubscriptionRow>(
    `SELECT id,business_id,plan_id,status,trial_ends_at,current_period_starts_at,current_period_ends_at,cancel_at_period_end,canceled_at
     FROM business_subscriptions
     WHERE business_id=$1
     ORDER BY CASE WHEN status IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED') THEN 0 ELSE 1 END,created_at DESC,id DESC
     LIMIT 1`,
    [input.businessId],
  );
  const subscriptionRow = subscriptionResult.rows[0] ?? null;
  if (!subscriptionRow) {
    return { businessId: input.businessId, subscription: null, effectiveEntitlements: [], publicPlans, generatedAt: now.toISOString() };
  }

  const planResult = await pool.query<PlanRow>(
    `SELECT id,code,name,description,currency_code,amount_minor,billing_interval,trial_days
     FROM subscription_plans WHERE id=$1`,
    [subscriptionRow.plan_id],
  );
  const planRow = planResult.rows[0];
  if (!planRow) throw new TenantBillingError("Subscription plan is unavailable.", 500, "TENANT_BILLING_PLAN_UNAVAILABLE");
  const planEntitlements = (await loadPlanEntitlements(pool, [planRow.id])).get(planRow.id) ?? [];
  const effectiveEntitlements = await loadEffectiveEntitlements(pool, input.businessId, planEntitlements, now);
  const plan = mapPlan(planRow, planEntitlements);
  const supportedActions = !MUTATION_ROLES.has(input.role) || !isCurrentSubscriptionStatus(subscriptionRow.status)
    ? []
    : subscriptionRow.cancel_at_period_end ? ["RESUME" as const] : ["CANCEL_AT_PERIOD_END" as const];

  return {
    businessId: input.businessId,
    subscription: {
      id: subscriptionRow.id,
      status: subscriptionRow.status,
      plan,
      trialEndsAt: iso(subscriptionRow.trial_ends_at),
      currentPeriodStartsAt: iso(subscriptionRow.current_period_starts_at),
      currentPeriodEndsAt: iso(subscriptionRow.current_period_ends_at),
      cancelAtPeriodEnd: subscriptionRow.cancel_at_period_end,
      canceledAt: iso(subscriptionRow.canceled_at),
      supportedActions,
    },
    effectiveEntitlements,
    publicPlans,
    generatedAt: now.toISOString(),
  };
}

export async function transitionTenantSubscription(
  pool: DatabasePool,
  actor: { businessId: string; role: BusinessRole; staffId: string | null },
  action: "CANCEL_AT_PERIOD_END" | "RESUME",
): Promise<TenantBillingOverview> {
  if (!MUTATION_ROLES.has(actor.role)) {
    throw new TenantBillingError("Your role cannot change the subscription.", 403, "TENANT_BILLING_ACTION_FORBIDDEN");
  }

  await withTransaction(pool, async (client) => {
    const found = await client.query<SubscriptionRow & { plan_code: string }>(
      `SELECT bs.id,bs.business_id,bs.plan_id,bs.status,bs.trial_ends_at,bs.current_period_starts_at,bs.current_period_ends_at,
              bs.cancel_at_period_end,bs.canceled_at,sp.code AS plan_code
       FROM business_subscriptions bs JOIN subscription_plans sp ON sp.id=bs.plan_id
       WHERE bs.business_id=$1
       ORDER BY CASE WHEN bs.status IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED') THEN 0 ELSE 1 END,bs.created_at DESC,bs.id DESC
       LIMIT 1 FOR UPDATE OF bs`,
      [actor.businessId],
    );
    const current = found.rows[0];
    if (!current) throw new TenantBillingError("Subscription was not found.", 404, "TENANT_BILLING_SUBSCRIPTION_NOT_FOUND");
    if (!isCurrentSubscriptionStatus(current.status)) {
      throw new TenantBillingError("This subscription cannot be changed from its current state.", 409, "TENANT_BILLING_TRANSITION_INVALID");
    }

    const nextCancelAtPeriodEnd = action === "CANCEL_AT_PERIOD_END" ? true : false;
    if (action === "RESUME" && !current.cancel_at_period_end) {
      throw new TenantBillingError("This subscription is not scheduled to cancel.", 409, "TENANT_BILLING_TRANSITION_INVALID");
    }
    if (current.cancel_at_period_end === nextCancelAtPeriodEnd) return;

    await client.query(
      `UPDATE business_subscriptions
       SET cancel_at_period_end=$2,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
       WHERE id=$1`,
      [current.id, nextCancelAtPeriodEnd],
    );
    await client.query(
      `INSERT INTO audit_events(business_id,actor_staff_id,event_type,entity_type,entity_id,payload)
       VALUES($1,$2,$3,'BUSINESS_SUBSCRIPTION',$4,$5::jsonb)`,
      [
        actor.businessId,
        actor.staffId,
        action === "CANCEL_AT_PERIOD_END" ? "SUBSCRIPTION_CANCEL_SCHEDULED" : "SUBSCRIPTION_CANCEL_RESUMED",
        current.id,
        JSON.stringify({
          previous: { status: current.status, cancelAtPeriodEnd: current.cancel_at_period_end, planCode: current.plan_code },
          next: { status: current.status, cancelAtPeriodEnd: nextCancelAtPeriodEnd, planCode: current.plan_code },
          currentPeriodEndsAt: iso(current.current_period_ends_at),
        }),
      ],
    );
  });

  return getTenantBillingOverview(pool, { businessId: actor.businessId, role: actor.role });
}

export async function listTenantBillingInvoices(
  pool: DatabasePool,
  input: { businessId: string; limit?: number },
): Promise<TenantBillingInvoiceSummary[]> {
  const limit = boundedLimit(input.limit);
  const result = await pool.query<InvoiceRow>(
    `${INVOICE_SELECT}
     WHERE business_id=$1
     ORDER BY issued_at DESC,created_at DESC,id DESC
     LIMIT $2`,
    [input.businessId, limit],
  );
  return result.rows.map(mapInvoice);
}

export async function getTenantBillingInvoiceDetail(
  pool: DatabasePool,
  input: { businessId: string; invoiceId: string },
): Promise<TenantBillingInvoiceDetail> {
  const result = await pool.query<InvoiceRow>(`${INVOICE_SELECT} WHERE business_id=$1 AND id=$2`, [input.businessId, input.invoiceId]);
  const row = result.rows[0];
  if (!row) throw new TenantBillingError("Invoice was not found.", 404, "TENANT_BILLING_INVOICE_NOT_FOUND");
  const payments = await listPaymentsForInvoice(pool, input.businessId, input.invoiceId);
  return { ...mapInvoice(row), payments };
}

export async function listTenantBillingPayments(
  pool: DatabasePool,
  input: { businessId: string; limit?: number },
): Promise<TenantBillingPaymentSummary[]> {
  const limit = boundedLimit(input.limit);
  const result = await pool.query<PaymentRow>(
    `${PAYMENT_SELECT}
     WHERE p.business_id=$1
     ORDER BY p.received_at DESC,p.created_at DESC,p.id DESC
     LIMIT $2`,
    [input.businessId, limit],
  );
  return result.rows.map(mapPayment);
}

async function listPaymentsForInvoice(pool: DatabasePool, businessId: string, invoiceId: string): Promise<TenantBillingPaymentSummary[]> {
  const result = await pool.query<PaymentRow>(
    `${PAYMENT_SELECT} WHERE p.business_id=$1 AND p.invoice_id=$2 ORDER BY p.received_at DESC,p.id DESC`,
    [businessId, invoiceId],
  );
  return result.rows.map(mapPayment);
}

async function assertActiveBusiness(pool: DatabasePool, businessId: string): Promise<void> {
  const result = await pool.query<{ id: string }>("SELECT id FROM businesses WHERE id=$1 AND status='ACTIVE'", [businessId]);
  if (!result.rowCount) throw new TenantBillingError("Business is unavailable.", 404, "TENANT_BILLING_BUSINESS_NOT_FOUND");
}

async function loadPlanEntitlements(pool: DatabasePool, planIds: string[]): Promise<Map<string, TenantBillingEntitlement[]>> {
  const map = new Map<string, TenantBillingEntitlement[]>();
  if (!planIds.length) return map;
  const result = await pool.query<{ plan_id: string; entitlement_code: string; entitlement_value: unknown }>(
    `SELECT plan_id,entitlement_code,entitlement_value
     FROM plan_entitlements WHERE plan_id=ANY($1::uuid[]) ORDER BY entitlement_code`,
    [planIds],
  );
  for (const row of result.rows) {
    const items = map.get(row.plan_id) ?? [];
    items.push({ code: row.entitlement_code, value: row.entitlement_value });
    map.set(row.plan_id, items);
  }
  return map;
}

async function loadEffectiveEntitlements(
  pool: DatabasePool,
  businessId: string,
  base: TenantBillingEntitlement[],
  now: Date,
): Promise<TenantBillingEntitlement[]> {
  const merged = new Map(base.map((item) => [item.code, item.value]));
  const overrides = await pool.query<{ entitlement_code: string; entitlement_value: unknown }>(
    `SELECT entitlement_code,entitlement_value
     FROM business_entitlement_overrides
     WHERE business_id=$1 AND (expires_at IS NULL OR expires_at>$2)
     ORDER BY entitlement_code`,
    [businessId, now],
  );
  for (const row of overrides.rows) merged.set(row.entitlement_code, row.entitlement_value);
  return [...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, value]) => ({ code, value }));
}

function mapPlan(row: PlanRow, entitlements: TenantBillingEntitlement[]): TenantBillingPlan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    currencyCode: row.currency_code.trim(),
    amountMinor: safeMinor(row.amount_minor),
    billingInterval: row.billing_interval,
    trialDays: row.trial_days,
    entitlements,
  };
}

function mapInvoice(row: InvoiceRow): TenantBillingInvoiceSummary {
  const totalMinor = safeMinor(row.total_minor);
  const amountPaidMinor = safeMinor(row.amount_paid_minor);
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    currencyCode: row.currency_code.trim(),
    subtotalMinor: safeMinor(row.subtotal_minor),
    taxMinor: safeMinor(row.tax_minor),
    totalMinor,
    amountPaidMinor,
    balanceMinor: Math.max(0, totalMinor - amountPaidMinor),
    status: row.status,
    periodStart: row.period_start.toISOString(),
    periodEnd: row.period_end.toISOString(),
    issuedAt: iso(row.issued_at),
    dueAt: iso(row.due_at),
    paidAt: iso(row.paid_at),
    createdAt: row.created_at.toISOString(),
  };
}

function mapPayment(row: PaymentRow): TenantBillingPaymentSummary {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    currencyCode: row.currency_code.trim(),
    amountMinor: safeMinor(row.amount_minor),
    status: row.status,
    provider: row.provider,
    occurredAt: row.received_at.toISOString(),
    settledAt: iso(row.reconciled_at),
    createdAt: row.created_at.toISOString(),
  };
}

function safeMinor(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TenantBillingError("Billing amount exceeds supported range.", 500, "TENANT_BILLING_AMOUNT_OVERFLOW");
  return parsed;
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new TenantBillingError("limit must be between 1 and 100.", 400, "TENANT_BILLING_LIMIT_INVALID");
  return value;
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

const INVOICE_SELECT = `SELECT id,invoice_number,currency_code,subtotal_minor,tax_minor,total_minor,amount_paid_minor,status,
  period_start,period_end,issued_at,due_at,paid_at,created_at FROM subscription_invoices`;
const PAYMENT_SELECT = `SELECT p.id,p.invoice_id,i.invoice_number,p.currency_code,p.amount_minor,p.provider,p.status,
  p.received_at,p.reconciled_at,p.created_at
  FROM subscription_payments p JOIN subscription_invoices i ON i.id=p.invoice_id AND i.business_id=p.business_id`;
