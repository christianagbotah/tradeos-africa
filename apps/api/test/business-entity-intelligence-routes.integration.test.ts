import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations/migration-runner.js";

process.env.OPENAI_API_KEY = "test-only-key";
process.env.TRADEOS_AI_MODEL = "test-model";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `entity_route_test_${crypto.randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const app = buildApp(pool);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");
const originalFetch = globalThis.fetch;

type Tenant = { token: string; userId: string; businessId: string; branchId: string };
type ProviderCall = { body: Record<string, unknown> };

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  await applyMigrations(pool, { migrationDirectory });
  await app.ready();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");
});

afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
afterAll(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await adminPool.end();
});

describe("entity intelligence routes and contextual query", () => {
  it("returns deterministic entity intelligence for an authorized record", async () => {
    const tenant = await createTenant("entity-route@tradeos.test", "Entity Route");
    const customerId = await seedCustomer(tenant.businessId, "Route Customer");

    const response = await app.inject({
      method: "GET",
      url: `/v1/intelligence/entity?businessId=${tenant.businessId}&branchId=${tenant.branchId}&entityType=CUSTOMER&entityId=${customerId}`,
      headers: authHeaders(tenant.token),
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.entity).toEqual({ entityType: "CUSTOMER", entityId: customerId, label: "Route Customer" });
    expect(body.evidence.some((item: { source: string }) => item.source === "customers")).toBe(true);
  });

  it("rejects unsupported entity types before evidence lookup", async () => {
    const tenant = await createTenant("entity-type@tradeos.test", "Entity Type");
    const response = await app.inject({
      method: "GET",
      url: `/v1/intelligence/entity?businessId=${tenant.businessId}&branchId=${tenant.branchId}&entityType=SQL_TABLE&entityId=${crypto.randomUUID()}`,
      headers: authHeaders(tenant.token),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("ENTITY_TYPE_UNSUPPORTED");
  });

  it("returns the same safe not-found for unknown and another tenant's entity", async () => {
    const tenantA = await createTenant("entity-a@tradeos.test", "Entity A");
    const tenantB = await createTenant("entity-b@tradeos.test", "Entity B");
    const foreignCustomerId = await seedCustomer(tenantB.businessId, "Foreign Customer");
    for (const entityId of [foreignCustomerId, crypto.randomUUID()]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/intelligence/entity?businessId=${tenantA.businessId}&branchId=${tenantA.branchId}&entityType=CUSTOMER&entityId=${entityId}`,
        headers: authHeaders(tenantA.token),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: "ENTITY_NOT_FOUND" });
    }
  });

  it("creates one server-owned entity review task and returns the active task on retry", async () => {
    const tenant = await createTenant("entity-action-route@tradeos.test", "Entity Action Route");
    const customerId = await seedCustomer(tenant.businessId, "Action Customer");
    const payload = {
      businessId: tenant.businessId,
      branchId: tenant.branchId,
      context: { entityType: "CUSTOMER", entityId: customerId },
    };

    const first = await app.inject({
      method: "POST", url: "/v1/intelligence/entity/action-items", headers: authHeaders(tenant.token), payload,
    });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({
      created: true,
      item: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        sourceEntityType: "CUSTOMER",
        sourceEntityId: customerId,
        createdByUserId: tenant.userId,
        assignedUserId: tenant.userId,
        actionType: "CREATE_RECEIVABLE_FOLLOW_UP",
        status: "OPEN",
      },
    });

    const retry = await app.inject({
      method: "POST", url: "/v1/intelligence/entity/action-items", headers: authHeaders(tenant.token), payload,
    });
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json().created).toBe(false);
    expect(retry.json().item.id).toBe(first.json().item.id);
  });

  it("rejects client attempts to shape an entity action", async () => {
    const tenant = await createTenant("entity-action-inject@tradeos.test", "Entity Action Inject");
    const customerId = await seedCustomer(tenant.businessId, "Injection Customer");
    for (const injected of [
      { actionType: "POST_PAYMENT" },
      { title: "Pay now" },
      { reason: "Client says so" },
      { evidence: [{ source: "client" }] },
      { assignedUserId: crypto.randomUUID() },
      { dueInHours: 9999 },
    ]) {
      const response = await app.inject({
        method: "POST", url: "/v1/intelligence/entity/action-items", headers: authHeaders(tenant.token),
        payload: {
          businessId: tenant.businessId,
          branchId: tenant.branchId,
          context: { entityType: "CUSTOMER", entityId: customerId },
          ...injected,
        },
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error).toBe("ENTITY_ACTION_CLIENT_SHAPING_FORBIDDEN");
    }
    const count = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM business_action_items WHERE business_id=$1`, [tenant.businessId]);
    expect(count.rows[0]?.count).toBe(0);
  });

  it("validates entity type, tenant ownership, and eligible membership role before action creation", async () => {
    const tenantA = await createTenant("entity-action-a@tradeos.test", "Entity Action A");
    const tenantB = await createTenant("entity-action-b@tradeos.test", "Entity Action B");
    const foreignCustomerId = await seedCustomer(tenantB.businessId, "Foreign Action Customer");

    const unsupported = await app.inject({
      method: "POST", url: "/v1/intelligence/entity/action-items", headers: authHeaders(tenantA.token),
      payload: { businessId: tenantA.businessId, branchId: tenantA.branchId, context: { entityType: "SQL_TABLE", entityId: crypto.randomUUID() } },
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json().error).toBe("ENTITY_TYPE_UNSUPPORTED");

    const foreign = await app.inject({
      method: "POST", url: "/v1/intelligence/entity/action-items", headers: authHeaders(tenantA.token),
      payload: { businessId: tenantA.businessId, branchId: tenantA.branchId, context: { entityType: "CUSTOMER", entityId: foreignCustomerId } },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error).toBe("ENTITY_NOT_FOUND");

    const localCustomerId = await seedCustomer(tenantA.businessId, "Viewer Customer");
    await pool.query(`UPDATE business_memberships SET role='VIEWER' WHERE business_id=$1 AND user_id=$2`, [tenantA.businessId, tenantA.userId]);
    const viewer = await app.inject({
      method: "POST", url: "/v1/intelligence/entity/action-items", headers: authHeaders(tenantA.token),
      payload: { businessId: tenantA.businessId, branchId: tenantA.branchId, context: { entityType: "CUSTOMER", entityId: localCustomerId } },
    });
    expect(viewer.statusCode).toBe(403);
    expect(viewer.json().error).toBe("ENTITY_ACTION_FORBIDDEN");
  });

  it("grounds Ask TradeOS on server-validated structured entity context", async () => {
    const tenant = await createTenant("entity-query@tradeos.test", "Entity Query");
    const customerId = await seedCustomer(tenant.businessId, "Grounded Customer");
    const calls: ProviderCall[] = [];
    globalThis.fetch = fakeProvider(calls, { answer: "Grounded customer answer", evidenceIndexes: [0], recommendations: [] });

    const response = await app.inject({
      method: "POST",
      url: "/v1/intelligence/query",
      headers: authHeaders(tenant.token),
      payload: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        question: "Tell me about this record",
        context: { entityType: "CUSTOMER", entityId: customerId },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(calls).toHaveLength(1);
    const evidence = providerEvidence(calls[0]!);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((item) => item.sourceId === customerId)).toBe(true);
    expect(evidence.some((item) => item.sourceType === "customers" && item.label === "customerName")).toBe(true);
    expect(providerPrompt(calls[0]!)).toContain(`Validated entity: CUSTOMER Grounded Customer (${customerId}).`);
  });

  it("revalidates query context ownership and never calls the provider for a foreign record", async () => {
    const tenantA = await createTenant("entity-query-a@tradeos.test", "Entity Query A");
    const tenantB = await createTenant("entity-query-b@tradeos.test", "Entity Query B");
    const foreignCustomerId = await seedCustomer(tenantB.businessId, "Foreign Query Customer");
    const calls: ProviderCall[] = [];
    globalThis.fetch = fakeProvider(calls, { answer: "should not run", evidenceIndexes: [0], recommendations: [] });

    const response = await app.inject({
      method: "POST",
      url: "/v1/intelligence/query",
      headers: authHeaders(tenantA.token),
      payload: {
        businessId: tenantA.businessId,
        branchId: tenantA.branchId,
        question: "Tell me about this record",
        context: { entityType: "CUSTOMER", entityId: foreignCustomerId },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("ENTITY_NOT_FOUND");
    expect(calls).toHaveLength(0);
  });

  it("rejects arbitrary query context types before calling the provider", async () => {
    const tenant = await createTenant("entity-query-type@tradeos.test", "Entity Query Type");
    const calls: ProviderCall[] = [];
    globalThis.fetch = fakeProvider(calls, { answer: "should not run", evidenceIndexes: [0], recommendations: [] });
    const response = await app.inject({
      method: "POST",
      url: "/v1/intelligence/query",
      headers: authHeaders(tenant.token),
      payload: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        question: "Run arbitrary context",
        context: { entityType: "DATABASE_TABLE", entityId: crypto.randomUUID() },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("ENTITY_TYPE_UNSUPPORTED");
    expect(calls).toHaveLength(0);
  });
});

function fakeProvider(calls: ProviderCall[], structuredOutput: Record<string, unknown>): typeof fetch {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ body });
    return new Response(JSON.stringify({ id: "resp-entity", output_text: JSON.stringify(structuredOutput) }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req-entity" },
    });
  }) as typeof fetch;
}

function providerPrompt(call: ProviderCall): string {
  const input = call.body.input as Array<{ content?: Array<{ text?: string }> }> | undefined;
  return input?.[0]?.content?.[0]?.text ?? "";
}

function providerEvidence(call: ProviderCall): Array<{ sourceType: string; sourceId?: string; label: string; value?: unknown }> {
  const text = providerPrompt(call);
  const marker = "Authoritative grounding evidence (JSON):\n";
  const index = text.indexOf(marker);
  expect(index).toBeGreaterThanOrEqual(0);
  return JSON.parse(text.slice(index + marker.length));
}

async function createTenant(email: string, name: string): Promise<Tenant> {
  const registration = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: { displayName: name, email, password: "TradeOS-Test-1234", platform: "WEB", deviceKey: `device-${email}`, appVersion: "test" },
  });
  expect(registration.statusCode, registration.body).toBe(201);
  const registrationBody = registration.json();
  const token = registrationBody.session.accessToken as string;
  const userId = registrationBody.user.id as string;
  const onboard = await app.inject({
    method: "POST", url: "/v1/onboarding/business", headers: authHeaders(token),
    payload: { name, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(onboard.statusCode, onboard.body).toBe(201);
  return { token, userId, businessId: onboard.json().business.id, branchId: onboard.json().branch.id };
}

async function seedCustomer(businessId: string, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO customers(business_id,name,is_active,credit_terms_days) VALUES($1,$2,true,30) RETURNING id`,
    [businessId, name],
  );
  return result.rows[0]!.id;
}

function authHeaders(token: string) { return { authorization: `Bearer ${token}` }; }
