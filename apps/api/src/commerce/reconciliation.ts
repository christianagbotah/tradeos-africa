import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { cashMethods, isCashMethod, CashbookError } from "./cashbook.js";
import { signedMinor, addSignedMinor } from "./valuation.js";
import type { SaleMutationContext } from "./sales.js";

export const operationsMutations = ["OPERATING_DAY_OPEN_CREATE", "OPERATING_DAY_CLOSE_CREATE", "SHIFT_OPEN_CREATE", "SHIFT_CLOSE_CREATE"] as const;
export interface ReconciliationPayload { actorStaffId: string; businessDate?: string; dayId?: string; shiftId?: string; note?: string; openingBalances?: {method:string; countedMinor:number}[]; closingBalances?: {method:string; countedMinor:number}[] }
// One lock order for opening, closing and cashbook insertion prevents stale SUM snapshots.
export async function lockOperations(client: DatabaseClient, businessId: string, branchId: string) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`operations:${businessId}:${branchId}`]);
}
export async function recomputeReconciliation(client: DatabaseClient, kind: "operating_day" | "staff_shift", id: string) {
  const balances = await client.query(`SELECT b.method,b.opening_counted_minor,b.closing_counted_minor,COALESCE((SELECT SUM(e.amount_delta_minor) FROM cashbook_entries e WHERE e.${kind}_id=b.${kind}_id AND e.method=b.method),0) AS movement FROM ${kind}_method_balances b WHERE b.${kind}_id=$1`, [id]);
  for (const b of balances.rows) {
    const movement = signedMinor(Number(b.movement));
    const expected = addSignedMinor(signedMinor(Number(b.opening_counted_minor)), movement);
    const variance = b.closing_counted_minor === null ? null : addSignedMinor(signedMinor(Number(b.closing_counted_minor)), -expected);
    await client.query(`UPDATE ${kind}_method_balances SET movement_minor=$3,expected_closing_minor=$4,variance_minor=$5 WHERE ${kind}_id=$1 AND method=$2`, [id,b.method,movement,expected,variance]);
  }
}
async function attributeExistingCashbookEntries(client: DatabaseClient, kind: "operating_day" | "staff_shift", input: { id: string; businessId: string; branchId: string; openedAt: string; operatingDayId?: string; staffId?: string }) {
  if (kind === "operating_day") {
    await client.query(
      `UPDATE cashbook_entries SET operating_day_id=$1 WHERE business_id=$2 AND branch_id=$3 AND operating_day_id IS NULL AND occurred_at >= $4`,
      [input.id,input.businessId,input.branchId,input.openedAt],
    );
  } else {
    await client.query(
      `UPDATE cashbook_entries SET staff_shift_id=$1 WHERE business_id=$2 AND branch_id=$3 AND operating_day_id=$4 AND staff_shift_id IS NULL AND actor_staff_id=$5 AND occurred_at >= $6`,
      [input.id,input.businessId,input.branchId,input.operatingDayId,input.staffId,input.openedAt],
    );
  }
  await recomputeReconciliation(client,kind,input.id);
}
export async function applyReconciliationMutation(pool: DatabasePool, context: SaleMutationContext, payload: ReconciliationPayload, type: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !context.branchId || !context.clientMutationId || Number.isNaN(Date.parse(context.occurredAt))) throw new CashbookError("Invalid operations mutation");
  const day = type.startsWith("OPERATING_DAY"), close = type.includes("CLOSE");
  const table = day ? "operating_days" : "staff_shifts", kind = day ? "operating_day" : "staff_shift";
  if (payload.note !== undefined && (typeof payload.note !== "string" || payload.note.length>1000)) throw new CashbookError("Invalid note");
  const list = (close ? payload.closingBalances : payload.openingBalances) ?? [];
  if (!Array.isArray(list)) throw new CashbookError("Balances must be a list");
  const amounts = new Map<string,number>();
  for (const b of list) {
    if (!b || !isCashMethod(b.method) || !Number.isSafeInteger(b.countedMinor) || b.countedMinor<0 || amounts.has(b.method)) throw new CashbookError("Invalid or duplicate counted balance");
    amounts.set(b.method,b.countedMinor);
  }
  if (close && amounts.size!==5) throw new CashbookError("All five closing counted balances are required");
  if (day && !close && (typeof payload.businessDate!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.businessDate) || Number.isNaN(Date.parse(payload.businessDate)) || new Date(payload.businessDate).toISOString().slice(0,10)!==payload.businessDate)) throw new CashbookError("Valid businessDate required");
  return withTransaction(pool, async client => {
    await lockOperations(client,context.businessId,context.branchId);
    const currency = (await client.query(`SELECT b.currency_code FROM branches br JOIN businesses b ON b.id=br.business_id WHERE br.id=$1 AND br.business_id=$2 AND br.is_active=true`, [context.branchId,context.businessId])).rows[0]?.currency_code;
    if (!currency) throw new CashbookError("Branch not found", "BRANCH_NOT_FOUND");
    if (!(await client.query(`SELECT id FROM staff WHERE id=$1 AND business_id=$2 AND is_active=true`, [payload.actorStaffId,context.businessId])).rowCount) throw new CashbookError("Active actor required");
    const prior = (await client.query(`SELECT * FROM ${table} WHERE business_id=$1 AND ${close ? "closing" : "opening"}_client_mutation_id=$2`, [context.businessId,context.clientMutationId])).rows[0];
    if (prior) {
      const suppliedId = day ? payload.dayId : payload.shiftId;
      if (prior.branch_id!==context.branchId || (close ? prior.closed_by_staff_id : prior.opened_by_staff_id)!==payload.actorStaffId || (suppliedId && suppliedId!==prior.id)) throw new CashbookError("Replay actor, branch or interval differs");
      return {id:prior.id,idempotentReplay:true};
    }
    let id: string;
    if (!close) {
      const supplied = day ? payload.dayId : payload.shiftId;
      if (supplied !== undefined && (typeof supplied !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supplied))) throw new CashbookError("Client interval ID must be a UUID");
    }
    if (close) {
      const target = day ? payload.dayId : payload.shiftId;
      if (typeof target!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) throw new CashbookError("Close target UUID required");
      const row = (await client.query(`SELECT * FROM ${table} WHERE id=$1 AND business_id=$2 AND branch_id=$3 AND status='OPEN' ${day ? "" : "AND staff_id=$4"} FOR UPDATE`, day ? [target,context.businessId,context.branchId] : [target,context.businessId,context.branchId,payload.actorStaffId])).rows[0];
      if (!row) throw new CashbookError("Own open interval not found");
      if (Date.parse(context.occurredAt)<new Date(row.opened_at).getTime()) throw new CashbookError("Close cannot precede open");
      if (day && (await client.query(`SELECT id FROM staff_shifts WHERE operating_day_id=$1 AND status='OPEN'`, [target])).rowCount) throw new CashbookError("Close all open shifts first");
      if (day && (await client.query(`SELECT id FROM staff_shifts WHERE operating_day_id=$1 AND closed_at>$2`,[target,context.occurredAt])).rowCount) throw new CashbookError("Day close cannot precede shift close");
      const laterInterval = day
        ? await client.query(`SELECT id FROM operating_days WHERE business_id=$1 AND branch_id=$2 AND id<>$3 AND opened_at>$4 AND opened_at<=$5 LIMIT 1`,[context.businessId,context.branchId,target,row.opened_at,context.occurredAt])
        : await client.query(`SELECT id FROM staff_shifts WHERE business_id=$1 AND branch_id=$2 AND staff_id=$3 AND id<>$4 AND opened_at>$5 AND opened_at<=$6 LIMIT 1`,[context.businessId,context.branchId,payload.actorStaffId,target,row.opened_at,context.occurredAt]);
      if (laterInterval.rowCount) throw new CashbookError("Close would overlap a later interval");
      // A delayed open mutation may have provisionally claimed later offline movements. Finalizing the
      // interval releases anything after the authoritative close timestamp so delivery order cannot
      // permanently contaminate this close or block the next interval.
      if (day) {
        await client.query(`UPDATE cashbook_entries SET staff_shift_id=NULL,operating_day_id=NULL WHERE operating_day_id=$1 AND occurred_at>$2`,[target,context.occurredAt]);
      } else {
        await client.query(`UPDATE cashbook_entries SET staff_shift_id=NULL WHERE staff_shift_id=$1 AND occurred_at>$2`,[target,context.occurredAt]);
      }
      id=target;
      await client.query(`UPDATE ${table} SET status='CLOSED',closed_at=$2,closed_by_staff_id=$3,closing_client_mutation_id=$4,note=COALESCE($5,note) WHERE id=$1`,[id,context.occurredAt,payload.actorStaffId,context.clientMutationId,payload.note ?? null]);
      for (const method of cashMethods) await client.query(`UPDATE ${kind}_method_balances SET closing_counted_minor=$3 WHERE ${kind}_id=$1 AND method=$2`, [id,method,amounts.get(method)]);
      await recomputeReconciliation(client,kind,id);
    } else {
      let dayId: string | undefined;
      if (!day) {
        dayId=(await client.query(`SELECT id FROM operating_days WHERE business_id=$1 AND branch_id=$2 AND status='OPEN' AND opened_at<=$3 AND ($4::uuid IS NULL OR id=$4) ORDER BY opened_at DESC,id DESC LIMIT 1`,[context.businessId,context.branchId,context.occurredAt,payload.dayId ?? null])).rows[0]?.id;
        if (!dayId) throw new CashbookError("An open operating day at occurredAt is required");
      }
      // Only an interval that already contains this opening instant is an overlap. Later closed
      // intervals are allowed so a delayed offline interval can be backfilled, then its close is
      // checked against the next interval boundary above.
      if ((await client.query(`SELECT id FROM ${table} WHERE business_id=$1 AND branch_id=$2 ${day ? "" : "AND staff_id=$4"} AND opened_at <= $3 AND (closed_at IS NULL OR closed_at >= $3)`,day ? [context.businessId,context.branchId,context.occurredAt] : [context.businessId,context.branchId,context.occurredAt,payload.actorStaffId])).rowCount) throw new CashbookError("An overlapping or open interval already exists");
      const suppliedId = day ? payload.dayId : payload.shiftId;
      const values = [suppliedId ?? null,context.businessId,context.branchId,currency,payload.actorStaffId,context.clientMutationId,context.occurredAt,payload.note ?? null,...(day ? [payload.businessDate] : [dayId,payload.actorStaffId])];
      id=(await client.query(`INSERT INTO ${table}(id,business_id,branch_id,currency_code,opened_by_staff_id,opening_client_mutation_id,opened_at,note,status,${day ? "business_date" : "operating_day_id,staff_id"}) VALUES (COALESCE($1,gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,'OPEN',${day ? "$9" : "$9,$10"}) RETURNING id`,values)).rows[0]!.id;
      for (const method of cashMethods) await client.query(`INSERT INTO ${kind}_method_balances(${kind}_id,method,opening_counted_minor,expected_closing_minor) VALUES ($1,$2,$3,$3)`,[id,method,amounts.get(method) ?? 0]);
      if (day) {
        await attributeExistingCashbookEntries(client,kind,{ id,businessId:context.businessId,branchId:context.branchId,openedAt:context.occurredAt });
      } else {
        await attributeExistingCashbookEntries(client,kind,{ id,businessId:context.businessId,branchId:context.branchId,openedAt:context.occurredAt,operatingDayId:dayId!,staffId:payload.actorStaffId });
      }
    }
    const eventType=`${day ? "OPERATING_DAY" : "SHIFT"}_${close ? "CLOSED" : "OPENED"}`;
    const event=JSON.stringify({id,actorStaffId:payload.actorStaffId});
    await client.query(`INSERT INTO audit_events(business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,[context.businessId,context.branchId,payload.actorStaffId,eventType,kind.toUpperCase(),id,context.clientMutationId,event,context.occurredAt]);
    await client.query(`INSERT INTO outbox_events(business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,[context.businessId,context.branchId,kind.toUpperCase(),id,eventType,event,context.occurredAt]);
    return {id,idempotentReplay:false};
  });
}
