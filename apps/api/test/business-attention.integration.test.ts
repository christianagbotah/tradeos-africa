import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { detectBusinessAttention } from "../src/business-intelligence/attention-service.js";
import type { CreditAgingReport, FinancialSummaryReport } from "@tradeos/contracts";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function createOwner(label: string) {
  const register = await app.inject({ method: "POST", url: "/v1/auth/register", payload: {
    displayName: "Attention Owner", email: `attention-${label}@tradeos.test`,
    password: "TradeOS-Test-1234", platform: "WEB", deviceKey: `attention-${label}`, appVersion: "test",
  } });
  expect(register.statusCode).toBe(201);
  const userId = register.json().user.id as string;
  const headers = { authorization: `Bearer ${register.json().session.accessToken}` };
  const onboard = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers,
    payload: { name: `Attention Business ${label}`, businessType: "RETAIL_HARDWARE", branchName: "Main" } });
  expect(onboard.statusCode).toBe(201);
  return { userId, headers, businessId: onboard.json().business.id as string,
    branchId: onboard.json().branch.id as string };
}
function url(businessId: string, branchId: string) {
  return `/v1/intelligence/attention?businessId=${businessId}&branchId=${branchId}`;
}

describe("business attention", () => {
  it("writes one current low-data alert and keeps stable idempotent IDs", async () => {
    const a = await createOwner("one");
    const endpoint = `/v1/intelligence/attention/evaluate?businessId=${a.businessId}&branchId=${a.branchId}`;
    const once = await app.inject({ method: "POST", url: endpoint, headers: a.headers });
    expect(once.statusCode).toBe(200);
    expect(once.json()).toMatchObject({ businessId: a.businessId, branchId: a.branchId, evaluated: true });
    const original = once.json().items.find((x: { ruleCode: string }) => x.ruleCode === "LOW_DATA_CONFIDENCE");
    expect(original).toBeTruthy();
    expect(original.evidence[0]).toMatchObject({ key: "salesCount", value: 0 });
    const twice = await app.inject({ method: "POST", url: endpoint, headers: a.headers });
    expect(twice.statusCode).toBe(200);
    expect(twice.json().items.find((x: { ruleCode: string }) => x.ruleCode === "LOW_DATA_CONFIDENCE").id).toBe(original.id);
    const read = await app.inject({ method: "GET", url: url(a.businessId, a.branchId), headers: a.headers });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ evaluated: false });
    expect(read.json().items[0].id).toBe(original.id);
    expect((await pool.query("SELECT count(*)::int AS n FROM business_attention_items WHERE business_id=$1 AND state='OPEN'", [a.businessId])).rows[0].n).toBe(1);
  });

  it("blocks cross-tenant, foreign branch and cashier roles", async () => {
    const a = await createOwner("a");
    const b = await createOwner("b");
    const other = `/v1/intelligence/attention/evaluate?businessId=${b.businessId}&branchId=${b.branchId}`;
    expect((await app.inject({ method: "POST", url: other, headers: a.headers })).statusCode).toBe(403);
    const foreignBranch = `/v1/intelligence/attention/evaluate?businessId=${a.businessId}&branchId=${b.branchId}`;
    expect((await app.inject({ method: "POST", url: foreignBranch, headers: a.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: url(a.businessId, a.branchId) })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: url(b.businessId, b.branchId), headers: a.headers })).statusCode).toBe(403);
    await pool.query("UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1", [a.businessId]);
    expect((await app.inject({ method: "POST", url: `/v1/intelligence/attention/evaluate?businessId=${a.businessId}`, headers: a.headers })).statusCode).toBe(403);
    await pool.query("UPDATE business_memberships SET role='OWNER' WHERE business_id=$1", [a.businessId]);
    await pool.query("UPDATE businesses SET status='SUSPENDED' WHERE id=$1", [a.businessId]);
    expect((await app.inject({ method: "GET", url: url(a.businessId, a.branchId), headers: a.headers })).statusCode).toBe(403);
  });

  it("enforces business/branch ownership and open-source uniqueness in SQL", async () => {
    const a = await createOwner("db-a");
    const b = await createOwner("db-b");
    const valid = [a.businessId, a.branchId, "test"];
    const insert = `INSERT INTO business_attention_items (business_id,branch_id,source_key,rule_code,severity,title,summary)
      VALUES ($1,$2,$3,'LOW_DATA_CONFIDENCE','INFO','T','S') RETURNING id`;
    await expect(pool.query(insert, [a.businessId, b.branchId, "foreign"])).rejects.toMatchObject({ code: "23503" });
    const first = await pool.query(insert, valid);
    await expect(pool.query(insert, valid)).rejects.toMatchObject({ code: "23505" });
    await pool.query("UPDATE business_attention_items SET state='RESOLVED' WHERE id=$1", [first.rows[0].id]);
    await expect(pool.query(insert, valid)).resolves.toHaveProperty("rowCount", 1);
    const policy = `INSERT INTO business_automation_policies
      (business_id,branch_id,code,name,trigger_type,action_type,execution_class,created_by_user_id,updated_by_user_id)
      VALUES($1,$2,'p1','Test Policy','MANUAL','CREATE_ACTION_ITEM',$3,$4,$4)`;
    await expect(pool.query(policy, [a.businessId, a.branchId, 3, a.userId])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(policy, [a.businessId, b.branchId, 1, a.userId])).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query(policy, [a.businessId, a.branchId, 1, a.userId])).resolves.toHaveProperty("rowCount", 1);
  });

  it("keeps overdue debt factual even when trading history is insufficient", () => {
    const side = {
      totalOpenMinor: 3000, notDueMinor: 0, dueWithin7DaysMinor: 0, dueWithin30DaysMinor: 0,
      overdue1To30DaysMinor: 3000, overdue31To60DaysMinor: 0, overdue61To90DaysMinor: 0,
      overdueOver90DaysMinor: 0, obligationCount: 1, oldestDueAt: new Date().toISOString(),
    };
    const report = { businessId: "b", branchId: null, health: { status: "INSUFFICIENT_DATA", insights: [] },
      flow: { salesCount: 0 } } as unknown as FinancialSummaryReport;
    const aging = { businessId: "b", branchId: null, receivables: side,
      payables: { ...side, totalOpenMinor: 0, overdue1To30DaysMinor: 0 } } as unknown as CreditAgingReport;
    const signals = detectBusinessAttention(report, aging);
    expect(signals.map((x) => x.ruleCode)).toEqual(["LOW_DATA_CONFIDENCE", "RECEIVABLES_OVERDUE"]);
    expect(signals[1].evidence).toContainEqual({ key: "overdueReceivablesMinor",
      label: "Overdue customer balances", value: 3000, unit: "MINOR" });
    expect(() => detectBusinessAttention(report, { ...aging, businessId: "other" })).toThrow(/scope/);
  });
});
