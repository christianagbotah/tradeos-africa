export type PosPaymentMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER" | "CUSTOMER_CREDIT";

export type PosCatalogSelection = {
  itemId: string;
  name: string;
  saleUnitCode: string;
  saleUnitLabel: string;
  priceMinor: number;
};

export type PosSellableItem = {
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
};

export type PosLineKey = `${string}:${string}`;

export type CartLine = PosCatalogSelection & {
  key: PosLineKey;
  quantity: number;
};

export type PosCustomerState = {
  id: string;
  name: string;
  active: boolean;
  creditEnabled?: boolean;
} | null;

export function cartLineKey(itemId: string, saleUnitCode: string): PosLineKey {
  return `${itemId}:${saleUnitCode}`;
}

export function toPosSelection(item: PosSellableItem): PosCatalogSelection {
  return {
    itemId: item.itemId,
    name: item.name,
    saleUnitCode: item.unitCode,
    saleUnitLabel: item.unitLabel,
    priceMinor: item.priceMinor,
  };
}

export function addCartItem(cart: readonly CartLine[], item: PosCatalogSelection): CartLine[] {
  assertSelection(item);
  const key = cartLineKey(item.itemId, item.saleUnitCode);
  const existing = cart.find((line) => line.key === key);
  if (!existing) return [...cart, { ...item, key, quantity: 1 }];

  return cart.map((line) => line.key === key
    ? { ...line, ...item, key, quantity: line.quantity + 1 }
    : line);
}

export function setCartQuantity(cart: readonly CartLine[], key: PosLineKey, quantity: number): CartLine[] {
  assertQuantity(quantity);
  if (!cart.some((line) => line.key === key)) throw new Error("Cart line was not found.");
  return cart.map((line) => line.key === key ? { ...line, quantity } : line);
}

export function removeCartLine(cart: readonly CartLine[], key: PosLineKey): CartLine[] {
  return cart.filter((line) => line.key !== key);
}

export function changeCartUnit(
  cart: readonly CartLine[],
  lineKey: PosLineKey,
  nextUnit: PosCatalogSelection,
): CartLine[] {
  assertSelection(nextUnit);
  const source = cart.find((line) => line.key === lineKey);
  if (!source) throw new Error("Cart line was not found.");
  if (source.itemId !== nextUnit.itemId) throw new Error("A cart line can only change to another unit of the same item.");

  const targetKey = cartLineKey(nextUnit.itemId, nextUnit.saleUnitCode);
  if (targetKey === lineKey) {
    return cart.map((line) => line.key === lineKey ? { ...line, ...nextUnit, key: targetKey } : line);
  }

  const target = cart.find((line) => line.key === targetKey);
  if (target) {
    return cart
      .filter((line) => line.key !== lineKey)
      .map((line) => line.key === targetKey
        ? { ...line, ...nextUnit, key: targetKey, quantity: line.quantity + source.quantity }
        : line);
  }

  return cart.map((line) => line.key === lineKey
    ? { ...nextUnit, key: targetKey, quantity: source.quantity }
    : line);
}

export function normalizeCustomerPayment(
  customer: PosCustomerState,
  paymentMethod: PosPaymentMethod,
): PosPaymentMethod {
  if (paymentMethod !== "CUSTOMER_CREDIT") return paymentMethod;
  if (!customer?.active || !customer.creditEnabled) return "CASH";
  return "CUSTOMER_CREDIT";
}

function assertQuantity(quantity: number): void {
  if (!Number.isFinite(quantity)) throw new Error("Quantity must be a valid finite number.");
  if (quantity <= 0) throw new Error("Quantity must be greater than zero.");
}

function assertSelection(item: PosCatalogSelection): void {
  if (!item.itemId.trim() || !item.saleUnitCode.trim()) throw new Error("Item and sale unit are required.");
  if (!Number.isSafeInteger(item.priceMinor) || item.priceMinor < 0) throw new Error("Display price must be a non-negative integer in minor currency units.");
}
