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

async function onboard(label: string) {
  const register = await app.inject({ method: "POST", url: "/v1/auth/register",
    payload: { displayName: "Approval Owner", email: "automation-" + label + "@tradeos.test",
      password: "TradeOS-Test-1234", platform: "WEB", deviceKey: "automation-" + label, appVersion: "test" },
  });
  expect(register.statusCode).toBe(201);
  const headers = { authorization: "Bearer " + register.json().session.accessToken };
  const setup = await app.inject({ method: "POST", url: "/v1/onboarding/business", headers,
    payload: { name: "Automation Merchant " + label, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(setup.statusCode).toBe(201);
  return { headers, businessId: setup.json().business.id as string,
    branchId: setup.json().branch.id as string,
    userId: register.json().user.id as string };
}
type Owner = Awaited<ReturnType<typeof onboard>>;
function qs(owner: Owner) {
  return "?businessId=" + owner.businessId + "&branchId=" + owner.branchId;
}
function url(owner: Owner) { return "/v1/intelligence/automation" + qs(owner); }
async function configure(owner: Owner, enabled: boolean, minSeverity: "MEDIUM" | "HIGH" | "CRITICAL" = "HIGH",
  expectedVersion: number | null = null) {
  return app.inject({ method: "PUT", url: "/v1/intelligence/automation/config" + qs(owner),
    headers: owner.headers, payload: { enabled, minSeverity, expectedVersion } });
}
async function addAlert(owner: Owner, severity: string = "HIGH") {
  const rows = await pool.query<{ id: string }>(
    "INSERT INTO business_attention_items " +
    "(business_id,branch_id,source_key,rule_code,severity,title,summary) " +
    "VALUES($1,$2,$3,'RECEIVABLES_OVERDUE',$4,'Overdue customer balances','Review customer payment dates') RETURNING id",
    [owner.businessId,owner.branchId,"automation-test-" + Math.random(),severity],
  );
  return rows.rows[0]!.id;
}
async function propose(owner: Owner) {
  return app.inject({ method: "POST", url: "/v1/intelligence/automation/propose" + qs(owner), headers: owner.headers });
}
async function decide(owner: Owner, id: string, decision: "APPROVE" | "REJECT") {
  return app.inject({ method: "POST",
    url: "/v1/intelligence/automation/runs/" + id + "/decision" + qs(owner),
    headers: owner.headers, payload: { decision } });
}

describe("owner-approved merchant action automation", () => {
  it("is opt-in, deduplicated and only creates a task after owner approval", async () => {
    const owner = await onboard("approval");
    const id = await addAlert(owner);
    const disabled = await propose(owner);
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({ proposedCount: 0, pending: [], policy: null });
    const config = await configure(owner, true);
    expect(config.statusCode).toBe(200);
    expect(config.json().policy).toMatchObject({ enabled: true, approvalRole: "OWNER",
      minSeverity: "HIGH", policyVersion: 1 });
    const first = await propose(owner);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ proposedCount: 1 });
    const run = first.json().pending[0];
    expect(run).toMatchObject({ state: "WAITING_APPROVAL", sourceAttentionId: id,
      title: "Overdue customer balances" });
    const replay = await propose(owner);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().proposedCount).toBe(0);
    const before = await pool.query("SELECT count(*)::int AS n FROM business_action_items WHERE business_id=$1", [owner.businessId]);
    expect(before.rows[0].n).toBe(0);
    const approved = await decide(owner, run.id, "APPROVE");
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ state: "SUCCEEDED", outputSummary: { taskCreated: true } });
    const tasks = await pool.query(
      "SELECT id,source_attention_id,idempotency_key,source_automation_run_id FROM business_action_items WHERE business_id=$1",
      [owner.businessId],
    );
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0]).toMatchObject({
      source_attention_id: id, source_automation_run_id: run.id, idempotency_key: "ATTENTION:" + id,
    });
    const events = await pool.query("SELECT event_type,actor_user_id FROM business_action_events WHERE action_id=$1", [tasks.rows[0].id]);
    expect(events.rows).toEqual([{ event_type: "CREATED", actor_user_id: owner.userId }]);
    const again = await decide(owner, run.id, "APPROVE");
    expect(again.statusCode).toBe(409);
    const audit = await pool.query(
      "SELECT event_type,actor_type,actor_user_id FROM business_automation_audit_events " +
      "WHERE business_id=$1 ORDER BY occurred_at,id",
      [owner.businessId],
    );
    expect(audit.rows.map((x: { event_type: string }) => x.event_type)).toContain("RUN_PROPOSED");
    expect(audit.rows.map((x: { event_type: string }) => x.event_type)).toContain("RUN_APPROVED");
    expect(audit.rows.find((x: { event_type: string }) => x.event_type === "RUN_PROPOSED")).toMatchObject({
      actor_type: "SYSTEM", actor_user_id: null,
    });
  });

  it("treats policy changes as revisions, cancels stale proposals and allows explicit rejection", async () => {
    const owner = await onboard("version");
    const alertId = await addAlert(owner, "HIGH");
    const first = await configure(owner, true);
    expect(first.statusCode).toBe(200);
    const proposal = await propose(owner);
    expect(proposal.json().pending).toHaveLength(1);
    const runId = proposal.json().pending[0].id as string;
    const stale = await configure(owner, true, "CRITICAL", 5);
    expect(stale.statusCode).toBe(409);
    const changed = await configure(owner, true, "CRITICAL", 1);
    expect(changed.statusCode).toBe(200);
    expect(changed.json().policy.policyVersion).toBe(2);
    expect(changed.json().pending).toHaveLength(0);
    expect((await decide(owner, runId, "APPROVE")).statusCode).toBe(409);
    expect((await propose(owner)).json().proposedCount).toBe(0);
    await pool.query("UPDATE business_attention_items SET severity='CRITICAL' WHERE id=$1", [alertId]);
    const next = await propose(owner);
    expect(next.json().proposedCount).toBe(1);
    const nextId = next.json().pending[0].id as string;
    const rejected = await decide(owner, nextId, "REJECT");
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().state).toBe("REJECTED");
    expect((await propose(owner)).json().proposedCount).toBe(0);
    const count = await pool.query("SELECT count(*)::int AS n FROM business_action_items WHERE business_id=$1", [owner.businessId]);
    expect(count.rows[0].n).toBe(0);
  });

  it("never approves a resolved alert and prevents duplicate tasks across manual and approved routes", async () => {
    const owner = await onboard("stale");
    const alertId = await addAlert(owner);
    await configure(owner,true);
    const proposed = await propose(owner);
    const runId = proposed.json().pending[0].id as string;
    await pool.query("UPDATE business_attention_items SET state='RESOLVED' WHERE id=$1", [alertId]);
    const stale = await decide(owner,runId,"APPROVE");
    expect(stale.statusCode).toBe(409);
    await pool.query("UPDATE business_attention_items SET state='OPEN' WHERE id=$1", [alertId]);
    const manual = await app.inject({ method: "POST", url: "/v1/intelligence/actions/generate" + qs(owner), headers: owner.headers });
    expect(manual.statusCode).toBe(200);
    expect(manual.json().createdCount).toBe(1);
    const accepted = await decide(owner,runId,"APPROVE");
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().outputSummary.taskCreated).toBe(false);
    const records = await pool.query("SELECT count(*)::int AS n FROM business_action_items WHERE business_id=$1", [owner.businessId]);
    expect(records.rows[0].n).toBe(1);
  });

  it("enforces ownership and branch isolation for settings and approvals", async () => {
    const a = await onboard("scope-a"), b = await onboard("scope-b");
    expect((await app.inject({ method: "GET", url: url(a), headers: b.headers })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/v1/intelligence/automation/config" + qs(a),
      headers: b.headers, payload: { enabled: true, minSeverity: "HIGH", expectedVersion: null } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET",
      url: "/v1/intelligence/automation?businessId=" + a.businessId + "&branchId=" + b.branchId,
      headers: a.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: "/v1/intelligence/automation/config" + qs(a),
      headers: a.headers, payload: { enabled: true, minSeverity: "LOW", expectedVersion: null } })).statusCode).toBe(400);
    await configure(a,true);
    await addAlert(a);
    const data = await propose(a);
    const runId = data.json().pending[0].id as string;
    expect((await decide(b,runId,"APPROVE")).statusCode).toBe(404);
    await pool.query("UPDATE business_memberships SET role='MANAGER' WHERE business_id=$1", [a.businessId]);
    expect((await app.inject({ method: "GET", url: url(a), headers: a.headers })).statusCode).toBe(200);
    expect((await propose(a)).statusCode).toBe(403);
    expect((await decide(a,runId,"APPROVE")).statusCode).toBe(403);
    await pool.query("UPDATE business_memberships SET role='OWNER' WHERE business_id=$1", [a.businessId]);
    await pool.query("UPDATE businesses SET status='SUSPENDED' WHERE id=$1", [a.businessId]);
    expect((await decide(a,runId,"APPROVE")).statusCode).toBe(403);
  });

  it("enforces ownership of automation audit references in PostgreSQL", async () => {
    const a = await onboard("db-a"), b = await onboard("db-b");
    await configure(a,true);
    const policy = await pool.query("SELECT id FROM business_automation_policies WHERE business_id=$1", [a.businessId]);
    await expect(pool.query(
      "INSERT INTO business_automation_audit_events(" +
      "business_id,policy_id,actor_user_id,actor_type,event_type) " +
      "VALUES($1,$2,$3,'USER','POLICY_UPDATED')",
      [b.businessId,policy.rows[0].id,b.userId],
    )).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query(
      "INSERT INTO business_automation_audit_events(" +
      "business_id,policy_id,actor_user_id,actor_type,event_type) " +
      "VALUES($1,$2,$3,'SYSTEM','RUN_PROPOSED')",
      [a.businessId,policy.rows[0].id,a.userId],
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("proposes owner approvals from the background scheduler when enabled", async () => {
    const owner = await onboard("scheduler");
    await configure(owner,true);
    // Real reporting evaluation produces the low-data alert, which does not qualify for HIGH proposals.
    const lowData = await runBusinessAttentionSchedulerTick(pool, {
      now: () => new Date("2030-02-14T12:00:00.000Z"), batchSize: 1,
    });
    expect(lowData).toMatchObject({ attempted: 1, succeeded: 1 });
    const summary = await app.inject({ method: "GET", url: url(owner), headers: owner.headers });
    expect(summary.json().pending).toHaveLength(0);
  });
});
