import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);

beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function owner(tag: string) {
  const r = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: { displayName: "Action Owner", email: `action-owner-${tag}@tradeos.test`,
      password: "TradeOS-Test-1234", platform: "WEB", deviceKey: `action-${tag}`, appVersion: "test" },
  });
  expect(r.statusCode).toBe(201);
  const headers = { authorization: `Bearer ${r.json().session.accessToken}` };
  const o = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers,
    payload: { name: `Action Shop ${tag}`, businessType: "RETAIL_HARDWARE", branchName: "Main" } });
  expect(o.statusCode).toBe(201);
  return { userId: r.json().user.id as string, headers,
    businessId: o.json().business.id as string, branchId: o.json().branch.id as string };
}
function params(b: { businessId: string; branchId: string }) {
  return `?businessId=${b.businessId}&branchId=${b.branchId}`;
}
async function addAlert(b: { businessId: string; branchId: string }, severity = "HIGH") {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO business_attention_items
      (business_id,branch_id,source_key,rule_code,severity,title,summary,evidence)
      VALUES($1,$2,$3,'RECEIVABLES_OVERDUE',$4,'Customer debts','Customers are overdue.','[]'::jsonb)
      RETURNING id`,
    [b.businessId,b.branchId,`debt-alert-${Math.random()}`,severity],
  );
  return a.rows[0]!.id;
}

describe("Business action queue", () => {
  it("converts active alerts into idempotent follow-up tasks and audits creation", async () => {
    const b = await owner("create");
    const activeId = await addAlert(b);
    const informationalId = await addAlert(b, "INFO");
    expect(informationalId).toBeTruthy();

    const url = `/v1/intelligence/actions/generate${params(b)}`;
    const first = await app.inject({ method: "POST", url, headers: b.headers });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ createdCount: 1, businessId: b.businessId, branchId: b.branchId });
    expect(first.json().items).toHaveLength(1);
    const action = first.json().items[0];
    expect(action).toMatchObject({ state: "OPEN", sourceAttentionId: activeId, assignedUserId: null });
    const replay = await app.inject({ method: "POST", url, headers: b.headers });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ createdCount: 0 });
    expect(replay.json().items).toHaveLength(1);
    const events = await pool.query(
      `SELECT event_type,from_state,to_state,actor_user_id FROM business_action_events
        WHERE business_id=$1 AND action_id=$2`,
      [b.businessId, action.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      event_type: "CREATED", from_state: null, to_state: "OPEN", actor_user_id: b.userId,
    });
  });

  it("serializes concurrent retries without duplicate tasks", async () => {
    const b = await owner("races");
    await addAlert(b);
    const url = `/v1/intelligence/actions/generate${params(b)}`;
    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url, headers: b.headers }),
      app.inject({ method: "POST", url, headers: b.headers }),
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(first.json().createdCount + second.json().createdCount).toBe(1);
    const items = await pool.query(
      `SELECT id FROM business_action_items WHERE business_id=$1`, [b.businessId],
    );
    expect(items.rows).toHaveLength(1);
    const events = await pool.query(
      `SELECT id FROM business_action_events WHERE business_id=$1`, [b.businessId],
    );
    expect(events.rows).toHaveLength(1);
  });

  it("uses optimistic state transitions with a single auditable event per change", async () => {
    const b = await owner("transition");
    await addAlert(b);
    const gen = await app.inject({
      method: "POST", url: `/v1/intelligence/actions/generate${params(b)}`, headers: b.headers,
    });
    const taskId = gen.json().items[0].id as string;
    const path = `/v1/intelligence/actions/${taskId}${params(b)}`;
    const done = await app.inject({ method: "PATCH", url: path, headers: b.headers,
      payload: { state: "DONE", expectedState: "OPEN" } });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ state: "DONE" });
    expect(done.json().completedAt).not.toBeNull();

    const stale = await app.inject({ method: "PATCH", url: path, headers: b.headers,
      payload: { state: "SNOOZED", expectedState: "OPEN" } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("BUSINESS_ACTION_STALE");

    const duplicate = await app.inject({ method: "PATCH", url: path, headers: b.headers,
      payload: { state: "DONE", expectedState: "DONE" } });
    expect(duplicate.statusCode).toBe(200);

    const reopen = await app.inject({ method: "PATCH", url: path, headers: b.headers,
      payload: { state: "OPEN", expectedState: "DONE" } });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().completedAt).toBeNull();
    const audit = await pool.query(
      `SELECT event_type,from_state,to_state FROM business_action_events
        WHERE business_id=$1 AND action_id=$2 ORDER BY occurred_at,id`,
      [b.businessId, taskId],
    );
    expect(audit.rows).toHaveLength(3);
    expect(audit.rows.map((row: { event_type: string }) => row.event_type)).toEqual([
      "CREATED", "STATE_CHANGED", "STATE_CHANGED",
    ]);
    expect(audit.rows.map((row: { to_state: string }) => row.to_state)).toEqual([
      "OPEN", "DONE", "OPEN",
    ]);
  });

  it("blocks foreign tenants, branches, suspended businesses and unauthorized roles", async () => {
    const a = await owner("scope-a");
    const b = await owner("scope-b");
    await addAlert(a);
    await app.inject({ method: "POST",
      url: `/v1/intelligence/actions/generate${params(a)}`, headers: a.headers });
    const readA = await app.inject({ method: "GET", url: `/v1/intelligence/actions${params(a)}`, headers: a.headers });
    expect(readA.statusCode).toBe(200);
    const actionId = readA.json().items[0].id as string;

    expect((await app.inject({ method: "GET", url: `/v1/intelligence/actions${params(a)}` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/v1/intelligence/actions${params(a)}`, headers: b.headers })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET",
      url: `/v1/intelligence/actions?businessId=${a.businessId}&branchId=${b.branchId}`, headers: a.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH",
      url: `/v1/intelligence/actions/${actionId}${params(b)}`, headers: b.headers,
      payload: { state: "DONE", expectedState: "OPEN" } })).statusCode).toBe(404);
    await pool.query("UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1", [a.businessId]);
    expect((await app.inject({ method: "POST", url: `/v1/intelligence/actions/generate${params(a)}`, headers: a.headers })).statusCode).toBe(403);
    await pool.query("UPDATE business_memberships SET role='OWNER' WHERE business_id=$1", [a.businessId]);
    await pool.query("UPDATE businesses SET status='SUSPENDED' WHERE id=$1", [a.businessId]);
    expect((await app.inject({ method: "GET", url: `/v1/intelligence/actions${params(a)}`, headers: a.headers })).statusCode).toBe(403);
  });

  it("rejects cross-business action audit links at the database layer", async () => {
    const a = await owner("fk-a");
    const b = await owner("fk-b");
    await addAlert(a);
    const gen = await app.inject({ method: "POST", url: `/v1/intelligence/actions/generate${params(a)}`, headers: a.headers });
    const id = gen.json().items[0].id as string;
    await expect(pool.query(
      `INSERT INTO business_action_events
        (business_id,action_id,actor_user_id,event_type,to_state)
        VALUES($1,$2,$3,'CREATED','OPEN')`,
      [b.businessId,id,b.userId],
    )).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query(
      `INSERT INTO business_action_events
        (business_id,action_id,actor_user_id,event_type,from_state,to_state)
        VALUES($1,$2,$3,'STATE_CHANGED','OPEN','OPEN')`,
      [a.businessId,id,a.userId],
    )).rejects.toMatchObject({ code: "23514" });
  });
});
