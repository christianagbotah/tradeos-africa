import { Money, money, multiplyMoney } from "./money.js";

export type SellableKind = "PRODUCT" | "SERVICE";
export type ReturnDisposition = "RESTOCK" | "QUARANTINE" | "DISCARD" | "NOT_APPLICABLE";
export type RefundMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "CUSTOMER_CREDIT" | "ORIGINAL_METHOD";

export interface SaleLineSnapshot {
  id: string;
  kind: SellableKind;
  quantitySold: number;
  quantityPreviouslyReturned: number;
  unitNet: Money;
  unitTax: Money;
  unitCost: Money;
  stockUnitId?: string;
}

export interface SaleReturnLineRequest {
  saleLineId: string;
  quantity: number;
  disposition: ReturnDisposition;
}

export interface SaleReturnRequest {
  idempotencyKey: string;
  reason: string;
  refundMethod: RefundMethod;
  lines: SaleReturnLineRequest[];
}

export interface InventoryReturnEffect {
  saleLineId: string;
  quantity: number;
  stockUnitId: string;
  destination: "AVAILABLE" | "QUARANTINE";
}

export interface SaleReturnLinePlan {
  saleLineId: string;
  quantity: number;
  netRevenueReversal: Money;
  taxReversal: Money;
  cogsReversal: Money;
  inventoryEffect?: InventoryReturnEffect;
  discardedCost?: Money;
}

export interface SaleReturnPlan {
  idempotencyKey: string;
  reason: string;
  refundMethod: RefundMethod;
  lines: SaleReturnLinePlan[];
  refundTotal: Money;
  netRevenueReversalTotal: Money;
  taxReversalTotal: Money;
  cogsReversalTotal: Money;
  discardedCostTotal: Money;
}

export class SaleReturnError extends Error {}

/**
 * Builds the accounting/inventory intent for a physical sale return.
 * Persistence, approval and actual payment reversal are handled by application services.
 *
 * Key rule: money and stock are separate effects. A service refund does not recreate
 * consumed stock; a discarded product return does not re-enter available inventory.
 */
export function planSaleReturn(
  saleLines: SaleLineSnapshot[],
  request: SaleReturnRequest,
): SaleReturnPlan {
  if (!request.idempotencyKey.trim()) throw new SaleReturnError("Idempotency key is required");
  if (!request.reason.trim()) throw new SaleReturnError("Return reason is required");
  if (request.lines.length === 0) throw new SaleReturnError("At least one return line is required");

  const byId = new Map(saleLines.map((line) => [line.id, line]));
  const seen = new Set<string>();
  let currency: string | null = null;

  const planned = request.lines.map((requested): SaleReturnLinePlan => {
    if (seen.has(requested.saleLineId)) {
      throw new SaleReturnError(`Duplicate return line ${requested.saleLineId}`);
    }
    seen.add(requested.saleLineId);

    const line = byId.get(requested.saleLineId);
    if (!line) throw new SaleReturnError(`Sale line ${requested.saleLineId} was not found`);
    assertQuantity(requested.quantity);

    const remaining = line.quantitySold - line.quantityPreviouslyReturned;
    if (requested.quantity > remaining + Number.EPSILON) {
      throw new SaleReturnError(
        `Cannot return ${requested.quantity}; only ${remaining} remains returnable for ${line.id}`,
      );
    }

    for (const value of [line.unitNet, line.unitTax, line.unitCost]) {
      currency ??= value.currency;
      if (value.currency !== currency) {
        throw new SaleReturnError("All sale line money values must use one currency");
      }
    }

    if (line.kind === "SERVICE" && requested.disposition !== "NOT_APPLICABLE") {
      throw new SaleReturnError("Service returns must use NOT_APPLICABLE disposition");
    }
    if (line.kind === "PRODUCT" && requested.disposition === "NOT_APPLICABLE") {
      throw new SaleReturnError("Product returns require RESTOCK, QUARANTINE or DISCARD disposition");
    }

    const netRevenueReversal = multiplyMoney(line.unitNet, requested.quantity);
    const taxReversal = multiplyMoney(line.unitTax, requested.quantity);
    const returnedCost = multiplyMoney(line.unitCost, requested.quantity);

    let cogsReversal = money(line.unitCost.currency, 0);
    let discardedCost = money(line.unitCost.currency, 0);
    let inventoryEffect: InventoryReturnEffect | undefined;

    if (line.kind === "PRODUCT") {
      if (!line.stockUnitId) throw new SaleReturnError(`Product line ${line.id} has no stock unit`);

      if (requested.disposition === "RESTOCK" || requested.disposition === "QUARANTINE") {
        cogsReversal = returnedCost;
        inventoryEffect = {
          saleLineId: line.id,
          quantity: requested.quantity,
          stockUnitId: line.stockUnitId,
          destination: requested.disposition === "RESTOCK" ? "AVAILABLE" : "QUARANTINE",
        };
      } else if (requested.disposition === "DISCARD") {
        // Revenue is reversed, but the unusable item does not recreate an inventory asset.
        discardedCost = returnedCost;
      }
    }

    return {
      saleLineId: line.id,
      quantity: requested.quantity,
      netRevenueReversal,
      taxReversal,
      cogsReversal,
      ...(inventoryEffect ? { inventoryEffect } : {}),
      ...(discardedCost.minor !== 0 ? { discardedCost } : {}),
    };
  });

  if (!currency) throw new SaleReturnError("Could not determine return currency");

  const sum = (selector: (line: SaleReturnLinePlan) => Money): Money =>
    money(currency!, planned.reduce((total, line) => total + selector(line).minor, 0));

  const netRevenueReversalTotal = sum((line) => line.netRevenueReversal);
  const taxReversalTotal = sum((line) => line.taxReversal);
  const cogsReversalTotal = sum((line) => line.cogsReversal);
  const discardedCostTotal = money(
    currency,
    planned.reduce((total, line) => total + (line.discardedCost?.minor ?? 0), 0),
  );

  return {
    idempotencyKey: request.idempotencyKey,
    reason: request.reason,
    refundMethod: request.refundMethod,
    lines: planned,
    refundTotal: money(currency, netRevenueReversalTotal.minor + taxReversalTotal.minor),
    netRevenueReversalTotal,
    taxReversalTotal,
    cogsReversalTotal,
    discardedCostTotal,
  };
}

function assertQuantity(quantity: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new SaleReturnError("Return quantity must be a positive finite number");
  }
}
