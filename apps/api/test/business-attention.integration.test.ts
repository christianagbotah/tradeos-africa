import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

type Tenant = { token: string; userId: string; businessId: string; branchId: string };

describe("deterministic business attention", () => {
  it("creates evidence-backed low-data attention once and updates it on reevaluation", async () => {
    const tenant = await createTenant("attention-owner@tradeos.test", "Attention Shop");
    const headers = authHeaders(tenant.token);

    const first = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "manual:first" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        businessId: tenant.businessId,
        branchId: tenant.branchId,
        ruleCode: "LOW_DATA_CONFIDENCE",
        state: "OPEN",
      }),
    ]));

    const lowData = first.json().items.find((item: { ruleCode: string }) => item.ruleCode === "LOW_DATA_CONFIDENCE");
    expect(lowData.sourceKey).toBe(`low-data:${tenant.branchId}`);
    expect(lowData.evidence.length).toBeGreaterThan(0);

    const second = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "manual:second" },
    });
    expect(second.statusCode).toBe(200);
    const lowDataAgain = second.json().items.find((item: { ruleCode: string }) => item.ruleCode === "LOW_DATA_CONFIDENCE");
    expect(lowDataAgain.id).toBe(lowData.id);

    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM business_attention_items
       WHERE business_id=$1 AND branch_id=$2 AND rule_code='LOW_DATA_CONFIDENCE' AND state='OPEN'`,
      [tenant.businessId, tenant.branchId],
    );
    expect(count.rows[0]?.count).toBe("1");

    const listed = await app.inject({
      method: "GET",
      url: `/v1/intelligence/attention?businessId=${tenant.businessId}&branchId=${tenant.branchId}`,
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.some((item: { id: string }) => item.id === lowData.id)).toBe(true);
  });

  it("rejects forged tenant scopes before returning or evaluating attention", async () => {
    const tenantA = await createTenant("attention-a@tradeos.test", "Tenant A");
    const tenantB = await createTenant("attention-b@tradeos.test", "Tenant B");
    const headersA = authHeaders(tenantA.token);

    const readOther = await app.inject({
      method: "GET",
      url: `/v1/intelligence/attention?businessId=${tenantB.businessId}&branchId=${tenantB.branchId}`,
      headers: headersA,
    });
    expect(readOther.statusCode).toBe(403);
    expect(readOther.json().error).toBe("BUSINESS_ACCESS_DENIED");

    const evaluateOther = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers: headersA,
      payload: { businessId: tenantB.businessId, branchId: tenantB.branchId, correlationId: "forged" },
    });
    expect(evaluateOther.statusCode).toBe(403);
    expect(evaluateOther.json().error).toBe("BUSINESS_ACCESS_DENIED");
  });

  it("allows operational attention reads for STAFF but hides financial rules and blocks manual evaluation", async () => {
    const tenant = await createTenant("attention-staff@tradeos.test", "Staff Shop");
    const headers = authHeaders(tenant.token);

    await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "owner-seed" },
    });

    await pool.query(
      `INSERT INTO business_attention_items(
         business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
       ) VALUES
         ($1,$2,'receivables:overdue','RECEIVABLES_OVERDUE','HIGH','OPEN','Overdue receivables','Customers owe overdue balances','[]'),
         ($1,$2,'stockout:item-demo','STOCKOUT_RISK','HIGH','OPEN','Stockout risk','Demo stock risk','[]')`,
      [tenant.businessId, tenant.branchId],
    );

    await pool.query(
      `UPDATE business_memberships
       SET role='STAFF'
       WHERE business_id=$1 AND user_id=$2 AND status='ACTIVE'`,
      [tenant.businessId, tenant.userId],
    );

    const list = await app.inject({
      method: "GET",
      url: `/v1/intelligence/attention?businessId=${tenant.businessId}&branchId=${tenant.branchId}`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    const ruleCodes = list.json().items.map((item: { ruleCode: string }) => item.ruleCode);
    expect(ruleCodes).toContain("STOCKOUT_RISK");
    expect(ruleCodes).toContain("LOW_DATA_CONFIDENCE");
    expect(ruleCodes).not.toContain("RECEIVABLES_OVERDUE");
    expect(ruleCodes).not.toContain("PAYABLES_OVERDUE");
    expect(ruleCodes).not.toContain("CASH_PRESSURE_FORECAST");
    expect(ruleCodes).not.toContain("MARGIN_PRESSURE");

    const evaluate = await app.inject({
      method: "POST",
      url: "/v1/intelligence/attention/evaluate",
      headers,
      payload: { businessId: tenant.businessId, branchId: tenant.branchId, correlationId: "staff-forbidden" },
    });
    expect(evaluate.statusCode).toBe(403);
    expect(evaluate.json().error).toBe("ROLE_FORBIDDEN");
  });
});

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
  const body = registration.json();
  const token = body.session.accessToken as string;
  const userId = body.user.id as string;

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
