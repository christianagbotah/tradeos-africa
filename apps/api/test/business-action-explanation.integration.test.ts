import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "../src/migrations/migration-runner.js";
import { createBusinessEntityActionItem } from "../src/business-intelligence/entity-action-service.js";
import { explainBusinessActionItem } from "../src/business-intelligence/action-explanation-service.js";
import { listBusinessActionItems } from "../src/business-intelligence/automation-service.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `action_explain_test_${crypto.randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");

const B1 = "89000000-0000-4000-8000-000000000001";
const B2 = "89000000-0000-4000-8000-000000000002";
const BR1 = "89000000-0000-4000-8000-000000000011";
const BR2 = "89000000-0000-4000-8000-000000000012";
const OWNER = "89000000-0000-4000-8000-000000000021";
const OWNER_STAFF = "89000000-0000-4000-8000-000000000022";
const SUPPLIER = "89000000-0000-4000-8000-000000000031";
const PURCHASE = "89000000-0000-4000-8000-000000000032";
const NOW = new Date("2026-10-24T12:00:00.000Z");

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  await applyMigrations(pool, { migrationDirectory });
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE businesses,app_users CASCADE");
  await seedFixture();
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await adminPool.end();
});

describe("business action item explanation", () => {
  it("explains an entity review and reapplies current role evidence permissions", async () => {
    const created = await createBusinessEntityActionItem(pool, { userId: OWNER, businessId: B1 }, {
      businessId: B1, branchId: BR1, entityType: "SUPPLIER", entityId: SUPPLIER, now: NOW,
    });
    expect(created.item.evidence.some((item) => item.label === "recentPurchaseTotalMinor30d")).toBe(true);

    const ownerExplanation = await explainBusinessActionItem(pool, {
      userId: OWNER, businessId: B1, role: "OWNER", staffId: OWNER_STAFF,
    }, created.item.id, NOW);
    expect(ownerExplanation).toMatchObject({
      businessId: B1,
      branchId: BR1,
      actionItemId: created.item.id,
      sourceKind: "ENTITY_REVIEW",
      entity: { entityType: "SUPPLIER", entityId: SUPPLIER },
    });
    expect(ownerExplanation.evidence.some((item) => item.label === "recentPurchaseTotalMinor30d")).toBe(true);

    await pool.query(`UPDATE business_memberships SET role='INVENTORY' WHERE business_id=$1 AND user_id=$2`, [B1, OWNER]);
    const inventoryExplanation = await explainBusinessActionItem(pool, {
      userId: OWNER, businessId: B1, role: "INVENTORY", staffId: OWNER_STAFF,
    }, created.item.id, NOW);
    expect(inventoryExplanation.evidence.some((item) => item.label === "recentPurchaseTotalMinor30d")).toBe(false);
  });

  it("resolves automation policy, run and attention provenance in the same business", async () => {
    const policyId = crypto.randomUUID();
    const attentionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const actionId = crypto.randomUUID();
    await pool.query(`INSERT INTO business_attention_items(
      id,business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence,first_seen_at,last_seen_at
    ) VALUES($1,$2,$3,'explain-attention','PAYABLES_OVERDUE','HIGH','OPEN','Supplier payable overdue','A supplier balance is overdue','[]',$4,$4)`,
    [attentionId,B1,BR1,NOW]);
    await pool.query(`INSERT INTO business_automation_policies(
      id,business_id,branch_id,code,name,enabled,trigger_type,conditions,action_type,action_configuration,policy_version,created_by_user_id,updated_by_user_id
    ) VALUES($1,$2,$3,'payables-review','Payables review',true,'ATTENTION','{}','CREATE_PAYABLES_REVIEW','{}',3,$4,$4)`,
    [policyId,B1,BR1,OWNER]);
    await pool.query(`INSERT INTO business_automation_runs(
      id,business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,structured_input,output_summary,evidence,started_at,completed_at,created_at,updated_at
    ) VALUES($1,$2,$3,$4,3,'ATTENTION',$5,'SUCCEEDED',$6::jsonb,'{}','[]',$7,$7,$7,$7)`,
    [runId,B1,BR1,policyId,`attention:${attentionId}`,JSON.stringify({ executionOrigin: "SYSTEM_DISPATCHER" }),NOW]);
    await pool.query(`INSERT INTO business_action_items(
      id,business_id,branch_id,source_attention_item_id,source_automation_run_id,action_type,title,reason,evidence,assigned_user_id,assigned_staff_id,status
    ) VALUES($1,$2,$3,$4,$5,'CREATE_PAYABLES_REVIEW','Review supplier payables','Payables need review','[]',$6,$7,'OPEN')`,
    [actionId,B1,BR1,attentionId,runId,OWNER,OWNER_STAFF]);

    const explanation = await explainBusinessActionItem(pool, {
      userId: OWNER, businessId: B1, role: "OWNER", staffId: OWNER_STAFF,
    }, actionId, NOW);
    expect(explanation.sourceKind).toBe("AUTOMATION");
    expect(explanation.automation).toMatchObject({
      policyId,
      policyName: "Payables review",
      policyVersion: 3,
      triggerType: "ATTENTION",
      triggerSource: "ATTENTION",
      runId,
    });
    expect(explanation.attention).toMatchObject({ id: attentionId, ruleCode: "PAYABLES_OVERDUE", severity: "HIGH", title: "Supplier payable overdue" });
    expect(explanation.summary).toContain("Payables review");
  });

  it("does not re-expose financial automation evidence after the assignee is downgraded", async () => {
    const policyId = crypto.randomUUID();
    const attentionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const actionId = crypto.randomUUID();
    const financialEvidence = [{
      source: "supplier_credit_obligations", entityType: "SUPPLIER", entityId: SUPPLIER,
      label: "openPayableMinor", value: "12500", metadata: { kind: "money_minor", currencyCode: "GHS" },
    }];
    await pool.query(`INSERT INTO business_attention_items(
      id,business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence,first_seen_at,last_seen_at
    ) VALUES($1,$2,$3,'explain-private-payables','PAYABLES_OVERDUE','HIGH','OPEN','Payables overdue','GHS 125.00 is overdue',$4::jsonb,$5,$5)`,
    [attentionId,B1,BR1,JSON.stringify(financialEvidence),NOW]);
    await pool.query(`INSERT INTO business_automation_policies(
      id,business_id,branch_id,code,name,enabled,trigger_type,conditions,action_type,action_configuration,policy_version,created_by_user_id,updated_by_user_id
    ) VALUES($1,$2,$3,'private-payables-review','Private payables review',true,'ATTENTION','{}','CREATE_PAYABLES_REVIEW','{}',1,$4,$4)`,
    [policyId,B1,BR1,OWNER]);
    await pool.query(`INSERT INTO business_automation_runs(
      id,business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,structured_input,output_summary,evidence,started_at,completed_at,created_at,updated_at
    ) VALUES($1,$2,$3,$4,1,'ATTENTION',$5,'SUCCEEDED','{}','{}',$6::jsonb,$7,$7,$7,$7)`,
    [runId,B1,BR1,policyId,`attention:${attentionId}`,JSON.stringify(financialEvidence),NOW]);
    await pool.query(`INSERT INTO business_action_items(
      id,business_id,branch_id,source_attention_item_id,source_automation_run_id,action_type,title,reason,evidence,assigned_user_id,assigned_staff_id,status
    ) VALUES($1,$2,$3,$4,$5,'CREATE_PAYABLES_REVIEW','Review supplier payables','A supplier balance is overdue',$6::jsonb,$7,$8,'OPEN')`,
    [actionId,B1,BR1,attentionId,runId,JSON.stringify(financialEvidence),OWNER,OWNER_STAFF]);

    await pool.query(`UPDATE business_memberships SET role='INVENTORY' WHERE business_id=$1 AND user_id=$2`, [B1,OWNER]);
    const explanation = await explainBusinessActionItem(pool, {
      userId: OWNER, businessId: B1, role: "INVENTORY", staffId: OWNER_STAFF,
    }, actionId, NOW);

    expect(explanation.sourceKind).toBe("AUTOMATION");
    expect(explanation.evidence).toEqual([]);
    expect(explanation.action.evidence).toEqual([]);
    expect(explanation.attention).toBeUndefined();

    const queue = await listBusinessActionItems(pool, {
      userId: OWNER, businessId: B1, role: "INVENTORY", staffId: OWNER_STAFF,
    }, BR1);
    const visible = queue.find((item) => item.id === actionId);
    expect(visible).toBeTruthy();
    expect(visible?.evidence).toEqual([]);
  });

  it("classifies provenance-free items as manual and rejects foreign action ids safely", async () => {
    const manualId = crypto.randomUUID();
    await pool.query(`INSERT INTO business_action_items(
      id,business_id,branch_id,action_type,title,reason,evidence,assigned_user_id,assigned_staff_id,status
    ) VALUES($1,$2,$3,'CREATE_FOLLOW_UP','Manual follow-up','A user created this review','[]',$4,$5,'OPEN')`,
    [manualId,B1,BR1,OWNER,OWNER_STAFF]);
    const manual = await explainBusinessActionItem(pool, {
      userId: OWNER, businessId: B1, role: "OWNER", staffId: OWNER_STAFF,
    }, manualId, NOW);
    expect(manual.sourceKind).toBe("MANUAL");
    expect(manual.summary).toContain("A user created this review");

    const foreignId = crypto.randomUUID();
    await pool.query(`INSERT INTO business_action_items(id,business_id,branch_id,title,reason,evidence,status)
      VALUES($1,$2,$3,'Foreign','Foreign action','[]','OPEN')`, [foreignId,B2,BR2]);
    await expect(explainBusinessActionItem(pool, {
      userId: OWNER, businessId: B1, role: "OWNER", staffId: OWNER_STAFF,
    }, foreignId, NOW)).rejects.toMatchObject({ statusCode: 404, code: "BUSINESS_ACTION_ITEM_NOT_FOUND" });
  });

  it("is read-only across economic and access ledgers", async () => {
    const manualId = crypto.randomUUID();
    await pool.query(`INSERT INTO business_action_items(id,business_id,branch_id,title,reason,evidence,assigned_user_id,assigned_staff_id,status)
      VALUES($1,$2,$3,'Read only','Explain me','[]',$4,$5,'OPEN')`, [manualId,B1,BR1,OWNER,OWNER_STAFF]);
    const before = await invariantCounts();
    await explainBusinessActionItem(pool, { userId: OWNER, businessId: B1, role: "OWNER", staffId: OWNER_STAFF }, manualId, NOW);
    expect(await invariantCounts()).toEqual(before);
  });
});

async function invariantCounts() {
  const result = await pool.query<Record<string, number>>(`SELECT
    (SELECT count(*)::int FROM sales) AS sales,
    (SELECT count(*)::int FROM payments) AS payments,
    (SELECT count(*)::int FROM return_cases) AS returns,
    (SELECT count(*)::int FROM inventory_movements) AS inventory,
    (SELECT count(*)::int FROM cashbook_entries) AS cashbook,
    (SELECT count(*)::int FROM business_memberships) AS memberships,
    (SELECT count(*)::int FROM staff) AS staff`);
  return result.rows[0]!;
}

async function seedFixture() {
  await pool.query(`INSERT INTO businesses(id,name,business_type,country_code,currency_code,timezone,status) VALUES
    ($1,'Explain Tenant','RETAIL','GH','GHS','Africa/Accra','ACTIVE'),
    ($2,'Foreign Tenant','RETAIL','GH','GHS','Africa/Accra','ACTIVE')`, [B1,B2]);
  await pool.query(`INSERT INTO branches(id,business_id,name,code,timezone,is_active) VALUES
    ($1,$2,'Main','MAIN','Africa/Accra',true),($3,$4,'Foreign','MAIN','Africa/Accra',true)`, [BR1,B1,BR2,B2]);
  await pool.query(`INSERT INTO app_users(id,display_name,email,password_hash,status) VALUES
    ($1,'Owner','explain-owner@test.local','hash','ACTIVE')`, [OWNER]);
  await pool.query(`INSERT INTO staff(id,business_id,display_name,role,is_active) VALUES($1,$2,'Owner','OWNER',true)`, [OWNER_STAFF,B1]);
  await pool.query(`INSERT INTO business_memberships(business_id,user_id,staff_id,role,status,created_by_user_id)
    VALUES($1,$2,$3,'OWNER','ACTIVE',$2)`, [B1,OWNER,OWNER_STAFF]);
  await pool.query(`INSERT INTO suppliers(id,business_id,name,payment_terms_days,is_active) VALUES($1,$2,'Supplier Explain',14,true)`, [SUPPLIER,B1]);
  await pool.query(`INSERT INTO purchases(id,business_id,branch_id,supplier_id,received_by_staff_id,status,currency_code,settlement_method,total_minor,client_mutation_id,received_at)
    VALUES($1,$2,$3,$4,$5,'RECEIVED','GHS','CASH',12500,'explain-purchase',$6)`, [PURCHASE,B1,BR1,SUPPLIER,OWNER_STAFF,NOW]);
}
