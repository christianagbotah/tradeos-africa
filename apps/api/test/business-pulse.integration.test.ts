import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "../src/migrations/migration-runner.js";
import { getBusinessPulse, markBusinessPulseSeen, BusinessPulseError } from "../src/business-intelligence/pulse-service.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema=`pulse_test_${crypto.randomBytes(8).toString("hex")}`, quoted=`"${schema}"`;
const adminPool=new Pool({connectionString:baseDatabaseUrl});
const pool=new Pool({connectionString:baseDatabaseUrl,options:`-c search_path=${schema},public`});
const migrationDirectory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../packages/db/migrations");
const B1="93000000-0000-4000-8000-000000000001", B2="94000000-0000-4000-8000-000000000001";
const BR1="93000000-0000-4000-8000-000000000002", BR2="94000000-0000-4000-8000-000000000002";
const OWNER="93000000-0000-4000-8000-000000000010", VIEWER="93000000-0000-4000-8000-000000000011";
const OWNER_STAFF="93000000-0000-4000-8000-000000000012", VIEWER_STAFF="93000000-0000-4000-8000-000000000013";
const T0=new Date("2026-10-23T10:00:00.000Z"), T1=new Date("2026-10-23T11:00:00.000Z");

beforeAll(async()=>{await adminPool.query(`CREATE SCHEMA ${quoted}`);await applyMigrations(pool,{migrationDirectory});});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE businesses,app_users CASCADE");await seed();});
afterAll(async()=>{await pool.end();await adminPool.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);await adminPool.end();});

const owner={userId:OWNER,businessId:B1,role:"OWNER" as const,staffId:OWNER_STAFF};
const viewer={userId:VIEWER,businessId:B1,role:"VIEWER" as const,staffId:VIEWER_STAFF};

describe("business pulse",()=>{
  it("computes unseen attention/tasks, severity summary and a monotonic seen cursor",async()=>{
    const first=await getBusinessPulse(pool,owner,{businessId:B1,branchId:BR1,limit:10,now:T0});
    expect(first.lastSeenAt).toBeNull();
    expect(first.unseenCount).toBe(4);
    expect(first.attentionSummary).toMatchObject({HIGH:1,MEDIUM:1});
    expect(first.attentionItems).toHaveLength(2);
    expect(first.actionItems).toHaveLength(2);

    expect((await markBusinessPulseSeen(pool,owner,{businessId:B1,branchId:BR1,now:T1})).lastSeenAt).toBe(T1.toISOString());
    expect((await getBusinessPulse(pool,owner,{businessId:B1,branchId:BR1,limit:10,now:T1})).unseenCount).toBe(0);
    expect((await markBusinessPulseSeen(pool,owner,{businessId:B1,branchId:BR1,now:T0})).lastSeenAt).toBe(T1.toISOString());
  });

  it("reuses current-role filtering and assigned-task visibility",async()=>{
    const pulse=await getBusinessPulse(pool,viewer,{businessId:B1,branchId:BR1,limit:10,now:T0});
    expect(pulse.attentionItems.map(x=>x.ruleCode)).toEqual(["STOCKOUT_RISK"]);
    expect(pulse.actionItems).toHaveLength(1);
    expect(pulse.actionItems[0]?.assignedUserId).toBe(VIEWER);
    expect(pulse.unseenCount).toBe(2);
  });

  it("fails closed on forged tenant/branch scope and bounds returned arrays",async()=>{
    await expect(getBusinessPulse(pool,{...owner,businessId:B2},{businessId:B1,branchId:BR1,limit:1,now:T0})).rejects.toMatchObject<Partial<BusinessPulseError>>({statusCode:403});
    await expect(getBusinessPulse(pool,owner,{businessId:B1,branchId:BR2,limit:1,now:T0})).rejects.toMatchObject({statusCode:404});
    const bounded=await getBusinessPulse(pool,owner,{businessId:B1,branchId:BR1,limit:1,now:T0});
    expect(bounded.attentionItems).toHaveLength(1);
    expect(bounded.actionItems).toHaveLength(1);
    expect(bounded.unseenCount).toBe(4);
  });
});

async function seed(){
  await pool.query(`INSERT INTO businesses(id,name,business_type,country_code,currency_code,timezone,status) VALUES($1,'Pulse A','RETAIL','GH','GHS','Africa/Accra','ACTIVE'),($2,'Pulse B','RETAIL','GH','GHS','Africa/Accra','ACTIVE')`,[B1,B2]);
  await pool.query(`INSERT INTO branches(id,business_id,name,code,timezone,is_active) VALUES($1,$2,'Main','MAIN','Africa/Accra',true),($3,$4,'Foreign','MAIN','Africa/Accra',true)`,[BR1,B1,BR2,B2]);
  await pool.query(`INSERT INTO app_users(id,display_name,email,password_hash,status) VALUES($1,'Owner','pulse-owner@test.local','hash','ACTIVE'),($2,'Viewer','pulse-viewer@test.local','hash','ACTIVE')`,[OWNER,VIEWER]);
  await pool.query(`INSERT INTO staff(id,business_id,display_name,role,is_active) VALUES($1,$2,'Owner','OWNER',true),($3,$2,'Viewer','VIEWER',true)`,[OWNER_STAFF,B1,VIEWER_STAFF]);
  await pool.query(`INSERT INTO business_memberships(business_id,user_id,staff_id,role,status) VALUES($1,$2,$3,'OWNER','ACTIVE'),($1,$4,$5,'VIEWER','ACTIVE')`,[B1,OWNER,OWNER_STAFF,VIEWER,VIEWER_STAFF]);
  const att=(rule:string,severity:string,key:string)=>pool.query(`INSERT INTO business_attention_items(business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$5,'OPEN',$4,$4,'[]',$6,$6)`,[B1,BR1,key,rule,severity,T0]);
  await att("RECEIVABLES_OVERDUE","HIGH","receivables"); await att("STOCKOUT_RISK","MEDIUM","stock");
  await pool.query(`INSERT INTO business_action_items(business_id,branch_id,action_type,title,reason,evidence,assigned_user_id,assigned_staff_id,status,created_at,updated_at) VALUES($1,$2,'CREATE_FOLLOW_UP','Owner review','Review','[]',$3,$4,'OPEN',$5,$5),($1,$2,'CREATE_FOLLOW_UP','Viewer review','Review','[]',$6,$7,'OPEN',$5,$5)`,[B1,BR1,OWNER,OWNER_STAFF,T0,VIEWER,VIEWER_STAFF]);
}
