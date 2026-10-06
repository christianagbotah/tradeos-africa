import { Money, money, multiplyMoney } from "./money.js";

export type SellableKind = "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
export type ReturnDisposition = "RESTOCK" | "QUARANTINE" | "DISCARD" | "NOT_RETURNED" | "NOT_APPLICABLE";
export type RefundMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "CUSTOMER_CREDIT" | "ORIGINAL_METHOD";

export interface SaleLineSnapshot {
  id: string;
  kind: SellableKind;
  quantitySold: number;
  quantityPreviouslyReturned: number;
  unitNet: Money;
  unitTax: Money;
  unitCost: Money;
  lineCost?: Money;
  stockUnitId?: string;
  /** Historical stock units represented by one sale unit at the time of sale. */
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

export function planSaleReturn(saleLines: SaleLineSnapshot[], request: SaleReturnRequest): SaleReturnPlan {
  if (!request.idempotencyKey.trim()) throw new SaleReturnError("Idempotency key is required");
  if (!request.reason.trim()) throw new SaleReturnError("Return reason is required");
  if (request.lines.length === 0) throw new SaleReturnError("At least one return line is required");

  const byId = new Map(saleLines.map((line) => [line.id, line]));
  const seen = new Set<string>();
  let currency: string | null = null;

  const planned = request.lines.map((requested): SaleReturnLinePlan => {
    if (seen.has(requested.saleLineId)) throw new SaleReturnError(`Duplicate return line ${requested.saleLineId}`);
    seen.add(requested.saleLineId);

    const line = byId.get(requested.saleLineId);
    if (!line) throw new SaleReturnError(`Sale line ${requested.saleLineId} was not found`);
    assertPositive(requested.quantity, "Return quantity");

    const remaining = line.quantitySold - line.quantityPreviouslyReturned;
    if (requested.quantity > remaining + Number.EPSILON) {
      throw new SaleReturnError(`Cannot return ${requested.quantity}; only ${remaining} remains returnable for ${line.id}`);
    }

    for (const value of [line.unitNet, line.unitTax, line.unitCost, ...(line.lineCost ? [line.lineCost] : [])]) {
      currency ??= value.currency;
      if (value.currency !== currency) throw new SaleReturnError("All sale line money values must use one currency");
    }

    assertDisposition(line, requested.disposition);

    const netRevenueReversal = multiplyMoney(line.unitNet, requested.quantity);
    const taxReversal = multiplyMoney(line.unitTax, requested.quantity);
    const returnedCost = line.lineCost
      ? money(line.lineCost.currency, allocatedCost(line.lineCost.minor, line.quantityPreviouslyReturned + requested.quantity, line.quantitySold) - allocatedCost(line.lineCost.minor, line.quantityPreviouslyReturned, line.quantitySold))
      : multiplyMoney(line.unitCost, requested.quantity);
    let cogsReversal = money(line.unitCost.currency, 0);
    let discardedCost = money(line.unitCost.currency, 0);
    let inventoryEffect: InventoryReturnEffect | undefined;

    if (line.kind === "PRODUCT") {
      if (requested.disposition === "RESTOCK" || requested.disposition === "QUARANTINE") {
        if (!line.stockUnitId) throw new SaleReturnError(`Product line ${line.id} has no stock unit`);
        const factor = line.stockQuantityPerSaleUnit ?? 1;
        assertPositive(factor, `Stock conversion for ${line.id}`);
        cogsReversal = returnedCost;
        inventoryEffect = {
          saleLineId: line.id,
          quantity: requested.quantity * factor,
          stockUnitId: line.stockUnitId,
          destination: requested.disposition === "RESTOCK" ? "AVAILABLE" : "QUARANTINE",
        };
      } else if (requested.disposition === "DISCARD") {
        // The item physically came back but is unusable, so it does not recreate an inventory asset.
        discardedCost = returnedCost;
      }
      // NOT_RETURNED reverses revenue/tax only. The customer keeps the product, so
      // stock and COGS remain exactly as recorded by the original sale.
    } else if (line.kind === "PREPARED_PRODUCT" && requested.disposition === "DISCARD") {
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
  const discardedCostTotal = money(currency, planned.reduce((total, line) => total + (line.discardedCost?.minor ?? 0), 0));

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

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new SaleReturnError(`${label} must be a positive finite number`);
}

function assertDisposition(line: SaleLineSnapshot, disposition: ReturnDisposition): void {
  if (line.kind === "SERVICE" && disposition !== "NOT_APPLICABLE") {
    throw new SaleReturnError("Service refunds must use NOT_APPLICABLE disposition");
  }
  if (
    line.kind === "PRODUCT" &&
    disposition !== "RESTOCK" &&
    disposition !== "QUARANTINE" &&
    disposition !== "DISCARD" &&
    disposition !== "NOT_RETURNED"
  ) {
    throw new SaleReturnError("Product refunds require RESTOCK, QUARANTINE, DISCARD or NOT_RETURNED disposition");
  }
  if (
    line.kind === "PREPARED_PRODUCT" &&
    disposition !== "DISCARD" &&
    disposition !== "NOT_RETURNED" &&
    disposition !== "NOT_APPLICABLE"
  ) {
    throw new SaleReturnError("Prepared-product refunds may be DISCARD, NOT_RETURNED or NOT_APPLICABLE; ingredients cannot be restocked");
  }
}

function allocatedCost(minor: number, quantity: number, totalQuantity: number): number {
  const scale = 100_000_000;
  const numerator = Math.round(quantity * scale);
  const denominator = Math.round(totalQuantity * scale);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new SaleReturnError("Unsafe valuation quantity");
  }
  const divisor = BigInt(denominator);
  return Number((BigInt(minor) * BigInt(numerator) + divisor / 2n) / divisor);
}
