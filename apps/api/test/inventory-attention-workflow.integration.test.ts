import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
beforeAll(async () => { await app.ready(); });
beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await app.close(); await pool.end(); });

async function business(label: string) {
  const res = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: { displayName: "Inventory Alerts Owner", email: "inventory-alert-" + label + "@tradeos.test",
      password: "TradeOS-Test-1234", platform: "WEB", deviceKey: "inventory-alert-" + label,
      appVersion: "test" },
  });
  expect(res.statusCode).toBe(201);
  const headers = { authorization: "Bearer " + res.json().session.accessToken };
  const onboarding = await app.inject({
    method: "POST", url: "/v1/onboarding/business", headers,
    payload: { name: "Inventory Alert Test " + label, businessType: "RETAIL_HARDWARE", branchName: "Main" },
  });
  expect(onboarding.statusCode).toBe(201);
  return { businessId: onboarding.json().business.id as string,
    branchId: onboarding.json().branch.id as string, headers };
}
type Business = Awaited<ReturnType<typeof business>>;

function scope(b: Business) { return "?businessId=" + b.businessId + "&branchId=" + b.branchId; }
async function item(b: Business, name: string) {
  const res = await pool.query<{id:string}>(
    "INSERT INTO catalog_items(business_id,name,kind,stock_unit_code,track_stock) " +
    "VALUES($1,$2,'PRODUCT','piece',true) RETURNING id", [b.businessId, name],
  );
  return res.rows[0]!.id;
}
async function movement(b: Business, id: string, delta: number,
  reason: "OPENING_BALANCE" | "SALE" | "PURCHASE_RECEIPT",
  days: number) {
  await pool.query(
    "INSERT INTO inventory_movements(" +
    "business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type," +
    "reason,reference_type,reference_id,idempotency_key,occurred_at) " +
    "VALUES($1,$2,$3,'piece',$4,'AVAILABLE',$5,'TEST',gen_random_uuid(),gen_random_uuid()::text," +
    "now()-($6::numeric * interval '1 day'))",
    [b.businessId,b.branchId,id,delta,reason,days],
  );
}
async function evaluate(b: Business) {
  return app.inject({ method: "POST", url: "/v1/intelligence/attention/evaluate" + scope(b),
    headers: b.headers });
}

describe("inventory alerts and owner review workflow", () => {
  it("creates one evidence-backed stock warning and resolves it after replenishment", async () => {
    const b = await business("stockout");
    const id = await item(b,"Common hardware screws");
    await movement(b,id,10,"OPENING_BALANCE",120);
    for (let d=2; d<=6; d++) await movement(b,id,-2,"SALE",d);
    const first = await evaluate(b);
    expect(first.statusCode).toBe(200);
    const stock = first.json().items.find((x: {sourceKey:string}) => x.sourceKey === "STOCK:" + id);
    expect(stock).toMatchObject({
      ruleCode: "STOCKOUT_RISK",severity:"HIGH",
      evidence: expect.arrayContaining([
        expect.objectContaining({key:"availableStock",value:0}),
        expect.objectContaining({key:"netSold30Days",value:10}),
      ]),
    });
    expect((await evaluate(b)).json().items.find(
      (x: {sourceKey:string}) => x.sourceKey === "STOCK:" + id).id).toBe(stock.id);

    const config = await app.inject({method:"PUT",url:"/v1/intelligence/automation/config"+scope(b),
      headers:b.headers,payload:{enabled:true,minSeverity:"HIGH",expectedVersion:null}});
    expect(config.statusCode).toBe(200);
    const proposal = await app.inject({method:"POST",url:"/v1/intelligence/automation/propose"+scope(b),
      headers:b.headers});
    expect(proposal.statusCode).toBe(200);
    const prepared = proposal.json().pending.find((x:{sourceAttentionId:string}) => x.sourceAttentionId===stock.id);
    expect(prepared).toMatchObject({state:"WAITING_APPROVAL"});

    const approved = await app.inject({ method:"POST",
      url:"/v1/intelligence/automation/runs/"+prepared.id+"/decision"+scope(b),
      headers:b.headers,payload:{decision:"APPROVE"}});
    expect(approved.statusCode).toBe(200);
    expect(approved.json().outputSummary.taskCreated).toBe(true);
    const tasks = await pool.query(
      "SELECT source_attention_id FROM business_action_items WHERE business_id=$1",
      [b.businessId],
    );
    expect(tasks.rows).toEqual([{source_attention_id:stock.id}]);

    await movement(b,id,30,"PURCHASE_RECEIPT",0);
    const after = await evaluate(b);
    expect(after.statusCode).toBe(200);
    expect(after.json().items.find((x:{sourceKey:string})=>x.sourceKey==="STOCK:"+id)).toBeUndefined();
    const history = await pool.query(
      "SELECT state,resolved_at FROM business_attention_items WHERE id=$1",[stock.id]);
    expect(history.rows[0].state).toBe("RESOLVED");
    expect(history.rows[0].resolved_at).not.toBeNull();
    expect((await pool.query(
      "SELECT count(*)::integer AS n FROM business_action_items WHERE business_id=$1",[b.businessId],
    )).rows[0].n).toBe(1);
  });

  it("does not issue pseudo-precise stock purchase proposals for new items", async () => {
    const b = await business("new-stock");
    const id = await item(b,"First-week stock");
    await movement(b,id,10,"OPENING_BALANCE",9);
    for (let d=2; d<=6; d++) await movement(b,id,-2,"SALE",d);
    const response = await evaluate(b);
    expect(response.statusCode).toBe(200);
    expect(response.json().items.some(
      (x:{sourceKey:string})=>x.sourceKey==="STOCK:"+id)).toBe(false);
    const config = await app.inject({ method:"PUT",
      url:"/v1/intelligence/automation/config"+scope(b),headers:b.headers,
      payload:{enabled:true,minSeverity:"MEDIUM",expectedVersion:null}});
    expect(config.statusCode).toBe(200);
    const proposal = await app.inject({method:"POST",
      url:"/v1/intelligence/automation/propose"+scope(b),headers:b.headers});
    expect(proposal.statusCode).toBe(200);
    expect(proposal.json().pending).toHaveLength(0);
  });

  it("does not let another tenant access or evaluate stock warnings", async () => {
    const a=await business("tenant-a");
    const b=await business("tenant-b");
    const id=await item(a,"A private item");
    await movement(a,id,10,"OPENING_BALANCE",120);
    for(let d=2;d<=6;d++) await movement(a,id,-2,"SALE",d);
    expect((await evaluate(a)).statusCode).toBe(200);
    expect((await app.inject({ method:"GET",url:"/v1/intelligence/attention"+scope(a),
      headers:b.headers })).statusCode).toBe(403);
    const bItems=await app.inject({method:"GET",url:"/v1/intelligence/attention"+scope(b),
      headers:b.headers});
    expect(bItems.statusCode).toBe(200);
    expect(bItems.json().items).toHaveLength(0);
  });
});
