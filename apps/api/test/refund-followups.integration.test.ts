import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

describe("merchant refund append-only follow-ups and escalation", () => {
  it("records immutable idempotent notes while preserving refund liabilities and scope", async () => {
    async function register(email: string, deviceKey: string) {
      const res = await app.inject({ method: "POST", url: "/v1/auth/register",
        payload: { displayName: email.split("@")[0], email,
          password: "QA-Refund-Notes-Testing-2026!", platform: "WEB",
          deviceKey, appVersion: "test" } });
      expect(res.statusCode).toBe(201);
      return { headers: { authorization: `Bearer ${res.json().session.accessToken}` },
        userId: res.json().user.id as string };
    }
    const owner = await register("owner-followup@tradeos.test", "followup-owner");
    const cashier = await register("cashier-followup@tradeos.test", "followup-cashier");
    const stranger = await register("stranger-followup@tradeos.test", "followup-stranger");
    const onboard = await app.inject({ method: "POST", url: "/v1/onboarding/business",
      headers: owner.headers, payload: { name: "Followup Retail",
        businessType: "RETAIL_HARDWARE", branchName: "Main" } });
    expect(onboard.statusCode).toBe(201);
    const businessId: string = onboard.json().business.id;
    const branchId: string = onboard.json().branch.id;
    await pool.query(
      "INSERT INTO business_memberships(business_id,user_id,role,status) VALUES($1,$2,'CASHIER','ACTIVE')",
      [businessId, cashier.userId]);
    const otherBranchId = (await pool.query<{id:string}>(
      "INSERT INTO branches(business_id,name,code) VALUES($1,'Other','OTHER') RETURNING id",
      [businessId])).rows[0]!.id;

    async function seed(key: string, branch: string, status: string, amount: number) {
      const sale = (await pool.query<{id:string}>(
        `INSERT INTO sales(business_id,branch_id,status,currency_code,
            subtotal_net_minor,total_minor,client_mutation_id)
           VALUES($1,$2,'COMPLETED','GHS',20000,20000,$3) RETURNING id`,
        [businessId, branch, `sale-${key}`])).rows[0]!.id;
      const ret = (await pool.query<{id:string}>(
        `INSERT INTO return_cases(business_id,branch_id,original_sale_id,status,
           reason,refund_method,currency_code,refund_total_minor,client_mutation_id)
           VALUES($1,$2,$3,'COMPLETED','Test','CASH','GHS',$4,$5) RETURNING id`,
        [businessId, branch, sale, amount, `return-${key}`])).rows[0]!.id;
      return (await pool.query<{id:string}>(
        `INSERT INTO refund_transactions(business_id,return_case_id,amount_minor,
           currency_code,method,status,idempotency_key)
           VALUES($1,$2,$3,'GHS','CASH',$4,$5) RETURNING id`,
        [businessId, ret, amount, status, key])).rows[0]!.id;
    }
    const refundId = await seed("pending", branchId, "PENDING", 1200);
    const failedId = await seed("failed", branchId, "FAILED", 250);
    const settledId = await seed("settled", branchId, "SUCCEEDED", 500);
    const otherBranchRefund = await seed("other", otherBranchId, "PENDING", 10000);
    const base = { businessId, branchId, refundId };
    const requestId = randomUUID();
    const body = { ...base, clientRequestId: requestId, eventKind: "INTERNAL_NOTE",
      note: "Customer called; awaiting a confirmed provider refund reference." };
    const queueUrl = `/v1/refunds/settlement-queue?businessId=${businessId}&branchId=${branchId}`;
    const timelineUrl = `/v1/refunds/followups?businessId=${businessId}&branchId=${branchId}&refundId=${refundId}`;

    const original = await app.inject({method:"GET",url:queueUrl,headers:owner.headers});
    expect(original.statusCode).toBe(200);
    expect(original.json().items.find((r:{id:string})=>r.id===refundId))
      .toMatchObject({followupCount:0,escalated:false});
    const initialAuditCount = (await pool.query<{n:string}>(
      "SELECT count(*) AS n FROM audit_events WHERE entity_id=$1",[refundId])).rows[0]!.n;

    const create = await app.inject({method:"POST",url:"/v1/refunds/followups",
      headers:owner.headers,payload:body});
    expect(create.statusCode).toBe(201);
    expect(create.headers["cache-control"]).toContain("no-store");
    expect(create.json().event).toMatchObject({
      refundId,eventKind:"INTERNAL_NOTE",idempotentReplay:false,
      providerFinality:"NOT_ESTABLISHED",payoutStatusUnchanged:true
    });
    const eventId:string = create.json().event.eventId;
    const replay = await app.inject({method:"POST",url:"/v1/refunds/followups",
      headers:owner.headers,payload:body});
    expect(replay.statusCode).toBe(200);
    expect(replay.json().event).toMatchObject({ eventId,idempotentReplay:true });
    const conflict = await app.inject({method:"POST",url:"/v1/refunds/followups",
      headers:owner.headers,payload:{...body,note:"The same request ID carries different evidence content."}});
    expect(conflict.statusCode).toBe(409);
    const noNote = await app.inject({method:"POST",url:"/v1/refunds/followups",
      headers:owner.headers,payload:{...body,clientRequestId:randomUUID(),note:"Too short"}});
    expect(noNote.statusCode).toBe(400);
    const noUrl = await app.inject({method:"POST",url:"/v1/refunds/followups",
      headers:owner.headers,payload:{...body,clientRequestId:randomUUID(),
        evidenceReference:"https://do-not-accept.example"}});
    expect(noUrl.statusCode).toBe(400);

    const prematureReview = await app.inject({method:"POST",
      url:"/v1/refunds/followups",headers:owner.headers,
      payload:{...body,clientRequestId:randomUUID(),
        eventKind:"ESCALATION_REVIEWED",
        note:"Attempted to resolve an escalation that was never opened."}});
    expect(prematureReview.statusCode).toBe(409);

    const escalate = await app.inject({method:"POST",url:"/v1/refunds/followups",
      headers:owner.headers,payload:{...body,clientRequestId:randomUUID(),
        eventKind:"ESCALATED",note:"Escalated to management after customer requested urgent review."}});
    expect(escalate.statusCode).toBe(201);
    const afterEscalation = await app.inject({method:"GET",url:queueUrl,headers:owner.headers});
    expect(afterEscalation.json().items.find((r:{id:string})=>r.id===refundId))
      .toMatchObject({followupCount:2,escalated:true});
    expect(afterEscalation.json().summaryByCurrency).toEqual(original.json().summaryByCurrency);

    const reviewed = await app.inject({method:"POST",url:"/v1/refunds/followups",
      headers:owner.headers,payload:{...body,clientRequestId:randomUUID(),
        eventKind:"ESCALATION_REVIEWED",
        note:"Manager reviewed the escalation; provider settlement remains unverified."}});
    expect(reviewed.statusCode).toBe(201);
    const nextQueue = await app.inject({method:"GET",url:queueUrl,headers:owner.headers});
    expect(nextQueue.json().items.find((r:{id:string})=>r.id===refundId))
      .toMatchObject({followupCount:3,escalated:false});
    const timeline = await app.inject({method:"GET",url:timelineUrl+"&limit=2",
      headers:owner.headers});
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json()).toMatchObject({refundId,hasMore:true,
      providerFinality:"NOT_ESTABLISHED"});
    expect(timeline.json().events).toHaveLength(2);
    const nextPage = await app.inject({method:"GET",url:timelineUrl+"&limit=2&offset=2",
      headers:owner.headers});
    expect(nextPage.json().events).toHaveLength(1);
    expect(nextPage.json().hasMore).toBe(false);

    expect((await app.inject({method:"POST",url:"/v1/refunds/followups",headers:owner.headers,
      payload:{...body,refundId:settledId,clientRequestId:randomUUID()}})).statusCode).toBe(409);
    expect((await app.inject({method:"POST",url:"/v1/refunds/followups",headers:owner.headers,
      payload:{...body,refundId:failedId,clientRequestId:randomUUID()}})).statusCode).toBe(201);
    expect((await app.inject({method:"POST",url:"/v1/refunds/followups",headers:owner.headers,
      payload:{...body,refundId:otherBranchRefund,clientRequestId:randomUUID()}})).statusCode).toBe(404);
    expect((await app.inject({method:"GET",url:timelineUrl.replace(refundId,otherBranchRefund),
      headers:owner.headers})).statusCode).toBe(404);
    expect((await app.inject({method:"GET",url:timelineUrl,headers:cashier.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:"/v1/refunds/followups",headers:cashier.headers,
      payload:{...body,clientRequestId:randomUUID()}})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:timelineUrl,headers:stranger.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:timelineUrl})).statusCode).toBe(401);

    await expect(pool.query("UPDATE refund_followup_events SET note='rewrite' WHERE id=$1",
      [eventId])).rejects.toThrow();
    await expect(pool.query("DELETE FROM refund_followup_events WHERE id=$1",
      [eventId])).rejects.toThrow();
    const afterAuditCount = (await pool.query<{n:string}>(
      "SELECT count(*) AS n FROM audit_events WHERE entity_id=$1",[refundId])).rows[0]!.n;
    expect(Number(afterAuditCount) - Number(initialAuditCount)).toBe(3);
    const financial = (await pool.query<{status:string;amount_minor:string}>(
      "SELECT status,amount_minor::text FROM refund_transactions WHERE id=$1",
      [refundId])).rows[0];
    expect(financial).toEqual({ status:"PENDING", amount_minor:"1200" });
  });
});
