import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE businesses CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("business intelligence and automation persistence", () => {
  it("creates the four tenant-scoped intelligence tables", async () => {
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
  });

  it("requires business_id on every row and rejects cross-business branch scope", async () => {
    const columns = await pool.query<{ table_name: string; is_nullable: string }>(
      `SELECT table_name,is_nullable
       FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name = ANY($1::text[])
         AND column_name='business_id'
       ORDER BY table_name`,
      [[
        "business_action_items",
        "business_attention_items",
        "business_automation_policies",
        "business_automation_runs",
      ]],
    );

    expect(columns.rows).toEqual([
      { table_name: "business_action_items", is_nullable: "NO" },
      { table_name: "business_attention_items", is_nullable: "NO" },
      { table_name: "business_automation_policies", is_nullable: "NO" },
      { table_name: "business_automation_runs", is_nullable: "NO" },
    ]);

    const businessA = await seedBusiness("Tenant AI A");
    const businessB = await seedBusiness("Tenant AI B");
    const branchB = await seedBranch(businessB, "B-MAIN");

    await expect(pool.query(
      `INSERT INTO business_attention_items(
         business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
       ) VALUES($1,$2,'CASH_PRESSURE:main','CASH_PRESSURE_FORECAST','HIGH','OPEN','Cash pressure','Evidence says cash pressure','[]'::jsonb)`,
      [businessA, branchB],
    )).rejects.toMatchObject({ code: "23503" });
  });

  it("deduplicates the same open attention signal per business/branch/rule/source and allows reopening after resolution", async () => {
    const businessId = await seedBusiness("Attention Business");
    const branchId = await seedBranch(businessId, "MAIN");

    const insert = () => pool.query(
      `INSERT INTO business_attention_items(
         business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence
       ) VALUES($1,$2,'receivables:overdue','RECEIVABLES_OVERDUE','HIGH','OPEN','Receivables overdue','Customers are overdue','[]'::jsonb)`,
      [businessId, branchId],
    );

    await insert();
    await expect(insert()).rejects.toMatchObject({ code: "23505" });

    await pool.query(
      `UPDATE business_attention_items
       SET state='RESOLVED',resolved_at=now(),updated_at=now()
       WHERE business_id=$1 AND branch_id=$2 AND source_key='receivables:overdue' AND state='OPEN'`,
      [businessId, branchId],
    );

    await expect(insert()).resolves.toBeTruthy();
  });

  it("treats business + policy/version + trigger correlation as the automation idempotency boundary", async () => {
    const businessId = await seedBusiness("Automation Business");
    const branchId = await seedBranch(businessId, "MAIN");
    const staffId = await seedStaff(businessId, "OWNER");
    const policyId = await seedPolicy(businessId, branchId, staffId, 2);

    const insertRun = (policyVersion: number) => pool.query(
      `INSERT INTO business_automation_runs(
         business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id,
         state,execution_class,structured_input,output_summary,proposed_action,evidence
       ) VALUES($1,$2,$3,$4,'ATTENTION','corr-123','WAITING_CONFIRMATION',2,'{}','{}','{}','[]')`,
      [businessId, branchId, policyId, policyVersion],
    );

    await insertRun(1);
    await expect(insertRun(1)).rejects.toMatchObject({ code: "23505" });
    await expect(insertRun(2)).resolves.toBeTruthy();
  });

  it("supports only workflow action-item states and contains no direct economic-posting columns", async () => {
    const businessId = await seedBusiness("Action Business");
    const branchId = await seedBranch(businessId, "MAIN");

    for (const status of ["OPEN", "DONE", "SNOOZED", "CANCELED"] as const) {
      await expect(pool.query(
        `INSERT INTO business_action_items(
           business_id,branch_id,title,reason,evidence,status
         ) VALUES($1,$2,$3,'Review this evidence','[]'::jsonb,$4)`,
        [businessId, branchId, `Action ${status}`, status],
      )).resolves.toBeTruthy();
    }

    await expect(pool.query(
      `INSERT INTO business_action_items(
         business_id,branch_id,title,reason,evidence,status
       ) VALUES($1,$2,'Bad state','Invalid','[]'::jsonb,'POSTED')`,
      [businessId, branchId],
    )).rejects.toMatchObject({ code: "23514" });

    const forbidden = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name='business_action_items'
         AND column_name = ANY($1::text[])`,
      [[
        "amount_minor",
        "payment_method",
        "payment_id",
        "refund_id",
        "stock_movement_id",
        "cashbook_entry_id",
        "role_id",
      ]],
    );
    expect(forbidden.rows).toEqual([]);
  });

  it("publishes the approved provider-neutral business intelligence contracts", () => {
    const contractPath = fileURLToPath(new URL("../../../packages/contracts/src/business-intelligence.ts", import.meta.url));
    expect(existsSync(contractPath)).toBe(true);
    if (!existsSync(contractPath)) return;

    const source = readFileSync(contractPath, "utf8");
    for (const exportedName of [
      "BusinessAttentionItem",
      "BusinessBriefing",
      "BusinessBriefingSection",
      "BusinessAssistantQueryRequest",
      "BusinessAssistantQueryResponse",
      "BusinessAutomationPolicy",
      "BusinessAutomationRun",
      "BusinessActionItem",
      "BusinessRecommendation",
    ]) {
      expect(source).toContain(`export interface ${exportedName}`);
    }

    const indexPath = fileURLToPath(new URL("../../../packages/contracts/src/index.ts", import.meta.url));
    expect(readFileSync(indexPath, "utf8")).toContain('export * from "./business-intelligence.js";');
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
    `INSERT INTO branches(business_id,name,code,timezone,is_active)
     VALUES($1,$2,$2,'Africa/Accra',true) RETURNING id`,
    [businessId, code],
  );
  return result.rows[0]!.id;
}

async function seedStaff(businessId: string, role: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO staff(business_id,display_name,role,is_active)
     VALUES($1,'AI Automation Owner',$2,true) RETURNING id`,
    [businessId, role],
  );
  return result.rows[0]!.id;
}

async function seedPolicy(
  businessId: string,
  branchId: string,
  staffId: string,
  executionClass: number,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO business_automation_policies(
       business_id,branch_id,code,name,enabled,trigger_type,conditions,action_type,
       action_configuration,execution_class,policy_version,created_by_staff_id,updated_by_staff_id
     ) VALUES($1,$2,$3,'Policy',true,'ATTENTION','{}','CREATE_FOLLOW_UP','{}',$4,1,$5,$5)
     RETURNING id`,
    [businessId, branchId, `POLICY_${Math.random().toString(16).slice(2)}`, executionClass, staffId],
  );
  return result.rows[0]!.id;
}
