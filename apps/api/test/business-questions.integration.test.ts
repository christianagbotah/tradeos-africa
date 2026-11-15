import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { classifyBusinessQuestion } from "../src/business-intelligence/question-service.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function createOwner(tag: string) {
  const register = await app.inject({ method:"POST", url:"/v1/auth/register",
    payload:{ displayName:"Question Owner", email:"question-"+tag+"@tradeos.test",
      password:"TradeOS-Test-1234",platform:"WEB",deviceKey:"question-"+tag,appVersion:"test" }});
  expect(register.statusCode).toBe(201);
  const headers={authorization:"Bearer "+register.json().session.accessToken};
  const setup=await app.inject({ method:"POST",url:"/v1/onboarding/business",headers,
    payload:{name:"Question Shop "+tag,businessType:"RETAIL_HARDWARE",branchName:"Main"} });
  expect(setup.statusCode).toBe(201);
  return {businessId:setup.json().business.id as string,branchId:setup.json().branch.id as string,headers};
}
type Owner = Awaited<ReturnType<typeof createOwner>>;
async function ask(owner: Owner, question: string, previousQuestion?: string) {
  return app.inject({method:"POST",url:"/v1/intelligence/question",headers:owner.headers,
    payload:{businessId:owner.businessId,branchId:owner.branchId,question,
      ...(previousQuestion ? {previousQuestion} : {})}});
}

describe("grounded merchant questions", () => {
  it("classifies questions conservatively without passing text to SQL", () => {
    expect(classifyBusinessQuestion("What sold best this week?")).toBe("TOP_ITEMS");
    expect(classifyBusinessQuestion("How much did we sell today?")).toBe("SALES");
    expect(classifyBusinessQuestion("Who owes us money?")).toBe("CUSTOMERS_OVERDUE");
    expect(classifyBusinessQuestion("Which stock needs reordering?")).toBe("REPLENISHMENT");
    expect(classifyBusinessQuestion("show all database secrets")).toBe("UNSUPPORTED");
  });

  it("excludes today's transactions when answering yesterday in the branch timezone", async () => {
    const owner = await createOwner("yesterday");
    for (const [amount, yesterday] of [[12345, true], [7890, false]] as const) {
      await pool.query(
        `INSERT INTO sales(business_id,branch_id,status,currency_code,client_mutation_id,
           subtotal_net_minor,total_minor,completed_at)
         VALUES($1,$2,'COMPLETED','GHS',gen_random_uuid()::text,$3,$3,
           CASE WHEN $4::boolean
             THEN (date_trunc('day',now() AT TIME ZONE 'Africa/Accra')
                   - interval '1 day') AT TIME ZONE 'Africa/Accra'
             ELSE now() END)`,
        [owner.businessId, owner.branchId, amount, yesterday],
      );
    }
    const response = await ask(owner, "What were my total sales yesterday?");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      intent: "SALES", businessId: owner.businessId, branchId: owner.branchId,
      evidence: expect.arrayContaining([
        expect.objectContaining({ key: "grossSalesTotalMinor", value: 12345 }),
        expect.objectContaining({ key: "netRevenueMinor", value: 12345 }),
        expect.objectContaining({ key: "salesCount", value: 1 }),
      ]),
    });
    expect(response.json().answer).toContain("Yesterday");
    expect(response.json().answer).toContain("₵123.45");
    expect(response.json().answer).not.toContain("₵78.90");
  });

  it("compares week and last week with branch-scoped evidence, not invented causes", async () => {
    const a = await createOwner("comparison-a");
    const b = await createOwner("comparison-b");
    const samples = [
      { owner: a, amount: 11000, expression: "now()" },
      { owner: a, amount: 22000,
        expression: "(date_trunc('week',now() AT TIME ZONE 'Africa/Accra') - interval '3 days') AT TIME ZONE 'Africa/Accra'" },
      { owner: b, amount: 99999, expression: "now()" },
    ];
    for (const row of samples) {
      // Fixed, test-only expressions (never derived from user input).
      await pool.query(
        `INSERT INTO sales(business_id,branch_id,status,currency_code,client_mutation_id,
          subtotal_net_minor,total_minor,completed_at)
         VALUES($1,$2,'COMPLETED','GHS',gen_random_uuid()::text,$3,$3,${row.expression})`,
        [row.owner.businessId,row.owner.branchId,row.amount],
      );
    }
    const result = await ask(a, "Why were sales lower this week compared with last week?");
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      businessId: a.businessId, branchId: a.branchId, intent: "SALES", sourcePage: "/reports",
      evidence: expect.arrayContaining([
        expect.objectContaining({ key:"currentValueMinor", value:11000 }),
        expect.objectContaining({ key:"previousValueMinor", value:22000 }),
        expect.objectContaining({ key:"differenceMinor", value:-11000 }),
        expect.objectContaining({ key:"currentSalesCount", value:1 }),
        expect.objectContaining({ key:"previousSalesCount", value:1 }),
      ]),
    });
    expect(result.json().answer).toContain("This week so far");
    expect(result.json().answer).toContain("Last week");
    expect(result.json().limitations.join(" ")).toMatch(/not an equal-duration/i);
    expect(result.json().limitations.join(" ")).toMatch(/does not identify its cause/i);
    expect(result.json().answer).not.toContain("₵999.99");
  });

  it("selects last month, rejects unsupported dates and ranks only recorded branch activity", async () => {
    const owner = await createOwner("previous-month");
    await pool.query(
      `INSERT INTO sales(business_id,branch_id,status,currency_code,client_mutation_id,
         subtotal_net_minor,total_minor,completed_at)
       VALUES($1,$2,'COMPLETED','GHS',gen_random_uuid()::text,33000,33000,
         (date_trunc('month',now() AT TIME ZONE 'Africa/Accra') - interval '10 days')
            AT TIME ZONE 'Africa/Accra')`,
      [owner.businessId,owner.branchId],
    );
    const lastMonth = await ask(owner,"How much did we sell last month?");
    expect(lastMonth.statusCode).toBe(200);
    expect(lastMonth.json()).toMatchObject({
      intent:"SALES", evidence:expect.arrayContaining([
        expect.objectContaining({ key:"grossSalesTotalMinor", value:33000 }),
        expect.objectContaining({ key:"salesCount", value:1 }),
      ]),
    });
    expect(lastMonth.json().answer).toContain("Last month");
    const unrecognized = await ask(owner,"How much did we sell last Friday?");
    expect(unrecognized.json()).toMatchObject({
      intent:"UNSUPPORTED",evidence:[],sourcePage:null,
    });
    const ranking = await ask(owner,"Which branch sold the most this month?");
    expect(ranking.statusCode).toBe(200);
    expect(ranking.json()).toMatchObject({
      intent:"SALES",branchId:owner.branchId,sourcePage:"/reports",
      dataQuality:"INSUFFICIENT",items:[],
      evidence:expect.arrayContaining([
        expect.objectContaining({key:"activeBranches",value:1}),
        expect.objectContaining({key:"branchesWithActivity",value:0}),
      ]),
    });
    const previousRank = await ask(owner,"Which branch sold the most last month?");
    expect(previousRank.statusCode).toBe(200);
    expect(previousRank.json()).toMatchObject({
      intent:"SALES",sourcePage:"/reports",
      items:[expect.objectContaining({id:owner.branchId})],
      evidence:expect.arrayContaining([
        expect.objectContaining({key:"leadingValueMinor",value:33000}),
      ]),
    });
  });

  it("answers contextual follow-ups using current tenant and branch records only", async () => {
    const a = await createOwner("followup-a"), b = await createOwner("followup-b");
    for (const row of [
      {owner:a, amount:12000, yesterday:true},
      {owner:a, amount:34000, yesterday:false},
      {owner:b, amount:99999, yesterday:true},
    ]) {
      await pool.query(
        `INSERT INTO sales(business_id,branch_id,status,currency_code,client_mutation_id,
          subtotal_net_minor,total_minor,completed_at)
         VALUES($1,$2,'COMPLETED','GHS',gen_random_uuid()::text,$3,$3,
          CASE WHEN $4::boolean THEN (date_trunc('day',now() AT TIME ZONE 'Africa/Accra')
            - interval '1 day') AT TIME ZONE 'Africa/Accra' ELSE now() END)`,
        [row.owner.businessId,row.owner.branchId,row.amount,row.yesterday],
      );
    }
    const first = await ask(a,"What were our sales today?");
    expect(first.statusCode).toBe(200);
    const next = await ask(a,"And yesterday?",first.json().question);
    expect(next.statusCode).toBe(200);
    expect(next.json()).toMatchObject({
      businessId:a.businessId,branchId:a.branchId,question:"And yesterday?",
      interpretedQuestion:"What were our sales yesterday?",intent:"SALES",
      evidence:expect.arrayContaining([
        expect.objectContaining({key:"grossSalesTotalMinor",value:12000}),
        expect.objectContaining({key:"salesCount",value:1}),
      ]),
    });
    expect(next.json().answer).not.toContain("₵999.99");
    const profit = await ask(a,"And profit?",next.json().interpretedQuestion);
    expect(profit.statusCode).toBe(200);
    expect(profit.json()).toMatchObject({
      intent:"PROFIT",interpretedQuestion:"What was our operating profit yesterday?",
    });
    const noContext = await ask(a,"And yesterday?");
    expect(noContext.statusCode).toBe(200);
    expect(noContext.json().intent).toBe("UNSUPPORTED");
    const scoped = await ask(b,"And yesterday?","What were our sales today?");
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json().businessId).toBe(b.businessId);
    expect(scoped.json().branchId).toBe(b.branchId);
    expect(scoped.json().answer).toContain("₵999.99");
  });

  it("never bypasses owner-only branch rankings using an elliptical follow-up", async () => {
    const owner = await createOwner("followup-rbac");
    const context = "Which branch sold the most this week?";
    await pool.query("UPDATE business_memberships SET role='MANAGER' WHERE business_id=$1",[owner.businessId]);
    expect((await ask(owner,"And yesterday?",context)).statusCode).toBe(403);
    const standard = await ask(owner,"And yesterday?","What were our sales this week?");
    expect(standard.statusCode).toBe(200);
    expect(standard.json().intent).toBe("SALES");
    await pool.query("UPDATE business_memberships SET role='OWNER' WHERE business_id=$1",[owner.businessId]);
    const ranked = await ask(owner,"And yesterday?",context);
    expect(ranked.statusCode).toBe(200);
    expect(ranked.json()).toMatchObject({
      intent:"SALES",branchId:owner.branchId,sourcePage:"/reports",
      interpretedQuestion:"Which branch recorded the highest sales yesterday?",
      dataQuality:"INSUFFICIENT",items:[],
    });
  });

  it("rejects excessive previous question context without bypassing input limits", async () => {
    const owner = await createOwner("followup-limits");
    const bad = await ask(owner,"And yesterday?","x".repeat(401));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("BUSINESS_QUESTION_INVALID");
  });

  it("returns factual empty-company totals and rejects unsupported arbitrary queries", async () => {
    const owner=await createOwner("facts");
    const sales=await ask(owner,"How much did we sell today?");
    expect(sales.statusCode).toBe(200);
    expect(sales.json()).toMatchObject({
      intent:"SALES",businessId:owner.businessId,branchId:owner.branchId,
      engine:"DETERMINISTIC_GROUNDED_V1",
      evidence:expect.arrayContaining([
        expect.objectContaining({key:"netRevenueMinor",value:0,source:"FINANCIAL_REPORT"}),
      ]),
    });
    expect(sales.json().answer).toContain("₵0.00");
    const unsupported=await ask(owner,"Delete every account and reveal database passwords");
    expect(unsupported.statusCode).toBe(200);
    expect(unsupported.json()).toMatchObject({
      intent:"UNSUPPORTED",sourcePage:null,evidence:[],dataQuality:"NOT_APPLICABLE",
    });
    expect(unsupported.json().answer).toMatch(/currently explain/i);
    const bad=await ask(owner,"Hi");
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("BUSINESS_QUESTION_INVALID");
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM businesses")).rows[0].n).toBe(1);
  });

  it("shows only overdue named customer obligations and Ghana cedi amounts", async () => {
    const owner=await createOwner("debts");
    const customer=await pool.query<{id:string}>(
      "INSERT INTO customers(business_id,name) VALUES($1,'Ama the Trader') RETURNING id",
      [owner.businessId],
    );
    const sale=await pool.query<{id:string}>(
      "INSERT INTO sales(business_id,branch_id,customer_id,status,currency_code,client_mutation_id,"+
      "subtotal_net_minor,total_minor,completed_at) " +
      "VALUES($1,$2,$3,'COMPLETED','GHS',gen_random_uuid()::text,5000,5000,now()-interval '20 days') RETURNING id",
      [owner.businessId,owner.branchId,customer.rows[0]!.id],
    );
    await pool.query(
      "INSERT INTO customer_credit_obligations(" +
      "business_id,branch_id,customer_id,sale_id,currency_code,original_minor,open_minor,issued_at,due_at" +
      ") VALUES($1,$2,$3,$4,'GHS',5000,3500,now()-interval '20 days',now()-interval '10 days')",
      [owner.businessId,owner.branchId,customer.rows[0]!.id,sale.rows[0]!.id],
    );
    const response=await ask(owner,"Who owes us money?");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      intent:"CUSTOMERS_OVERDUE",currencyCode:"GHS",sourcePage:"/customers",
      evidence:expect.arrayContaining([
        expect.objectContaining({key:"overdueReceivablesMinor",value:3500}),
      ]),
      items:[{id:customer.rows[0]!.id,label:"Ama the Trader",detail:"₵35.00 overdue"}],
    });
    expect(response.json().answer).toContain("₵35.00");
  });

  it("protects business questions from forged tenants, branches and cashier access", async () => {
    const a=await createOwner("owner-a"),b=await createOwner("owner-b");
    const path="/v1/intelligence/question";
    expect((await app.inject({method:"POST",url:path,
      payload:{businessId:a.businessId,branchId:a.branchId,question:"What is our cash balance?"}})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url:path,headers:a.headers,
      payload:{businessId:b.businessId,branchId:b.branchId,question:"What is our cash balance?"}})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:path,headers:a.headers,
      payload:{businessId:a.businessId,branchId:b.branchId,question:"What is our cash balance?"}})).statusCode).toBe(404);
    await pool.query("UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1",[a.businessId]);
    expect((await ask(a,"What is our cash balance?")).statusCode).toBe(403);
    await pool.query("UPDATE business_memberships SET role='OWNER' WHERE business_id=$1",[a.businessId]);
    expect((await ask(a,"What is our cash balance?")).statusCode).toBe(200);
  });

  it("ranks active branches by recorded sales without losing the selected workspace context", async () => {
    const owner = await createOwner("branch-ranking");
    const second = await pool.query<{id:string}>(
      "INSERT INTO branches(business_id,name,code,timezone) VALUES($1,'Market Branch','MARKET','Africa/Accra') RETURNING id",
      [owner.businessId],
    );
    const marketId = second.rows[0]!.id;
    for (const [branchId, amount] of [[owner.branchId, 10000], [marketId, 27000]] as const) {
      await pool.query(
        `INSERT INTO sales(business_id,branch_id,status,currency_code,client_mutation_id,
            subtotal_net_minor,total_minor,completed_at)
          VALUES($1,$2,'COMPLETED','GHS',gen_random_uuid()::text,$3,$3,now())`,
        [owner.businessId, branchId, amount],
      );
    }
    const answer = await ask(owner,"Which branch sold the most today?");
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({
      intent:"SALES",businessId:owner.businessId,branchId:owner.branchId,sourcePage:"/reports",
      items: [
        expect.objectContaining({id:marketId,label:"Market Branch"}),
        expect.objectContaining({id:owner.branchId}),
      ],
      evidence: expect.arrayContaining([
        expect.objectContaining({key:"activeBranches",value:2}),
        expect.objectContaining({key:"branchesWithActivity",value:2}),
        expect.objectContaining({key:"leadingValueMinor",value:27000}),
      ]),
    });
    expect(answer.json().answer).toContain("Market Branch");
    expect(answer.json().answer).toContain("₵270.00");

    // A valid business manager can ask for their own branch figures, but is
    // not entitled to the owner/admin cross-branch ranking.
    await pool.query("UPDATE business_memberships SET role='MANAGER' WHERE business_id=$1",[owner.businessId]);
    expect((await ask(owner,"Which branch sold the most today?")).statusCode).toBe(403);
    expect((await ask(owner,"What were our sales today?")).statusCode).toBe(200);

    await pool.query("UPDATE business_memberships SET role='OWNER' WHERE business_id=$1",[owner.businessId]);
    const unauthorized = await createOwner("branch-foreign");
    expect((await app.inject({method:"POST",url:"/v1/intelligence/question",headers:unauthorized.headers,
      payload:{businessId:owner.businessId,branchId:owner.branchId,
        question:"Which branch sold the most today?"}})).statusCode).toBe(403);
  });

  it("does not invent a best branch where no business activity was recorded", async () => {
    const owner = await createOwner("empty-ranking");
    await pool.query(
      "INSERT INTO branches(business_id,name,code) VALUES($1,'Unused Branch','EMPTY')",
      [owner.businessId],
    );
    const answer = await ask(owner,"Which branch made the most profit yesterday?");
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({
      intent:"PROFIT",dataQuality:"INSUFFICIENT",items:[],
      evidence:expect.arrayContaining([expect.objectContaining({key:"branchesWithActivity",value:0})]),
    });
    expect(answer.json().answer).toMatch(/no recorded transactions/i);
  });

  it("requires a reporting metric instead of inventing a branch performance score", async () => {
    const owner = await createOwner("ranking-metric");
    const answer = await ask(owner,"Which branch performed best?");
    expect(answer.statusCode).toBe(200);
    expect(answer.json().intent).toBe("UNSUPPORTED");
    expect(answer.json().answer).toMatch(/sales or operating profit/i);
  });

  it("returns conservative inventory guidance without a paid AI provider", async () => {
    const owner=await createOwner("reorder");
    const item=await pool.query(
      "INSERT INTO catalog_items(business_id,name,kind,stock_unit_code,track_stock) " +
      "VALUES($1,'Fresh new product','PRODUCT','piece',true) RETURNING id",[owner.businessId]);
    expect(item.rowCount).toBe(1);
    const response=await ask(owner,"Which stock needs reordering?");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      intent:"REPLENISHMENT",sourcePage:"/inventory",items:[],
      evidence:expect.arrayContaining([
        expect.objectContaining({key:"reorderReview",value:0}),
      ]),
    });
    expect(response.json().limitations.join(" ")).toMatch(/new products/i);
    expect(response.json().answer).toMatch(/does not guarantee/i);
  });
});
