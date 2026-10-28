import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();

beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE
    auth_sessions,business_memberships,app_users,staff,branches,businesses
    CASCADE`);
});

afterAll(async () => {
  await pool.end();
});

describe("business intelligence and automation persistence", () => {
  it("creates tenant-scoped attention, policies, runs, and action items", async () => {
    const result = await pool.query<{
      attention: string | null;
      policies: string | null;
      runs: string | null;
      actions: string | null;
    }>(
      `SELECT
         to_regclass('business_attention_items')::text AS attention,
         to_regclass('business_automation_policies')::text AS policies,
         to_regclass('business_automation_runs')::text AS runs,
         to_regclass('business_action_items')::text AS actions`,
    );

    expect(result.rows[0]).toEqual({
      attention: "business_attention_items",
      policies: "business_automation_policies",
      runs: "business_automation_runs",
      actions: "business_action_items",
    });

    const columns = await pool.query<{ table_name: string; is_nullable: string }>(
      `SELECT table_name,is_nullable
       FROM information_schema.columns
       WHERE table_schema=current_schema()
         AND table_name = ANY($1::text[])
         AND column_name='business_id'
       ORDER BY table_name`,
      [["business_action_items", "business_attention_items", "business_automation_policies", "business_automation_runs"]],
    );
    expect(columns.rows).toEqual([
      { table_name: "business_action_items", is_nullable: "NO" },
      { table_name: "business_attention_items", is_nullable: "NO" },
      { table_name: "business_automation_policies", is_nullable: "NO" },
      { table_name: "business_automation_runs", is_nullable: "NO" },
    ]);
  });

  it("rejects a branch scope that belongs to another business", async () => {
    const businessA = await seedBusiness("Tenant A");
    const businessB = await seedBusiness("Tenant B");
    const branchA = await seedBranch(businessA, "A-MAIN");

    await expect(pool.query(
      `INSERT INTO business_attention_items(
         business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
       ) VALUES($1,$2,'cash-pressure','CASH_PRESSURE_FORECAST','HIGH','OPEN','Cash pressure','Cash is under pressure','[]')`,
      [businessB, branchA],
    )).rejects.toMatchObject({ code: "23503" });

    await expect(pool.query(
      `INSERT INTO business_attention_items(
         business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
       ) VALUES($1,$2,'cash-pressure','CASH_PRESSURE_FORECAST','HIGH','OPEN','Cash pressure','Cash is under pressure','[]')`,
      [businessA, branchA],
    )).resolves.toBeTruthy();
  });

  it("deduplicates an open attention source within business and branch scope but permits reopening", async () => {
    const businessId = await seedBusiness("Scoped Tenant");
    const branchId = await seedBranch(businessId, "MAIN");

    await insertAttention(businessId, branchId, "stockout:item-1");
    await expect(insertAttention(businessId, branchId, "stockout:item-1")).rejects.toMatchObject({ code: "23505" });

    const secondBranch = await seedBranch(businessId, "SECOND");
    await expect(insertAttention(businessId, secondBranch, "stockout:item-1")).resolves.toBeTruthy();

    await pool.query(
      `UPDATE business_attention_items
       SET state='RESOLVED',resolved_at=now(),updated_at=now()
       WHERE business_id=$1 AND branch_id=$2 AND source_key=$3 AND state='OPEN'`,
      [businessId, branchId, "stockout:item-1"],
    );
    await expect(insertAttention(businessId, branchId, "stockout:item-1")).resolves.toBeTruthy();

    await pool.query(
      `INSERT INTO business_attention_items(
         business_id,source_key,rule_code,severity,state,title,summary,evidence
       ) VALUES($1,'receivables:all','RECEIVABLES_OVERDUE','HIGH','OPEN','Receivables overdue','Customers owe overdue balances','[]')`,
      [businessId],
    );
    await expect(pool.query(
      `INSERT INTO business_attention_items(
         business_id,source_key,rule_code,severity,state,title,summary,evidence
       ) VALUES($1,'receivables:all','RECEIVABLES_OVERDUE','HIGH','OPEN','Duplicate','Duplicate','[]')`,
      [businessId],
    )).rejects.toMatchObject({ code: "23505" });
  });

  it("uses business, policy version, and trigger correlation as the automation idempotency boundary", async () => {
    const businessId = await seedBusiness("Automation Tenant");
    const userId = await seedUser("owner@automation.test");
    const policyId = await seedPolicy(businessId, userId);

    await insertRun(businessId, policyId, 1, "daily:2026-10-17");
    await expect(insertRun(businessId, policyId, 1, "daily:2026-10-17")).rejects.toMatchObject({ code: "23505" });
    await expect(insertRun(businessId, policyId, 2, "daily:2026-10-17")).resolves.toBeTruthy();
  });

  it("keeps action items workflow-only and restricts their lifecycle states", async () => {
    const forbidden = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name='business_action_items'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [["amount_minor", "cashbook_entry_id", "payment_id", "payment_method", "refund_id", "sale_id", "stock_quantity"]],
    );
    expect(forbidden.rows).toEqual([]);

    const businessId = await seedBusiness("Actions Tenant");
    for (const status of ["OPEN", "DONE", "SNOOZED", "CANCELED"]) {
      const completion = status === "DONE" ? "RESOLVED" : null;
      await expect(pool.query(
        `INSERT INTO business_action_items(business_id,title,reason,evidence,status,completion_outcome,completed_at)
         VALUES($1,$2,'Deterministic evidence','[]',$3,$4,CASE WHEN $3='DONE' THEN now() ELSE NULL END)`,
        [businessId, `Action ${status}`, status, completion],
      )).resolves.toBeTruthy();
    }

    await expect(pool.query(
      `INSERT INTO business_action_items(business_id,title,reason,evidence,status)
       VALUES($1,'Invalid','Invalid state','[]','POSTED')`,
      [businessId],
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("tracks structured action completion outcomes and completion actor audit", async () => {
    const columns = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name,is_nullable
       FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name='business_action_items'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [["completed_by_user_id", "completion_outcome"]],
    );
    expect(columns.rows).toEqual([
      { column_name: "completed_by_user_id", is_nullable: "YES" },
      { column_name: "completion_outcome", is_nullable: "YES" },
    ]);

    const businessId = await seedBusiness("Outcome Tenant");
    const userId = await seedUser("outcome@test.local");
    const open = await pool.query<{ id: string }>(
      `INSERT INTO business_action_items(business_id,title,reason,evidence,status)
       VALUES($1,'Outcome task','Evidence','[]','OPEN') RETURNING id`,
      [businessId],
    );

    await expect(pool.query(
      `UPDATE business_action_items
       SET status='DONE',completed_at=now(),completion_outcome='NOT_RELEVANT',completed_by_user_id=$2
       WHERE id=$1`,
      [open.rows[0]!.id, userId],
    )).resolves.toBeTruthy();

    await expect(pool.query(
      `INSERT INTO business_action_items(business_id,title,reason,evidence,status,completion_outcome)
       VALUES($1,'Bad outcome','Evidence','[]','DONE','FALSE_POSITIVE')`,
      [businessId],
    )).rejects.toMatchObject({ code: "23514" });

    await expect(pool.query(
      `INSERT INTO business_action_items(business_id,title,reason,evidence,status,completion_outcome)
       VALUES($1,'Open with outcome','Evidence','[]','OPEN','RESOLVED')`,
      [businessId],
    )).rejects.toMatchObject({ code: "23514" });

    await expect(pool.query(
      `INSERT INTO business_action_items(business_id,title,reason,evidence,status,completion_outcome,completed_at)
       VALUES($1,'Done default shape','Evidence','[]','DONE','RESOLVED',now())`,
      [businessId],
    )).resolves.toBeTruthy();

    await expect(pool.query(
      `UPDATE business_action_items SET completed_by_user_id='70000000-0000-4000-8000-000000009999' WHERE id=$1`,
      [open.rows[0]!.id],
    )).rejects.toMatchObject({ code: "23503" });

    const index = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname=current_schema() AND tablename='business_action_items'
         AND indexname='idx_business_action_feedback_recent'`,
    );
    expect(index.rows).toEqual([{ indexname: "idx_business_action_feedback_recent" }]);
  });

  it("tracks entity provenance, creator audit, and active entity-task uniqueness", async () => {
    const columns = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name,is_nullable
       FROM information_schema.columns
       WHERE table_schema=current_schema() AND table_name='business_action_items'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [["created_by_user_id", "source_entity_id", "source_entity_type"]],
    );
    expect(columns.rows).toEqual([
      { column_name: "created_by_user_id", is_nullable: "YES" },
      { column_name: "source_entity_id", is_nullable: "YES" },
      { column_name: "source_entity_type", is_nullable: "YES" },
    ]);

    const businessId = await seedBusiness("Entity Task Tenant");
    const branchId = await seedBranch(businessId, "ENTITY");
    const userId = await seedUser("entity-task@test.local");
    const entityId = "70000000-0000-4000-8000-000000000099";

    await expect(pool.query(
      `INSERT INTO business_action_items(
         business_id,branch_id,source_entity_type,title,reason,evidence,status
       ) VALUES($1,$2,'CUSTOMER','Invalid provenance','Missing id','[]','OPEN')`,
      [businessId, branchId],
    )).rejects.toMatchObject({ code: "23514" });

    await expect(pool.query(
      `INSERT INTO business_action_items(
         business_id,branch_id,source_entity_type,source_entity_id,title,reason,evidence,status
       ) VALUES($1,$2,'SQL_TABLE',$3,'Invalid type','Invalid type','[]','OPEN')`,
      [businessId, branchId, entityId],
    )).rejects.toMatchObject({ code: "23514" });

    await expect(pool.query(
      `INSERT INTO business_action_items(
         business_id,branch_id,source_entity_type,source_entity_id,created_by_user_id,action_type,title,reason,evidence,status
       ) VALUES($1,$2,'CUSTOMER',$3,$4,'CREATE_RECEIVABLE_FOLLOW_UP','Follow up','Evidence','[]','OPEN')`,
      [businessId, branchId, entityId, userId],
    )).resolves.toBeTruthy();

    await expect(pool.query(
      `INSERT INTO business_action_items(
         business_id,branch_id,source_entity_type,source_entity_id,created_by_user_id,action_type,title,reason,evidence,status
       ) VALUES($1,$2,'CUSTOMER',$3,$4,'CREATE_RECEIVABLE_FOLLOW_UP','Duplicate','Evidence','[]','SNOOZED')`,
      [businessId, branchId, entityId, userId],
    )).rejects.toMatchObject({ code: "23505" });

    await pool.query(
      `UPDATE business_action_items SET status='DONE',completed_at=now(),completion_outcome='RESOLVED'
       WHERE business_id=$1 AND source_entity_type='CUSTOMER' AND source_entity_id=$2`,
      [businessId, entityId],
    );

    await expect(pool.query(
      `INSERT INTO business_action_items(
         business_id,branch_id,source_entity_type,source_entity_id,created_by_user_id,action_type,title,reason,evidence,status
       ) VALUES($1,$2,'CUSTOMER',$3,$4,'CREATE_RECEIVABLE_FOLLOW_UP','Reopened','Evidence','[]','OPEN')`,
      [businessId, branchId, entityId, userId],
    )).resolves.toBeTruthy();

    await expect(pool.query(
      `INSERT INTO business_action_items(
         business_id,branch_id,source_entity_type,source_entity_id,created_by_user_id,action_type,title,reason,evidence,status
       ) VALUES($1,$2,'SUPPLIER',$3,'70000000-0000-4000-8000-000000009999','CREATE_FOLLOW_UP','Bad creator','Evidence','[]','OPEN')`,
      [businessId, branchId, "70000000-0000-4000-8000-000000000100"],
    )).rejects.toMatchObject({ code: "23503" });
  });

});

async function seedBusiness(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone)
     VALUES($1,'RETAIL','GH','GHS','Africa/Accra') RETURNING id`,
    [name],
  );
  return result.rows[0]!.id;
}

async function seedBranch(businessId: string, code: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO branches(business_id,name,code,timezone)
     VALUES($1,$2,$2,'Africa/Accra') RETURNING id`,
    [businessId, code],
  );
  return result.rows[0]!.id;
}

async function seedUser(email: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO app_users(display_name,email,password_hash,status)
     VALUES('AI Owner',$1,'test-hash','ACTIVE') RETURNING id`,
    [email],
  );
  return result.rows[0]!.id;
}

async function insertAttention(businessId: string, branchId: string, sourceKey: string) {
  return pool.query(
    `INSERT INTO business_attention_items(
       business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
     ) VALUES($1,$2,$3,'STOCKOUT_RISK','HIGH','OPEN','Stockout risk','Item may stock out','[]')`,
    [businessId, branchId, sourceKey],
  );
}

async function seedPolicy(businessId: string, userId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_automation_policies(
       business_id,code,name,enabled,trigger_type,conditions,action_type,action_configuration,
       policy_version,created_by_user_id,updated_by_user_id
     ) VALUES($1,$2,'Follow-up',true,'ATTENTION','{}','CREATE_FOLLOW_UP','{}',1,$3,$3)
     RETURNING id`,
    [businessId, `POLICY_${Math.random().toString(16).slice(2)}`, userId],
  );
  return result.rows[0]!.id;
}

async function insertRun(businessId: string, policyId: string, policyVersion: number, correlationId: string) {
  return pool.query(
    `INSERT INTO business_automation_runs(
       business_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,
       structured_input,output_summary,evidence
     ) VALUES($1,$2,$3,'ATTENTION',$4,'SUCCEEDED','{}','{}','[]')`,
    [businessId, policyId, policyVersion, correlationId],
  );
}
