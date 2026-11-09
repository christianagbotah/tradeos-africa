import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations/migration-runner.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `tenant_billing_routes_${crypto.randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const app = buildApp(pool);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  await applyMigrations(pool, { migrationDirectory });
  await app.ready();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE subscription_plans,app_users,businesses CASCADE");
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await adminPool.end();
});

describe("tenant billing routes", () => {
  it("lets Owner read tenant-safe overview, invoices and payments", async () => {
    const owner = await register("billing-owner@tradeos.test", "billing-owner-device");
    const businessId = await createBusiness(owner.accessToken);
    const seeded = await seedBilling(businessId);

    const overview = await app.inject({ method: "GET", url: `/v1/billing/overview?businessId=${businessId}`, headers: bearer(owner.accessToken) });
    expect(overview.statusCode, overview.body).toBe(200);
    expect(overview.json<{ subscription: { plan: { code: string } } }>().subscription.plan.code).toContain("basic-");
    expect(overview.body).not.toMatch(/provider_customer|providerCustomer|provider_subscription|providerSubscription/);

    const invoices = await app.inject({ method: "GET", url: `/v1/billing/invoices?businessId=${businessId}&limit=10`, headers: bearer(owner.accessToken) });
    expect(invoices.statusCode).toBe(200);
    expect(invoices.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)).toEqual([seeded.invoiceId]);

    const payments = await app.inject({ method: "GET", url: `/v1/billing/payments?businessId=${businessId}`, headers: bearer(owner.accessToken) });
    expect(payments.statusCode).toBe(200);
    expect(payments.body).not.toMatch(/providerEvent|providerTransaction|failureMessage/);
  });

  it("keeps Accountant read-only and denies lower roles from billing reads", async () => {
    const owner = await register("billing-roles@tradeos.test", "billing-roles-device");
    const businessId = await createBusiness(owner.accessToken);
    await seedBilling(businessId);

    await setRole(businessId, "ACCOUNTANT");
    const accountantRead = await app.inject({ method: "GET", url: `/v1/billing/overview?businessId=${businessId}`, headers: bearer(owner.accessToken) });
    expect(accountantRead.statusCode).toBe(200);
    const accountantCancel = await app.inject({ method: "POST", url: "/v1/billing/subscription/cancel-at-period-end", headers: bearer(owner.accessToken), payload: { businessId } });
    expect(accountantCancel.statusCode).toBe(403);

    await setRole(businessId, "VIEWER");
    const viewerRead = await app.inject({ method: "GET", url: `/v1/billing/overview?businessId=${businessId}`, headers: bearer(owner.accessToken) });
    expect(viewerRead.statusCode).toBe(403);
  });

  it("authenticates subscription mutations before validating client-shaped input", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/billing/subscription/cancel-at-period-end",
      payload: { businessId: "not-a-uuid", planId: crypto.randomUUID() },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: string }>().error).toBe("AUTH_REQUIRED");
  });

  it("allows Owner/Admin cancel and resume but rejects client-shaped lifecycle requests", async () => {
    const owner = await register("billing-actions@tradeos.test", "billing-actions-device");
    const businessId = await createBusiness(owner.accessToken);
    await seedBilling(businessId);

    const cancel = await app.inject({ method: "POST", url: "/v1/billing/subscription/cancel-at-period-end", headers: bearer(owner.accessToken), payload: { businessId } });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(cancel.json<{ subscription: { cancelAtPeriodEnd: boolean } }>().subscription.cancelAtPeriodEnd).toBe(true);

    await setRole(businessId, "ADMIN");
    const resume = await app.inject({ method: "POST", url: "/v1/billing/subscription/resume", headers: bearer(owner.accessToken), payload: { businessId } });
    expect(resume.statusCode).toBe(200);
    expect(resume.json<{ subscription: { cancelAtPeriodEnd: boolean } }>().subscription.cancelAtPeriodEnd).toBe(false);

    const shaped = await app.inject({ method: "POST", url: "/v1/billing/subscription/cancel-at-period-end", headers: bearer(owner.accessToken), payload: { businessId, planId: crypto.randomUUID() } });
    expect(shaped.statusCode).toBe(400);
    expect(shaped.json<{ error: string }>().error).toBe("TENANT_BILLING_BODY_INVALID");
  });

  it("hides foreign invoice detail as not found and validates list limits", async () => {
    const owner = await register("billing-isolation@tradeos.test", "billing-isolation-device");
    const businessId = await createBusiness(owner.accessToken);
    await seedBilling(businessId);
    const foreign = await register("billing-foreign@tradeos.test", "billing-foreign-device");
    const foreignBusinessId = await createBusiness(foreign.accessToken);
    const foreignBilling = await seedBilling(foreignBusinessId, "FOREIGN");

    const hidden = await app.inject({ method: "GET", url: `/v1/billing/invoices/${foreignBilling.invoiceId}?businessId=${businessId}`, headers: bearer(owner.accessToken) });
    expect(hidden.statusCode).toBe(404);
    const badLimit = await app.inject({ method: "GET", url: `/v1/billing/invoices?businessId=${businessId}&limit=0`, headers: bearer(owner.accessToken) });
    expect(badLimit.statusCode).toBe(400);
  });
});

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { displayName: "Billing Owner", email, password: "TradeOS-Test-1234", platform: "WEB", deviceKey, appVersion: "test" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ session: { accessToken: string } }>().session;
}

async function createBusiness(accessToken: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers: bearer(accessToken),
    payload: { name: `Billing ${crypto.randomUUID().slice(0, 8)}`, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ business: { id: string } }>().business.id;
}

async function seedBilling(businessId: string, suffix = "MAIN") {
  const plan = await pool.query<{ id: string }>(
    `INSERT INTO subscription_plans(code,name,currency_code,amount_minor,billing_interval,trial_days,is_public,is_active)
     VALUES($1,'Basic','GHS',5000,'MONTHLY',14,true,true) RETURNING id`,
    [`basic-${suffix.toLowerCase()}-${businessId.slice(0, 6)}`],
  );
  const subscription = await pool.query<{ id: string }>(
    `INSERT INTO business_subscriptions(business_id,plan_id,status,current_period_starts_at,current_period_ends_at)
     VALUES($1,$2,'ACTIVE',now()-interval '1 day',now()+interval '29 days') RETURNING id`,
    [businessId, plan.rows[0]!.id],
  );
  const invoice = await pool.query<{ id: string }>(
    `INSERT INTO subscription_invoices(
       business_id,subscription_id,invoice_number,currency_code,subtotal_minor,total_minor,status,
       period_start,period_end,due_at,provider,provider_invoice_reference
     ) VALUES($1,$2,$3,'GHS',5000,5000,'OPEN',now()-interval '1 day',now()+interval '29 days',now()+interval '7 days','HUBTEL',$4)
     RETURNING id`,
    [businessId, subscription.rows[0]!.id, `INV-${suffix}-${businessId.slice(0, 8)}`, `hidden-invoice-${suffix}-${businessId}`],
  );
  await pool.query(
    `INSERT INTO subscription_payments(
       business_id,invoice_id,amount_minor,currency_code,method,provider,provider_event_reference,
       provider_transaction_reference,status,received_at
     ) VALUES($1,$2,1000,'GHS','MOMO','HUBTEL',$3,$4,'SUCCEEDED',now())`,
    [businessId, invoice.rows[0]!.id, `hidden-event-${suffix}-${businessId}`, `hidden-txn-${suffix}-${businessId}`],
  );
  return { invoiceId: invoice.rows[0]!.id };
}

async function setRole(businessId: string, role: string) {
  await pool.query(`UPDATE business_memberships SET role=$2 WHERE business_id=$1`, [businessId, role]);
}

function bearer(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}
