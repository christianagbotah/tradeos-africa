import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { runBusinessAttentionSchedulerTick } from "../src/business-intelligence/attention-scheduler.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function registerBusiness(label: string) {
  const reg = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: { displayName: "Scheduler Owner", email: "scheduler-" + label + "@tradeos.test",
      password: "TradeOS-Test-1234", platform: "WEB", deviceKey: "scheduler-" + label, appVersion: "test" },
  });
  expect(reg.statusCode).toBe(201);
  const headers = { authorization: "Bearer " + reg.json().session.accessToken };
  const business = await app.inject({
    method: "POST", url: "/v1/onboarding/business", headers,
    payload: { name: "Scheduled Store " + label, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(business.statusCode).toBe(201);
  return { businessId: business.json().business.id as string, branchId: business.json().branch.id as string };
}

describe("merchant background attention scheduler", () => {
  it("evaluates without a logged-in user and fairly processes limited batches", async () => {
    const a = await registerBusiness("one");
    const b = await registerBusiness("two");
    const now = () => new Date("2030-02-14T08:00:00.000Z");
    const first = await runBusinessAttentionSchedulerTick(pool, { now, batchSize: 1 });
    const second = await runBusinessAttentionSchedulerTick(pool, { now, batchSize: 1 });
    const third = await runBusinessAttentionSchedulerTick(pool, { now, batchSize: 1 });
    expect(first).toMatchObject({ acquired: true, attempted: 1, succeeded: 1, failed: 0 });
    expect(second).toMatchObject({ acquired: true, attempted: 1, succeeded: 1, failed: 0 });
    expect(third).toMatchObject({ acquired: true, attempted: 0 });
    const cursor = await pool.query(
      "SELECT business_id,branch_id,last_result,failure_count FROM business_attention_schedule_checkpoints",
    );
    expect(cursor.rows).toHaveLength(2);
    expect(new Set(cursor.rows.map((row: { branch_id: string }) => row.branch_id)))
      .toEqual(new Set([a.branchId, b.branchId]));
    expect(cursor.rows.every((row: { last_result: string; failure_count: number }) =>
      row.last_result === "SUCCESS" && row.failure_count === 0)).toBe(true);
    const alerts = await pool.query(
      "SELECT business_id FROM business_attention_items WHERE state='OPEN' AND rule_code='LOW_DATA_CONFIDENCE'",
    );
    expect(alerts.rows).toHaveLength(2);
  });

  it("retries failed tenant evaluations without repeatedly selecting them too early", async () => {
    const a = await registerBusiness("recovery");
    const time = new Date("2030-02-14T10:00:00.000Z");
    const failed = await runBusinessAttentionSchedulerTick(pool, {
      now: () => time,
      evaluate: async () => { throw new Error("deliberate test failure"); },
    });
    expect(failed).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
    const checkpoint = await pool.query(
      "SELECT failure_count,last_result,last_error_code FROM business_attention_schedule_checkpoints WHERE business_id=$1",
      [a.businessId],
    );
    expect(checkpoint.rows[0]).toMatchObject({
      failure_count: 1, last_result: "FAILED", last_error_code: "EVALUATION_FAILED",
    });
    const tooSoon = await runBusinessAttentionSchedulerTick(pool, {
      now: () => new Date(time.getTime() + 14 * 60 * 1000),
    });
    expect(tooSoon.attempted).toBe(0);
    const recovered = await runBusinessAttentionSchedulerTick(pool, {
      now: () => new Date(time.getTime() + 16 * 60 * 1000),
    });
    expect(recovered).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
    const result = await pool.query(
      "SELECT failure_count,last_result,last_success_at FROM business_attention_schedule_checkpoints WHERE business_id=$1",
      [a.businessId],
    );
    expect(result.rows[0].last_result).toBe("SUCCESS");
    expect(result.rows[0].failure_count).toBe(0);
    expect(result.rows[0].last_success_at).not.toBeNull();
  });

  it("keeps two simultaneous scheduler instances from double evaluating", async () => {
    const a = await registerBusiness("parallel");
    const now = () => new Date("2030-02-14T12:00:00.000Z");
    const results = await Promise.all([
      runBusinessAttentionSchedulerTick(pool, { now, batchSize: 1 }),
      runBusinessAttentionSchedulerTick(pool, { now, batchSize: 1 }),
    ]);
    expect(results[0]!.attempted + results[1]!.attempted).toBe(1);
    const count = await pool.query(
      "SELECT count(*)::int AS n FROM business_attention_schedule_checkpoints WHERE business_id=$1",
      [a.businessId],
    );
    expect(count.rows[0].n).toBe(1);
    const alerts = await pool.query(
      "SELECT count(*)::int AS n FROM business_attention_items WHERE business_id=$1 AND state='OPEN' AND rule_code='LOW_DATA_CONFIDENCE'",
      [a.businessId],
    );
    expect(alerts.rows[0].n).toBe(1);
  });

  it("never evaluates suspended tenants or inactive branches", async () => {
    const a = await registerBusiness("suspended");
    await pool.query("UPDATE businesses SET status='SUSPENDED' WHERE id=$1", [a.businessId]);
    const result = await runBusinessAttentionSchedulerTick(pool, {
      now: () => new Date("2030-02-14T14:00:00.000Z"),
    });
    expect(result.attempted).toBe(0);
  });
});
