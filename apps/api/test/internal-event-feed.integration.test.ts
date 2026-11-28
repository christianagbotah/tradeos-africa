import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import {
  deliverInternalEventFeedBatch,
  deliverDueInternalEventFeedBatch,
  listBusinessEventFeed,
  startInternalEventFeedWorker,
} from "../src/commerce/internal-event-feed.js";

process.env.DATABASE_URL ??=
  "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => {
  await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");
});
afterAll(async () => { await app.close(); await pool.end(); });

async function merchant(tag: string) {
  const register = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: {
      displayName: "Outbox Owner", email: "outbox-" + tag + "@tradeos.test",
      password: "TradeOS-Test-1234", platform: "WEB", deviceKey: tag, appVersion: "ci",
    },
  });
  expect(register.statusCode).toBe(201);
  const headers = { authorization: "Bearer " + register.json().session.accessToken };
  const setup = await app.inject({
    method: "POST", url: "/v1/onboarding/business", headers,
    payload: { name: "Event Feed Test " + tag, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(setup.statusCode).toBe(201);
  return {
    headers,
    businessId: setup.json().business.id as string,
    branchId: setup.json().branch.id as string,
  };
}
type Merchant = Awaited<ReturnType<typeof merchant>>;

async function insertEvent(
  b: Merchant,
  options: { branchId?: string; eventType?: string } = {},
): Promise<string> {
  const row = await pool.query<{ id: string }>(
    "INSERT INTO outbox_events (business_id,branch_id,aggregate_type,aggregate_id,event_type,payload) " +
    "VALUES($1,$2,'SALE',gen_random_uuid(),$3,'{}'::jsonb) RETURNING id",
    [b.businessId, options.branchId ?? b.branchId, options.eventType ?? "SALE_COMPLETED"],
  );
  return row.rows[0]!.id;
}
const url = (b: Merchant) => "/v1/intelligence/activity-feed?businessId=" +
  b.businessId + "&branchId=" + b.branchId;

describe("durable internal outbox delivery with real PostgreSQL transaction", () => {
  it("is opt-in, preserves existing events, then delivers and acknowledges atomically", async () => {
    const a = await merchant("capture-a");
    const id = await insertEvent(a);
    const worker = startInternalEventFeedWorker(pool, { enabled: false });
    worker.stop();
    const before = await pool.query(
      "SELECT published_at FROM outbox_events WHERE id=$1", [id],
    );
    expect(before.rows[0].published_at).toBeNull();
    expect((await listBusinessEventFeed(pool,a.businessId,a.branchId)).items).toHaveLength(0);

    const tick = await deliverInternalEventFeedBatch(pool);
    expect(tick).toEqual({
      selected:1, acknowledged:1, destination:"INTERNAL_BUSINESS_EVENT_FEED",
    });
    const read = await app.inject({ method:"GET",url:url(a),headers:a.headers });
    expect(read.statusCode).toBe(200);
    expect(read.headers["cache-control"]).toContain("no-store");
    expect(read.json()).toMatchObject({
      businessId:a.businessId,branchId:a.branchId,
      items:[{id,eventType:"SALE_COMPLETED",aggregateType:"SALE"}],
    });
    expect(read.json().items[0]).not.toHaveProperty("payload");
    expect(read.json().items[0]).not.toHaveProperty("providerReference");
    expect((await pool.query(
      "SELECT published_at IS NOT NULL AS done FROM outbox_events WHERE id=$1",[id],
    )).rows[0].done).toBe(true);
    const again = await deliverInternalEventFeedBatch(pool);
    expect(again.selected).toBe(0);
  });

  it("preserves branch and tenant isolation even with a valid bearer token", async () => {
    const a=await merchant("isolated-a");
    const b=await merchant("isolated-b");
    const ea=await insertEvent(a);
    const eb=await insertEvent(b);
    expect((await deliverInternalEventFeedBatch(pool)).acknowledged).toBe(2);
    const readA=await app.inject({method:"GET",url:url(a),headers:a.headers});
    expect(readA.json().items.map((x:{id:string})=>x.id)).toEqual([ea]);
    const readB=await app.inject({method:"GET",url:url(b),headers:b.headers});
    expect(readB.json().items.map((x:{id:string})=>x.id)).toEqual([eb]);
    expect((await app.inject({method:"GET",url:url(a)})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:url(a),headers:b.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:url(a).replace(
      a.branchId,b.branchId),headers:a.headers})).statusCode).toBe(404);
    await pool.query("UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1",[a.businessId]);
    expect((await app.inject({method:"GET",url:url(a),headers:a.headers})).statusCode).toBe(403);
  });

  it("is idempotent on replay with an already recorded identical feed event", async () => {
    const a=await merchant("replay");
    const id=await insertEvent(a);
    await deliverInternalEventFeedBatch(pool);
    // A simulated crash/replay boundary in an isolated CI database.
    await pool.query("UPDATE outbox_events SET published_at=NULL WHERE id=$1",[id]);
    const replay=await deliverInternalEventFeedBatch(pool);
    expect(replay.acknowledged).toBe(1);
    expect((await pool.query(
      "SELECT COUNT(*)::int AS n FROM business_event_feed WHERE outbox_event_id=$1",[id],
    )).rows[0].n).toBe(1);
  });

  it("rolls back both feed insert and ack on invalid source tenant/branch", async () => {
    const a=await merchant("rollback-a");
    const b=await merchant("rollback-b");
    const valid=await insertEvent(a);
    const forged=await insertEvent(a,{branchId:b.branchId});
    await expect(deliverInternalEventFeedBatch(pool)).rejects.toBeDefined();
    const unchanged=await pool.query<{
      id:string;published_at:Date|null;
    }>(
      "SELECT id,published_at FROM outbox_events WHERE id=ANY($1::uuid[]) ORDER BY id",
      [[valid,forged]],
    );
    expect(unchanged.rows).toHaveLength(2);
    expect(unchanged.rows.every(r=>r.published_at===null)).toBe(true);
    expect((await pool.query(
      "SELECT COUNT(*)::int AS n FROM business_event_feed",
    )).rows[0].n).toBe(0);
  });

  it("isolates a failed event, retries durably, and exposes scoped review counts",async()=>{
    const a=await merchant("retry-a"),b=await merchant("retry-b");
    const bad=await insertEvent(a),good=await insertEvent(a),foreign=await insertEvent(b);
    await pool.query(`CREATE FUNCTION qa_feed_ack_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.published_at IS NOT NULL AND NEW.event_type='QA_FAIL_DELIVERY' THEN
      RAISE EXCEPTION 'Synthetic feed acknowledgement failure'; END IF; RETURN NEW; END $$`);
    try{
      await pool.query("UPDATE outbox_events SET event_type='QA_FAIL_DELIVERY' WHERE id=$1",[bad]);
      await pool.query("CREATE TRIGGER qa_feed_ack_failure BEFORE UPDATE ON outbox_events FOR EACH ROW EXECUTE FUNCTION qa_feed_ack_failure()");
      const first=await deliverDueInternalEventFeedBatch(pool);
      expect(first).toMatchObject({selected:3,acknowledged:2,retrying:1,reviewRequired:0});
      expect((await pool.query("SELECT published_at FROM outbox_events WHERE id=$1",[bad])).rows[0].published_at).toBeNull();
      expect((await pool.query("SELECT count(*)::int AS n FROM business_event_feed WHERE outbox_event_id=$1",[bad])).rows[0].n).toBe(0);
      expect((await pool.query("SELECT count(*)::int AS n FROM business_event_feed WHERE outbox_event_id=ANY($1::uuid[])",[[good,foreign]])).rows[0].n).toBe(2);
      const deferred=await deliverDueInternalEventFeedBatch(pool);
      expect(deferred.selected).toBe(0);
      const statusUrl=(merchant:Merchant)=>url(merchant).replace("activity-feed?","activity-feed/status?");
      const status=await app.inject({method:"GET",url:statusUrl(a),headers:a.headers});
      expect(status.json()).toMatchObject({pending:1,retrying:1,reviewRequired:0});
      expect((await app.inject({method:"GET",url:statusUrl(b),headers:b.headers})).json()).toMatchObject({pending:0,retrying:0,reviewRequired:0});
      expect((await app.inject({method:"GET",url:statusUrl(a),headers:b.headers})).statusCode).toBe(403);
      // Accelerate only the synthetic CI retry clock.
      await pool.query("UPDATE internal_event_feed_attempts SET attempt_count=7,next_retry_at=now()-interval '1 second' WHERE outbox_event_id=$1",[bad]);
      expect(await deliverDueInternalEventFeedBatch(pool)).toMatchObject({selected:1,acknowledged:0,retrying:0,reviewRequired:1});
      expect((await app.inject({method:"GET",url:statusUrl(a),headers:a.headers})).json()).toMatchObject({pending:1,retrying:0,reviewRequired:1});
      expect((await deliverDueInternalEventFeedBatch(pool)).selected).toBe(0);
      expect((await pool.query("SELECT published_at FROM outbox_events WHERE id=$1",[bad])).rows[0].published_at).toBeNull();
    }finally{
      await pool.query("DROP TRIGGER IF EXISTS qa_feed_ack_failure ON outbox_events");
      await pool.query("DROP FUNCTION IF EXISTS qa_feed_ack_failure()");
    }
  });

  it("delivers concurrently without duplicate receipts",async()=>{
    const a=await merchant("retry-concurrent");
    await insertEvent(a);
    const results=await Promise.all([deliverDueInternalEventFeedBatch(pool),deliverDueInternalEventFeedBatch(pool)]);
    expect(results.reduce((n,x)=>n+x.acknowledged,0)).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM business_event_feed WHERE business_id=$1",[a.businessId])).rows[0].n).toBe(1);
  });

  it("is append-only and rejects fabricated/mismatched delivery receipts",async()=>{
    const a=await merchant("guard");
    const id=await insertEvent(a);
    await expect(pool.query(
      "INSERT INTO business_event_feed(" +
      "outbox_event_id,business_id,branch_id,aggregate_type,aggregate_id,event_type,occurred_at) " +
      "SELECT id,business_id,branch_id,aggregate_type,aggregate_id,'WRONG',occurred_at " +
      "FROM outbox_events WHERE id=$1",[id],
    )).rejects.toBeDefined();
    await deliverInternalEventFeedBatch(pool);
    await expect(pool.query(
      "DELETE FROM business_event_feed WHERE outbox_event_id=$1",[id],
    )).rejects.toBeDefined();
    await expect(pool.query(
      "UPDATE business_event_feed SET event_type='CHANGED' WHERE outbox_event_id=$1",[id],
    )).rejects.toBeDefined();
  });
});
