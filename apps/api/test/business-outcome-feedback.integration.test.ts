import { afterAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { createPool } from "../src/db.js";
import { shouldCooldownAttentionAutomation } from "../src/business-intelligence/outcome-feedback-service.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const NOW = new Date("2026-10-25T12:00:00.000Z");

type Scope = { businessId: string; branchId: string; userId: string; policyId: string };

beforeEach(async () => { await pool.query("TRUNCATE TABLE app_users,businesses CASCADE"); });
afterAll(async () => { await pool.end(); });

describe("review outcome feedback cooldown", () => {
  it("cools down INFO/LOW automatic dispatch after two recent negative outcomes for the same signal", async () => {
    const scope = await seedScope("Cooldown Tenant");
    await seedCompletedReview(scope, { completedAt: daysAgo(5), outcome: "NOT_RELEVANT" });
    await seedCompletedReview(scope, { completedAt: daysAgo(2), outcome: "NO_ACTION_NEEDED" });

    const result = await shouldCooldownAttentionAutomation(pool, input(scope, "LOW_DATA_CONFIDENCE", "low-data:main", "INFO"));

    expect(result).toEqual({
      skip: true,
      negativeCount: 2,
      cooldownUntil: "2026-11-06T12:00:00.000Z",
    });
  });

  it("does not cool down with only one recent negative or when the latest cooldown has expired", async () => {
    const one = await seedScope("One Negative");
    await seedCompletedReview(one, { completedAt: daysAgo(2), outcome: "NOT_RELEVANT" });
    expect(await shouldCooldownAttentionAutomation(pool, input(one, "LOW_DATA_CONFIDENCE", "low-data:main", "LOW")))
      .toEqual({ skip: false, negativeCount: 1, cooldownUntil: null });

    const expired = await seedScope("Expired Feedback");
    await seedCompletedReview(expired, { completedAt: daysAgo(29), outcome: "NOT_RELEVANT" });
    await seedCompletedReview(expired, { completedAt: daysAgo(20), outcome: "NO_ACTION_NEEDED" });
    expect(await shouldCooldownAttentionAutomation(pool, input(expired, "LOW_DATA_CONFIDENCE", "low-data:main", "INFO")))
      .toEqual({ skip: false, negativeCount: 2, cooldownUntil: null });
  });

  it("ignores outcomes outside the 30-day learning window", async () => {
    const scope = await seedScope("Old Feedback");
    await seedCompletedReview(scope, { completedAt: daysAgo(31), outcome: "NOT_RELEVANT" });
    await seedCompletedReview(scope, { completedAt: daysAgo(2), outcome: "NO_ACTION_NEEDED" });

    expect(await shouldCooldownAttentionAutomation(pool, input(scope, "LOW_DATA_CONFIDENCE", "low-data:main", "INFO")))
      .toEqual({ skip: false, negativeCount: 1, cooldownUntil: null });
  });

  it("never cools MEDIUM, HIGH, or CRITICAL attention", async () => {
    const scope = await seedScope("Severity Tenant");
    await seedCompletedReview(scope, { completedAt: daysAgo(5), outcome: "NOT_RELEVANT" });
    await seedCompletedReview(scope, { completedAt: daysAgo(2), outcome: "NO_ACTION_NEEDED" });

    for (const severity of ["MEDIUM", "HIGH", "CRITICAL"] as const) {
      expect(await shouldCooldownAttentionAutomation(pool, input(scope, "LOW_DATA_CONFIDENCE", "low-data:main", severity)))
        .toEqual({ skip: false, negativeCount: 0, cooldownUntil: null });
    }
  });

  it("does not mix manual tasks or another tenant, branch, rule, source key, or non-negative outcome", async () => {
    const scope = await seedScope("Isolated Feedback");
    const secondBranch = await seedBranch(scope.businessId, "SECOND");
    const foreign = await seedScope("Foreign Feedback");

    await seedCompletedReview(scope, { completedAt: daysAgo(2), outcome: "NOT_RELEVANT", automated: false });
    await seedCompletedReview(scope, { completedAt: daysAgo(2), outcome: "RESOLVED" });
    await seedCompletedReview(scope, { completedAt: daysAgo(2), outcome: "NOT_RELEVANT", branchId: secondBranch });
    await seedCompletedReview(scope, { completedAt: daysAgo(2), outcome: "NOT_RELEVANT", ruleCode: "SLOW_STOCK" });
    await seedCompletedReview(scope, { completedAt: daysAgo(2), outcome: "NOT_RELEVANT", sourceKey: "low-data:other" });
    await seedCompletedReview(foreign, { completedAt: daysAgo(2), outcome: "NOT_RELEVANT" });

    expect(await shouldCooldownAttentionAutomation(pool, input(scope, "LOW_DATA_CONFIDENCE", "low-data:main", "INFO")))
      .toEqual({ skip: false, negativeCount: 0, cooldownUntil: null });
  });
});

function input(scope: Scope, ruleCode: string, sourceKey: string, severity: string) {
  return { businessId: scope.businessId, branchId: scope.branchId, ruleCode, sourceKey, severity, now: NOW };
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

async function seedScope(name: string): Promise<Scope> {
  const business = await pool.query<{ id: string }>(
    `INSERT INTO businesses(name,business_type,country_code,currency_code,timezone,status)
     VALUES($1,'RETAIL','GH','GHS','Africa/Accra','ACTIVE') RETURNING id`, [name],
  );
  const businessId = business.rows[0]!.id;
  const branchId = await seedBranch(businessId, "MAIN");
  const user = await pool.query<{ id: string }>(
    `INSERT INTO app_users(display_name,email,password_hash,status)
     VALUES($1,$2,'hash','ACTIVE') RETURNING id`, [name, `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@feedback.test`],
  );
  const userId = user.rows[0]!.id;
  const policy = await pool.query<{ id: string }>(
    `INSERT INTO business_automation_policies(
       business_id,branch_id,code,name,enabled,trigger_type,conditions,action_type,action_configuration,
       policy_version,created_by_user_id,updated_by_user_id
     ) VALUES($1,$2,$3,$3,true,'ATTENTION','{}','CREATE_FOLLOW_UP','{}',1,$4,$4) RETURNING id`,
    [businessId, branchId, `feedback-${businessId}`, userId],
  );
  return { businessId, branchId, userId, policyId: policy.rows[0]!.id };
}

async function seedBranch(businessId: string, code: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO branches(business_id,name,code,timezone,is_active)
     VALUES($1,$2,$2,'Africa/Accra',true) RETURNING id`, [businessId, code],
  );
  return result.rows[0]!.id;
}

async function seedCompletedReview(
  scope: Scope,
  options: {
    completedAt: Date;
    outcome: "RESOLVED" | "ALREADY_HANDLED" | "NOT_RELEVANT" | "NO_ACTION_NEEDED";
    automated?: boolean;
    branchId?: string;
    ruleCode?: string;
    sourceKey?: string;
  },
): Promise<void> {
  const branchId = options.branchId ?? scope.branchId;
  const ruleCode = options.ruleCode ?? "LOW_DATA_CONFIDENCE";
  const sourceKey = options.sourceKey ?? "low-data:main";
  const attention = await pool.query<{ id: string }>(
    `INSERT INTO business_attention_items(
       business_id,branch_id,source_key,rule_code,severity,state,title,summary,evidence,
       first_seen_at,last_seen_at,resolved_at
     ) VALUES($1,$2,$3,$4,'INFO','RESOLVED','Feedback signal','Feedback signal','[]',$5,$5,$5)
     RETURNING id`,
    [scope.businessId, branchId, sourceKey, ruleCode, options.completedAt],
  );

  let runId: string | null = null;
  if (options.automated !== false) {
    const run = await pool.query<{ id: string }>(
      `INSERT INTO business_automation_runs(
         business_id,branch_id,policy_id,policy_version,trigger_source,trigger_correlation_id,state,
         structured_input,output_summary,evidence,started_at,completed_at
       ) VALUES($1,$2,$3,1,'ATTENTION',$4,'SUCCEEDED','{}','{}','[]',$5,$5) RETURNING id`,
      [scope.businessId, branchId, scope.policyId, `feedback:${crypto.randomUUID()}`, options.completedAt],
    );
    runId = run.rows[0]!.id;
  }

  await pool.query(
    `INSERT INTO business_action_items(
       business_id,branch_id,source_attention_item_id,source_automation_run_id,action_type,title,reason,evidence,
       status,completed_at,completion_outcome,completed_by_user_id
     ) VALUES($1,$2,$3,$4,'CREATE_FOLLOW_UP','Feedback review','Feedback review','[]','DONE',$5,$6,$7)`,
    [scope.businessId, branchId, attention.rows[0]!.id, runId, options.completedAt, options.outcome, scope.userId],
  );
}
