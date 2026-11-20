import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { posFail } from "./hubtel-pos-config.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = {
  id: string;
  sale_id: string;
  business_id: string;
  branch_id: string;
  status: "AWAITING_PROVIDER_INVESTIGATION";
  created_at: Date;
};
type Checkout = {
  id: string;
  branch_id: string;
  payment_id: string;
  state: string;
};
type Payment = { id: string; branch_id: string; status: string };
type Sale = { id: string; branch_id: string; status: string };

function validId(id: string): void {
  if (!UUID.test(id)) posFail("Valid Hubtel review identifiers are required.",
    "HUBTEL_CANCEL_REVIEW_ID_INVALID", 400);
}
function reviewNote(note: unknown): string {
  if (typeof note !== "string" || note.trim().length < 20 ||
      note.trim().length > 700 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(note)) {
    posFail("Explain why provider cancellation investigation is needed (20–700 characters).",
      "HUBTEL_CANCEL_REVIEW_NOTE_INVALID", 400);
  }
  return note.trim();
}
function publicCase(row: Row, replay: boolean) {
  return {
    reviewId: row.id, saleId: row.sale_id, branchId: row.branch_id,
    status: row.status, requestedAt: row.created_at.toISOString(),
    idempotentReplay: replay,
    providerFinality: "NOT_ESTABLISHED" as const,
    canReleaseStock: false as const,
  };
}

/** Records an idempotent, read-only escalation, never a provider void or stock reversal.
 * Lock sale -> payment -> checkout in the same order as the independent verifier.
 * This makes a simultaneous verifier/cancellation-request safe: payment wins or
 * a previously recorded review is returned without changing the sale.
 */
export async function requestHubtelCancellationInvestigation(
  pool: DatabasePool,
  input: { businessId: string; saleId: string; actorUserId: string; note: unknown },
) {
  [input.businessId, input.saleId, input.actorUserId].forEach(validId);
  const reason = reviewNote(input.note);
  return withTransaction(pool, async (tx) => {
    const sale = (await tx.query<Sale>(
      "SELECT id,branch_id,status FROM sales WHERE id=$1 AND business_id=$2 FOR UPDATE",
      [input.saleId, input.businessId],
    )).rows[0];
    if (!sale) posFail("Hubtel sale was not found.",
      "HUBTEL_CANCEL_REVIEW_NOT_FOUND", 404);

    const payment = (await tx.query<Payment>(
      "SELECT id,branch_id,status FROM payments "+
      "WHERE business_id=$1 AND sale_id=$2 ORDER BY id FOR UPDATE",
      [input.businessId,input.saleId],
    )).rows;
    const checkout = (await tx.query<Checkout>(
      "SELECT id,branch_id,payment_id,state FROM hubtel_sale_checkout_attempts "+
      "WHERE business_id=$1 AND sale_id=$2 FOR UPDATE",
      [input.businessId,input.saleId],
    )).rows[0];
    if (!checkout || payment.length!==1 || checkout.payment_id!==payment[0]?.id ||
        sale.branch_id!==checkout.branch_id ||
        payment[0]?.branch_id!==checkout.branch_id) {
      posFail("Sale, checkout and payment do not reconcile to the same merchant branch.",
        "HUBTEL_CANCEL_REVIEW_SCOPE_INVALID", 409);
    }
    // A repeated request returns the original case without modifying the reason,
    // creating additional audit events or invalidating any later PAID resolution.
    const prior = (await tx.query<Row>(
      "SELECT id,sale_id,business_id,branch_id,status,created_at "+
      "FROM hubtel_pos_cancellation_investigations "+
      "WHERE business_id=$1 AND sale_id=$2",
      [input.businessId,input.saleId],
    )).rows[0];
    if (prior) return { investigation: publicCase(prior,true) };

    if (sale.status!=="OPEN" || payment[0]!.status!=="PENDING" ||
        !["PREPARED","READY","PENDING_VERIFICATION","REVIEW_REQUIRED"].includes(checkout.state)) {
      posFail("Only a pending checkout can be escalated for cancellation investigation.",
        "HUBTEL_CANCEL_REVIEW_NOT_PENDING",409);
    }
    const created=(await tx.query<Row>(
      "INSERT INTO hubtel_pos_cancellation_investigations("+
      "business_id,branch_id,sale_id,attempt_id,payment_id,requested_by_user_id,reason) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7) "+
      "ON CONFLICT(business_id,sale_id) DO NOTHING "+
      "RETURNING id,sale_id,business_id,branch_id,status,created_at",
      [input.businessId,sale.branch_id,input.saleId,checkout.id,
        payment[0]!.id,input.actorUserId,reason],
    )).rows[0];
    if (!created) {
      const raced=(await tx.query<Row>(
        "SELECT id,sale_id,business_id,branch_id,status,created_at "+
        "FROM hubtel_pos_cancellation_investigations WHERE business_id=$1 AND sale_id=$2",
        [input.businessId,input.saleId],
      )).rows[0];
      if (!raced) posFail("Investigation request could not be verified.",
        "HUBTEL_CANCEL_REVIEW_RETRY_REQUIRED",409);
      return { investigation: publicCase(raced,true) };
    }
    await tx.query(
      "INSERT INTO audit_events(business_id,branch_id,event_type,entity_type,"+
      "entity_id,correlation_id,payload,occurred_at) "+
      "VALUES($1,$2,'HUBTEL_CANCELLATION_INVESTIGATION_REQUESTED',"+
      "'SALE',$3,$4,$5::jsonb,now())",
      [input.businessId,sale.branch_id,sale.id,created.id,
        JSON.stringify({reviewId:created.id,requestedByUserId:input.actorUserId,
          providerFinality:"NOT_ESTABLISHED",stockRelease:false})],
    );
    return { investigation: publicCase(created,false) };
  });
}

export async function readHubtelCancellationInvestigation(
  pool: DatabasePool, businessId: string, saleId: string,
) {
  const row=(await pool.query<Row>(
    "SELECT id,sale_id,business_id,branch_id,status,created_at "+
    "FROM hubtel_pos_cancellation_investigations "+
    "WHERE business_id=$1 AND sale_id=$2",
    [businessId,saleId],
  )).rows[0];
  return row ? publicCase(row,false) : null;
}
