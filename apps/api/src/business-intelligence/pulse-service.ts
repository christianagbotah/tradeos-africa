import type { BusinessPulse, BusinessPulseAttentionSummary } from "@tradeos/contracts";
import type { BusinessRole } from "../auth/authorization.js";
import type { DatabasePool } from "../db.js";
import { listBusinessAttention } from "./attention-service.js";
import { listBusinessActionItems } from "./automation-service.js";

const FINANCIAL_ROLES = new Set<BusinessRole>(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

type PulseActor = { userId: string; businessId: string; role: BusinessRole; staffId: string | null };
type PulseInput = { businessId: string; branchId: string | null; limit: number; now?: Date };
type SeenInput = { businessId: string; branchId: string | null; now?: Date };

export class BusinessPulseError extends Error {
  constructor(message: string, readonly statusCode=400, readonly code="BUSINESS_PULSE_INVALID") {
    super(message); this.name="BusinessPulseError";
  }
}

export async function getBusinessPulse(pool: DatabasePool, actor: PulseActor, input: PulseInput): Promise<BusinessPulse> {
  await assertPulseScope(pool, actor, input.businessId, input.branchId);
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new BusinessPulseError("limit must be an integer between 1 and 50");
  }
  const [attentionItems, allActions, state] = await Promise.all([
    listBusinessAttention(pool, { businessId: input.businessId, branchId: input.branchId, includeFinancial: FINANCIAL_ROLES.has(actor.role) }),
    listBusinessActionItems(pool, actor, input.branchId),
    readSeenState(pool, actor.userId, input.businessId, input.branchId),
  ]);
  const actionItems = allActions.filter((item) => item.status === "OPEN" || item.status === "SNOOZED");
  const lastSeenAt = state?.last_seen_at ? iso(state.last_seen_at) : null;
  const cursor = lastSeenAt ? new Date(lastSeenAt).getTime() : Number.NEGATIVE_INFINITY;
  const unseenCount = attentionItems.filter((item) => new Date(item.lastSeenAt).getTime() > cursor).length
    + actionItems.filter((item) => new Date(item.createdAt).getTime() > cursor).length;
  const attentionSummary: BusinessPulseAttentionSummary = { CRITICAL:0, HIGH:0, MEDIUM:0, LOW:0, INFO:0 };
  for (const item of attentionItems) attentionSummary[item.severity] += 1;
  return {
    businessId: input.businessId,
    branchId: input.branchId,
    generatedAt: (input.now ?? new Date()).toISOString(),
    lastSeenAt,
    unseenCount,
    attentionSummary,
    attentionItems: attentionItems.slice(0, input.limit),
    actionItems: actionItems.slice(0, input.limit),
  };
}

export async function markBusinessPulseSeen(pool: DatabasePool, actor: PulseActor, input: SeenInput): Promise<{ lastSeenAt: string }> {
  await assertPulseScope(pool, actor, input.businessId, input.branchId);
  const seenAt = input.now ?? new Date();
  const result = await pool.query<{ last_seen_at: Date | string }>(
    `INSERT INTO business_intelligence_pulse_state(business_id,branch_id,user_id,last_seen_at)
     VALUES($1,$2,$3,$4)
     ON CONFLICT (business_id,branch_id,user_id) DO UPDATE SET
       last_seen_at=GREATEST(COALESCE(business_intelligence_pulse_state.last_seen_at,EXCLUDED.last_seen_at),EXCLUDED.last_seen_at),
       updated_at=now()
     RETURNING last_seen_at`,
    [input.businessId, input.branchId, actor.userId, seenAt],
  );
  return { lastSeenAt: iso(result.rows[0]!.last_seen_at) };
}

async function assertPulseScope(pool: DatabasePool, actor: PulseActor, businessId: string, branchId: string | null): Promise<void> {
  if (actor.businessId !== businessId) throw new BusinessPulseError("Pulse scope is outside your business.",403,"BUSINESS_PULSE_FORBIDDEN");
  const membership = await pool.query(`SELECT 1 FROM business_memberships m JOIN businesses b ON b.id=m.business_id WHERE m.business_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND b.status='ACTIVE'`,[businessId,actor.userId]);
  if (!membership.rowCount) throw new BusinessPulseError("Business access is unavailable.",403,"BUSINESS_PULSE_FORBIDDEN");
  if (branchId !== null) {
    const branch = await pool.query(`SELECT 1 FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true`,[branchId,businessId]);
    if (!branch.rowCount) throw new BusinessPulseError("Branch is unavailable in the authorized business.",404,"BUSINESS_PULSE_BRANCH_NOT_FOUND");
  }
}

async function readSeenState(pool: DatabasePool, userId: string, businessId: string, branchId: string | null) {
  const result = await pool.query<{ last_seen_at: Date | string | null }>(
    `SELECT last_seen_at FROM business_intelligence_pulse_state WHERE user_id=$1 AND business_id=$2 AND branch_id IS NOT DISTINCT FROM $3::uuid`,
    [userId,businessId,branchId],
  );
  return result.rows[0] ?? null;
}

function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
