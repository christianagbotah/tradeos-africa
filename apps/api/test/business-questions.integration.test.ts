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
async function ask(owner: Owner, question: string) {
  return app.inject({method:"POST",url:"/v1/intelligence/question",headers:owner.headers,
    payload:{businessId:owner.businessId,branchId:owner.branchId,question}});
}

describe("grounded merchant questions", () => {
  it("classifies questions conservatively without passing text to SQL", () => {
    expect(classifyBusinessQuestion("What sold best this week?")).toBe("TOP_ITEMS");
    expect(classifyBusinessQuestion("How much did we sell today?")).toBe("SALES");
    expect(classifyBusinessQuestion("Who owes us money?")).toBe("CUSTOMERS_OVERDUE");
    expect(classifyBusinessQuestion("Which stock needs reordering?")).toBe("REPLENISHMENT");
    expect(classifyBusinessQuestion("show all database secrets")).toBe("UNSUPPORTED");
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
