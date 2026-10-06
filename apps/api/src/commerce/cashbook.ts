import { lockOperations, recomputeReconciliation } from "./reconciliation.js";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { signedMinor } from "./valuation.js";
import type { SaleMutationContext } from "./sales.js";

export const cashMethods = ["CASH", "MOMO", "CARD", "BANK", "OTHER"] as const;
export type CashMethod = typeof cashMethods[number];
export type CashEntryType = "SALE_RECEIPT" | "CUSTOMER_PAYMENT" | "PURCHASE_PAYMENT" | "SUPPLIER_PAYMENT" | "SALE_REFUND" | "PURCHASE_RETURN_RECOVERY" | "EXPENSE" | "OPENING_BALANCE" | "ADJUSTMENT" | "OWNER_INJECTION" | "OWNER_WITHDRAWAL" | "TRANSFER_OUT" | "TRANSFER_IN";
export function isCashMethod(method: string): method is CashMethod { return (cashMethods as readonly string[]).includes(method); }
export async function recordCashbookEntry(client: DatabaseClient, input: {
  moneyAccountId?: string | undefined; businessId: string; branchId: string; amountDeltaMinor: number; currencyCode: string; method: CashMethod;
  entryType: CashEntryType; sourceType: string; sourceId: string; actorStaffId?: string | null | undefined; idempotencyKey: string; occurredAt: string;
}): Promise<void> {
  signedMinor(input.amountDeltaMinor);
  if (!input.amountDeltaMinor || !isCashMethod(input.method) || !input.idempotencyKey || Number.isNaN(Date.parse(input.occurredAt))) throw new CashbookError("Invalid cashbook entry");
  // Money-account row locks always precede the branch operations lock. Treasury transfers lock
  // accounts first as well, so this shared order prevents transfer-vs-sale deadlocks.
  const moneyAccountId = await resolveMoneyAccount(client,input);
  await lockOperations(client,input.businessId,input.branchId);
  const operatingDayId = (await client.query(`SELECT id FROM operating_days WHERE business_id=$1 AND branch_id=$2 AND opened_at<=$3 AND (closed_at IS NULL OR $3<=closed_at) ORDER BY opened_at DESC,id DESC LIMIT 1`,[input.businessId,input.branchId,input.occurredAt])).rows[0]?.id ?? null;
  const staffShiftId = operatingDayId && input.actorStaffId ? (await client.query(`SELECT id FROM staff_shifts WHERE business_id=$1 AND branch_id=$2 AND operating_day_id=$3 AND staff_id=$4 AND opened_at<=$5 AND (closed_at IS NULL OR $5<=closed_at) ORDER BY opened_at DESC,id DESC LIMIT 1`,[input.businessId,input.branchId,operatingDayId,input.actorStaffId,input.occurredAt])).rows[0]?.id ?? null : null;
  const values = [input.businessId,input.branchId,input.amountDeltaMinor,input.currencyCode,input.method,input.entryType,input.sourceType,input.sourceId,input.actorStaffId ?? null,input.idempotencyKey,input.occurredAt,moneyAccountId,operatingDayId,staffShiftId];
  // A conflicting key must describe the same movement; silently dropping another movement would hide money.
  const result = await client.query(`INSERT INTO cashbook_entries(business_id,branch_id,amount_delta_minor,currency_code,method,entry_type,source_type,source_id,actor_staff_id,idempotency_key,occurred_at,money_account_id,operating_day_id,staff_shift_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT(business_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
    WHERE cashbook_entries.branch_id=EXCLUDED.branch_id AND cashbook_entries.amount_delta_minor=EXCLUDED.amount_delta_minor
    AND cashbook_entries.currency_code=EXCLUDED.currency_code AND cashbook_entries.method=EXCLUDED.method
    AND cashbook_entries.entry_type=EXCLUDED.entry_type AND cashbook_entries.source_type=EXCLUDED.source_type AND cashbook_entries.source_id=EXCLUDED.source_id
    AND cashbook_entries.actor_staff_id IS NOT DISTINCT FROM EXCLUDED.actor_staff_id
    AND cashbook_entries.money_account_id=EXCLUDED.money_account_id
    AND cashbook_entries.operating_day_id IS NOT DISTINCT FROM EXCLUDED.operating_day_id
    AND cashbook_entries.staff_shift_id IS NOT DISTINCT FROM EXCLUDED.staff_shift_id
    AND cashbook_entries.occurred_at=EXCLUDED.occurred_at
    RETURNING id`, values);
  if (!result.rowCount) throw new CashbookError("Cashbook idempotency key conflicts with another movement");
  if (operatingDayId) await recomputeReconciliation(client,"operating_day",operatingDayId);
  if (staffShiftId) await recomputeReconciliation(client,"staff_shift",staffShiftId);
}
export class CashbookError extends Error { constructor(message: string, readonly code = "CASHBOOK_INVALID", readonly statusCode = 400) { super(message); } }
export interface CashbookMutationPayload {
  moneyAccountId?: string; categoryId?: string; amountMinor?: number; amountDeltaMinor?: number; currencyCode?: string; method: CashMethod;
  description?: string; payee?: string; provider?: string; providerReference?: string; actorStaffId?: string;
  reason?: "OPENING_BALANCE" | "CORRECTION" | "OWNER_INJECTION" | "OWNER_WITHDRAWAL"; note?: string;
}
export async function applyCashbookMutation(pool: DatabasePool, context: SaleMutationContext, payload: CashbookMutationPayload, adjustment: boolean) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CashbookError("Payload must be an object");
  for (const value of [payload.description,payload.payee,payload.provider,payload.providerReference,payload.note,payload.currencyCode]) if (value !== undefined && (typeof value !== "string" || value.length > 1000)) throw new CashbookError("Text value is invalid or too long");
  if (!context.branchId || !context.clientMutationId || Number.isNaN(Date.parse(context.occurredAt))) throw new CashbookError("Branch, mutation identity and valid occurredAt are required");
  const amount = adjustment ? payload.amountDeltaMinor : payload.amountMinor;
  if (!Number.isSafeInteger(amount) || !amount || (!adjustment && amount! < 0) || !isCashMethod(payload.method)) throw new CashbookError("Amount must be a valid non-zero minor-unit integer and method must move money");
  const delta = adjustment ? amount! : -amount!;
  const reasons = ["OPENING_BALANCE","CORRECTION","OWNER_INJECTION","OWNER_WITHDRAWAL"];
  if (adjustment && (!reasons.includes(payload.reason ?? "") || !payload.note?.trim() || (["OPENING_BALANCE","OWNER_INJECTION"].includes(payload.reason!) && delta < 0) || (payload.reason === "OWNER_WITHDRAWAL" && delta > 0))) throw new CashbookError("Adjustment reason, sign and note are invalid");
  if (!adjustment && !payload.description?.trim() && !payload.payee?.trim()) throw new CashbookError("Expense needs a description or payee");
  return withTransaction(pool, async client => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`${context.businessId}:${context.clientMutationId}`]);
    const currency = (await client.query<{currency_code:string}>(`SELECT b.currency_code FROM branches br JOIN businesses b ON b.id=br.business_id WHERE br.id=$1 AND br.business_id=$2 AND br.is_active=true FOR SHARE OF br,b`, [context.branchId,context.businessId])).rows[0]?.currency_code;
    if (!currency) throw new CashbookError("Branch not found for business", "BRANCH_NOT_FOUND");
    if (payload.currencyCode && payload.currencyCode.toUpperCase() !== currency) throw new CashbookError("Currency must match business");
    if (!(await client.query(`SELECT id FROM staff WHERE id=$1 AND business_id=$2 AND is_active=true`, [payload.actorStaffId,context.businessId])).rowCount) throw new CashbookError("Active staff actor required");
    const table = adjustment ? "cashbook_adjustments" : "expenses";
    const prior = (await client.query<{id:string;branch_id:string}>(`SELECT id,branch_id FROM ${table} WHERE business_id=$1 AND client_mutation_id=$2`, [context.businessId,context.clientMutationId])).rows[0];
    if (prior) {
      if (prior.branch_id !== context.branchId) throw new CashbookError("Replay branch differs");
      return {id:prior.id,idempotentReplay:true};
    }
    if (!adjustment && !(await client.query(`SELECT id FROM expense_categories WHERE id=$1 AND business_id=$2 AND is_active=true FOR SHARE`, [payload.categoryId,context.businessId])).rowCount) throw new CashbookError("Active expense category required");
    const moneyAccountId = await resolveMoneyAccount(client,{...context,currencyCode:currency,method:payload.method,moneyAccountId:payload.moneyAccountId});
    const fields = adjustment ? "reason,note,amount_delta_minor" : "category_id,description,payee,provider,provider_reference,amount_minor";
    const extra = adjustment ? [payload.reason,payload.note!.trim(),delta] : [payload.categoryId,payload.description?.trim() || null,payload.payee?.trim() || null,payload.provider?.trim() || null,payload.providerReference?.trim() || null,amount];
    const values = [context.businessId,context.branchId,currency,payload.method,payload.actorStaffId,context.clientMutationId,context.occurredAt,moneyAccountId,...extra];
    const id = (await client.query<{id:string}>(`INSERT INTO ${table}(business_id,branch_id,currency_code,method,actor_staff_id,client_mutation_id,occurred_at,money_account_id,${fields}) VALUES (${values.map((_,i)=>`$${i+1}`).join(",")}) RETURNING id`, values)).rows[0]!.id;
    const entryType: CashEntryType = adjustment ? (payload.reason === "CORRECTION" ? "ADJUSTMENT" : payload.reason!) : "EXPENSE";
    await recordCashbookEntry(client,{...context,currencyCode:currency,method:payload.method,moneyAccountId,amountDeltaMinor:delta,entryType,sourceType:adjustment ? "CASHBOOK_ADJUSTMENT" : "EXPENSE",sourceId:id,actorStaffId:payload.actorStaffId,idempotencyKey:`${adjustment ? "adjustment" : "expense"}:${id}`});
    const event = JSON.stringify({amountDeltaMinor:delta,method:payload.method});
    await client.query(`INSERT INTO audit_events(business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,[context.businessId,context.branchId,payload.actorStaffId,`${entryType}_CREATED`,table.toUpperCase(),id,context.clientMutationId,event,context.occurredAt]);
    await client.query(`INSERT INTO outbox_events(business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,[context.businessId,context.branchId,table.toUpperCase(),id,`${entryType}_CREATED`,event,context.occurredAt]);
    return {id,amountDeltaMinor:delta,idempotentReplay:false};
  });
}

export async function resolveMoneyAccount(client: DatabaseClient, input: {businessId:string;branchId:string;currencyCode:string;method:CashMethod;moneyAccountId?:string|undefined}): Promise<string> {
  if (input.moneyAccountId !== undefined && (typeof input.moneyAccountId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.moneyAccountId))) throw new CashbookError("Invalid money account ID");
  const row = (await client.query(`SELECT a.* FROM money_accounts a WHERE a.business_id=$1 AND a.id=COALESCE($5::uuid,(SELECT money_account_id FROM money_account_defaults WHERE business_id=$1 AND branch_id=$2 AND method=$4)) AND a.active AND a.currency_code=$3 AND a.method=$4 AND (a.branch_id IS NULL OR a.branch_id=$2) FOR SHARE OF a`, [input.businessId,input.branchId,input.currencyCode,input.method,input.moneyAccountId ?? null])).rows[0];
  if (!row) throw new CashbookError("Active money account must match business, branch, currency and method");
  return row.id;
}
