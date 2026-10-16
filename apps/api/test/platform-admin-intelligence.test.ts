import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/auth/security.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
const PASSWORD = "admin-password-123";
const SERVICE_MODULE = "../src/platform-admin/intelligence-service.js";
const PROVIDER_MODULE = "../src/ai/provider.js";

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

describe("grounded platform intelligence", () => {
  it("supplies only allow-listed structured facts and preserves evidence provenance", async () => {
    const { createPlatformAdminIntelligenceService } = await import(SERVICE_MODULE) as IntelligenceModule;
    const actor = await seedActor("grounded-ai@tradeos.test", "SUPER_ADMIN");
    await seedBusiness("Grounded tenant");
    await seedAttention("grounded-attention", "SUBSCRIPTION_PAST_DUE", "HIGH");

    const provider = new FakeProvider({
      answer: "One tenant needs billing attention.",
      recommendations: [],
    });
    const service = createPlatformAdminIntelligenceService({ pool, provider });
    const result = await service.query(actor, {
      question: "What needs attention?",
      tools: ["platform_metrics", "attention_items"],
      correlationId: "grounded-query-1",
    });

    expect(result.answer).toContain("billing attention");
    expect(provider.calls).toHaveLength(1);
    const request = provider.calls[0]!;
    expect(request.evidence.length).toBeGreaterThan(0);
    expect(new Set(request.evidence.map((item) => item.sourceType))).toEqual(
      new Set(["PLATFORM_METRICS", "ATTENTION_ITEM"]),
    );
    expect(request.evidence.every((item) => item.sourceId || item.label)).toBe(true);
    expect(JSON.stringify(request)).not.toContain("password_hash");
    expect(JSON.stringify(request)).not.toContain("session_token_hash");
    expect(result.evidence).toEqual(request.evidence);
  });

  it("rejects unsupported tools before invoking the provider", async () => {
    const { createPlatformAdminIntelligenceService } = await import(SERVICE_MODULE) as IntelligenceModule;
    const actor = await seedActor("tool-guard@tradeos.test", "SUPER_ADMIN");
    const provider = new FakeProvider({ answer: "should not run", recommendations: [] });
    const service = createPlatformAdminIntelligenceService({ pool, provider });

    await expect(service.query(actor, {
      question: "Run arbitrary SQL",
      tools: ["arbitrary_sql"],
      correlationId: "unsupported-tool",
    })).rejects.toMatchObject({ code: "ADMIN_AI_TOOL_NOT_ALLOWED", statusCode: 400 });
    expect(provider.calls).toHaveLength(0);
  });

  it("rejects malformed structured model output and creates no automation action", async () => {
    const { createPlatformAdminIntelligenceService } = await import(SERVICE_MODULE) as IntelligenceModule;
    const actor = await seedActor("schema-guard@tradeos.test", "SUPER_ADMIN");
    const provider = new FakeProvider({ answer: 42, recommendations: [{ proposedAction: { type: "TENANT_STATUS_CHANGE" } }] });
    const service = createPlatformAdminIntelligenceService({ pool, provider });

    await expect(service.query(actor, {
      question: "Suspend risky tenants",
      tools: ["platform_metrics"],
      correlationId: "malformed-output",
    })).rejects.toMatchObject({ code: "ADMIN_AI_INVALID_OUTPUT", statusCode: 502 });

    const runs = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM platform_automation_runs");
    expect(Number(runs.rows[0]!.count)).toBe(0);
  });

  it("surfaces provider unavailability without breaking deterministic attention", async () => {
    const { createPlatformAdminIntelligenceService } = await import(SERVICE_MODULE) as IntelligenceModule;
    const { AiProviderError } = await import(PROVIDER_MODULE) as ProviderModule;
    const { cookie, actor } = await seedActorWithCookie("ai-unavailable@tradeos.test", "SUPER_ADMIN");
    await seedAttention("deterministic-still-works", "DEVICE_STALE", "MEDIUM");
    const provider = {
      async generate() { throw new AiProviderError("AI provider is unavailable", 503, "AI_UNAVAILABLE"); },
    };
    const service = createPlatformAdminIntelligenceService({ pool, provider });

    await expect(service.briefing(actor, { correlationId: "provider-down" }))
      .rejects.toMatchObject({ code: "AI_UNAVAILABLE", statusCode: 503 });

    const attention = await app.inject({ method: "GET", url: "/api/admin/attention", headers: { cookie } });
    expect(attention.statusCode, attention.body).toBe(200);
    expect(attention.json<{ items: Array<{ sourceKey: string }> }>().items.map((item) => item.sourceKey))
      .toContain("deterministic-still-works");
  });
});

class FakeProvider {
  readonly calls: Array<{ prompt: string; evidence: Array<{ sourceType: string; sourceId?: string; label: string; value?: unknown }>; correlationId?: string }> = [];
  constructor(private readonly output: unknown) {}
  async generate(input: { prompt: string; evidence: Array<{ sourceType: string; sourceId?: string; label: string; value?: unknown }>; correlationId?: string }) {
    this.calls.push(input);
    return { text: "", structuredOutput: this.output, providerMetadata: { requestId: "fake-request" } };
  }
}

type IntelligenceModule = {
  createPlatformAdminIntelligenceService(args: { pool: typeof pool; provider: { generate(input: unknown): Promise<unknown> } }): {
    query(actor: Record<string, unknown>, input: { question: string; tools: string[]; correlationId: string }): Promise<{ answer: string; evidence: unknown[] }>;
    briefing(actor: Record<string, unknown>, input: { correlationId: string }): Promise<unknown>;
  };
};
type ProviderModule = { AiProviderError: new(message: string, statusCode: number, code: string) => Error & { statusCode: number; code: string } };

async function seedActor(email: string, role: string): Promise<Record<string, unknown>> {
  return (await seedActorWithCookie(email, role)).actor;
}

async function seedActorWithCookie(email: string, role: string): Promise<{ cookie: string; actor: Record<string, unknown> }> {
  const passwordHash = await hashPassword(PASSWORD);
  const user = await pool.query<{ id: string }>(
    `INSERT INTO platform_users(email,display_name,role,is_active,password_hash,password_changed_at)
     VALUES($1,$2,$3,true,$4,now()) RETURNING id`,
    [email, `${role} AI Operator`, role, passwordHash],
  );
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/session/login",
    payload: { identifier: email, password: PASSWORD, platform: "WEB", deviceKey: `${email}-device` },
  });
  expect(login.statusCode, login.body).toBe(200);
  const cookie = adminCookie(login.headers);
  return {
    cookie,
    actor: {
      id: user.rows[0]!.id,
      email,
      displayName: `${role} AI Operator`,
      role,
      isActive: true,
      lastLoginAt: new Date().toISOString(),
      sessionId: "test-session",
      deviceKey: `${email}-device`,
      platform: "WEB",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      idleExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

async function seedBusiness(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES($1,'RETAIL','GH','GHS','Africa/Accra','ACTIVE') RETURNING id`,
    [name],
  );
  return result.rows[0]!.id;
}

async function seedAttention(sourceKey: string, ruleCode: string, severity: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO platform_attention_items(source_key,rule_code,severity,state,title,summary,evidence,first_seen_at,last_seen_at)
     VALUES($1,$2,$3,'OPEN','Attention item','Evidence-backed issue','[]'::jsonb,now(),now()) RETURNING id`,
    [sourceKey, ruleCode, severity],
  );
  return result.rows[0]!.id;
}

function adminCookie(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["set-cookie"];
  const serialized = Array.isArray(raw) ? raw[0] : raw;
  expect(serialized).toBeTruthy();
  return serialized!.split(";", 1)[0]!;
}
