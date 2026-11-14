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
  const reg=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
    displayName:"Notification Owner",email:"notices-"+tag+"@tradeos.test",
    password:"TradeOS-Test-1234",platform:"WEB",deviceKey:"notice-"+tag,appVersion:"test",
  }});
  expect(reg.statusCode).toBe(201);
  const headers={authorization:"Bearer "+reg.json().session.accessToken};
  const setup=await app.inject({method:"POST",url:"/v1/onboarding/business",headers,
    payload:{name:"Notification Business "+tag,businessType:"RETAIL_HARDWARE",branchName:"Main"}});
  expect(setup.statusCode).toBe(201);
  return {businessId:setup.json().business.id as string,branchId:setup.json().branch.id as string,
    userId:reg.json().user.id as string,headers};
}
type Business = Awaited<ReturnType<typeof owner>>;
const qs=(b:Business)=>"?businessId="+b.businessId+"&branchId="+b.branchId;
const readUrl=(b:Business)=>"/v1/intelligence/notifications"+qs(b);
const receiptUrl=(b:Business,kind:string,id:string)=>
  "/v1/intelligence/notifications/"+kind+"/"+id+"/read"+qs(b);

async function alert(b:Business) {
  const res=await pool.query<{id:string}>(
    "INSERT INTO business_attention_items("+
    "business_id,branch_id,source_key,rule_code,severity,title,summary) "+
    "VALUES($1,$2,'debts','RECEIVABLES_OVERDUE','HIGH','Collect outstanding debt','Recorded payments are overdue') RETURNING id",
    [b.businessId,b.branchId],
  );
  return res.rows[0]!.id;
}

describe("user-scoped business notification inbox",()=>{
  it("returns only active scoped alerts and records idempotent per-user reads",async()=>{
    const b=await owner("read");
    const id=await alert(b);
    const first=await app.inject({method:"GET",url:readUrl(b),headers:b.headers});
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      businessId:b.businessId,branchId:b.branchId,unreadCount:1,truncated:false,
      notifications:[{id,kind:"ATTENTION",severity:"HIGH",readAt:null,href:"/reports"}],
    });
    const read=await app.inject({method:"POST",url:receiptUrl(b,"ATTENTION",id),headers:b.headers});
    expect(read.statusCode).toBe(200);
    const retry=await app.inject({method:"POST",url:receiptUrl(b,"ATTENTION",id),headers:b.headers});
    expect(retry.statusCode).toBe(200);
    expect(retry.json().readAt).toBe(read.json().readAt);
    const updated=await app.inject({method:"GET",url:readUrl(b),headers:b.headers});
    expect(updated.json().unreadCount).toBe(0);
    expect(updated.json().notifications[0].readAt).toBe(read.json().readAt);
    expect((await pool.query("SELECT count(*)::int AS n FROM business_notification_reads WHERE business_id=$1",
      [b.businessId])).rows[0].n).toBe(1);
    await pool.query("UPDATE business_attention_items SET state='RESOLVED' WHERE id=$1",[id]);
    const resolved=await app.inject({method:"GET",url:readUrl(b),headers:b.headers});
    expect(resolved.json().notifications).toHaveLength(0);
  });

  it("owners see proposals; managers see alerts only; acknowledgements do not approve tasks",async()=>{
    const b=await owner("approvals");
    const id=await alert(b);
    const config=await app.inject({method:"PUT",url:"/v1/intelligence/automation/config"+qs(b),
      headers:b.headers,payload:{enabled:true,minSeverity:"HIGH",expectedVersion:null}});
    expect(config.statusCode).toBe(200);
    const proposed=await app.inject({method:"POST",url:"/v1/intelligence/automation/propose"+qs(b),
      headers:b.headers});
    expect(proposed.statusCode).toBe(200);
    const run=proposed.json().pending[0];
    expect(run).toBeTruthy();
    const ownerInbox=await app.inject({method:"GET",url:readUrl(b),headers:b.headers});
    expect(ownerInbox.json().notifications.map((item:{kind:string})=>item.kind).sort())
      .toEqual(["APPROVAL","ATTENTION"]);
    expect((await app.inject({method:"POST",url:receiptUrl(b,"APPROVAL",run.id),
      headers:b.headers})).statusCode).toBe(200);
    expect((await pool.query("SELECT count(*)::int AS n FROM business_action_items WHERE business_id=$1",
      [b.businessId])).rows[0].n).toBe(0);

    await pool.query("UPDATE business_memberships SET role='MANAGER' WHERE business_id=$1",[b.businessId]);
    const managerInbox=await app.inject({method:"GET",url:readUrl(b),headers:b.headers});
    expect(managerInbox.statusCode).toBe(200);
    expect(managerInbox.json().notifications).toMatchObject([{id,kind:"ATTENTION"}]);
    expect((await app.inject({method:"POST",url:receiptUrl(b,"APPROVAL",run.id),
      headers:b.headers})).statusCode).toBe(403);
    expect((await pool.query("SELECT state FROM business_automation_runs WHERE id=$1",[run.id])).rows[0].state)
      .toBe("WAITING_APPROVAL");
  });

  it("rejects forged tenants, branches, cashier roles and nonexistent notification IDs",async()=>{
    const a=await owner("tenant-a"),b=await owner("tenant-b");
    const id=await alert(a);
    expect((await app.inject({method:"GET",url:readUrl(a)})).statusCode).toBe(401);
    expect((await app.inject({method:"GET",url:readUrl(a),headers:b.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:receiptUrl(a,"ATTENTION",id),
      headers:b.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"GET",url:"/v1/intelligence/notifications?businessId="+a.businessId+
      "&branchId="+b.branchId,headers:a.headers})).statusCode).toBe(404);
    expect((await app.inject({method:"POST",url:receiptUrl(b,"ATTENTION",id),
      headers:b.headers})).statusCode).toBe(404);
    expect((await app.inject({method:"POST",url:receiptUrl(a,"NOT_REAL",id),
      headers:a.headers})).statusCode).toBe(400);
    await pool.query("UPDATE business_memberships SET role='CASHIER' WHERE business_id=$1",[a.businessId]);
    expect((await app.inject({method:"GET",url:readUrl(a),headers:a.headers})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:receiptUrl(a,"ATTENTION",id),
      headers:a.headers})).statusCode).toBe(403);
    await pool.query("UPDATE business_memberships SET role='OWNER' WHERE business_id=$1",[a.businessId]);
    await pool.query("UPDATE businesses SET status='SUSPENDED' WHERE id=$1",[a.businessId]);
    expect((await app.inject({method:"GET",url:readUrl(a),headers:a.headers})).statusCode).toBe(403);
  });

  it("enforces tenant ownership at the SQL layer",async()=>{
    const a=await owner("fk-a"),b=await owner("fk-b");
    const id=await alert(a);
    await expect(pool.query(
      "INSERT INTO business_notification_reads("+
      "business_id,branch_id,user_id,source_type,source_id) VALUES($1,$2,$3,'ATTENTION',$4)",
      [a.businessId,b.branchId,a.userId,id],
    )).rejects.toMatchObject({code:"23503"});
    const count=await pool.query("SELECT COUNT(*)::int AS n FROM business_notification_reads");
    expect(count.rows[0].n).toBe(0);
  });
});
