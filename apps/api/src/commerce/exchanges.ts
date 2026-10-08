import type { ExchangeCreateInput, ExchangeResult, ExchangeSettlementMethod } from "@tradeos/contracts";
import type { RefundMethod } from "@tradeos/domain";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { recordCashbookEntry, isCashMethod } from "./cashbook.js";
import { assertCustomerCreditAvailable, loadCustomerAccount, recordCustomerAccountEntry } from "./customer-credit.js";
import { createCustomerCreditObligation, reduceCustomerObligationForSale } from "./credit-obligations.js";
import { allocateRefund, applyReturnMutationInTransaction, refreshPayments, type ReturnMutationPayload } from "./returns.js";
import { applySaleMutationInTransaction, type PaymentMethod, type SaleMutationPayload } from "./sales.js";

export type ExchangeMutationPayload = ExchangeCreateInput & { initiatedByStaffId?: string };

export class ExchangeMutationError extends Error {
  constructor(message: string, readonly code = "EXCHANGE_INVALID") { super(message); }
}

type ExchangeContext = { businessId: string; branchId: string; clientMutationId: string; occurredAt: string };
type OriginalSale = { id: string; customer_id: string | null; currency_code: string; status: string };
type ExchangeRow = {
  id: string; original_sale_id: string; return_case_id: string; replacement_sale_id: string;
  return_total_minor: string | number; replacement_total_minor: string | number; net_difference_minor: string | number; status: string;
};

export async function applyExchangeMutation(
  pool: DatabasePool,
  context: ExchangeContext,
  payload: ExchangeMutationPayload,
): Promise<ExchangeResult & { idempotentReplay: boolean }> {
  validateExchange(context, payload);
  return withTransaction(pool, async (client) => {
    const prior = await client.query<ExchangeRow>(
      `SELECT id,original_sale_id,return_case_id,replacement_sale_id,return_total_minor,replacement_total_minor,net_difference_minor,status
       FROM exchange_cases WHERE business_id=$1 AND client_mutation_id=$2`,
      [context.businessId, context.clientMutationId],
    );
    if (prior.rows[0]) return resultFromRow(prior.rows[0], true);

    const original = await loadOriginalSale(client, context, payload.originalSaleId);
    const actorStaffId = payload.initiatedByStaffId ?? null;

    const returned = await applyReturnMutationInTransaction(
      client,
      { ...context, clientMutationId: `${context.clientMutationId}:return` },
      {
        originalSaleId: payload.originalSaleId,
        reason: payload.reason,
        refundMethod: "ORIGINAL_METHOD",
        ...(actorStaffId ? { initiatedByStaffId: actorStaffId, approvedByStaffId: actorStaffId } : {}),
        lines: payload.returnedLines,
      } satisfies ReturnMutationPayload,
      { settleRefund: false, recordedRefundMethod: "EXCHANGE_CREDIT" },
    );

    const replacementPayload: SaleMutationPayload = {
      ...(original.customer_id ? { customerId: original.customer_id } : {}),
      ...(actorStaffId ? { cashierStaffId: actorStaffId } : {}),
      lines: payload.replacementLines,
    };
    const replacement = await applySaleMutationInTransaction(
      client,
      { ...context, clientMutationId: `${context.clientMutationId}:replacement` },
      replacementPayload,
      { settlePayments: false },
    );

    const netDifferenceMinor = replacement.totalMinor - returned.refundTotalMinor;
    let status: "PROCESSING" | "COMPLETED" = "COMPLETED";
    if (netDifferenceMinor > 0) {
      await collectDifference(client, context, payload, original, replacement.saleId, netDifferenceMinor, actorStaffId);
    } else if (netDifferenceMinor < 0) {
      status = await refundDifference(client, context, payload, original, returned.returnCaseId, -netDifferenceMinor, actorStaffId);
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO exchange_cases (
         business_id,branch_id,original_sale_id,return_case_id,replacement_sale_id,customer_id,initiated_by_staff_id,
         status,currency_code,reason,settlement_method,return_total_minor,replacement_total_minor,net_difference_minor,
         client_mutation_id,created_at,completed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [context.businessId,context.branchId,original.id,returned.returnCaseId,replacement.saleId,original.customer_id,actorStaffId,
       status,original.currency_code,payload.reason.trim(),payload.settlementMethod,returned.refundTotalMinor,replacement.totalMinor,
       netDifferenceMinor,context.clientMutationId,context.occurredAt,status === "COMPLETED" ? context.occurredAt : null],
    );
    const exchangeCaseId = inserted.rows[0]?.id;
    if (!exchangeCaseId) throw new ExchangeMutationError("Could not create exchange case", "EXCHANGE_CREATE_FAILED");

    const auditPayload = JSON.stringify({
      originalSaleId: original.id,
      returnCaseId: returned.returnCaseId,
      replacementSaleId: replacement.saleId,
      returnTotalMinor: returned.refundTotalMinor,
      replacementTotalMinor: replacement.totalMinor,
      netDifferenceMinor,
      status,
    });
    await client.query(
      `INSERT INTO audit_events (business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload,occurred_at)
       VALUES ($1,$2,$3,$4,'EXCHANGE_CASE',$5,$6,$7::jsonb,$8)`,
      [context.businessId,context.branchId,actorStaffId,status === "COMPLETED" ? "EXCHANGE_COMPLETED" : "EXCHANGE_PROCESSING",
       exchangeCaseId,context.clientMutationId,auditPayload,context.occurredAt],
    );
    await client.query(
      `INSERT INTO outbox_events (business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at)
       VALUES ($1,$2,'EXCHANGE_CASE',$3,$4,$5::jsonb,$6)`,
      [context.businessId,context.branchId,exchangeCaseId,status === "COMPLETED" ? "EXCHANGE_COMPLETED" : "EXCHANGE_PROCESSING",auditPayload,context.occurredAt],
    );

    return {
      exchangeCaseId,
      originalSaleId: original.id,
      returnCaseId: returned.returnCaseId,
      replacementSaleId: replacement.saleId,
      returnTotalMinor: returned.refundTotalMinor,
      replacementTotalMinor: replacement.totalMinor,
      netDifferenceMinor,
      status,
      idempotentReplay: false,
    };
  });
}

async function loadOriginalSale(client: DatabaseClient, context: ExchangeContext, saleId: string): Promise<OriginalSale> {
  const result = await client.query<OriginalSale>(
    `SELECT id,customer_id,currency_code,status FROM sales
     WHERE id=$1 AND business_id=$2 AND branch_id=$3 FOR UPDATE`,
    [saleId,context.businessId,context.branchId],
  );
  const sale = result.rows[0];
  if (!sale) throw new ExchangeMutationError("Original sale was not found", "SALE_NOT_FOUND");
  if (!["COMPLETED","PARTIALLY_REFUNDED","REFUNDED"].includes(sale.status)) {
    throw new ExchangeMutationError(`Sale in status ${sale.status} cannot be exchanged`, "SALE_NOT_RETURNABLE");
  }
  return sale;
}

async function collectDifference(
  client: DatabaseClient,
  context: ExchangeContext,
  payload: ExchangeCreateInput,
  original: OriginalSale,
  replacementSaleId: string,
  amountMinor: number,
  actorStaffId: string | null,
): Promise<void> {
  const method = await resolveCollectionMethod(client, original.id, payload.settlementMethod);
  if (method === "CUSTOMER_CREDIT" && !original.customer_id) {
    throw new ExchangeMutationError("Customer credit requires a named customer", "CUSTOMER_REQUIRED_FOR_CREDIT");
  }
  const payment = await client.query<{ id: string }>(
    `INSERT INTO payments (business_id,branch_id,sale_id,amount_minor,currency_code,method,status,client_mutation_id,received_at)
     VALUES ($1,$2,$3,$4,$5,$6,'SUCCEEDED',$7,$8) RETURNING id`,
    [context.businessId,context.branchId,replacementSaleId,amountMinor,original.currency_code,method,
     `${context.clientMutationId}:difference-payment`,context.occurredAt],
  );
  const paymentId = payment.rows[0]?.id;
  if (!paymentId) throw new ExchangeMutationError("Could not record exchange payment", "EXCHANGE_PAYMENT_FAILED");

  if (method === "CUSTOMER_CREDIT" && original.customer_id) {
    const credit = await assertCustomerCreditAvailable(client,context.businessId,original.customer_id,original.currency_code,amountMinor);
    await recordCustomerAccountEntry(client,{
      businessId:context.businessId,branchId:context.branchId,customerId:original.customer_id,currencyCode:original.currency_code,
      entryType:"CREDIT_SALE",balanceDeltaMinor:amountMinor,sourceType:"SALE",sourceId:replacementSaleId,actorStaffId,
      idempotencyKey:`${context.clientMutationId}:difference-credit-ledger`,occurredAt:context.occurredAt,
    });
    await createCustomerCreditObligation(client,{
      businessId:context.businessId,branchId:context.branchId,customerId:original.customer_id,saleId:replacementSaleId,
      currencyCode:original.currency_code,amountMinor,termsDays:credit.creditTermsDays,occurredAt:context.occurredAt,
    });
  } else if (isCashMethod(method)) {
    await recordCashbookEntry(client,{
      ...context,moneyAccountId:payload.moneyAccountId,currencyCode:original.currency_code,method,amountDeltaMinor:amountMinor,
      entryType:"SALE_RECEIPT",sourceType:"PAYMENT",sourceId:paymentId,actorStaffId,idempotencyKey:`exchange-payment:${paymentId}`,
    });
  }
}

async function refundDifference(
  client: DatabaseClient,
  context: ExchangeContext,
  payload: ExchangeCreateInput,
  original: OriginalSale,
  returnCaseId: string,
  amountMinor: number,
  actorStaffId: string | null,
): Promise<"PROCESSING" | "COMPLETED"> {
  if (payload.settlementMethod === "OTHER") {
    throw new ExchangeMutationError("OTHER cannot be used to refund an exchange difference", "EXCHANGE_REFUND_METHOD_INVALID");
  }
  const allocations = await allocateRefund(client,original.id,amountMinor,payload.settlementMethod as RefundMethod);
  let pending = false;
  let customerCreditRefundMinor = 0;
  for (let index=0; index<allocations.length; index += 1) {
    const allocation = allocations[index]!;
    pending ||= allocation.status === "PENDING";
    if (allocation.method === "CUSTOMER_CREDIT") customerCreditRefundMinor += allocation.amountMinor;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO refund_transactions (business_id,return_case_id,original_payment_id,amount_minor,currency_code,method,status,idempotency_key,created_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [context.businessId,returnCaseId,allocation.originalPaymentId,allocation.amountMinor,original.currency_code,allocation.method,
       allocation.status,`${context.clientMutationId}:difference-refund:${index}`,context.occurredAt,
       allocation.status === "SUCCEEDED" ? context.occurredAt : null],
    );
    const refundId = inserted.rows[0]?.id;
    if (!refundId) throw new ExchangeMutationError("Could not record exchange refund", "EXCHANGE_REFUND_FAILED");
    if (allocation.status === "SUCCEEDED" && isCashMethod(allocation.method)) {
      const account = allocation.originalPaymentId
        ? (await client.query<{ money_account_id: string | null }>(
            `SELECT e.money_account_id FROM cashbook_entries e
             WHERE e.business_id=$1 AND e.source_type='PAYMENT' AND e.source_id=$2 AND e.method=$3 LIMIT 1`,
            [context.businessId,allocation.originalPaymentId,allocation.method],
          )).rows[0]?.money_account_id ?? undefined
        : payload.moneyAccountId;
      await recordCashbookEntry(client,{
        ...context,moneyAccountId:account,currencyCode:original.currency_code,method:allocation.method,
        amountDeltaMinor:-allocation.amountMinor,entryType:"SALE_REFUND",sourceType:"REFUND_TRANSACTION",sourceId:refundId,
        actorStaffId,idempotencyKey:`exchange-refund:${refundId}`,
      });
    }
  }
  if (customerCreditRefundMinor > 0) {
    if (!original.customer_id) throw new ExchangeMutationError("Customer credit refund requires a named customer", "CUSTOMER_REQUIRED_FOR_CREDIT_REFUND");
    const account = await loadCustomerAccount(client,context.businessId,original.customer_id,true);
    if (account.currency_code !== original.currency_code) throw new ExchangeMutationError("Customer account currency does not match the sale", "CUSTOMER_CURRENCY_MISMATCH");
    await recordCustomerAccountEntry(client,{
      businessId:context.businessId,branchId:context.branchId,customerId:original.customer_id,currencyCode:original.currency_code,
      entryType:"CREDIT_REFUND",balanceDeltaMinor:-customerCreditRefundMinor,sourceType:"RETURN_CASE",sourceId:returnCaseId,
      actorStaffId,idempotencyKey:`${context.clientMutationId}:difference-credit-refund`,occurredAt:context.occurredAt,
    });
    await reduceCustomerObligationForSale(client,{
      businessId:context.businessId,saleId:original.id,sourceId:returnCaseId,amountMinor:customerCreditRefundMinor,occurredAt:context.occurredAt,
    });
  }
  await refreshPayments(client,original.id);
  return pending ? "PROCESSING" : "COMPLETED";
}

async function resolveCollectionMethod(client: DatabaseClient, saleId: string, requested: ExchangeSettlementMethod): Promise<PaymentMethod> {
  if (requested !== "ORIGINAL_METHOD") return requested as PaymentMethod;
  const methods = await client.query<{ method: PaymentMethod }>(
    `SELECT DISTINCT method FROM payments WHERE sale_id=$1 AND status IN ('SUCCEEDED','PARTIALLY_REVERSED') ORDER BY method`, [saleId],
  );
  if (methods.rows.length !== 1) throw new ExchangeMutationError("Original payment method is ambiguous for the exchange difference", "EXCHANGE_ORIGINAL_METHOD_AMBIGUOUS");
  return methods.rows[0]!.method;
}

function validateExchange(context: ExchangeContext, payload: ExchangeCreateInput): void {
  if (!context.branchId || !context.clientMutationId || Number.isNaN(Date.parse(context.occurredAt))) {
    throw new ExchangeMutationError("Branch, mutation identity and valid occurredAt are required");
  }
  if (!payload?.originalSaleId || !payload.reason?.trim()) throw new ExchangeMutationError("Original sale and reason are required");
  if (!Array.isArray(payload.returnedLines) || payload.returnedLines.length === 0) throw new ExchangeMutationError("At least one returned line is required");
  if (!Array.isArray(payload.replacementLines) || payload.replacementLines.length === 0) throw new ExchangeMutationError("At least one replacement line is required");
  for (const line of payload.returnedLines) {
    if (!line.saleLineId || !Number.isFinite(line.quantity) || line.quantity <= 0) throw new ExchangeMutationError("Returned lines need a sale line and positive quantity");
  }
  for (const line of payload.replacementLines) {
    if (!line.itemId || !line.saleUnitCode || !Number.isFinite(line.quantity) || line.quantity <= 0) throw new ExchangeMutationError("Replacement lines need an item, sale unit and positive quantity");
  }
}

function resultFromRow(row: ExchangeRow, idempotentReplay: boolean): ExchangeResult & { idempotentReplay: boolean } {
  return {
    exchangeCaseId: row.id,
    originalSaleId: row.original_sale_id,
    returnCaseId: row.return_case_id,
    replacementSaleId: row.replacement_sale_id,
    returnTotalMinor: Number(row.return_total_minor),
    replacementTotalMinor: Number(row.replacement_total_minor),
    netDifferenceMinor: Number(row.net_difference_minor),
    status: row.status === "PROCESSING" ? "PROCESSING" : "COMPLETED",
    idempotentReplay,
  };
}
