import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/security.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
const PASSWORD = "admin-password-123";

beforeAll(async () => { await app.ready(); });
beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE
    platform_automation_runs,platform_automation_policies,platform_attention_items,
    subscription_payment_refunds,subscription_payments,subscription_invoices,
    platform_admin_sessions,platform_audit_events,business_entitlement_overrides,
    business_subscriptions,plan_entitlements,subscription_plans,registered_devices,
    client_releases,platform_users,businesses CASCADE`);
});
afterAll(async () => { await app.close(); await pool.end(); });

describe("deterministic platform attention engine", () => {
  it("derives all approved attention rules from authoritative control-plane data", async () => {
    const now = new Date();
    await seedAdmin("attention@tradeos.test", "SUPER_ADMIN");
    const cookie = await adminCookieFor("attention@tradeos.test");

    const trialBusiness = await seedBusiness("Trial expiring");
    const trialPlan = await seedPlan("TRIAL-PLAN");
    const trialSub = await seedSubscription(trialBusiness, trialPlan, "TRIALING", addHours(now, 48));

    const pastDueBusiness = await seedBusiness("Past due");
    const pastDuePlan = await seedPlan("PAST-DUE-PLAN");
    const pastDueSub = await seedSubscription(pastDueBusiness, pastDuePlan, "PAST_DUE", null);

    const failedBusiness = await seedBusiness("Failed collections");
    const failedPlan = await seedPlan("FAILED-PAY-PLAN");
    const failedSub = await seedSubscription(failedBusiness, failedPlan, "ACTIVE", null);
    const failedInvoice = await seedInvoice(failedBusiness, failedSub, "INV-ATTN-FAILED");
    for (let index = 1; index <= 3; index += 1) {
      await seedFailedPayment(failedBusiness, failedInvoice, index, addHours(now, -index));
    }

    const staleBusiness = await seedBusiness("Stale device");
    const staleDevice = await seedDevice(staleBusiness, "stale-device", "WEB", "2.0.0", addHours(now, -2), addHours(now, -2));

    const syncBusiness = await seedBusiness("Sync risk");
    const syncDevice = await seedDevice(syncBusiness, "sync-risk-device", "WINDOWS", "2.0.0", addMinutes(now, -5), addHours(now, -2));

    const clientBusiness = await seedBusiness("Old client");
    const clientDevice = await seedDevice(clientBusiness, "old-client", "ANDROID", "1.4.0", addMinutes(now, -5), addMinutes(now, -5));
    await pool.query(
      `INSERT INTO client_releases(platform,version,release_channel,status,minimum_supported_version,rollout_percent,released_at)
       VALUES('ANDROID','2.2.0','STABLE','ACTIVE','2.0.0',100,$1)`,
      [addHours(now, -1)],
    );

    const overrideBusiness = await seedBusiness("Override heavy");
    for (let index = 1; index <= 5; index += 1) {
      await pool.query(
        `INSERT INTO business_entitlement_overrides(business_id,entitlement_code,entitlement_value,reason)
         VALUES($1,$2,'true'::jsonb,'Temporary platform exception')`,
        [overrideBusiness, `OVERRIDE_${index}`],
      );
    }

    const loginRiskAdmin = await seedAdmin("login-risk@tradeos.test", "SUPPORT");
    await pool.query("UPDATE platform_users SET failed_login_count=4 WHERE id=$1", [loginRiskAdmin]);

    const evaluation = await app.inject({
      method: "POST",
      url: "/api/admin/attention/evaluate",
      headers: jsonHeaders(cookie),
      payload: { correlationId: "attention-rule-evaluation" },
    });
    expect(evaluation.statusCode, evaluation.body).toBe(200);
    const items = evaluation.json<{ items: AttentionItem[] }>().items;
    const byRule = new Map(items.map((item) => [item.ruleCode, item]));

    expect([...byRule.keys()]).toEqual(expect.arrayContaining([
      "TRIAL_EXPIRING_3D",
      "SUBSCRIPTION_PAST_DUE",
      "COLLECTION_FAILED_3X",
      "DEVICE_STALE",
      "SYNC_RISK",
      "CLIENT_BELOW_MINIMUM",
      "ENTITLEMENT_OVERRIDE_HIGH",
      "ADMIN_LOGIN_FAILURES_HIGH",
    ]));

    expect(byRule.get("TRIAL_EXPIRING_3D")).toMatchObject({
      businessId: trialBusiness,
      entityType: "SUBSCRIPTION",
      entityId: trialSub,
      severity: "MEDIUM",
      state: "OPEN",
      sourceKey: `trial-expiring:${trialSub}`,
    });
    expectEvidence(byRule.get("TRIAL_EXPIRING_3D"), "trialEndsAt");

    expect(byRule.get("SUBSCRIPTION_PAST_DUE")).toMatchObject({
      businessId: pastDueBusiness,
      entityType: "SUBSCRIPTION",
      entityId: pastDueSub,
      severity: "HIGH",
      sourceKey: `subscription-past-due:${pastDueSub}`,
    });
    expectEvidence(byRule.get("SUBSCRIPTION_PAST_DUE"), "status");

    expect(byRule.get("COLLECTION_FAILED_3X")).toMatchObject({
      businessId: failedBusiness,
      severity: "HIGH",
      sourceKey: `collection-failed-3x:${failedBusiness}`,
    });
    expectEvidence(byRule.get("COLLECTION_FAILED_3X"), "failedCount");

    expect(byRule.get("DEVICE_STALE")).toMatchObject({
      businessId: staleBusiness,
      entityType: "DEVICE",
      entityId: staleDevice,
      severity: "MEDIUM",
      sourceKey: `device-stale:${staleDevice}`,
    });
    expectEvidence(byRule.get("DEVICE_STALE"), "lastSeenAt");

    expect(byRule.get("SYNC_RISK")).toMatchObject({
      businessId: syncBusiness,
      entityType: "DEVICE",
      entityId: syncDevice,
      severity: "HIGH",
      sourceKey: `sync-risk:${syncDevice}`,
    });
    expectEvidence(byRule.get("SYNC_RISK"), "lastSyncAt");

    expect(byRule.get("CLIENT_BELOW_MINIMUM")).toMatchObject({
      businessId: clientBusiness,
      entityType: "DEVICE",
      entityId: clientDevice,
      severity: "HIGH",
      sourceKey: `client-below-minimum:${clientDevice}`,
    });
    expectEvidence(byRule.get("CLIENT_BELOW_MINIMUM"), "minimumSupportedVersion");

    expect(byRule.get("ENTITLEMENT_OVERRIDE_HIGH")).toMatchObject({
      businessId: overrideBusiness,
      entityType: "BUSINESS",
      entityId: overrideBusiness,
      severity: "MEDIUM",
      sourceKey: `entitlement-override-high:${overrideBusiness}`,
    });
    expectEvidence(byRule.get("ENTITLEMENT_OVERRIDE_HIGH"), "overrideCount");

    expect(byRule.get("ADMIN_LOGIN_FAILURES_HIGH")).toMatchObject({
      businessId: null,
      entityType: "PLATFORM_ADMIN",
      entityId: loginRiskAdmin,
      severity: "HIGH",
      sourceKey: `admin-login-failures-high:${loginRiskAdmin}`,
    });
    expectEvidence(byRule.get("ADMIN_LOGIN_FAILURES_HIGH"), "failedLoginCount");
  });

  it("updates an unchanged open signal instead of duplicating it, then resolves it when the condition clears", async () => {
    const now = new Date();
    await seedAdmin("lifecycle@tradeos.test", "SUPER_ADMIN");
    const cookie = await adminCookieFor("lifecycle@tradeos.test");
    const businessId = await seedBusiness("Lifecycle Tenant");
    const planId = await seedPlan("LIFECYCLE-PLAN");
    const subscriptionId = await seedSubscription(businessId, planId, "TRIALING", addHours(now, 48));

    const first = await evaluate(cookie, "lifecycle-1");
    expect(first.statusCode, first.body).toBe(200);
    const firstItem = first.json<{ items: AttentionItem[] }>().items.find((item) => item.ruleCode === "TRIAL_EXPIRING_3D");
    expect(firstItem).toBeTruthy();

    const second = await evaluate(cookie, "lifecycle-2");
    expect(second.statusCode, second.body).toBe(200);
    const secondItem = second.json<{ items: AttentionItem[] }>().items.find((item) => item.ruleCode === "TRIAL_EXPIRING_3D");
    expect(secondItem?.id).toBe(firstItem?.id);

    const duplicateCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM platform_attention_items
       WHERE source_key=$1 AND state='OPEN'`,
      [`trial-expiring:${subscriptionId}`],
    );
    expect(Number(duplicateCount.rows[0]!.count)).toBe(1);

    await pool.query(
      "UPDATE business_subscriptions SET trial_ends_at=$2,updated_at=now() WHERE id=$1",
      [subscriptionId, addHours(now, 24 * 10)],
    );
    const cleared = await evaluate(cookie, "lifecycle-3");
    expect(cleared.statusCode, cleared.body).toBe(200);

    const stored = await pool.query<{ state: string; resolved_at: Date | null }>(
      "SELECT state,resolved_at FROM platform_attention_items WHERE id=$1",
      [firstItem!.id],
    );
    expect(stored.rows[0]?.state).toBe("RESOLVED");
    expect(stored.rows[0]?.resolved_at).toBeInstanceOf(Date);

    const listed = await app.inject({ method: "GET", url: "/api/admin/attention", headers: cookieHeader(cookie) });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ items: AttentionItem[] }>().items.some((item) => item.id === firstItem!.id)).toBe(false);
  });

  it("allows support to read attention but requires an operations-capable role to force evaluation", async () => {
    await seedAdmin("support-attention@tradeos.test", "SUPPORT");
    const supportCookie = await adminCookieFor("support-attention@tradeos.test");

    const list = await app.inject({ method: "GET", url: "/api/admin/attention", headers: cookieHeader(supportCookie) });
    expect(list.statusCode, list.body).toBe(200);

    const forbidden = await evaluate(supportCookie, "support-eval");
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    expect(forbidden.json<{ error: string }>().error).toBe("ADMIN_ATTENTION_EVALUATE_FORBIDDEN");

    const unauthenticated = await app.inject({ method: "GET", url: "/api/admin/attention" });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json<{ error: string }>().error).toBe("ADMIN_AUTH_REQUIRED");
  });
});

interface AttentionItem {
  id: string;
  sourceKey: string;
  ruleCode: string;
  businessId: string | null;
  entityType: string | null;
  entityId: string | null;
  severity: string;
  state: string;
  evidence: Array<{ sourceType: string; label: string; value?: unknown }>;
}

function expectEvidence(item: AttentionItem | undefined, label: string): void {
  expect(item).toBeTruthy();
  expect(item!.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ label })]));
}

async function evaluate(cookie: string, correlationId: string) {
  return app.inject({
    method: "POST",
    url: "/api/admin/attention/evaluate",
    headers: jsonHeaders(cookie),
    payload: { correlationId },
  });
}

async function seedAdmin(email: string, role: string): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
     VALUES($1,$2,$3,true,$4,now()) RETURNING id`,
    [email, `${role} Operator`, role, passwordHash],
  );
  return result.rows[0]!.id;
}

async function adminCookieFor(email: string): Promise<string> {
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/session/login",
    payload: { identifier: email, password: PASSWORD, platform: "WEB", deviceKey: `${email}-device` },
  });
  expect(login.statusCode, login.body).toBe(200);
  return adminCookie(login.headers);
}

async function seedBusiness(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES($1,'RETAIL','GH','GHS','Africa/Accra','ACTIVE') RETURNING id`,
    [name],
  );
  return result.rows[0]!.id;
}

async function seedPlan(code: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active)
     VALUES($1,$1,'GHS',10000,'MONTHLY',0,false,true) RETURNING id`,
    [code],
  );
  return result.rows[0]!.id;
}

async function seedSubscription(businessId: string, planId: string, status: string, trialEndsAt: Date | null): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_subscriptions(
       business_id,plan_id,status,trial_ends_at,current_period_starts_at,current_period_ends_at
     ) VALUES($1,$2,$3,$4,now()-interval '10 days',now()+interval '20 days') RETURNING id`,
    [businessId, planId, status, trialEndsAt],
  );
  return result.rows[0]!.id;
}

async function seedInvoice(businessId: string, subscriptionId: string, invoiceNumber: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO subscription_invoices(
       business_id,subscription_id,invoice_number,currency_code,subtotal_minor,tax_minor,total_minor,amount_paid_minor,
       status,period_start,period_end,issued_at,due_at
     ) VALUES($1,$2,$3,'GHS',10000,0,10000,0,'OPEN',now()-interval '30 days',now(),now()-interval '7 days',now()+interval '7 days')
     RETURNING id`,
    [businessId, subscriptionId, invoiceNumber],
  );
  return result.rows[0]!.id;
}

async function seedFailedPayment(businessId: string, invoiceId: string, index: number, receivedAt: Date): Promise<void> {
  await pool.query(
    `INSERT INTO subscription_payments(
       business_id,invoice_id,amount_minor,currency_code,method,provider,provider_event_reference,
       provider_transaction_reference,status,failure_code,failure_message,received_at
     ) VALUES($1,$2,10000,'GHS','MOMO','TEST',$3,$4,'FAILED','DECLINED','Provider rejected collection',$5)`,
    [businessId, invoiceId, `attention-fail-event-${businessId}-${index}`, `attention-fail-txn-${businessId}-${index}`, receivedAt],
  );
}

async function seedDevice(
  businessId: string,
  deviceKey: string,
  platform: string,
  appVersion: string,
  lastSeenAt: Date | null,
  lastSyncAt: Date | null,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO registered_devices(
       business_id,device_key,platform,app_version,release_channel,status,last_seen_at,last_sync_at
     ) VALUES($1,$2,$3,$4,'STABLE','ACTIVE',$5,$6) RETURNING id`,
    [businessId, deviceKey, platform, appVersion, lastSeenAt, lastSyncAt],
  );
  return result.rows[0]!.id;
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function adminCookie(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["set-cookie"];
  const serialized = Array.isArray(raw) ? raw[0] : raw;
  expect(serialized).toBeTruthy();
  return serialized!.split(";", 1)[0]!;
}
function cookieHeader(cookie: string) { return { cookie }; }
function jsonHeaders(cookie: string) { return { cookie, "content-type": "application/json" }; }
