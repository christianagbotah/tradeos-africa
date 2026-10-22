import type { DatabasePool } from "../db.js";
import { evaluateBusinessAttention } from "./attention-service.js";
import {
  businessAutomationConditionsMatch,
  evaluateBusinessAutomationSystem,
} from "./automation-service.js";

export const TENANT_AUTOMATION_DISPATCHER_LOCK_KEY = "8706112026102201";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const MIN_PROGRAMMATIC_INTERVAL_MS = 10;

type DispatchPolicyRow = {
  policy_id: string;
  business_id: string;
  evaluation_branch_id: string;
  conditions: Record<string, unknown>;
};

export type TenantAutomationDispatcherTickResult = {
  acquired: boolean;
  correlationId: string | null;
  scopesEvaluated: number;
  policiesEvaluated: number;
  matches: number;
  succeeded: number;
  failed: number;
};

type TickOptions = { intervalMs?: number; now?: () => Date };
type StartOptions = TickOptions & { enabled?: boolean };

export async function runTenantAutomationDispatcherTick(
  pool: DatabasePool,
  options: TickOptions = {},
): Promise<TenantAutomationDispatcherTickResult> {
  const intervalMs = normalizeInterval(options.intervalMs);
  const now = options.now?.() ?? new Date();
  const client = await pool.connect();
  let acquired = false;
  const result: TenantAutomationDispatcherTickResult = {
    acquired: false,
    correlationId: null,
    scopesEvaluated: 0,
    policiesEvaluated: 0,
    matches: 0,
    succeeded: 0,
    failed: 0,
  };
  const startedAt = Date.now();

  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [TENANT_AUTOMATION_DISPATCHER_LOCK_KEY],
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      logDispatcherTick(result, Date.now() - startedAt);
      return result;
    }

    result.acquired = true;
    const bucketMs = Math.floor(now.getTime() / intervalMs) * intervalMs;
    const bucket = new Date(bucketMs).toISOString();
    result.correlationId = `tenant-dispatcher:${bucket}`;

    const policies = await client.query<DispatchPolicyRow>(
      `SELECT p.id AS policy_id,p.business_id,b.id AS evaluation_branch_id,p.conditions
       FROM business_automation_policies p
       JOIN businesses tenant ON tenant.id=p.business_id AND tenant.status='ACTIVE'
       JOIN branches b
         ON b.business_id=p.business_id
        AND b.is_active=true
        AND (p.branch_id IS NULL OR b.id=p.branch_id)
       WHERE p.enabled=true AND p.trigger_type='ATTENTION'
       ORDER BY p.business_id,b.id,p.id`,
    );

    const scopes = groupPoliciesByScope(policies.rows);
    for (const scope of scopes) {
      result.scopesEvaluated += 1;
      result.policiesEvaluated += scope.policies.length;
      try {
        const attentionItems = await evaluateBusinessAttention(pool, {
          businessId: scope.businessId,
          branchId: scope.branchId,
          now,
          correlationId: `dispatcher:${bucket}:${scope.businessId}:${scope.branchId}`,
        });

        for (const policy of scope.policies) {
          for (const attention of attentionItems) {
            if (!businessAutomationConditionsMatch(policy.conditions ?? {}, {
              ruleCode: attention.ruleCode,
              severity: attention.severity,
            })) continue;
            result.matches += 1;
            try {
              const run = await evaluateBusinessAutomationSystem(pool, {
                businessId: scope.businessId,
                branchId: scope.branchId,
                policyId: policy.policy_id,
                triggerSource: "ATTENTION",
                triggerCorrelationId: `attention:${attention.id}`,
                now,
              });
              if (run.state === "SUCCEEDED") result.succeeded += 1;
              else if (run.state === "FAILED") result.failed += 1;
            } catch (error) {
              result.failed += 1;
              logDispatcherError("policy evaluation failed", error, {
                businessId: scope.businessId,
                branchId: scope.branchId,
                policyId: policy.policy_id,
                attentionItemId: attention.id,
              });
            }
          }
        }
      } catch (error) {
        result.failed += 1;
        logDispatcherError("scope evaluation failed", error, {
          businessId: scope.businessId,
          branchId: scope.branchId,
        });
      }
    }

    logDispatcherTick(result, Date.now() - startedAt);
    return result;
  } finally {
    if (acquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [TENANT_AUTOMATION_DISPATCHER_LOCK_KEY]);
      } catch (error) {
        logDispatcherError("advisory unlock failed", error, {});
      }
    }
    client.release();
  }
}

export function startTenantAutomationDispatcher(
  pool: DatabasePool,
  options: StartOptions = {},
): { stop(): void } {
  if (options.enabled === false) return { stop() {} };

  const intervalMs = normalizeInterval(options.intervalMs);
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const tickOptions = options.now ? { intervalMs, now: options.now } : { intervalMs };
      await runTenantAutomationDispatcherTick(pool, tickOptions);
    } catch (error) {
      logDispatcherError("scheduler tick failed", error, {});
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref?.();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

function groupPoliciesByScope(rows: DispatchPolicyRow[]): Array<{
  businessId: string;
  branchId: string;
  policies: DispatchPolicyRow[];
}> {
  const scopes = new Map<string, { businessId: string; branchId: string; policies: DispatchPolicyRow[] }>();
  for (const row of rows) {
    const key = `${row.business_id}:${row.evaluation_branch_id}`;
    const existing = scopes.get(key);
    if (existing) existing.policies.push(row);
    else scopes.set(key, {
      businessId: row.business_id,
      branchId: row.evaluation_branch_id,
      policies: [row],
    });
  }
  return [...scopes.values()];
}

function normalizeInterval(value: number | undefined): number {
  if (value === undefined) return DEFAULT_INTERVAL_MS;
  if (!Number.isFinite(value) || value < MIN_PROGRAMMATIC_INTERVAL_MS) return DEFAULT_INTERVAL_MS;
  return Math.floor(value);
}

function logDispatcherTick(result: TenantAutomationDispatcherTickResult, durationMs: number): void {
  if (process.env.VITEST) return;
  console.info("TradeOS tenant automation dispatcher tick", {
    acquired: result.acquired,
    correlationId: result.correlationId,
    scopesEvaluated: result.scopesEvaluated,
    policiesEvaluated: result.policiesEvaluated,
    matches: result.matches,
    succeeded: result.succeeded,
    failed: result.failed,
    durationMs,
  });
}

function logDispatcherError(
  event: string,
  error: unknown,
  context: Record<string, string>,
): void {
  if (process.env.VITEST) return;
  console.error("TradeOS tenant automation dispatcher error", {
    event,
    ...context,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorCode: typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "UNKNOWN")
      : "UNKNOWN",
  });
}
