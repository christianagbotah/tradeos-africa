import { money, planSaleReturn, SaleReturnError, type RefundMethod, type ReturnDisposition, type SaleLineSnapshot } from "@tradeos/domain";
import type { DbClient, DbPool } from "../db.js";
import { withTransaction } from "../db.js";
import { AppError, assertApp } from "../errors.js";

export interface CreateReturnLineInput {
  saleLineId: string;
  quantity: number;
  disposition: ReturnDisposition;
}

export interface CreateReturnInput {
  businessId: string;
  branchId: string;
  originalSaleId: string;
  clientMutationId: string;
  initiatedByStaffId?: string;
  approvedByStaffId?: string;
  reason: string;
  refundMethod: RefundMethod;
  occurredAt: string;
  lines: CreateReturnLineInput[];
}

export interface CreateReturnResult {
  returnCaseId: string;
  status: "PROCESSING" | "COMPLETED";
  refundTotalMinor: number;
  pendingRefundMinor: number;
  idempotentReplay: boolean;
}

type SaleRow = {
  id: string;
  currency_code: string;
  total_minor: string | number;
  status: string;
  customer_id: string | null;
};

type SaleLineRow = {
  id: string;
  item_kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  quantity: string | number;
  quantity_previously_returned: string | number;
  unit_net_minor: string | number;
  unit_tax_minor: string | number;
  unit_cost_minor: string | number;
  stock_quantity: string | number | null;
  stock_unit_code: string | null;
  item_id: string;
};

type OriginalPaymentRow = {
  id: string;
  method: "CASH" | "MOMO" | "CARD" | "BANK" | "CUSTOMER_CREDIT" | "OTHER";
  amount_minor: string | number;
  already_refunded_minor: string | number;
};

interface RefundAllocation {
  originalPaymentId: string | null;
  method: Exclude<RefundMethod, "ORIGINAL_METHOD">;
  amountMinor: number;
  status: "PENDING" | "SUCCEEDED";
}

export async function createReturn(pool: DbPool, input: CreateReturnInput): Promise<CreateReturnResult> {
  validateReturnInput(input);

  return withTransaction(pool, async (client) => {
    const existing = await client.query<{
      id: string;
      status: string;
      refund_total_minor: string | number;
    }>(
      `SELECT id, status, refund_total_minor
         FROM return_cases
        WHERE business_id = $1 AND client_mutation_id = $2`,
      [input.businessId, input.clientMutationId],
    );
    const replay = existing.rows[0];
    if (replay) {
      const pending = await pendingRefundAmount(client, replay.id);
      return {
        returnCaseId: replay.id,
        status: replay.status === "COMPLETED" ? "COMPLETED" : "PROCESSING",
        refundTotalMinor: Number(replay.refund_total_minor),
        pendingRefundMinor: pending,
        idempotentReplay: true,
      };
    }

    const saleResult = await client.query<SaleRow>(
      `SELECT id, currency_code, total_minor, status, customer_id
         FROM sales
        WHERE id = $1 AND business_id = $2 AND branch_id = $3
        FOR UPDATE`,
      [input.originalSaleId, input.businessId, input.branchId],
    );
    const sale = saleResult.rows[0];
    assertApp(sale, "SALE_NOT_FOUND", "Original sale was not found", 404);
    assertApp(
      ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(sale.status),
      "SALE_NOT_RETURNABLE",
      `Sale in status ${sale.status} cannot be returned`,
      409,
    );

    const requestedIds = input.lines.map((line) => line.saleLineId);
    const linesResult = await client.query<SaleLineRow>(
      `SELECT sl.id,
              sl.item_kind,
              sl.quantity,
              sl.unit_net_minor,
              sl.unit_tax_minor,
              sl.unit_cost_minor,
              sl.stock_quantity,
              sl.stock_unit_code,
              sl.item_id,
              COALESCE((
                SELECT SUM(rl.quantity)
                  FROM return_lines rl
                  JOIN return_cases rc ON rc.id = rl.return_case_id
                 WHERE rl.original_sale_line_id = sl.id
                   AND rc.status IN ('PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED')
              ), 0) AS quantity_previously_returned
         FROM sale_lines sl
        WHERE sl.sale_id = $1
          AND sl.business_id = $2
          AND sl.id = ANY($3::uuid[])
        ORDER BY sl.id`,
      [sale.id, input.businessId, requestedIds],
    );
    assertApp(linesResult.rows.length === requestedIds.length, "SALE_LINE_NOT_FOUND", "One or more requested sale lines do not belong to the original sale", 404);

    const snapshots: SaleLineSnapshot[] = linesResult.rows.map((line) => {
      const soldQuantity = Number(line.quantity);
      const stockQuantity = line.stock_quantity === null ? null : Number(line.stock_quantity);
      return {
        id: line.id,
        kind: line.item_kind,
        quantitySold: soldQuantity,
        quantityPreviouslyReturned: Number(line.quantity_previously_returned),
        unitNet: money(sale.currency_code, Number(line.unit_net_minor)),
        unitTax: money(sale.currency_code, Number(line.unit_tax_minor)),
        unitCost: money(sale.currency_code, Number(line.unit_cost_minor)),
        ...(line.stock_unit_code ? { stockUnitId: line.stock_unit_code } : {}),
        ...(stockQuantity !== null ? { stockQuantityPerSaleUnit: stockQuantity / soldQuantity } : {}),
      };
    });

    let plan;
    try {
      plan = planSaleReturn(snapshots, {
        idempotencyKey: input.clientMutationId,
        reason: input.reason,
        refundMethod: input.refundMethod,
        lines: input.lines,
      });
    } catch (error) {
      if (error instanceof SaleReturnError) {
        throw new AppError("RETURN_INVALID", error.message, 409);
      }
      throw error;
    }

    const allocations = await buildRefundAllocations(
      client,
      sale.id,
      plan.refundTotal.minor,
      input.refundMethod,
    );
    const hasPendingRefund = allocations.some((allocation) => allocation.status === "PENDING");
    const caseStatus = hasPendingRefund ? "PROCESSING" : "COMPLETED";
    const approvedBy = input.approvedByStaffId ?? input.initiatedByStaffId ?? null;

    const returnCaseInsert = await client.query<{ id: string }>(
      `INSERT INTO return_cases (
         business_id, branch_id, original_sale_id, customer_id,
         initiated_by_staff_id, approved_by_staff_id, status, reason, refund_method,
         currency_code, net_revenue_reversal_minor, tax_reversal_minor,
         refund_total_minor, cogs_reversal_minor, discarded_cost_minor,
         client_mutation_id, created_at, completed_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8, $9,
         $10, $11, $12,
         $13, $14, $15,
         $16, $17, $18
       )
       RETURNING id`,
      [
        input.businessId,
        input.branchId,
        sale.id,
        sale.customer_id,
        input.initiatedByStaffId ?? null,
        approvedBy,
        caseStatus,
        input.reason,
        input.refundMethod,
        sale.currency_code,
        plan.netRevenueReversalTotal.minor,
        plan.taxReversalTotal.minor,
        plan.refundTotal.minor,
        plan.cogsReversalTotal.minor,
        plan.discardedCostTotal.minor,
        input.clientMutationId,
        input.occurredAt,
        hasPendingRefund ? null : input.occurredAt,
      ],
    );
    const returnCaseId = returnCaseInsert.rows[0]?.id;
    assertApp(returnCaseId, "RETURN_CREATE_FAILED", "Could not create return case", 500);

    const lineById = new Map(linesResult.rows.map((line) => [line.id, line]));

    for (let index = 0; index < plan.lines.length; index += 1) {
      const planned = plan.lines[index]!;
      const original = lineById.get(planned.saleLineId)!;
      const disposition = input.lines.find((line) => line.saleLineId === planned.saleLineId)!.disposition;

      const returnLineInsert = await client.query<{ id: string }>(
        `INSERT INTO return_lines (
           return_case_id, original_sale_line_id, quantity, disposition,
           net_revenue_reversal_minor, tax_reversal_minor, cogs_reversal_minor, discarded_cost_minor
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          returnCaseId,
          planned.saleLineId,
          planned.quantity,
          disposition,
          planned.netRevenueReversal.minor,
          planned.taxReversal.minor,
          planned.cogsReversal.minor,
          planned.discardedCost?.minor ?? 0,
        ],
      );
      const returnLineId = returnLineInsert.rows[0]?.id;
      assertApp(returnLineId, "RETURN_LINE_CREATE_FAILED", "Could not create return line", 500);

      if (planned.inventoryEffect) {
        await client.query(`SELECT id FROM catalog_items WHERE id = $1 FOR UPDATE`, [original.item_id]);
        await client.query(
          `INSERT INTO inventory_movements (
             business_id, branch_id, item_id, stock_unit_code, quantity_delta,
             location_type, reason, reference_type, reference_id, actor_staff_id,
             idempotency_key, occurred_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'SALE_RETURN', 'RETURN_LINE', $7, $8, $9, $10)`,
          [
            input.businessId,
            input.branchId,
            original.item_id,
            planned.inventoryEffect.stockUnitId,
            planned.inventoryEffect.quantity,
            planned.inventoryEffect.destination,
            returnLineId,
            input.initiatedByStaffId ?? null,
            `${input.clientMutationId}:stock:${index}`,
            input.occurredAt,
          ],
        );
      }
    }

    for (let index = 0; index < allocations.length; index += 1) {
      const allocation = allocations[index]!;
      await client.query(
        `INSERT INTO refund_transactions (
           business_id, return_case_id, original_payment_id, amount_minor,
           currency_code, method, status, idempotency_key, created_at, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.businessId,
          returnCaseId,
          allocation.originalPaymentId,
          allocation.amountMinor,
          sale.currency_code,
          allocation.method,
          allocation.status,
          `${input.clientMutationId}:refund:${index}`,
          input.occurredAt,
          allocation.status === "SUCCEEDED" ? input.occurredAt : null,
        ],
      );
    }

    await refreshOriginalPaymentStatuses(client, sale.id);

    const acceptedRefund = await client.query<{ total: string | number }>(
      `SELECT COALESCE(SUM(refund_total_minor), 0) AS total
         FROM return_cases
        WHERE original_sale_id = $1
          AND status IN ('APPROVED', 'PROCESSING', 'COMPLETED')`,
      [sale.id],
    );
    const acceptedRefundMinor = Number(acceptedRefund.rows[0]?.total ?? 0);
    const fullyRefundedAndSettled = acceptedRefundMinor >= Number(sale.total_minor) && !hasPendingRefund;
    const nextSaleStatus = fullyRefundedAndSettled ? "REFUNDED" : "PARTIALLY_REFUNDED";
    await client.query(`UPDATE sales SET status = $2 WHERE id = $1`, [sale.id, nextSaleStatus]);

    await client.query(
      `INSERT INTO audit_events (
         business_id, branch_id, actor_staff_id, event_type, entity_type, entity_id,
         correlation_id, payload, occurred_at
       ) VALUES ($1, $2, $3, 'RETURN_ACCEPTED', 'RETURN_CASE', $4, $5, $6::jsonb, $7)`,
      [
        input.businessId,
        input.branchId,
        input.initiatedByStaffId ?? null,
        returnCaseId,
        input.clientMutationId,
        JSON.stringify({
          originalSaleId: sale.id,
          refundTotalMinor: plan.refundTotal.minor,
          pendingRefund: hasPendingRefund,
          lineCount: plan.lines.length,
        }),
        input.occurredAt,
      ],
    );

    await client.query(
      `INSERT INTO outbox_events (
         business_id, branch_id, aggregate_type, aggregate_id, event_type, payload, occurred_at
       ) VALUES ($1, $2, 'RETURN_CASE', $3, 'RETURN_ACCEPTED', $4::jsonb, $5)`,
      [
        input.businessId,
        input.branchId,
        returnCaseId,
        JSON.stringify({ returnCaseId, originalSaleId: sale.id, refundTotalMinor: plan.refundTotal.minor, status: caseStatus }),
        input.occurredAt,
      ],
    );

    return {
      returnCaseId,
      status: caseStatus,
      refundTotalMinor: plan.refundTotal.minor,
      pendingRefundMinor: allocations
        .filter((allocation) => allocation.status === "PENDING")
        .reduce((sum, allocation) => sum + allocation.amountMinor, 0),
      idempotentReplay: false,
    };
  });
}

function validateReturnInput(input: CreateReturnInput): void {
  assertApp(input.businessId.trim(), "BUSINESS_REQUIRED", "Business id is required");
  assertApp(input.branchId.trim(), "BRANCH_REQUIRED", "Branch id is required");
  assertApp(input.originalSaleId.trim(), "SALE_REQUIRED", "Original sale id is required");
  assertApp(input.clientMutationId.trim(), "IDEMPOTENCY_REQUIRED", "Client mutation id is required");
  assertApp(input.reason.trim(), "RETURN_REASON_REQUIRED", "Return/refund reason is required");
  assertApp(!Number.isNaN(Date.parse(input.occurredAt)), "OCCURRED_AT_INVALID", "occurredAt must be an ISO date-time");
  assertApp(input.lines.length > 0, "RETURN_LINES_REQUIRED", "At least one return/refund line is required");
  for (const line of input.lines) {
    assertApp(line.saleLineId.trim(), "SALE_LINE_REQUIRED", "Original sale line id is required");
    assertApp(Number.isFinite(line.quantity) && line.quantity > 0, "RETURN_QUANTITY_INVALID", "Return quantity must be positive");
  }
}

async function buildRefundAllocations(
  client: DbClient,
  saleId: string,
  refundTotalMinor: number,
  requestedMethod: RefundMethod,
): Promise<RefundAllocation[]> {
  if (requestedMethod !== "ORIGINAL_METHOD") {
    return [{
      originalPaymentId: null,
      method: requestedMethod,
      amountMinor: refundTotalMinor,
      status: settlesImmediately(requestedMethod) ? "SUCCEEDED" : "PENDING",
    }];
  }

  const payments = await client.query<OriginalPaymentRow>(
    `SELECT p.id,
            p.method,
            p.amount_minor,
            COALESCE((
              SELECT SUM(rt.amount_minor)
                FROM refund_transactions rt
               WHERE rt.original_payment_id = p.id
                 AND rt.status IN ('PENDING', 'SUCCEEDED')
            ), 0) AS already_refunded_minor
       FROM payments p
      WHERE p.sale_id = $1
        AND p.status IN ('SUCCEEDED', 'PARTIALLY_REVERSED')
      ORDER BY p.received_at, p.id
      FOR UPDATE`,
    [saleId],
  );

  let remaining = refundTotalMinor;
  const allocations: RefundAllocation[] = [];

  for (const payment of payments.rows) {
    if (remaining <= 0) break;
    if (payment.method === "OTHER") {
      continue;
    }
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

  if (remaining > 0) {
    throw new AppError(
      "REFUND_EXCEEDS_ORIGINAL_PAYMENTS",
      `Only ${refundTotalMinor - remaining} of ${refundTotalMinor} can be refunded to original payment methods`,
      409,
    );
  }

  return allocations;
}

function settlesImmediately(method: Exclude<RefundMethod, "ORIGINAL_METHOD">): boolean {
  return method === "CASH" || method === "CUSTOMER_CREDIT";
}

async function refreshOriginalPaymentStatuses(client: DbClient, saleId: string): Promise<void> {
  const payments = await client.query<{ id: string; amount_minor: string | number }>(
    `SELECT id, amount_minor FROM payments WHERE sale_id = $1 FOR UPDATE`,
    [saleId],
  );

  for (const payment of payments.rows) {
    const refunded = await client.query<{ total: string | number }>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total
         FROM refund_transactions
        WHERE original_payment_id = $1
          AND status = 'SUCCEEDED'`,
      [payment.id],
    );
    const refundedMinor = Number(refunded.rows[0]?.total ?? 0);
    const amountMinor = Number(payment.amount_minor);
    const status = refundedMinor <= 0
      ? "SUCCEEDED"
      : refundedMinor >= amountMinor
        ? "REVERSED"
        : "PARTIALLY_REVERSED";
    await client.query(`UPDATE payments SET status = $2 WHERE id = $1`, [payment.id, status]);
  }
}

async function pendingRefundAmount(client: DbClient, returnCaseId: string): Promise<number> {
  const result = await client.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(amount_minor), 0) AS total
       FROM refund_transactions
      WHERE return_case_id = $1 AND status = 'PENDING'`,
    [returnCaseId],
  );
  return Number(result.rows[0]?.total ?? 0);
}
