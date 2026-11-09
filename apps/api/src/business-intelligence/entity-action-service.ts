import type {
  BusinessActionCompletionOutcome,
  BusinessActionItem,
  BusinessEntityContext,
  BusinessEntityType,
  BusinessEvidenceReference,
} from "@tradeos/contracts";
import type { BusinessRole } from "../auth/authorization.js";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { filterBusinessEntityEvidenceForRole, getBusinessEntityIntelligence } from "./entity-service.js";

export class BusinessEntityActionError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "ENTITY_ACTION_INVALID",
  ) {
    super(message);
    this.name = "BusinessEntityActionError";
  }
}

type EntityActionActor = {
  userId: string;
  businessId: string;
};

type EntityActionInput = BusinessEntityContext & {
  businessId: string;
  branchId: string | null;
  now?: Date;
};

type Access = { role: BusinessRole; staffId: string | null };

type ActionRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  source_attention_item_id: string | null;
  source_automation_run_id: string | null;
  source_entity_type: BusinessEntityType | null;
  source_entity_id: string | null;
  created_by_user_id: string | null;
  action_type: string | null;
  title: string;
  reason: string;
  evidence: BusinessEvidenceReference[];
  assigned_user_id: string | null;
  assigned_staff_id: string | null;
  due_at: Date | string | null;
  status: "OPEN" | "DONE" | "SNOOZED" | "CANCELED";
  snoozed_until: Date | string | null;
  completed_at: Date | string | null;
  completion_outcome: BusinessActionCompletionOutcome | null;
  completed_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const ACTION_SELECT = `SELECT id,business_id,branch_id,source_attention_item_id,source_automation_run_id,
  source_entity_type,source_entity_id,created_by_user_id,action_type,title,reason,evidence,
  assigned_user_id,assigned_staff_id,due_at,status,snoozed_until,completed_at,completion_outcome,completed_by_user_id,created_at,updated_at
  FROM business_action_items`;

export async function createBusinessEntityActionItem(
  pool: DatabasePool,
  actor: EntityActionActor,
  input: EntityActionInput,
): Promise<{ item: BusinessActionItem; created: boolean }> {
  if (actor.businessId !== input.businessId) {
    throw new BusinessEntityActionError("Entity action scope is outside your business.", 403, "ENTITY_ACTION_FORBIDDEN");
  }

  const initialAccess = await resolveAccess(pool, actor);
  const now = input.now ?? new Date();
  const intelligence = await getBusinessEntityIntelligence(pool, {
    businessId: input.businessId,
    branchId: input.branchId,
    role: initialAccess.role,
    entityType: input.entityType,
    entityId: input.entityId,
    now,
  });
  const safeAction = intelligence.safeAction;
  if (!safeAction) {
    throw new BusinessEntityActionError("Your role cannot create a review task for this record.", 403, "ENTITY_ACTION_FORBIDDEN");
  }

  const primaryAttention = highestPriorityAttention(intelligence.attentionItems);
  const title = actionTitle(safeAction.actionType, intelligence.entity.label);
  const reason = primaryAttention?.summary ?? `TradeOS Intelligence recommended an internal review of ${intelligence.entity.label}.`;
  const evidence = intelligence.evidence.slice(0, 12);
  const dueAt = new Date(now.getTime() + safeAction.dueInHours * 3_600_000);

  const existing = await findActive(pool, input, safeAction.actionType);
  if (existing) {
    return { item: mapActionForRole(existing, initialAccess.role, input.entityType), created: false };
  }

  try {
    const inserted = await withTransaction(pool, async (client) => {
      const currentAccess = await resolveAccess(client, actor);
      if (currentAccess.role !== initialAccess.role || currentAccess.staffId !== initialAccess.staffId) {
        throw new BusinessEntityActionError("Business access changed; refresh and try again.", 409, "ENTITY_ACTION_ACCESS_CHANGED");
      }
      const result = await client.query<ActionRow>(
        `INSERT INTO business_action_items(
           business_id,branch_id,source_attention_item_id,source_entity_type,source_entity_id,created_by_user_id,
           action_type,title,reason,evidence,assigned_user_id,assigned_staff_id,due_at,status
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$6,$11,$12,'OPEN')
         RETURNING *`,
        [
          input.businessId,
          input.branchId,
          primaryAttention?.id ?? null,
          input.entityType,
          input.entityId,
          actor.userId,
          safeAction.actionType,
          title,
          reason,
          JSON.stringify(evidence),
          currentAccess.staffId,
          dueAt,
        ],
      );
      return result.rows[0]!;
    });
    return { item: mapActionForRole(inserted, initialAccess.role, input.entityType), created: true };
  } catch (error) {
    if (isPgCode(error, "23505")) {
      const duplicate = await findActive(pool, input, safeAction.actionType);
      if (duplicate) {
        return { item: mapActionForRole(duplicate, initialAccess.role, input.entityType), created: false };
      }
    }
    throw error;
  }
}

async function resolveAccess(
  db: Pick<DatabasePool, "query">,
  actor: EntityActionActor,
): Promise<Access> {
  const result = await db.query<{
    role: BusinessRole;
    staff_id: string | null;
    business_status: string;
  }>(
    `SELECT m.role,st.id AS staff_id,b.status AS business_status
     FROM business_memberships m
     JOIN businesses b ON b.id=m.business_id
     LEFT JOIN staff st ON st.id=m.staff_id AND st.business_id=m.business_id AND st.is_active=true
     WHERE m.business_id=$1 AND m.user_id=$2 AND m.status='ACTIVE'`,
    [actor.businessId, actor.userId],
  );
  const row = result.rows[0];
  if (!row || row.business_status !== "ACTIVE") {
    throw new BusinessEntityActionError("Business access is unavailable.", 403, "ENTITY_ACTION_FORBIDDEN");
  }
  return { role: row.role, staffId: row.staff_id };
}

async function findActive(
  pool: DatabasePool,
  input: EntityActionInput,
  actionType: string,
): Promise<ActionRow | null> {
  const result = await pool.query<ActionRow>(
    `${ACTION_SELECT}
     WHERE business_id=$1
       AND branch_id IS NOT DISTINCT FROM $2::uuid
       AND source_entity_type=$3
       AND source_entity_id=$4
       AND action_type=$5
       AND status IN ('OPEN','SNOOZED')
     ORDER BY created_at DESC,id DESC
     LIMIT 1`,
    [input.businessId, input.branchId, input.entityType, input.entityId, actionType],
  );
  return result.rows[0] ?? null;
}

function highestPriorityAttention<T extends { severity: string; lastSeenAt: string }>(items: T[]): T | null {
  const rank: Record<string, number> = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };
  return [...items].sort((a, b) =>
    (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0)
    || new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
  )[0] ?? null;
}

function actionTitle(actionType: string, label: string): string {
  switch (actionType) {
    case "CREATE_REORDER_REVIEW": return `Review stock reorder: ${label}`;
    case "CREATE_RECEIVABLE_FOLLOW_UP": return `Follow up receivable: ${label}`;
    default: return `Follow up: ${label}`;
  }
}

function mapAction(row: ActionRow): BusinessActionItem {
  return {
    businessId: row.business_id,
    branchId: row.branch_id,
    id: row.id,
    sourceAttentionItemId: row.source_attention_item_id,
    sourceAutomationRunId: row.source_automation_run_id,
    sourceEntityType: row.source_entity_type,
    sourceEntityId: row.source_entity_id,
    createdByUserId: row.created_by_user_id,
    actionType: row.action_type,
    title: row.title,
    reason: row.reason,
    evidence: row.evidence ?? [],
    assignedUserId: row.assigned_user_id,
    assignedStaffId: row.assigned_staff_id,
    dueAt: iso(row.due_at),
    status: row.status,
    snoozedUntil: iso(row.snoozed_until),
    completedAt: iso(row.completed_at),
    completionOutcome: row.completion_outcome,
    completedByUserId: row.completed_by_user_id,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function mapActionForRole(
  row: ActionRow,
  role: BusinessRole,
  entityType: BusinessEntityType,
): BusinessActionItem {
  const item = mapAction(row);
  return {
    ...item,
    evidence: filterBusinessEntityEvidenceForRole(role, entityType, item.evidence),
  };
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isPgCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
