import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();

beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE
    platform_admin_sessions,platform_audit_events,platform_users,businesses
    CASCADE`);
});

afterAll(async () => {
  await pool.end();
});

describe("platform attention and automation persistence", () => {
  it("creates the attention, policy, and run tables", async () => {
    const result = await pool.query<{
      attention: string | null;
      policies: string | null;
      runs: string | null;
    }>(
      `SELECT
         to_regclass('platform_attention_items')::text AS attention,
         to_regclass('platform_automation_policies')::text AS policies,
         to_regclass('platform_automation_runs')::text AS runs`,
    );

    expect(result.rows[0]).toEqual({
      attention: "platform_attention_items",
      policies: "platform_automation_policies",
      runs: "platform_automation_runs",
    });
  });

  it("deduplicates the same open attention source within the same scope but allows a new item after resolution", async () => {
    const businessId = await seedBusiness("Attention Tenant");

    await pool.query(
      `INSERT INTO platform_attention_items(
         source_key,rule_code,business_id,severity,state,title,summary,evidence
       ) VALUES('SUBSCRIPTION_PAST_DUE:tenant','SUBSCRIPTION_PAST_DUE',$1,'HIGH','OPEN','Past due','Subscription is past due','{}'::jsonb)`,
      [businessId],
    );

    await expect(pool.query(
      `INSERT INTO platform_attention_items(
         source_key,rule_code,business_id,severity,state,title,summary,evidence
       ) VALUES('SUBSCRIPTION_PAST_DUE:tenant','SUBSCRIPTION_PAST_DUE',$1,'HIGH','OPEN','Duplicate','Duplicate signal','{}'::jsonb)`,
      [businessId],
    )).rejects.toMatchObject({ code: "23505" });

    await pool.query(
      `UPDATE platform_attention_items
       SET state='RESOLVED',resolved_at=now(),updated_at=now()
       WHERE source_key='SUBSCRIPTION_PAST_DUE:tenant' AND business_id=$1 AND state='OPEN'`,
      [businessId],
    );

    await expect(pool.query(
      `INSERT INTO platform_attention_items(
         source_key,rule_code,business_id,severity,state,title,summary,evidence
       ) VALUES('SUBSCRIPTION_PAST_DUE:tenant','SUBSCRIPTION_PAST_DUE',$1,'HIGH','OPEN','Reopened','Condition returned','{}'::jsonb)`,
      [businessId],
    )).resolves.toBeTruthy();
  });

  it("makes policy/version/trigger correlation an idempotency boundary", async () => {
    const adminId = await seedPlatformAdmin("automation-owner@tradeos.test");
    const policyId = await seedPolicy(adminId, 2);

    await pool.query(
      `INSERT INTO platform_automation_runs(
         policy_id,policy_version,trigger_source,trigger_correlation_id,state,execution_class,
         structured_input,output_summary,proposed_action,evidence
       ) VALUES($1,1,'ATTENTION','corr-123','WAITING_APPROVAL',2,'{}','{}','{}','[]')`,
      [policyId],
    );

    await expect(pool.query(
      `INSERT INTO platform_automation_runs(
         policy_id,policy_version,trigger_source,trigger_correlation_id,state,execution_class,
         structured_input,output_summary,proposed_action,evidence
       ) VALUES($1,1,'ATTENTION','corr-123','WAITING_APPROVAL',2,'{}','{}','{}','[]')`,
      [policyId],
    )).rejects.toMatchObject({ code: "23505" });

    await expect(pool.query(
      `INSERT INTO platform_automation_runs(
         policy_id,policy_version,trigger_source,trigger_correlation_id,state,execution_class,
         structured_input,output_summary,proposed_action,evidence
       ) VALUES($1,2,'ATTENTION','corr-123','WAITING_APPROVAL',2,'{}','{}','{}','[]')`,
      [policyId],
    )).resolves.toBeTruthy();
  });

  it("restricts execution class and run state to the approved automation model", async () => {
    const adminId = await seedPlatformAdmin("constraints@tradeos.test");

    await expect(seedPolicy(adminId, 4)).rejects.toMatchObject({ code: "23514" });
    const policyId = await seedPolicy(adminId, 1);

    await expect(pool.query(
      `INSERT INTO platform_automation_runs(
         policy_id,policy_version,trigger_source,trigger_correlation_id,state,execution_class,
         structured_input,output_summary,proposed_action,evidence
       ) VALUES($1,1,'EVENT','bad-state','NOT_A_STATE',1,'{}','{}','{}','[]')`,
      [policyId],
    )).rejects.toMatchObject({ code: "23514" });

    await expect(pool.query(
      `INSERT INTO platform_automation_runs(
         policy_id,policy_version,trigger_source,trigger_correlation_id,state,execution_class,
         structured_input,output_summary,proposed_action,evidence
       ) VALUES($1,1,'EVENT','bad-class','QUEUED',5,'{}','{}','{}','[]')`,
      [policyId],
    )).rejects.toMatchObject({ code: "23514" });
  });

  it("enforces platform-user foreign keys for approver and executor identities", async () => {
    const adminId = await seedPlatformAdmin("approvals@tradeos.test");
    const policyId = await seedPolicy(adminId, 2);

    await expect(pool.query(
      `INSERT INTO platform_automation_runs(
         policy_id,policy_version,trigger_source,trigger_correlation_id,state,execution_class,
         structured_input,output_summary,proposed_action,evidence,approved_by_platform_user_id
       ) VALUES($1,1,'EVENT','bad-approver','APPROVED',2,'{}','{}','{}','[]',gen_random_uuid())`,
      [policyId],
    )).rejects.toMatchObject({ code: "23503" });

    await expect(pool.query(
      `INSERT INTO platform_automation_runs(
         policy_id,policy_version,trigger_source,trigger_correlation_id,state,execution_class,
         structured_input,output_summary,proposed_action,evidence,executed_by_platform_user_id
       ) VALUES($1,1,'EVENT','bad-executor','EXECUTING',2,'{}','{}','{}','[]',gen_random_uuid())`,
      [policyId],
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

async function seedPlatformAdmin(email: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO platform_users(email,display_name,role,is_active)
     VALUES($1,'Automation Admin','SUPER_ADMIN',true) RETURNING id`,
    [email],
  );
  return result.rows[0]!.id;
}

async function seedPolicy(adminId: string, executionClass: number): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO platform_automation_policies(
       code,name,enabled,trigger_type,conditions,action_type,action_configuration,
       execution_class,approval_role,created_by_platform_user_id,updated_by_platform_user_id
     ) VALUES($1,'Policy',true,'ATTENTION','{}','CREATE_INTERNAL_TASK','{}',$2,'SUPER_ADMIN',$3,$3)
     RETURNING id`,
    [`POLICY_${Math.random().toString(16).slice(2)}`, executionClass, adminId],
  );
  return result.rows[0]!.id;
}
