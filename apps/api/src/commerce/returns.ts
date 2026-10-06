import { adjustValuation } from "./valuation.js";
import { money, planSaleReturn, SaleReturnError, type RefundMethod, type ReturnDisposition, type SaleLineSnapshot } from "@tradeos/domain";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { loadCustomerAccount, recordCustomerAccountEntry } from "./customer-credit.js";

export interface ReturnMutationPayload {
  originalSaleId: string;
  reason: string;
  refundMethod: RefundMethod;
  initiatedByStaffId?: string;
  approvedByStaffId?: string;
  lines: Array<{ saleLineId: string; quantity: number; disposition: ReturnDisposition }>;
}

export interface ReturnMutationContext {
  businessId: string;
  branchId: string;
  clientMutationId: string;
  occurredAt: string;
}

export interface ReturnMutationResult {
  returnCaseId: string;
  status: "PROCESSING" | "COMPLETED";
  refundTotalMinor: number;
  pendingRefundMinor: number;
  idempotentReplay: boolean;
}

type SaleRow = { id: string; currency_code: string; total_minor: string | number; status: string; customer_id: string | null };
type SaleLineRow = {
  id: string;
  item_kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  quantity: string | number;
  quantity_previously_returned: string | number;
  unit_net_minor: string | number;
  unit_tax_minor: string | number;
  unit_cost_minor: string | number;
  line_cost_minor: string | number;
  stock_quantity: string | number | null;
  stock_unit_code: string | null;
  item_id: string;
};
type PaymentRow = {
  id: string;
  method: "CASH" | "MOMO" | "CARD" | "BANK" | "CUSTOMER_CREDIT" | "OTHER";
  amount_minor: string | number;
  already_refunded_minor: string | number;
};
type ConcreteRefundMethod = Exclude<RefundMethod, "ORIGINAL_METHOD">;
type RefundAllocation = { originalPaymentId: string | null; method: ConcreteRefundMethod; amountMinor: number; status: "PENDING" | "SUCCEEDED" };

export class ReturnMutationError extends Error {
  constructor(message: string, readonly code = "RETURN_INVALID") { super(message); }
}

export async function applyReturnMutation(
  pool: DatabasePool,
  context: ReturnMutationContext,
  payload: ReturnMutationPayload,
): Promise<ReturnMutationResult> {
  validateReturn(context, payload);

  return withTransaction(pool, async (client) => {
    const prior = await client.query<{ id: string; status: string; refund_total_minor: string | number }>(
      `SELECT id,status,refund_total_minor FROM return_cases
       WHERE business_id=$1 AND client_mutation_id=$2`, [context.businessId, context.clientMutationId],
    );
    const replay = prior.rows[0];
    if (replay) {
      return {
        returnCaseId: replay.id,
        status: replay.status === "COMPLETED" ? "COMPLETED" : "PROCESSING",
        refundTotalMinor: Number(replay.refund_total_minor),
        pendingRefundMinor: await pendingAmount(client, replay.id),
        idempotentReplay: true,
      };
    }

    const saleResult = await client.query<SaleRow>(
      `SELECT id,currency_code,total_minor,status,customer_id FROM sales
       WHERE id=$1 AND business_id=$2 AND branch_id=$3 FOR UPDATE`,
      [payload.originalSaleId, context.businessId, context.branchId],
    );
    const sale = saleResult.rows[0];
    if (!sale) throw new ReturnMutationError("Original sale was not found", "SALE_NOT_FOUND");
    if (!["COMPLETED","PARTIALLY_REFUNDED","REFUNDED"].includes(sale.status)) {
      throw new ReturnMutationError(`Sale in status ${sale.status} cannot be returned`, "SALE_NOT_RETURNABLE");
    }

    const requestedIds = payload.lines.map((line) => line.saleLineId);
    const linesResult = await client.query<SaleLineRow>(
      `SELECT sl.id,sl.item_kind,sl.quantity,sl.unit_net_minor,sl.unit_tax_minor,sl.unit_cost_minor,sl.line_cost_minor,
              sl.stock_quantity,sl.stock_unit_code,sl.item_id,
              COALESCE((SELECT SUM(rl.quantity) FROM return_lines rl
                JOIN return_cases rc ON rc.id=rl.return_case_id
                WHERE rl.original_sale_line_id=sl.id
                  AND rc.status IN ('PENDING_APPROVAL','APPROVED','PROCESSING','COMPLETED')),0) AS quantity_previously_returned
       FROM sale_lines sl
       WHERE sl.sale_id=$1 AND sl.business_id=$2 AND sl.id=ANY($3::uuid[])
       ORDER BY sl.id`,
      [sale.id, context.businessId, requestedIds],
    );
    if (linesResult.rows.length !== requestedIds.length) {
      throw new ReturnMutationError("One or more lines do not belong to the original sale", "SALE_LINE_NOT_FOUND");
    }

    const snapshots: SaleLineSnapshot[] = linesResult.rows.map((line) => {
      const sold = Number(line.quantity);
      const stock = line.stock_quantity === null ? null : Number(line.stock_quantity);
      return {
        id: line.id,
        kind: line.item_kind,
        quantitySold: sold,
        quantityPreviouslyReturned: Number(line.quantity_previously_returned),
        unitNet: money(sale.currency_code, Number(line.unit_net_minor)),
        unitTax: money(sale.currency_code, Number(line.unit_tax_minor)),
        unitCost: money(sale.currency_code, Number(line.unit_cost_minor)),
        lineCost: money(sale.currency_code, Number(line.line_cost_minor)),
        ...(line.stock_unit_code ? { stockUnitId: line.stock_unit_code } : {}),
        ...(stock !== null ? { stockQuantityPerSaleUnit: stock / sold } : {}),
      };
    });

    let plan;
    try {
      plan = planSaleReturn(snapshots, {
        idempotencyKey: context.clientMutationId,
        reason: payload.reason,
        refundMethod: payload.refundMethod,
        lines: payload.lines,
      });
    } catch (error) {
      if (error instanceof SaleReturnError) throw new ReturnMutationError(error.message);
      throw error;
    }

    const allocations = await allocateRefund(client, sale.id, plan.refundTotal.minor, payload.refundMethod);
    const customerCreditRefundMinor = allocations
      .filter((allocation) => allocation.method === "CUSTOMER_CREDIT")
      .reduce((sum, allocation) => sum + allocation.amountMinor, 0);
    if (customerCreditRefundMinor > 0) {
      if (!sale.customer_id) {
        throw new ReturnMutationError("Customer credit refunds require a customer on the original sale", "CUSTOMER_REQUIRED_FOR_CREDIT_REFUND");
      }
      const customer = await loadCustomerAccount(client, context.businessId, sale.customer_id, true);
      if (customer.currency_code !== sale.currency_code) {
        throw new ReturnMutationError("Customer account currency does not match the sale", "CUSTOMER_CURRENCY_MISMATCH");
      }
    }
    const pending = allocations.some((allocation) => allocation.status === "PENDING");
    const status = pending ? "PROCESSING" : "COMPLETED";
    const approvedBy = payload.approvedByStaffId ?? payload.initiatedByStaffId ?? null;

    const caseInsert = await client.query<{ id: string }>(
      `INSERT INTO return_cases (
         business_id,branch_id,original_sale_id,customer_id,initiated_by_staff_id,approved_by_staff_id,
         status,reason,refund_method,currency_code,net_revenue_reversal_minor,tax_reversal_minor,
         refund_total_minor,cogs_reversal_minor,discarded_cost_minor,client_mutation_id,created_at,completed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
      [
        context.businessId,context.branchId,sale.id,sale.customer_id,payload.initiatedByStaffId ?? null,approvedBy,
        status,payload.reason,payload.refundMethod,sale.currency_code,plan.netRevenueReversalTotal.minor,
        plan.taxReversalTotal.minor,plan.refundTotal.minor,plan.cogsReversalTotal.minor,plan.discardedCostTotal.minor,
        context.clientMutationId,context.occurredAt,pending ? null : context.occurredAt,
      ],
    );
    const returnCaseId = caseInsert.rows[0]?.id;
    if (!returnCaseId) throw new ReturnMutationError("Could not create return case", "RETURN_CREATE_FAILED");

    const originalById = new Map(linesResult.rows.map((line) => [line.id, line]));
    const returnItemIds = [...new Set(
      plan.lines
        .filter((line) => Boolean(line.inventoryEffect))
        .map((line) => originalById.get(line.saleLineId)?.item_id)
        .filter((itemId): itemId is string => Boolean(itemId)),
    )].sort();
    if (returnItemIds.length > 0) {
      await client.query(
        `SELECT id FROM catalog_items WHERE business_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
        [context.businessId, returnItemIds],
      );
    }
    for (let index = 0; index < plan.lines.length; index += 1) {
      const planned = plan.lines[index]!;
      const requested = payload.lines.find((line) => line.saleLineId === planned.saleLineId)!;
      const original = originalById.get(planned.saleLineId)!;
      const lineInsert = await client.query<{ id: string }>(
        `INSERT INTO return_lines (
           return_case_id,original_sale_line_id,quantity,disposition,net_revenue_reversal_minor,
           tax_reversal_minor,cogs_reversal_minor,discarded_cost_minor
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [returnCaseId,planned.saleLineId,planned.quantity,requested.disposition,planned.netRevenueReversal.minor,
         planned.taxReversal.minor,planned.cogsReversal.minor,planned.discardedCost?.minor ?? 0],
      );
      const returnLineId = lineInsert.rows[0]?.id;
      if (!returnLineId) throw new ReturnMutationError("Could not create return line", "RETURN_LINE_CREATE_FAILED");

      if (planned.inventoryEffect) {
        if (["RESTOCK","QUARANTINE"].includes(requested.disposition)) {
          await adjustValuation(client,context,original.item_id,planned.inventoryEffect.destination,planned.inventoryEffect.quantity,planned.cogsReversal.minor);
        }
        await client.query(
          `INSERT INTO inventory_movements (
             business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type,reason,
             reference_type,reference_id,actor_staff_id,idempotency_key,occurred_at
           ) VALUES ($1,$2,$3,$4,$5,$6,'SALE_RETURN','RETURN_LINE',$7,$8,$9,$10)`,
          [context.businessId,context.branchId,original.item_id,planned.inventoryEffect.stockUnitId,
           planned.inventoryEffect.quantity,planned.inventoryEffect.destination,returnLineId,
           payload.initiatedByStaffId ?? null,`${context.clientMutationId}:stock:${index}`,context.occurredAt],
        );
      }
    }

    for (let index = 0; index < allocations.length; index += 1) {
      const allocation = allocations[index]!;
      await client.query(
        `INSERT INTO refund_transactions (
           business_id,return_case_id,original_payment_id,amount_minor,currency_code,method,status,
           idempotency_key,created_at,completed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [context.businessId,returnCaseId,allocation.originalPaymentId,allocation.amountMinor,sale.currency_code,
         allocation.method,allocation.status,`${context.clientMutationId}:refund:${index}`,context.occurredAt,
         allocation.status === "SUCCEEDED" ? context.occurredAt : null],
      );
    }

    if (customerCreditRefundMinor > 0 && sale.customer_id) {
      await recordCustomerAccountEntry(client, {
        businessId: context.businessId,
        branchId: context.branchId,
        customerId: sale.customer_id,
        currencyCode: sale.currency_code,
        entryType: "CREDIT_REFUND",
        balanceDeltaMinor: -customerCreditRefundMinor,
        sourceType: "RETURN_CASE",
        sourceId: returnCaseId,
        actorStaffId: payload.initiatedByStaffId ?? null,
        idempotencyKey: `${context.clientMutationId}:credit-ledger`,
        occurredAt: context.occurredAt,
      });
    }

    await refreshPayments(client, sale.id);
    const accepted = await client.query<{ total: string | number }>(
      `SELECT COALESCE(SUM(refund_total_minor),0) AS total FROM return_cases
       WHERE original_sale_id=$1 AND status IN ('APPROVED','PROCESSING','COMPLETED')`, [sale.id],
    );
    const acceptedMinor = Number(accepted.rows[0]?.total ?? 0);
    const saleStatus = acceptedMinor >= Number(sale.total_minor) && !pending ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await client.query(`UPDATE sales SET status=$2 WHERE id=$1`, [sale.id, saleStatus]);
    await writeEvents(client, context, payload.initiatedByStaffId ?? null, returnCaseId, sale.id, plan.refundTotal.minor, status);

    return {
      returnCaseId,
      status,
      refundTotalMinor: plan.refundTotal.minor,
      pendingRefundMinor: allocations.filter((a) => a.status === "PENDING").reduce((sum, a) => sum + a.amountMinor, 0),
      idempotentReplay: false,
    };
  });
}

function validateReturn(context: ReturnMutationContext, payload: ReturnMutationPayload): void {
  if (!context.branchId || !context.clientMutationId) throw new ReturnMutationError("branchId and clientMutationId are required");
  if (Number.isNaN(Date.parse(context.occurredAt))) throw new ReturnMutationError("occurredAt must be an ISO date-time");
  if (!payload.originalSaleId || !payload.reason?.trim()) throw new ReturnMutationError("Original sale and reason are required");
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) throw new ReturnMutationError("At least one return line is required");
  for (const line of payload.lines) {
    if (!line.saleLineId || !Number.isFinite(line.quantity) || line.quantity <= 0) throw new ReturnMutationError("Return lines need a sale line and positive quantity");
  }
}

async function allocateRefund(client: DatabaseClient, saleId: string, total: number, requested: RefundMethod): Promise<RefundAllocation[]> {
  if (requested !== "ORIGINAL_METHOD") {
    return [{ originalPaymentId: null, method: requested, amountMinor: total, status: settlesImmediately(requested) ? "SUCCEEDED" : "PENDING" }];
  }

  const payments = await client.query<PaymentRow>(
    `SELECT p.id,p.method,p.amount_minor,
       COALESCE((SELECT SUM(rt.amount_minor) FROM refund_transactions rt
         WHERE rt.original_payment_id=p.id AND rt.status IN ('PENDING','SUCCEEDED')),0) AS already_refunded_minor
     FROM payments p WHERE p.sale_id=$1 AND p.status IN ('SUCCEEDED','PARTIALLY_REVERSED')
     ORDER BY p.received_at,p.id FOR UPDATE`, [saleId],
  );
  let remaining = total;
  const allocations: RefundAllocation[] = [];
  for (const payment of payments.rows) {
    if (remaining <= 0) break;
    if (payment.method === "OTHER") continue;
    const available = Number(payment.amount_minor) - Number(payment.already_refunded_minor);
    if (available <= 0) continue;
    const amountMinor = Math.min(remaining, available);
    allocations.push({
      originalPaymentId: payment.id,
      method: payment.method,
      amountMinor,
      status: settlesImmediately(payment.method) ? "SUCCEEDED" : "PENDING",
    });
    remaining -= amountMinor;
  }
  if (remaining > 0) throw new ReturnMutationError("Refund exceeds refundable original payments", "REFUND_EXCEEDS_ORIGINAL_PAYMENTS");
  return allocations;
}

function settlesImmediately(method: ConcreteRefundMethod): boolean {
  return method === "CASH" || method === "CUSTOMER_CREDIT";
}

async function refreshPayments(client: DatabaseClient, saleId: string): Promise<void> {
  const payments = await client.query<{ id: string; amount_minor: string | number }>(`SELECT id,amount_minor FROM payments WHERE sale_id=$1 FOR UPDATE`, [saleId]);
  for (const payment of payments.rows) {
    const refunded = await client.query<{ total: string | number }>(
      `SELECT COALESCE(SUM(amount_minor),0) AS total FROM refund_transactions WHERE original_payment_id=$1 AND status='SUCCEEDED'`, [payment.id],
    );
    const reversed = Number(refunded.rows[0]?.total ?? 0);
    const amount = Number(payment.amount_minor);
    const status = reversed <= 0 ? "SUCCEEDED" : reversed >= amount ? "REVERSED" : "PARTIALLY_REVERSED";
    await client.query(`UPDATE payments SET status=$2 WHERE id=$1`, [payment.id, status]);
  }
}

async function pendingAmount(client: DatabaseClient, returnCaseId: string): Promise<number> {
  const result = await client.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(amount_minor),0) AS total FROM refund_transactions WHERE return_case_id=$1 AND status='PENDING'`, [returnCaseId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function writeEvents(
  client: DatabaseClient, context: ReturnMutationContext, actorStaffId: string | null,
  returnCaseId: string, originalSaleId: string, refundTotalMinor: number, status: string,
): Promise<void> {
  const payload = JSON.stringify({ originalSaleId, refundTotalMinor, status });
  await client.query(
    `INSERT INTO audit_events (business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload,occurred_at)
     VALUES ($1,$2,$3,'RETURN_ACCEPTED','RETURN_CASE',$4,$5,$6::jsonb,$7)`,
    [context.businessId,context.branchId,actorStaffId,returnCaseId,context.clientMutationId,payload,context.occurredAt],
  );
  await client.query(
    `INSERT INTO outbox_events (business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at)
     VALUES ($1,$2,'RETURN_CASE',$3,'RETURN_ACCEPTED',$4::jsonb,$5)`,
    [context.businessId,context.branchId,returnCaseId,payload,context.occurredAt],
  );
}
