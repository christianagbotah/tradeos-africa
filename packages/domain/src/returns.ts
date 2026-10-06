import { Money, money, multiplyMoney } from "./money.js";

export type SellableKind = "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
export type ReturnDisposition = "RESTOCK" | "QUARANTINE" | "DISCARD" | "NOT_APPLICABLE";
export type RefundMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "CUSTOMER_CREDIT" | "ORIGINAL_METHOD";

export interface SaleLineSnapshot {
  id: string;
  kind: SellableKind;
  quantitySold: number;
  quantityPreviouslyReturned: number;
  unitNet: Money;
  unitTax: Money;
  /** Cost attached to one sale unit at the time of the original sale. */
  unitCost: Money;
  /** Stock unit used by the inventory ledger, e.g. ml, kg, metre or piece. */
  stockUnitId?: string;
  /**
   * Number of stock units represented by one sale unit.
   *
   * Examples:
   * - whisky sold by 50 ml glass while stock is tracked in ml => 50
   * - cable sold by yard while stock is tracked in metre => 0.9144
   * - item sold and stocked by piece => 1
   *
   * This value is captured on the sale line so future unit-rule edits cannot change
   * the accounting or stock effect of a historical return.
   */
  stockQuantityPerSaleUnit?: number;
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
  /** Quantity in the item's stock unit, not the unit originally sold. */
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
 * Builds the accounting/inventory intent for a sale return or refund.
 * Persistence, approval and actual payment reversal are handled by application services.
 *
 * Key rules:
 * - Money and stock are separate effects.
 * - Product returns recreate stock only when restocked/quarantined.
 * - Sale-unit quantities are converted back to the historical stock unit before stock moves.
 * - Service refunds never recreate consumables or labour already used.
 * - Prepared-product refunds never reconstruct ingredients already consumed.
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

    assertDisposition(line, requested.disposition);

    const netRevenueReversal = multiplyMoney(line.unitNet, requested.quantity);
    const taxReversal = multiplyMoney(line.unitTax, requested.quantity);
    const returnedCost = multiplyMoney(line.unitCost, requested.quantity);

    let cogsReversal = money(line.unitCost.currency, 0);
    let discardedCost = money(line.unitCost.currency, 0);
    let inventoryEffect: InventoryReturnEffect | undefined;

    if (line.kind === "PRODUCT") {
      if (!line.stockUnitId) throw new SaleReturnError(`Product line ${line.id} has no stock unit`);
      const stockQuantityPerSaleUnit = line.stockQuantityPerSaleUnit ?? 1;
      assertStockConversion(stockQuantityPerSaleUnit, line.id);

      if (requested.disposition === "RESTOCK" || requested.disposition === "QUARANTINE") {
        cogsReversal = returnedCost;
        inventoryEffect = {
          saleLineId: line.id,
          quantity: requested.quantity * stockQuantityPerSaleUnit,
          stockUnitId: line.stockUnitId,
          destination: requested.disposition === "RESTOCK" ? "AVAILABLE" : "QUARANTINE",
        };
      } else if (requested.disposition === "DISCARD") {
        // Revenue is reversed, but the unusable item does not recreate an inventory asset.
        discardedCost = returnedCost;
      }
    } else if (line.kind === "PREPARED_PRODUCT" && requested.disposition === "DISCARD") {
      // Ingredients/consumables were already consumed when the prepared item was produced/sold.
      // A physical return can be recorded as waste, but it must not rebuild ingredient stock.
      discardedCost = returnedCost;
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

function assertStockConversion(stockQuantityPerSaleUnit: number, saleLineId: string): void {
  if (!Number.isFinite(stockQuantityPerSaleUnit) || stockQuantityPerSaleUnit <= 0) {
    throw new SaleReturnError(`Product line ${saleLineId} has an invalid stock conversion snapshot`);
  }
}

function assertDisposition(line: SaleLineSnapshot, disposition: ReturnDisposition): void {
  if (line.kind === "SERVICE" && disposition !== "NOT_APPLICABLE") {
    throw new SaleReturnError("Service refunds must use NOT_APPLICABLE disposition");
  }

  if (line.kind === "PRODUCT" && disposition === "NOT_APPLICABLE") {
    throw new SaleReturnError("Product returns require RESTOCK, QUARANTINE or DISCARD disposition");
  }

  if (
    line.kind === "PREPARED_PRODUCT" &&
    disposition !== "DISCARD" &&
    disposition !== "NOT_APPLICABLE"
  ) {
    throw new SaleReturnError(
      "Prepared-product refunds may be marked DISCARD or NOT_APPLICABLE; ingredients cannot be restocked",
    );
  }
}
