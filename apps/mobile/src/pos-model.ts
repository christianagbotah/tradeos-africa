import type { QueuedMutation } from "@tradeos/client-core/sync-runtime";
import type { MobileCatalogItem, MobileInventoryItem } from "./api-client";

export type MobileImmediatePaymentMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";

export type MobileSellableItem = {
  key: string;
  itemId: string;
  name: string;
  sku: string | null;
  kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  unitCode: string;
  unitLabel: string;
  priceMinor: number;
  trackStock: boolean;
  stockUnitCode: string | null;
  availableStock: number | null;
};

export type MobileCartLine = MobileSellableItem & { quantity: number };

export type MobileSaleMutationInput = {
  clientId: string;
  clientMutationId: string;
  businessId: string;
  branchId: string;
  currencyCode: string;
  paymentMethod: MobileImmediatePaymentMethod;
  occurredAt: string;
  cart: readonly MobileCartLine[];
};

const immediatePayments = new Set<MobileImmediatePaymentMethod>(["CASH", "MOMO", "CARD", "BANK", "OTHER"]);

export function projectSellableItems(catalog: readonly MobileCatalogItem[], inventory: readonly MobileInventoryItem[]): MobileSellableItem[] {
  const inventoryByItem = new Map(inventory.map((item) => [item.id, item]));
  return catalog.flatMap((item) => item.units
    .filter((unit) => item.active && unit.canSell && unit.defaultSalePriceMinor !== null)
    .map((unit) => ({
      key: `${item.id}:${unit.code}`,
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      kind: item.kind,
      unitCode: unit.code,
      unitLabel: unit.label,
      priceMinor: unit.defaultSalePriceMinor!,
      trackStock: item.trackStock,
      stockUnitCode: item.stockUnitCode,
      availableStock: item.trackStock ? inventoryByItem.get(item.id)?.available ?? null : null,
    })));
}

export function filterSellableItems(items: readonly MobileSellableItem[], query: string): MobileSellableItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...items];
  return items.filter((item) => [item.name, item.sku ?? "", item.unitLabel, item.unitCode]
    .some((value) => value.toLocaleLowerCase().includes(normalized)));
}

export function addCartItem(cart: readonly MobileCartLine[], item: MobileSellableItem): MobileCartLine[] {
  assertSellable(item);
  const existing = cart.find((line) => line.key === item.key);
  if (!existing) return [...cart, { ...item, quantity: 1 }];
  return cart.map((line) => line.key === item.key ? { ...line, ...item, quantity: line.quantity + 1 } : line);
}

export function setCartQuantity(cart: readonly MobileCartLine[], key: string, quantity: number): MobileCartLine[] {
  assertQuantity(quantity);
  if (!cart.some((line) => line.key === key)) throw new Error("Cart line was not found.");
  return cart.map((line) => line.key === key ? { ...line, quantity } : line);
}

export function removeCartLine(cart: readonly MobileCartLine[], key: string): MobileCartLine[] {
  return cart.filter((line) => line.key !== key);
}

export function displayCartTotalMinor(cart: readonly MobileCartLine[]): number {
  return cart.reduce((sum, line) => sum + Math.round(line.priceMinor * line.quantity), 0);
}

export function buildSaleMutation(input: MobileSaleMutationInput): QueuedMutation & {
  payload: {
    currencyCode: string;
    paymentMethod: MobileImmediatePaymentMethod;
    lines: Array<{ itemId: string; saleUnitCode: string; quantity: number }>;
  };
} {
  if (input.cart.length === 0) throw new Error("Add at least one item before charging.");
  if (!immediatePayments.has(input.paymentMethod)) throw new Error("Payment method is not supported by mobile checkout.");
  if (!/^[A-Z]{3}$/.test(input.currencyCode.toUpperCase())) throw new Error("Currency must be a three-letter code.");
  for (const line of input.cart) {
    assertQuantity(line.quantity);
    if (!line.itemId.trim() || !line.unitCode.trim()) throw new Error("Every sale line needs an item and sale unit.");
  }

  return {
    clientId: input.clientId,
    clientMutationId: input.clientMutationId,
    businessId: input.businessId,
    branchId: input.branchId,
    mutationType: "SALE_CREATE",
    occurredAt: input.occurredAt,
    payload: {
      currencyCode: input.currencyCode.toUpperCase(),
      paymentMethod: input.paymentMethod,
      lines: input.cart.map((line) => ({
        itemId: line.itemId,
        saleUnitCode: line.unitCode,
        quantity: line.quantity,
      })),
    },
  };
}

function assertQuantity(quantity: number): void {
  if (!Number.isFinite(quantity)) throw new Error("Quantity must be a valid finite number.");
  if (quantity <= 0) throw new Error("Quantity must be greater than zero.");
}

function assertSellable(item: MobileSellableItem): void {
  if (!item.itemId.trim() || !item.unitCode.trim()) throw new Error("Item and sale unit are required.");
  if (!Number.isSafeInteger(item.priceMinor) || item.priceMinor < 0) throw new Error("Display price must be a non-negative integer in minor currency units.");
}
