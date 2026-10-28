import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations/migration-runner.js";

const { Pool }=pg;
const baseDatabaseUrl=process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema=`pulse_route_test_${crypto.randomBytes(8).toString("hex")}`, quoted=`"${schema}"`;
const adminPool=new Pool({connectionString:baseDatabaseUrl});
const pool=new Pool({connectionString:baseDatabaseUrl,options:`-c search_path=${schema},public`});
const app=buildApp(pool);
const migrationDirectory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../packages/db/migrations");
type Tenant={token:string;userId:string;businessId:string;branchId:string};

beforeAll(async()=>{await adminPool.query(`CREATE SCHEMA ${quoted}`);await applyMigrations(pool,{migrationDirectory});await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();await adminPool.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);await adminPool.end();});

describe("business pulse routes",()=>{
  it("returns live pulse and marks its server-owned seen cursor",async()=>{
    const t=await createTenant("pulse-route@test.local","Pulse Route");
    await pool.query(`INSERT INTO business_attention_items(business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence) VALUES($1,$2,'pulse-route','STOCKOUT_RISK','HIGH','OPEN','Stock needs attention','Review stock','[]')`,[t.businessId,t.branchId]);
    const first=await app.inject({method:"GET",url:`/v1/intelligence/pulse?businessId=${t.businessId}&branchId=${t.branchId}&limit=10`,headers:auth(t.token)});
    expect(first.statusCode,first.body).toBe(200); expect(first.json().unseenCount).toBe(1);
    const seen=await app.inject({method:"POST",url:"/v1/intelligence/pulse/seen",headers:auth(t.token),payload:{businessId:t.businessId,branchId:t.branchId}});
    expect(seen.statusCode,seen.body).toBe(200); expect(seen.json().lastSeenAt).toMatch(/Z$/);
    const second=await app.inject({method:"GET",url:`/v1/intelligence/pulse?businessId=${t.businessId}&branchId=${t.branchId}&limit=10`,headers:auth(t.token)});
    expect(second.statusCode).toBe(200); expect(second.json().unseenCount).toBe(0);
  });

  it("rejects client-shaped seen timestamps or content",async()=>{
    const t=await createTenant("pulse-shape@test.local","Pulse Shape");
    for(const extra of [{seenAt:"2000-01-01T00:00:00Z"},{unseenCount:0},{attentionItems:[]}]){
      const r=await app.inject({method:"POST",url:"/v1/intelligence/pulse/seen",headers:auth(t.token),payload:{businessId:t.businessId,branchId:t.branchId,...extra}});
      expect(r.statusCode,r.body).toBe(400);
      expect(r.json().error).toBe("BUSINESS_PULSE_CLIENT_SHAPING_FORBIDDEN");
    }
    expect((await pool.query(`SELECT count(*)::int AS count FROM business_intelligence_pulse_state WHERE business_id=$1`,[t.businessId])).rows[0]?.count).toBe(0);
  });

  it("rejects forged tenant scope and invalid limits",async()=>{
    const a=await createTenant("pulse-a@test.local","Pulse A"), b=await createTenant("pulse-b@test.local","Pulse B");
    const forged=await app.inject({method:"GET",url:`/v1/intelligence/pulse?businessId=${b.businessId}&branchId=${b.branchId}&limit=10`,headers:auth(a.token)});
    expect(forged.statusCode).toBe(403);
    const badLimit=await app.inject({method:"GET",url:`/v1/intelligence/pulse?businessId=${a.businessId}&branchId=${a.branchId}&limit=0`,headers:auth(a.token)});
    expect(badLimit.statusCode).toBe(400);
  });
});

async function createTenant(email:string,name:string):Promise<Tenant>{
  const reg=await app.inject({method:"POST",url:"/v1/auth/register",payload:{displayName:name,email,password:"TradeOS-Test-1234",platform:"WEB",deviceKey:`device-${email}`,appVersion:"test"}}); expect(reg.statusCode,reg.body).toBe(201);
  const rb=reg.json(), token=rb.session.accessToken as string, userId=rb.user.id as string;
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",headers:auth(token),payload:{name,businessType:"RETAIL_HARDWARE",branchName:"Main"}}); expect(onboard.statusCode,onboard.body).toBe(201);
  return {token,userId,businessId:onboard.json().business.id,branchId:onboard.json().branch.id};
}
function auth(token:string){return {authorization:`Bearer ${token}`};}
