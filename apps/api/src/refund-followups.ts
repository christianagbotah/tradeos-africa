import type { FastifyInstance } from "fastify";
import { requireBusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { withTransaction, type DatabasePool } from "./db.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 _.:/-]{5,159}$/;
const KINDS = ["INTERNAL_NOTE", "CUSTOMER_CONTACTED", "PROVIDER_CONTACTED",
  "ESCALATED", "ESCALATION_REVIEWED"] as const;
type EventKind = typeof KINDS[number];
const ROLES = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"] as const;

class RefundFollowupError extends Error {
  constructor(message: string, readonly statusCode = 400,
    readonly code = "REFUND_FOLLOWUP_INVALID") { super(message); }
}

type FollowupRow = {
  id: string; business_id: string; branch_id: string;
  refund_transaction_id: string; actor_user_id: string;
  client_request_id: string; event_kind: EventKind;
  evidence_reference: string | null; note: string; created_at: Date;
  actor_display_name?: string | null;
};
type RefundRow = { id: string; status: "PENDING" | "FAILED" | "SUCCEEDED" };

function requiredId(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new RefundFollowupError(`A valid ${name} is required.`, 400,
      "REFUND_FOLLOWUP_ID_INVALID");
  }
  return value;
}
function pageNumber(raw: unknown, fallback: number, max: number, name: string): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || !/^(0|[1-9][0-9]*)$/.test(raw) ||
      !Number.isSafeInteger(Number(raw)) || Number(raw) > max ||
      (name === "limit" && Number(raw) < 1)) {
    throw new RefundFollowupError(`Invalid ${name} for refund history.`, 400,
      "REFUND_FOLLOWUP_PAGE_INVALID");
  }
  return Number(raw);
}
function normalizedEvent(body: Record<string, unknown>) {
  if (typeof body.eventKind !== "string" ||
      !KINDS.includes(body.eventKind as EventKind)) {
    throw new RefundFollowupError("Choose a supported follow-up action.", 400,
      "REFUND_FOLLOWUP_KIND_INVALID");
  }
  if (typeof body.note !== "string" || body.note.trim().length < 20 ||
      body.note.trim().length > 700 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.note)) {
    throw new RefundFollowupError("Provide a follow-up note (20–700 characters).", 400,
      "REFUND_FOLLOWUP_NOTE_INVALID");
  }
  const rawReference = body.evidenceReference;
  const evidenceReference = rawReference === undefined || rawReference === null ||
    rawReference === "" ? null : rawReference;
  if (evidenceReference !== null &&
      (typeof evidenceReference !== "string" ||
        !REFERENCE.test(evidenceReference.trim()) ||
        evidenceReference.includes("://"))) {
    throw new RefundFollowupError(
      "Use a support-case or document reference, never a URL or secret.", 400,
      "REFUND_FOLLOWUP_REFERENCE_INVALID");
  }
  return {
    eventKind: body.eventKind as EventKind,
    note: body.note.trim(),
    evidenceReference: typeof evidenceReference === "string"
      ? evidenceReference.trim() : null,
  };
}
function publicEvent(row: FollowupRow, idempotentReplay = false,
  actorName?: string) {
  return {
    eventId: row.id,
    refundId: row.refund_transaction_id,
    branchId: row.branch_id,
    actorUserId: row.actor_user_id,
    actorDisplayName: row.actor_display_name ?? actorName ?? "Team member",
    eventKind: row.event_kind,
    evidenceReference: row.evidence_reference,
    note: row.note,
    recordedAt: row.created_at.toISOString(),
    idempotentReplay,
    providerFinality: "NOT_ESTABLISHED" as const,
    payoutStatusUnchanged: true as const,
  };
}
function sendError(request: { log: { error: (error: unknown) => void } },
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
  error: unknown) {
  if (error instanceof RefundFollowupError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "REFUND_FOLLOWUP_FAILED",
    message: "Refund follow-up could not be processed." });
}

export function registerRefundFollowupRoutes(app: FastifyInstance, pool: DatabasePool): void {
  async function authorize(headers: { authorization?: string | undefined },
    businessId: string, branchId: string) {
    const auth = await authenticateAccessToken(pool, headers.authorization);
    await requireBusinessRole(pool, auth, businessId, ROLES);
    const branch = await pool.query(
      "SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true",
      [branchId, businessId]);
    if (branch.rowCount !== 1) {
      throw new RefundFollowupError("Branch does not belong to this business.", 404,
        "REFUND_FOLLOWUP_BRANCH_NOT_FOUND");
    }
    return auth;
  }

  // Only the specified business and branch can read this append-only timeline.
  app.get<{ Querystring: {
    businessId?: string; branchId?: string; refundId?: string;
    limit?: string; offset?: string;
  } }>("/v1/refunds/followups", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store, max-age=0");
    try {
      const businessId = requiredId(request.query.businessId, "business ID");
      const branchId = requiredId(request.query.branchId, "branch ID");
      const refundId = requiredId(request.query.refundId, "refund ID");
      await authorize(request.headers, businessId, branchId);
      const limit = pageNumber(request.query.limit, 25, 100, "limit");
      const offset = pageNumber(request.query.offset, 0, 100000, "offset");
      const refund = await pool.query<RefundRow>(
        `SELECT rt.id,rt.status FROM refund_transactions rt
         JOIN return_cases rc ON rc.id=rt.return_case_id AND rc.business_id=rt.business_id
         WHERE rt.id=$1 AND rt.business_id=$2 AND rc.branch_id=$3`,
        [refundId, businessId, branchId]);
      if (refund.rowCount !== 1) {
        throw new RefundFollowupError("Refund was not found in this branch.", 404,
          "REFUND_FOLLOWUP_NOT_FOUND");
      }
      const events = await pool.query<FollowupRow>(
        `SELECT e.*,u.display_name AS actor_display_name
         FROM refund_followup_events e
         JOIN app_users u ON u.id=e.actor_user_id
         WHERE e.business_id=$1 AND e.branch_id=$2 AND e.refund_transaction_id=$3
         ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,
        [businessId, branchId, refundId, limit + 1, offset]);
      return {
        refundId, events: events.rows.slice(0, limit).map((row) => publicEvent(row)),
        offset, hasMore: events.rows.length > limit,
        providerFinality: "NOT_ESTABLISHED" as const,
      };
    } catch (error) { return sendError(request, reply, error); }
  });

  // A note/escalation is never provider proof and never changes refund status.
  app.post<{ Body: Record<string, unknown> }>("/v1/refunds/followups",
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store, max-age=0");
      try {
        const body = request.body ?? {};
        const businessId = requiredId(body.businessId, "business ID");
        const branchId = requiredId(body.branchId, "branch ID");
        const refundId = requiredId(body.refundId, "refund ID");
        const clientRequestId = requiredId(body.clientRequestId, "request ID");
        const event = normalizedEvent(body);
        const auth = await authorize(request.headers, businessId, branchId);
        const recorded = await withTransaction(pool, async (tx) => {
          // Lock the refund while recording to serialize duplicate submissions
          // and protect against a concurrent payout completion.
          const refund = (await tx.query<RefundRow>(
            `SELECT rt.id,rt.status FROM refund_transactions rt
             JOIN return_cases rc ON rc.id=rt.return_case_id AND rc.business_id=rt.business_id
             WHERE rt.id=$1 AND rt.business_id=$2 AND rc.branch_id=$3
             FOR UPDATE OF rt`,
            [refundId, businessId, branchId])).rows[0];
          if (!refund) throw new RefundFollowupError(
            "Refund was not found in this branch.", 404, "REFUND_FOLLOWUP_NOT_FOUND");
          const previous = (await tx.query<FollowupRow>(
            `SELECT * FROM refund_followup_events
             WHERE refund_transaction_id=$1 AND client_request_id=$2`,
            [refundId, clientRequestId])).rows[0];
          if (previous) {
            if (previous.actor_user_id !== auth.userId ||
                previous.event_kind !== event.eventKind ||
                previous.evidence_reference !== event.evidenceReference ||
                previous.note !== event.note) {
              throw new RefundFollowupError(
                "This request ID was already used for a different follow-up.", 409,
                "REFUND_FOLLOWUP_IDEMPOTENCY_CONFLICT");
            }
            return publicEvent(previous, true, auth.displayName);
          }
          if (refund.status !== "PENDING" && refund.status !== "FAILED") {
            throw new RefundFollowupError(
              "Only unresolved refunds can receive new follow-ups.", 409,
              "REFUND_FOLLOWUP_ALREADY_SETTLED");
          }
          if (event.eventKind === "ESCALATION_REVIEWED") {
            const last = (await tx.query<{event_kind: EventKind}>(
              `SELECT event_kind FROM refund_followup_events
               WHERE refund_transaction_id=$1
                 AND event_kind IN ('ESCALATED','ESCALATION_REVIEWED')
               ORDER BY created_at DESC,id DESC LIMIT 1`,
              [refundId])).rows[0];
            if (last?.event_kind !== "ESCALATED") {
              throw new RefundFollowupError(
                "There is no active escalation to review.", 409,
                "REFUND_FOLLOWUP_ESCALATION_NOT_OPEN");
            }
          }
          const created = (await tx.query<FollowupRow>(
            `INSERT INTO refund_followup_events
             (business_id,branch_id,refund_transaction_id,actor_user_id,
              client_request_id,event_kind,evidence_reference,note)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [businessId, branchId, refundId, auth.userId, clientRequestId,
              event.eventKind, event.evidenceReference, event.note])).rows[0];
          if (!created) throw new RefundFollowupError(
            "Follow-up could not be recorded.", 409, "REFUND_FOLLOWUP_RETRY_REQUIRED");
          await tx.query(
            `INSERT INTO audit_events
             (business_id,branch_id,event_type,entity_type,entity_id,
              correlation_id,payload,occurred_at)
             VALUES($1,$2,'REFUND_FOLLOWUP_RECORDED','REFUND_TRANSACTION',
               $3,$4,$5::jsonb,now())`,
            [businessId, branchId, refundId, created.id,
              JSON.stringify({ eventId: created.id, actorUserId: auth.userId,
                kind: event.eventKind, payoutStatusUnchanged: true })]);
          return publicEvent(created, false, auth.displayName);
        });
        return reply.code(recorded.idempotentReplay ? 200 : 201).send({
          event: recorded,
        });
      } catch (error) { return sendError(request, reply, error); }
    });
}
