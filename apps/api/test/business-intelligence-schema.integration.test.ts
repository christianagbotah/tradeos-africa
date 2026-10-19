import { afterAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();

afterAll(async () => {
  await pool.end();
});

describe("business intelligence persistence", () => {
  it("creates tenant-scoped attention, automation, run, and action-item tables", async () => {
    const result = await pool.query<{
      attention: string | null;
      policies: string | null;
      runs: string | null;
      actions: string | null;
    }>(`SELECT
      to_regclass('business_attention_items')::text AS attention,
      to_regclass('business_automation_policies')::text AS policies,
      to_regclass('business_automation_runs')::text AS runs,
      to_regclass('business_action_items')::text AS actions`);

    expect(result.rows[0]).toEqual({
      attention: "business_attention_items",
      policies: "business_automation_policies",
      runs: "business_automation_runs",
      actions: "business_action_items",
    });
  });

  it("requires every record to stay inside its business and rejects a branch from another business", async () => {
    const businessA = await seedBusiness("AI Scope A");
    const businessB = await seedBusiness("AI Scope B");
    const branchB = await seedBranch(businessB, "B1");

    await expect(pool.query(
      `INSERT INTO business_attention_items(
        business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
      ) VALUES($1,$2,'scope-test','LOW_DATA_CONFIDENCE','INFO','OPEN','Scope','Scope check','[]')`,
      [businessA, branchB],
    )).rejects.toBeTruthy();

    await expect(pool.query(
      `INSERT INTO business_attention_items(
        business_id,source_key,rule_code,severity,state,title,summary,evidence
      ) VALUES(NULL,'missing-business','LOW_DATA_CONFIDENCE','INFO','OPEN','Missing','Missing business','[]')`,
    )).rejects.toBeTruthy();
  });

  it("deduplicates open attention by business, branch and source key but allows a new item after resolution", async () => {
    const businessId = await seedBusiness("AI Attention");
    const branchId = await seedBranch(businessId, "MAIN");

    await pool.query(
      `INSERT INTO business_attention_items(
        business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
      ) VALUES($1,$2,'stockout:item-1','STOCKOUT_RISK','HIGH','OPEN','Stock risk','Stock risk','[]')`,
      [businessId, branchId],
    );

    await expect(pool.query(
      `INSERT INTO business_attention_items(
        business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
      ) VALUES($1,$2,'stockout:item-1','STOCKOUT_RISK','HIGH','OPEN','Duplicate','Duplicate','[]')`,
      [businessId, branchId],
    )).rejects.toMatchObject({ code: "23505" });

    await pool.query(
      `UPDATE business_attention_items SET state='RESOLVED',resolved_at=now(),updated_at=now()
       WHERE business_id=$1 AND branch_id=$2 AND source_key='stockout:item-1' AND state='OPEN'`,
      [businessId, branchId],
    );

    await expect(pool.query(
      `INSERT INTO business_attention_items(
        business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
      ) VALUES($1,$2,'stockout:item-1','STOCKOUT_RISK','HIGH','OPEN','Returned','Returned','[]')`,
      [businessId, branchId],
    )).resolves.toBeTruthy();
  });

  it("makes business + policy version + trigger correlation the automation idempotency boundary", async () => {
    const businessId = await seedBusiness("AI Automation");
    const userId = await seedUser();
    const policyId = await seedPolicy(businessId, userId);

    await pool.query(
      `INSERT INTO business_automation_runs(
        business_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,action_type,evidence
      ) VALUES($1,$2,1,'ATTENTION','corr-1','SUCCEEDED','CREATE_FOLLOW_UP','[]')`,
      [businessId, policyId],
    );

    await expect(pool.query(
      `INSERT INTO business_automation_runs(
        business_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,action_type,evidence
      ) VALUES($1,$2,1,'ATTENTION','corr-1','SUCCEEDED','CREATE_FOLLOW_UP','[]')`,
      [businessId, policyId],
    )).rejects.toMatchObject({ code: "23505" });

    await expect(pool.query(
      `INSERT INTO business_automation_runs(
        business_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,action_type,evidence
      ) VALUES($1,$2,2,'ATTENTION','corr-1','SUCCEEDED','CREATE_FOLLOW_UP','[]')`,
      [businessId, policyId],
    )).resolves.toBeTruthy();
  });

  it("keeps action items as workflow records with constrained statuses and no economic posting columns", async () => {
    const businessId = await seedBusiness("AI Actions");

    await expect(pool.query(
      `INSERT INTO business_action_items(business_id,title,reason,evidence,status)
       VALUES($1,'Review cash','Forecast risk','[]','OPEN')`,
      [businessId],
    )).resolves.toBeTruthy();

    await expect(pool.query(
      `INSERT INTO business_action_items(business_id,title,reason,evidence,status)
       VALUES($1,'Bad status','Bad','[]','POSTED')`,
      [businessId],
    )).rejects.toMatchObject({ code: "23514" });

    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='business_action_items'`,
    );
    const names = new Set(columns.rows.map((row) => row.column_name));
    expect(names.has("amount_minor")).toBe(false);
    expect(names.has("payment_id")).toBe(false);
    expect(names.has("stock_quantity_delta")).toBe(false);
  });
});

async function seedBusiness(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone)
     VALUES($1,'RETAIL','GH','GHS','Africa/Accra') RETURNING id`,
    [`${name}-${crypto.randomUUID()}`],
  );
  return result.rows[0]!.id;
}

async function seedBranch(businessId: string, code: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO branches(business_id,name,code,timezone)
     VALUES($1,'Branch',$2,'Africa/Accra') RETURNING id`,
    [businessId, `${code}-${crypto.randomUUID().slice(0, 8)}`],
  );
  return result.rows[0]!.id;
}

async function seedUser(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO app_users(display_name,email,password_hash,status)
     VALUES('AI Owner',$1,'test-hash','ACTIVE') RETURNING id`,
    [`ai-${crypto.randomUUID()}@tradeos.test`],
  );
  return result.rows[0]!.id;
}

async function seedPolicy(businessId: string, userId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_automation_policies(
      business_id,code,name,enabled,trigger_type,conditions,action_type,action_configuration,
      policy_version,created_by_user_id,updated_by_user_id
    ) VALUES($1,$2,'Policy',true,'ATTENTION','{}','CREATE_FOLLOW_UP','{}',1,$3,$3)
    RETURNING id`,
    [businessId, `POLICY_${crypto.randomUUID()}`, userId],
  );
  return result.rows[0]!.id;
}
