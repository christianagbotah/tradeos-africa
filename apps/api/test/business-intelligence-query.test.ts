import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
process.env.OPENAI_API_KEY = "test-only-key";
process.env.TRADEOS_AI_MODEL = "test-model";

const pool = createPool();
const app = buildApp(pool);
const originalFetch = globalThis.fetch;

type Tenant = { token: string; userId: string; businessId: string; branchId: string };
type ProviderCall = { body: Record<string, unknown> };

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
afterAll(async () => { globalThis.fetch = originalFetch; await app.close(); await pool.end(); });

describe("grounded business intelligence query", () => {
  it.each([
    ["what sold best this week?", "sales"],
    ["who owes us money?", "customer_credit_obligations"],
    ["what stock should I reorder?", "inventory"],
    ["why is cash lower than expected?", "cashbook_entries"],
  ])("answers %s from authoritative evidence", async (question, expectedSource) => {
    const tenant = await createTenant(`query-${expectedSource}@tradeos.test`, `Query ${expectedSource}`);
    const calls: ProviderCall[] = [];
    globalThis.fetch = fakeProvider(calls, {
      answer: `Grounded answer for ${expectedSource}`,
      evidenceIndexes: [0],
      recommendations: [],
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/intelligence/query",
      headers: authHeaders(tenant.token),
      payload: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        question,
        conversationId: `conversation-${expectedSource}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.businessId).toBe(tenant.businessId);
    expect(body.branchId).toBe(tenant.branchId);
    expect(body.answer).toContain("Grounded answer");
    expect(Array.isArray(body.evidence)).toBe(true);
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);

    const evidence = providerEvidence(calls[0]!);
    expect(evidence.some((item) => item.sourceType === expectedSource)).toBe(true);
    expect(evidence.every((item) => item.sourceId !== tenant.userId)).toBe(true);
  });

  it("rejects a forged business scope before calling the AI provider", async () => {
    const tenantA = await createTenant("query-a@tradeos.test", "Query A");
    const tenantB = await createTenant("query-b@tradeos.test", "Query B");
    const calls: ProviderCall[] = [];
    globalThis.fetch = fakeProvider(calls, { answer: "should not run", evidenceIndexes: [], recommendations: [] });

    const response = await app.inject({
      method: "POST",
      url: "/v1/intelligence/query",
      headers: authHeaders(tenantA.token),
      payload: {
        businessId: tenantB.businessId,
        branchId: tenantB.branchId,
        question: "show me this business",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("BUSINESS_ACCESS_DENIED");
    expect(calls).toHaveLength(0);
  });

  it("does not expose financial evidence to STAFF", async () => {
    const tenant = await createTenant("query-staff@tradeos.test", "Query Staff");
    await pool.query(
      `UPDATE business_memberships SET role='STAFF'
       WHERE business_id=$1 AND user_id=$2 AND status='ACTIVE'`,
      [tenant.businessId, tenant.userId],
    );
    const calls: ProviderCall[] = [];
    globalThis.fetch = fakeProvider(calls, { answer: "Operational answer", evidenceIndexes: [0], recommendations: [] });

    const response = await app.inject({
      method: "POST",
      url: "/v1/intelligence/query",
      headers: authHeaders(tenant.token),
      payload: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        question: "what should I work on next?",
      },
    });

    expect(response.statusCode).toBe(200);
    const evidence = providerEvidence(calls[0]!);
    const sources = new Set(evidence.map((item) => item.sourceType));
    expect(sources.has("inventory")).toBe(true);
    expect(sources.has("cashbook_entries")).toBe(false);
    expect(sources.has("customer_credit_obligations")).toBe(false);
    expect(sources.has("supplier_credit_obligations")).toBe(false);
  });

  it("rejects client requests for arbitrary SQL or unsupported tools", async () => {
    const tenant = await createTenant("query-tools@tradeos.test", "Query Tools");
    const calls: ProviderCall[] = [];
    globalThis.fetch = fakeProvider(calls, { answer: "should not run", evidenceIndexes: [], recommendations: [] });

    const response = await app.inject({
      method: "POST",
      url: "/v1/intelligence/query",
      headers: authHeaders(tenant.token),
      payload: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        question: "run this for me",
        tools: ["sql", "SELECT * FROM app_users"],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("BUSINESS_AI_TOOL_UNSUPPORTED");
    expect(calls).toHaveLength(0);
  });

  it("fails safely on malformed model output while deterministic briefing remains available", async () => {
    const tenant = await createTenant("query-malformed@tradeos.test", "Query Malformed");
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      id: "resp-malformed",
      output_text: JSON.stringify({ answer: "<script>alert(1)</script>", recommendations: "not-an-array" }),
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

    const query = await app.inject({
      method: "POST",
      url: "/v1/intelligence/query",
      headers: authHeaders(tenant.token),
      payload: {
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        question: "what should I know?",
      },
    });
    expect(query.statusCode).toBe(502);
    expect(["BUSINESS_AI_INVALID_OUTPUT", "AI_PROVIDER_INVALID_RESPONSE"]).toContain(query.json().error);

    const briefing = await app.inject({
      method: "GET",
      url: `/v1/intelligence/briefing?businessId=${tenant.businessId}&branchId=${tenant.branchId}&range=today`,
      headers: authHeaders(tenant.token),
    });
    expect(briefing.statusCode).toBe(200);
    expect(briefing.json().confidence.level).toBe("LOW");
    expect(briefing.json().headline).toContain("conservative");
  });
});

function fakeProvider(calls: ProviderCall[], structuredOutput: Record<string, unknown>): typeof fetch {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ body });
    return new Response(JSON.stringify({
      id: "resp-test",
      output_text: JSON.stringify(structuredOutput),
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req-test" },
    });
  }) as typeof fetch;
}

function providerEvidence(call: ProviderCall): Array<{ sourceType: string; sourceId?: string; label: string; value?: unknown }> {
  const input = call.body.input as Array<{ content?: Array<{ text?: string }> }> | undefined;
  const text = input?.[0]?.content?.[0]?.text ?? "";
  const marker = "Authoritative grounding evidence (JSON):\n";
  const index = text.indexOf(marker);
  expect(index).toBeGreaterThanOrEqual(0);
  return JSON.parse(text.slice(index + marker.length));
}

async function createTenant(email: string, name: string): Promise<Tenant> {
  const registration = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      displayName: name,
      email,
      password: "TradeOS-Test-1234",
      platform: "WEB",
      deviceKey: `device-${email}`,
      appVersion: "test",
    },
  });
  expect(registration.statusCode).toBe(201);
  const registrationBody = registration.json();
  const token = registrationBody.session.accessToken as string;
  const userId = registrationBody.user.id as string;

  const onboard = await app.inject({
    method: "POST",
    url: "/v1/onboarding/business",
    headers: authHeaders(token),
    payload: { name, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(onboard.statusCode).toBe(201);
  return {
    token,
    userId,
    businessId: onboard.json().business.id,
    branchId: onboard.json().branch.id,
  };
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}
