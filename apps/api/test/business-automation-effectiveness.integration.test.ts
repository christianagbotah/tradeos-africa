import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "../src/migrations/migration-runner.js";
import { getBusinessAutomationEffectiveness } from "../src/business-intelligence/automation-effectiveness-service.js";

const { Pool } = pg;
const baseDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const schema = `automation_effectiveness_${crypto.randomBytes(8).toString("hex")}`;
const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
const adminPool = new Pool({ connectionString: baseDatabaseUrl });
const pool = new Pool({ connectionString: baseDatabaseUrl, options: `-c search_path=${schema},public` });
const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.resolve(testDir, "../../../packages/db/migrations");

const B1 = "91000000-0000-4000-8000-000000000001";
const B2 = "92000000-0000-4000-8000-000000000001";
const BR1 = "91000000-0000-4000-8000-000000000002";
const BR2 = "91000000-0000-4000-8000-000000000003";
const USER = "91000000-0000-4000-8000-000000000010";
const P1 = "91000000-0000-4000-8000-000000000020";
const P2 = "91000000-0000-4000-8000-000000000021";
const PZERO = "91000000-0000-4000-8000-000000000022";
const POTHER = "91000000-0000-4000-8000-000000000023";
const NOW = new Date("2026-10-25T16:00:00.000Z");

beforeAll(async () => {
  await adminPool.query(`CREATE SCHEMA ${quotedSchema}`);
  await applyMigrations(pool, { migrationDirectory });
  await seed();
});

afterAll(async () => {
  await pool.end();
  await adminPool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
  await adminPool.end();
});

describe("business automation effectiveness", () => {
  it("aggregates automated review outcomes per policy while separating manual entity reviews", async () => {
    const result = await getBusinessAutomationEffectiveness(pool, { businessId: B1, branchId: BR1, now: NOW });

    expect(result).toMatchObject({
      businessId: B1,
      branchId: BR1,
      windowDays: 30,
      summary: {
        automatedTasksCreated: 4,
        automatedTasksCompleted: 2,
        automatedTasksOpen: 1,
        automatedTasksSnoozed: 1,
        negativeOutcomeCount: 1,
        medianCompletionHours: 4,
        manualEntityReviewsCreated: 1,
      },
      outcomes: { resolved: 1, alreadyHandled: 0, notRelevant: 1, noActionNeeded: 0 },
    });
    expect(result.summary.completionRate).toBeCloseTo(0.5, 6);
    expect(result.summary.relevantOutcomeRate).toBeCloseTo(0.5, 6);

    const inventory = result.policies.find((row) => row.policyId === P1);
    expect(inventory).toMatchObject({
      name: "Inventory health review",
      tasksCreated: 3,
      tasksCompleted: 2,
      tasksOpen: 1,
      tasksSnoozed: 0,
      relevantOutcomes: 1,
      negativeOutcomes: 1,
      medianCompletionHours: 4,
      lastTaskAt: "2026-10-25T10:00:00.000Z",
    });
    expect(inventory?.completionRate).toBeCloseTo(2 / 3, 6);
    expect(inventory?.relevantOutcomeRate).toBeCloseTo(0.5, 6);

    expect(result.policies.find((row) => row.policyId === PZERO)).toMatchObject({
      tasksCreated: 0,
      tasksCompleted: 0,
      completionRate: 0,
      relevantOutcomeRate: 0,
      medianCompletionHours: null,
      lastTaskAt: null,
    });
    expect(result.policies.some((row) => row.policyId === POTHER)).toBe(false);
  });

  it("does not expose evidence, source keys, contact data, entity labels or money fields", async () => {
    const result = await getBusinessAutomationEffectiveness(pool, { businessId: B1, branchId: BR1, now: NOW });
    const serialized = JSON.stringify(result);
    for (const forbidden of ["evidence", "sourceKey", "source_key", "phone", "email", "entityLabel", "Minor", "minor"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

async function seed() {
  await pool.query(`INSERT INTO businesses(id,name,business_type,country_code,currency_code,timezone,status) VALUES
    ($1,'Effectiveness','RETAIL','GH','GHS','Africa/Accra','ACTIVE'),
    ($2,'Foreign','RETAIL','GH','GHS','Africa/Accra','ACTIVE')`, [B1, B2]);
  await pool.query(`INSERT INTO branches(id,business_id,name,code,timezone,is_active) VALUES
    ($1,$2,'Main','MAIN','Africa/Accra',true),($3,$2,'Second','SECOND','Africa/Accra',true)`, [BR1,B1,BR2]);
  await pool.query(`INSERT INTO app_users(id,display_name,email,password_hash,status) VALUES($1,'Owner','effectiveness@test.local','hash','ACTIVE')`, [USER]);
  await pool.query(`INSERT INTO business_automation_policies(
      id,business_id,branch_id,code,name,enabled,trigger_type,conditions,action_type,action_configuration,policy_version,created_by_user_id,updated_by_user_id
    ) VALUES
      ($1,$5,$6,'inventory-health','Inventory health review',true,'ATTENTION','{}','CREATE_INVENTORY_REVIEW','{}',1,$7,$7),
      ($2,$5,NULL,'performance','Performance review',true,'ATTENTION','{}','CREATE_PERFORMANCE_REVIEW','{}',1,$7,$7),
      ($3,$5,$6,'quiet','Quiet policy',false,'ATTENTION','{}','CREATE_FOLLOW_UP','{}',1,$7,$7),
      ($4,$5,$8,'other-branch','Other branch policy',true,'ATTENTION','{}','CREATE_FOLLOW_UP','{}',1,$7,$7)`,
    [P1,P2,PZERO,POTHER,B1,BR1,USER,BR2]);

  const tasks = [
    { policy: P1, run: "91000000-0000-4000-8000-000000000101", action: "91000000-0000-4000-8000-000000000201", created: "2026-10-25T04:00:00Z", completed: "2026-10-25T06:00:00Z", status: "DONE", outcome: "RESOLVED" },
    { policy: P1, run: "91000000-0000-4000-8000-000000000102", action: "91000000-0000-4000-8000-000000000202", created: "2026-10-25T06:00:00Z", completed: "2026-10-25T12:00:00Z", status: "DONE", outcome: "NOT_RELEVANT" },
    { policy: P1, run: "91000000-0000-4000-8000-000000000103", action: "91000000-0000-4000-8000-000000000203", created: "2026-10-25T10:00:00Z", completed: null, status: "OPEN", outcome: null },
    { policy: P2, run: "91000000-0000-4000-8000-000000000104", action: "91000000-0000-4000-8000-000000000204", created: "2026-10-24T10:00:00Z", completed: null, status: "SNOOZED", outcome: null },
  ] as const;
  for (const task of tasks) {
    await pool.query(`INSERT INTO business_automation_runs(
        id,business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,structured_input,output_summary,evidence,started_at,completed_at,created_at,updated_at
      ) VALUES($1,$2,$3,$4,1,'ATTENTION',$5,'SUCCEEDED','{}','{}','[]',$6,$7,$6,$6)`,
      [task.run,B1,BR1,task.policy,`effectiveness:${task.run}`,task.created,task.completed ?? task.created]);
    await pool.query(`INSERT INTO business_action_items(
        id,business_id,branch_id,source_automation_run_id,action_type,title,reason,evidence,status,completion_outcome,completed_by_user_id,completed_at,created_at,updated_at
      ) VALUES($1,$2,$3,$4,'CREATE_FOLLOW_UP','Review','Reason','[]',$5,$6,CASE WHEN $5='DONE' THEN $7::uuid ELSE NULL END,$8,$9,$9)`,
      [task.action,B1,BR1,task.run,task.status,task.outcome,USER,task.completed,task.created]);
  }
  await pool.query(`INSERT INTO business_action_items(
      id,business_id,branch_id,source_entity_type,source_entity_id,created_by_user_id,action_type,title,reason,evidence,status,created_at,updated_at
    ) VALUES('91000000-0000-4000-8000-000000000250',$1,$2,'CATALOG_ITEM','91000000-0000-4000-8000-000000000260',$3,'CREATE_REORDER_REVIEW','Manual review','Reason','[]','OPEN',$4,$4)`,
    [B1,BR1,USER,"2026-10-25T08:00:00Z"]);

  await pool.query(`INSERT INTO business_automation_runs(
      id,business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,structured_input,output_summary,evidence,started_at,completed_at,created_at,updated_at
    ) VALUES('91000000-0000-4000-8000-000000000150',$1,$2,$3,1,'ATTENTION','other-branch','SUCCEEDED','{}','{}','[]',$4,$4,$4,$4)`, [B1,BR2,POTHER,"2026-10-25T09:00:00Z"]);
  await pool.query(`INSERT INTO business_action_items(
      id,business_id,branch_id,source_automation_run_id,action_type,title,reason,evidence,status,created_at,updated_at
    ) VALUES('91000000-0000-4000-8000-000000000251',$1,$2,'91000000-0000-4000-8000-000000000150','CREATE_FOLLOW_UP','Other branch','Reason','[]','OPEN',$3,$3)`, [B1,BR2,"2026-10-25T09:00:00Z"]);
}
