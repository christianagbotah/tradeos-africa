import type {
  AdminBillingInterval,
  AdminBusinessSubscription,
  AdminPlanEntitlement,
  AdminSubscriptionPlan,
  AdminSubscriptionStatus,
} from "@tradeos/contracts";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { PlatformAdminError, type PlatformAdminContext } from "./security.js";
import { isCurrentSubscriptionStatus } from "../subscriptions/subscription-lifecycle.js";

const WRITE_ROLES = new Set(["SUPER_ADMIN", "PLATFORM_ADMIN", "BILLING"]);
const INTERVALS = new Set<AdminBillingInterval>(["MONTHLY", "ANNUAL", "CUSTOM"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Queryable = Pick<DatabasePool, "query"> | Pick<DatabaseClient, "query">;
type PlanRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  currency_code: string;
  amount_minor: string | number;
  billing_interval: AdminBillingInterval;
  trial_days: number;
  is_public: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};
type SubscriptionRow = {
  id: string;
  business_id: string;
  business_name: string;
  plan_id: string;
  plan_code: string;
  plan_name: string;
  status: AdminSubscriptionStatus;
  provider: string | null;
  provider_customer_reference: string | null;
  provider_subscription_reference: string | null;
  trial_ends_at: Date | null;
  current_period_starts_at: Date | null;
  current_period_ends_at: Date | null;
  cancel_at_period_end: boolean;
  canceled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  billing_interval: AdminBillingInterval;
};

type AssignSubscriptionInput = {
  action: "ASSIGN";
  businessId: string;
  planId?: unknown;
  mode?: unknown;
  reason?: unknown;
};
type ExistingTransitionInput = {
  action?: unknown;
  subscriptionId: string;
  planId?: unknown;
  reason?: unknown;
  expectedUpdatedAt?: unknown;
};
export type TransitionSubscriptionInput = AssignSubscriptionInput | ExistingTransitionInput;

export async function listPlans(pool: DatabasePool): Promise<AdminSubscriptionPlan[]> {
  const rows = await pool.query<PlanRow>(
    `SELECT id,code,name,description,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active,created_at,updated_at
     FROM subscription_plans ORDER BY is_active DESC,is_public DESC,amount_minor,code`,
  );
  const entitlements = await loadEntitlements(pool, rows.rows.map((row) => row.id));
  return rows.rows.map((row) => mapPlan(row, entitlements.get(row.id) ?? []));
}

export async function createPlan(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  input: Record<string, unknown>,
): Promise<AdminSubscriptionPlan> {
  requireWriteRole(actor);
  const reason = parseReason(input.reason);
  const next = parsePlanInput(input, null);
  try {
    const id = await withTransaction(pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO subscription_plans(code,name,description,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [next.code,next.name,next.description,next.currencyCode,next.amountMinor,next.billingInterval,next.trialDays,next.public,next.active],
      );
      const planId = inserted.rows[0]!.id;
      await writeAudit(client, actor.id, null, "PLAN_CREATED", "SUBSCRIPTION_PLAN", planId, reason, { next });
      return planId;
    });
    return getPlan(pool, id);
  } catch (error) {
    if (isUniqueViolation(error)) throw new PlatformAdminError("Plan code already exists", 409, "ADMIN_PLAN_CODE_CONFLICT");
    throw error;
  }
}

export async function updatePlan(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  planId: string,
  input: Record<string, unknown>,
): Promise<AdminSubscriptionPlan> {
  requireWriteRole(actor);
  requireUuid(planId, "ADMIN_PLAN_NOT_FOUND", "Plan was not found");
  const reason = parseReason(input.reason);
  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt, "ADMIN_PLAN_VERSION_REQUIRED", "ADMIN_PLAN_VERSION_INVALID");
  try {
    await withTransaction(pool, async (client) => {
      const found = await client.query<PlanRow>(
        `SELECT id,code,name,description,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active,created_at,updated_at
         FROM subscription_plans WHERE id=$1 FOR UPDATE`, [planId],
      );
      const current = found.rows[0];
      if (!current) throw new PlatformAdminError("Plan was not found", 404, "ADMIN_PLAN_NOT_FOUND");
      assertFresh(current.updated_at, expectedUpdatedAt, "ADMIN_PLAN_STALE");
      const previous = mapPlan(current, []);
      const next = parsePlanInput(input, previous);
      await client.query(
        `UPDATE subscription_plans
         SET code=$2,name=$3,description=$4,currency_code=$5,amount_minor=$6,billing_interval=$7,trial_days=$8,
             is_public=$9,is_active=$10,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
         WHERE id=$1`,
        [planId,next.code,next.name,next.description,next.currencyCode,next.amountMinor,next.billingInterval,next.trialDays,next.public,next.active],
      );
      await writeAudit(client, actor.id, null, "PLAN_UPDATED", "SUBSCRIPTION_PLAN", planId, reason, {
        previous: planAuditSnapshot(previous), next: planAuditSnapshot(next),
      });
    });
    return getPlan(pool, planId);
  } catch (error) {
    if (isUniqueViolation(error)) throw new PlatformAdminError("Plan code already exists", 409, "ADMIN_PLAN_CODE_CONFLICT");
    throw error;
  }
}

export async function setPlanEntitlements(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  planId: string,
  input: { entitlements?: unknown; reason?: unknown; expectedUpdatedAt?: unknown },
): Promise<AdminSubscriptionPlan> {
  requireWriteRole(actor);
  requireUuid(planId, "ADMIN_PLAN_NOT_FOUND", "Plan was not found");
  const reason = parseReason(input.reason);
  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt, "ADMIN_PLAN_VERSION_REQUIRED", "ADMIN_PLAN_VERSION_INVALID");
  const entitlements = parseEntitlements(input.entitlements);
  await withTransaction(pool, async (client) => {
    const found = await client.query<{ updated_at: Date }>("SELECT updated_at FROM subscription_plans WHERE id=$1 FOR UPDATE", [planId]);
    const current = found.rows[0];
    if (!current) throw new PlatformAdminError("Plan was not found", 404, "ADMIN_PLAN_NOT_FOUND");
    assertFresh(current.updated_at, expectedUpdatedAt, "ADMIN_PLAN_STALE");
    const previousMap = await loadEntitlements(client, [planId]);
    const previous = previousMap.get(planId) ?? [];
    await client.query("DELETE FROM plan_entitlements WHERE plan_id=$1", [planId]);
    for (const entitlement of entitlements) {
      await client.query(
        `INSERT INTO plan_entitlements(plan_id,entitlement_code,entitlement_value) VALUES($1,$2,$3::jsonb)`,
        [planId, entitlement.code, JSON.stringify(entitlement.value)],
      );
    }
    await client.query(
      `UPDATE subscription_plans SET updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$1`,
      [planId],
    );
    await writeAudit(client, actor.id, null, "PLAN_ENTITLEMENTS_UPDATED", "SUBSCRIPTION_PLAN", planId, reason, { previous, next: entitlements });
  });
  return getPlan(pool, planId);
}

export async function listSubscriptions(pool: DatabasePool): Promise<AdminBusinessSubscription[]> {
  const result = await pool.query<SubscriptionRow>(subscriptionSelect("ORDER BY bs.created_at DESC,bs.id DESC"));
  return result.rows.map(mapSubscription);
}

export async function transitionSubscription(
  pool: DatabasePool,
  actor: PlatformAdminContext,
  input: TransitionSubscriptionInput,
): Promise<AdminBusinessSubscription> {
  requireWriteRole(actor);
  if ("businessId" in input) return assignSubscription(pool, actor, input);
  const subscriptionId = requireUuid(input.subscriptionId, "ADMIN_SUBSCRIPTION_NOT_FOUND", "Subscription was not found");
  const action = parseTransitionAction(input.action);
  const reason = parseReason(input.reason);
  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt, "ADMIN_SUBSCRIPTION_VERSION_REQUIRED", "ADMIN_SUBSCRIPTION_VERSION_INVALID");

  await withTransaction(pool, async (client) => {
    const found = await client.query<SubscriptionRow>(subscriptionSelect("WHERE bs.id=$1 FOR UPDATE OF bs"), [subscriptionId]);
    const current = found.rows[0];
    if (!current) throw new PlatformAdminError("Subscription was not found", 404, "ADMIN_SUBSCRIPTION_NOT_FOUND");
    assertFresh(current.updated_at, expectedUpdatedAt, "ADMIN_SUBSCRIPTION_STALE");
    const before = mapSubscription(current);
    const next = {
      status: current.status,
      planId: current.plan_id,
      cancelAtPeriodEnd: current.cancel_at_period_end,
      canceledAt: current.canceled_at,
      trialEndsAt: current.trial_ends_at,
      currentPeriodStartsAt: current.current_period_starts_at,
      currentPeriodEndsAt: current.current_period_ends_at,
    };

    if (action === "ACTIVATE") {
      if (current.status !== "TRIALING") invalidTransition(current.status, action);
      const period = await periodForPlan(client, current.plan_id);
      next.status = "ACTIVE";
      next.currentPeriodStartsAt = period.start;
      next.currentPeriodEndsAt = period.end;
      next.cancelAtPeriodEnd = false;
    } else if (action === "CHANGE_PLAN") {
      if (!isCurrentSubscriptionStatus(current.status)) invalidTransition(current.status, action);
      const planId = requireUuid(input.planId, "ADMIN_PLAN_NOT_FOUND", "Plan was not found");
      await requireActivePlan(client, planId);
      next.planId = planId;
    } else if (action === "PAUSE") {
      if (current.status !== "ACTIVE" && current.status !== "PAST_DUE") invalidTransition(current.status, action);
      next.status = "PAUSED";
    } else if (action === "REACTIVATE") {
      if (current.status !== "PAUSED") invalidTransition(current.status, action);
      next.status = "ACTIVE";
    } else if (action === "CANCEL_AT_PERIOD_END") {
      if (!isCurrentSubscriptionStatus(current.status)) invalidTransition(current.status, action);
      next.cancelAtPeriodEnd = true;
    } else if (action === "RESUME") {
      if (!isCurrentSubscriptionStatus(current.status) || !current.cancel_at_period_end) invalidTransition(current.status, action);
      next.cancelAtPeriodEnd = false;
    } else if (action === "CANCEL") {
      if (!isCurrentSubscriptionStatus(current.status)) invalidTransition(current.status, action);
      next.status = "CANCELED";
      next.cancelAtPeriodEnd = false;
      next.canceledAt = new Date();
    }

    await client.query(
      `UPDATE business_subscriptions
       SET plan_id=$2,status=$3,cancel_at_period_end=$4,canceled_at=$5,trial_ends_at=$6,
           current_period_starts_at=$7,current_period_ends_at=$8,
           updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
       WHERE id=$1`,
      [subscriptionId,next.planId,next.status,next.cancelAtPeriodEnd,next.canceledAt,next.trialEndsAt,next.currentPeriodStartsAt,next.currentPeriodEndsAt],
    );
    await writeAudit(client, actor.id, current.business_id, "SUBSCRIPTION_TRANSITIONED", "BUSINESS_SUBSCRIPTION", subscriptionId, reason, {
      action,
      previous: subscriptionAuditSnapshot(before),
      next: { status: next.status, planId: next.planId, cancelAtPeriodEnd: next.cancelAtPeriodEnd },
    });
  });
  return getSubscription(pool, subscriptionId);
}

async function assignSubscription(pool: DatabasePool, actor: PlatformAdminContext, input: AssignSubscriptionInput): Promise<AdminBusinessSubscription> {
  const businessId = requireUuid(input.businessId, "ADMIN_TENANT_NOT_FOUND", "Tenant was not found");
  const planId = requireUuid(input.planId, "ADMIN_PLAN_NOT_FOUND", "Plan was not found");
  const mode = input.mode === "TRIAL" || input.mode === "ACTIVE" ? input.mode : null;
  if (!mode) throw new PlatformAdminError("Subscription mode must be TRIAL or ACTIVE", 400, "ADMIN_SUBSCRIPTION_MODE_INVALID");
  const reason = parseReason(input.reason);
  let subscriptionId = "";
  try {
    await withTransaction(pool, async (client) => {
      const business = await client.query<{ id: string }>("SELECT id FROM businesses WHERE id=$1 FOR UPDATE", [businessId]);
      if (!business.rowCount) throw new PlatformAdminError("Tenant was not found", 404, "ADMIN_TENANT_NOT_FOUND");
      const plan = await requireActivePlan(client, planId);
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM business_subscriptions WHERE business_id=$1 AND status IN ('TRIALING','ACTIVE','PAST_DUE','PAUSED') LIMIT 1`,
        [businessId],
      );
      if (existing.rowCount) throw new PlatformAdminError("Tenant already has a current subscription", 409, "ADMIN_SUBSCRIPTION_CURRENT_EXISTS");
      if (mode === "TRIAL" && plan.trial_days <= 0) {
        throw new PlatformAdminError("This plan does not include a trial", 400, "ADMIN_SUBSCRIPTION_TRIAL_UNAVAILABLE");
      }
      const now = new Date();
      const period = mode === "ACTIVE" ? await periodForInterval(client, plan.billing_interval) : { start: null, end: null };
      const trialEndsAt = mode === "TRIAL" ? new Date(now.getTime() + plan.trial_days * 86400000) : null;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO business_subscriptions(
           business_id,plan_id,status,trial_ends_at,current_period_starts_at,current_period_ends_at,cancel_at_period_end
         ) VALUES($1,$2,$3,$4,$5,$6,false) RETURNING id`,
        [businessId,planId,mode === "TRIAL" ? "TRIALING" : "ACTIVE",trialEndsAt,period.start,period.end],
      );
      subscriptionId = inserted.rows[0]!.id;
      await writeAudit(client, actor.id, businessId, "SUBSCRIPTION_CREATED", "BUSINESS_SUBSCRIPTION", subscriptionId, reason, {
        next: { status: mode === "TRIAL" ? "TRIALING" : "ACTIVE", planId, cancelAtPeriodEnd: false },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PlatformAdminError("Tenant already has a current subscription", 409, "ADMIN_SUBSCRIPTION_CURRENT_EXISTS");
    throw error;
  }
  return getSubscription(pool, subscriptionId);
}

async function getPlan(queryable: Queryable, planId: string): Promise<AdminSubscriptionPlan> {
  const found = await queryable.query<PlanRow>(
    `SELECT id,code,name,description,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active,created_at,updated_at
     FROM subscription_plans WHERE id=$1`, [planId],
  );
  const row = found.rows[0];
  if (!row) throw new PlatformAdminError("Plan was not found", 404, "ADMIN_PLAN_NOT_FOUND");
  const entitlements = await loadEntitlements(queryable, [planId]);
  return mapPlan(row, entitlements.get(planId) ?? []);
}

async function getSubscription(queryable: Queryable, subscriptionId: string): Promise<AdminBusinessSubscription> {
  const found = await queryable.query<SubscriptionRow>(subscriptionSelect("WHERE bs.id=$1"), [subscriptionId]);
  const row = found.rows[0];
  if (!row) throw new PlatformAdminError("Subscription was not found", 404, "ADMIN_SUBSCRIPTION_NOT_FOUND");
  return mapSubscription(row);
}

async function loadEntitlements(queryable: Queryable, planIds: string[]): Promise<Map<string, AdminPlanEntitlement[]>> {
  const map = new Map<string, AdminPlanEntitlement[]>();
  if (!planIds.length) return map;
  const result = await queryable.query<{ plan_id: string; entitlement_code: string; entitlement_value: unknown }>(
    `SELECT plan_id,entitlement_code,entitlement_value FROM plan_entitlements
     WHERE plan_id=ANY($1::uuid[]) ORDER BY entitlement_code`, [planIds],
  );
  for (const row of result.rows) {
    const list = map.get(row.plan_id) ?? [];
    list.push({ code: row.entitlement_code, value: row.entitlement_value });
    map.set(row.plan_id, list);
  }
  return map;
}

async function requireActivePlan(client: DatabaseClient, planId: string): Promise<PlanRow> {
  const result = await client.query<PlanRow>(
    `SELECT id,code,name,description,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active,created_at,updated_at
     FROM subscription_plans WHERE id=$1 AND is_active=true`, [planId],
  );
  const row = result.rows[0];
  if (!row) throw new PlatformAdminError("Active plan was not found", 404, "ADMIN_PLAN_NOT_FOUND");
  return row;
}

async function periodForPlan(client: DatabaseClient, planId: string) {
  const plan = await requireActivePlan(client, planId);
  return periodForInterval(client, plan.billing_interval);
}

async function periodForInterval(client: DatabaseClient, interval: AdminBillingInterval): Promise<{ start: Date; end: Date | null }> {
  const result = await client.query<{ start_at: Date; end_at: Date | null }>(
    `SELECT now() AS start_at,
            CASE $1 WHEN 'MONTHLY' THEN now()+interval '1 month'
                    WHEN 'ANNUAL' THEN now()+interval '1 year'
                    ELSE NULL END AS end_at`, [interval],
  );
  return { start: result.rows[0]!.start_at, end: result.rows[0]!.end_at };
}

function subscriptionSelect(suffix: string): string {
  return `SELECT bs.id,bs.business_id,b.name AS business_name,bs.plan_id,sp.code AS plan_code,sp.name AS plan_name,
                 bs.status,bs.provider,bs.provider_customer_reference,bs.provider_subscription_reference,
                 bs.trial_ends_at,bs.current_period_starts_at,bs.current_period_ends_at,bs.cancel_at_period_end,
                 bs.canceled_at,bs.created_at,bs.updated_at,sp.billing_interval
          FROM business_subscriptions bs
          JOIN businesses b ON b.id=bs.business_id
          JOIN subscription_plans sp ON sp.id=bs.plan_id
          ${suffix}`;
}

function mapPlan(row: PlanRow, entitlements: AdminPlanEntitlement[]): AdminSubscriptionPlan {
  return {
    id: row.id, code: row.code, name: row.name, description: row.description,
    currencyCode: row.currency_code.trim(), amountMinor: safeMinor(row.amount_minor), billingInterval: row.billing_interval,
    trialDays: row.trial_days, public: row.is_public, active: row.is_active, entitlements,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

function mapSubscription(row: SubscriptionRow): AdminBusinessSubscription {
  return {
    id: row.id, businessId: row.business_id, businessName: row.business_name,
    planId: row.plan_id, planCode: row.plan_code, planName: row.plan_name, status: row.status,
    provider: row.provider, providerCustomerReference: row.provider_customer_reference,
    providerSubscriptionReference: row.provider_subscription_reference,
    trialEndsAt: iso(row.trial_ends_at), currentPeriodStartsAt: iso(row.current_period_starts_at),
    currentPeriodEndsAt: iso(row.current_period_ends_at), cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: iso(row.canceled_at), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

function parsePlanInput(input: Record<string, unknown>, current: AdminSubscriptionPlan | null) {
  return {
    id: current?.id,
    code: input.code === undefined && current ? current.code : parseCode(input.code),
    name: input.name === undefined && current ? current.name : parseName(input.name),
    description: input.description === undefined && current ? current.description : parseDescription(input.description),
    currencyCode: input.currencyCode === undefined && current ? current.currencyCode : parseCurrency(input.currencyCode),
    amountMinor: input.amountMinor === undefined && current ? current.amountMinor : parseMinor(input.amountMinor),
    billingInterval: input.billingInterval === undefined && current ? current.billingInterval : parseInterval(input.billingInterval),
    trialDays: input.trialDays === undefined && current ? current.trialDays : parseTrialDays(input.trialDays),
    public: input.isPublic === undefined && current ? current.public : parseBoolean(input.isPublic, true, "isPublic"),
    active: input.isActive === undefined && current ? current.active : parseBoolean(input.isActive, true, "isActive"),
    entitlements: current?.entitlements ?? [],
    createdAt: current?.createdAt,
    updatedAt: current?.updatedAt,
  };
}

function parseEntitlements(value: unknown): AdminPlanEntitlement[] {
  if (!Array.isArray(value) || value.length > 100) throw new PlatformAdminError("Entitlements must be an array of at most 100 items", 400, "ADMIN_ENTITLEMENTS_INVALID");
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new PlatformAdminError("Entitlement entry is invalid", 400, "ADMIN_ENTITLEMENTS_INVALID");
    const raw = entry as { code?: unknown; value?: unknown };
    const code = parseEntitlementCode(raw.code);
    if (seen.has(code)) throw new PlatformAdminError("Entitlement codes must be unique", 400, "ADMIN_ENTITLEMENTS_DUPLICATE");
    seen.add(code);
    if (!("value" in raw)) throw new PlatformAdminError("Entitlement value is required", 400, "ADMIN_ENTITLEMENTS_INVALID");
    return { code, value: raw.value };
  }).sort((a,b) => a.code.localeCompare(b.code));
}

function parseTransitionAction(value: unknown): "ACTIVATE"|"CHANGE_PLAN"|"PAUSE"|"REACTIVATE"|"CANCEL_AT_PERIOD_END"|"RESUME"|"CANCEL" {
  const allowed = new Set(["ACTIVATE","CHANGE_PLAN","PAUSE","REACTIVATE","CANCEL_AT_PERIOD_END","RESUME","CANCEL"]);
  if (typeof value !== "string" || !allowed.has(value)) throw new PlatformAdminError("Unsupported subscription transition", 400, "ADMIN_SUBSCRIPTION_ACTION_INVALID");
  return value as "ACTIVATE"|"CHANGE_PLAN"|"PAUSE"|"REACTIVATE"|"CANCEL_AT_PERIOD_END"|"RESUME"|"CANCEL";
}

function invalidTransition(status: string, action: string): never {
  throw new PlatformAdminError(`Cannot ${action.toLowerCase()} a ${status.toLowerCase()} subscription`, 409, "ADMIN_SUBSCRIPTION_TRANSITION_INVALID");
}
function requireWriteRole(actor: PlatformAdminContext): void {
  if (!WRITE_ROLES.has(actor.role)) throw new PlatformAdminError("Your platform role cannot change plans or subscriptions", 403, "ADMIN_SUBSCRIPTION_WRITE_FORBIDDEN");
}
function parseReason(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new PlatformAdminError("A reason is required", 400, "ADMIN_REASON_REQUIRED");
  const reason = value.trim();
  if (reason.length > 500) throw new PlatformAdminError("Reason is too long", 400, "ADMIN_REASON_INVALID");
  return reason;
}
function parseCode(value: unknown): string {
  if (typeof value !== "string") throw new PlatformAdminError("Plan code is required", 400, "ADMIN_PLAN_CODE_INVALID");
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,49}$/.test(code)) throw new PlatformAdminError("Plan code is invalid", 400, "ADMIN_PLAN_CODE_INVALID");
  return code;
}
function parseEntitlementCode(value: unknown): string {
  if (typeof value !== "string") throw new PlatformAdminError("Entitlement code is invalid", 400, "ADMIN_ENTITLEMENTS_INVALID");
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_.-]{0,79}$/.test(code)) throw new PlatformAdminError("Entitlement code is invalid", 400, "ADMIN_ENTITLEMENTS_INVALID");
  return code;
}
function parseName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > 120) throw new PlatformAdminError("Plan name is invalid", 400, "ADMIN_PLAN_NAME_INVALID");
  return value.trim();
}
function parseDescription(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 1000) throw new PlatformAdminError("Plan description is invalid", 400, "ADMIN_PLAN_DESCRIPTION_INVALID");
  return value.trim();
}
function parseCurrency(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) throw new PlatformAdminError("Currency code is invalid", 400, "ADMIN_PLAN_CURRENCY_INVALID");
  return value.trim().toUpperCase();
}
function parseMinor(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new PlatformAdminError("Plan amount must be a non-negative integer in minor units", 400, "ADMIN_PLAN_AMOUNT_INVALID");
  return value;
}
function parseInterval(value: unknown): AdminBillingInterval {
  if (typeof value !== "string" || !INTERVALS.has(value as AdminBillingInterval)) throw new PlatformAdminError("Billing interval is invalid", 400, "ADMIN_PLAN_INTERVAL_INVALID");
  return value as AdminBillingInterval;
}
function parseTrialDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 3650) throw new PlatformAdminError("Trial days are invalid", 400, "ADMIN_PLAN_TRIAL_INVALID");
  return value;
}
function parseBoolean(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new PlatformAdminError(`${field} must be boolean`, 400, "ADMIN_PLAN_BOOLEAN_INVALID");
  return value;
}
function parseExpectedUpdatedAt(value: unknown, requiredCode: string, invalidCode: string): Date {
  if (typeof value !== "string") throw new PlatformAdminError("Expected record version is required", 400, requiredCode);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new PlatformAdminError("Expected record version is invalid", 400, invalidCode);
  return date;
}
function assertFresh(actual: Date, expected: Date, code: string): void {
  if (actual.getTime() !== expected.getTime()) throw new PlatformAdminError("Record changed since it was loaded. Refresh and try again.", 409, code);
}
function requireUuid(value: unknown, code: string, message: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new PlatformAdminError(message, 404, code);
  return value;
}
function safeMinor(value: string | number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new PlatformAdminError("Stored monetary amount exceeds supported range", 500, "ADMIN_MONEY_OVERFLOW");
  return number;
}
function iso(value: Date | null): string | null { return value ? value.toISOString() : null; }
function isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505"; }
function planAuditSnapshot(plan: { code: string; name: string; currencyCode: string; amountMinor: number; billingInterval: string; trialDays: number; public: boolean; active: boolean }) {
  return { code: plan.code, name: plan.name, currencyCode: plan.currencyCode, amountMinor: plan.amountMinor, billingInterval: plan.billingInterval, trialDays: plan.trialDays, public: plan.public, active: plan.active };
}
function subscriptionAuditSnapshot(subscription: AdminBusinessSubscription) {
  return { status: subscription.status, planId: subscription.planId, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd };
}
async function writeAudit(client: DatabaseClient, actorId: string, businessId: string | null, eventType: string, entityType: string, entityId: string, reason: string, payload: Record<string, unknown>) {
  await client.query(
    `INSERT INTO platform_audit_events(platform_user_id,business_id,event_type,entity_type,entity_id,reason,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [actorId,businessId,eventType,entityType,entityId,reason,JSON.stringify(payload)],
  );
}
