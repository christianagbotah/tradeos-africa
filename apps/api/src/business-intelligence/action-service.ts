import type {
  BusinessActionItem,
  BusinessActionListResponse,
  BusinessActionState,
  BusinessActionTransition,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

type ActionRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  title: string;
  reason: string;
  state: BusinessActionState;
  assigned_user_id: string | null;
  due_at: Date | null;
  source_attention_id: string | null;
  source_automation_run_id: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};
const ACTION_COLUMNS = `id,business_id,branch_id,title,reason,state,assigned_user_id,
  due_at,source_attention_id,source_automation_run_id,created_at,updated_at,completed_at`;
const STATES: ReadonlySet<string> = new Set(["OPEN", "DONE", "SNOOZED", "CANCELED"]);

export class BusinessActionError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "BUSINESS_ACTION_INVALID") {
    super(message);
  }
}

/** Read-only view of current branch-scoped actions; never returns another tenant's actions. */
export async function listBusinessActions(
  pool: DatabasePool,
  businessId: string,
  branchId: string | null,
): Promise<BusinessActionListResponse> {
  const result = await pool.query<ActionRow>(
    `SELECT ${ACTION_COLUMNS} FROM business_action_items
      WHERE business_id=$1 AND branch_id IS NOT DISTINCT FROM $2::uuid
      ORDER BY CASE state WHEN 'OPEN' THEN 1 WHEN 'SNOOZED' THEN 2 ELSE 3 END,
        updated_at DESC,id LIMIT 100`,
    [businessId, branchId],
  );
  return {
    businessId,
    branchId,
    generatedAt: new Date().toISOString(),
    items: result.rows.map(mapRow),
  };
}

/**
 * Deterministically converts active alerts into follow-up tasks upon an explicit
 * permitted user action. Every alert instance creates at most one task, even with
 * retries and concurrent requests. No money, stock, customer credit or permissions
 * are modified.
 */
export async function generateBusinessActions(
  pool: DatabasePool,
  businessId: string,
  branchId: string | null,
  actorUserId: string,
): Promise<BusinessActionListResponse> {
  const createdCount = await withTransaction(pool, async (client) => {
    const scope = await client.query(
      `SELECT id FROM businesses WHERE id=$1 AND status='ACTIVE'`,
      [businessId],
    );
    if (!scope.rows[0]) {
      throw new BusinessActionError("Business access is unavailable.", 403, "BUSINESS_ACCESS_DENIED");
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO business_action_items(
        business_id,branch_id,title,reason,state,source_attention_id,idempotency_key
      )
      SELECT a.business_id,a.branch_id,
             'Review: ' || a.title,a.summary,'OPEN',a.id,'ATTENTION:' || a.id::text
      FROM business_attention_items a
      WHERE a.business_id=$1 AND a.branch_id IS NOT DISTINCT FROM $2::uuid
        AND a.state='OPEN' AND a.severity IN ('CRITICAL','HIGH','MEDIUM')
      ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END,
               a.last_seen_at DESC,a.id
      LIMIT 50
      ON CONFLICT (business_id,idempotency_key) WHERE idempotency_key IS NOT NULL
      DO NOTHING
      RETURNING id`,
      [businessId, branchId],
    );
    for (const row of created.rows) {
      await client.query(
        `INSERT INTO business_action_events(
          business_id,action_id,actor_user_id,event_type,from_state,to_state,evidence
        ) VALUES($1,$2,$3,'CREATED',NULL,'OPEN',$4::jsonb)`,
        [businessId, row.id, actorUserId, JSON.stringify({ origin: "ACTIVE_BUSINESS_ATTENTION" })],
      );
    }
    return created.rowCount ?? 0;
  });
  return { ...(await listBusinessActions(pool, businessId, branchId)), createdCount };
}

/**
 * Explicit user transition, serialized under row lock. A state change is
 * rejected when the UI holds stale data, and a successful transition always
 * produces one immutable audit event.
 */
export async function transitionBusinessAction(
  pool: DatabasePool,
  input: {
    businessId: string;
    branchId: string | null;
    actionId: string;
    actorUserId: string;
    transition: BusinessActionTransition;
  },
): Promise<BusinessActionItem> {
  const { businessId, branchId, actionId, actorUserId, transition } = input;
  if (!transition || !STATES.has(transition.state) || !STATES.has(transition.expectedState)) {
    throw new BusinessActionError("A supported state and expectedState are required.");
  }
  return withTransaction(pool, async (client) => {
    const found = await client.query<ActionRow>(
      `SELECT ${ACTION_COLUMNS} FROM business_action_items
        WHERE id=$1 AND business_id=$2 AND branch_id IS NOT DISTINCT FROM $3::uuid
        FOR UPDATE`,
      [actionId, businessId, branchId],
    );
    const existing = found.rows[0];
    if (!existing) throw new BusinessActionError("Follow-up task was not found.", 404, "BUSINESS_ACTION_NOT_FOUND");
    if (existing.state !== transition.expectedState) {
      throw new BusinessActionError("This task was updated elsewhere. Refresh to see its current state.", 409, "BUSINESS_ACTION_STALE");
    }
    if (existing.state === transition.state) return mapRow(existing);
    const updated = await client.query<ActionRow>(
      `UPDATE business_action_items
        SET state=$4, updated_at=now(),
          completed_at=CASE WHEN $4='DONE' THEN now() ELSE NULL END
        WHERE id=$1 AND business_id=$2 AND branch_id IS NOT DISTINCT FROM $3::uuid
        RETURNING ${ACTION_COLUMNS}`,
      [actionId, businessId, branchId, transition.state],
    );
    await client.query(
      `INSERT INTO business_action_events(
        business_id,action_id,actor_user_id,event_type,from_state,to_state,evidence
      ) VALUES($1,$2,$3,'STATE_CHANGED',$4,$5,'{}'::jsonb)`,
      [businessId, actionId, actorUserId, existing.state, transition.state],
    );
    return mapRow(updated.rows[0]!);
  });
}

function mapRow(row: ActionRow): BusinessActionItem {
  return {
    id: row.id, businessId: row.business_id, branchId: row.branch_id,
    title: row.title, reason: row.reason, state: row.state,
    assignedUserId: row.assigned_user_id,
    dueAt: row.due_at?.toISOString() ?? null,
    sourceAttentionId: row.source_attention_id,
    sourceAutomationRunId: row.source_automation_run_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}
