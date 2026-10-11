/**
 * Sale mutation builder for the TradeOS desktop client.
 *
 * Mirrors the canonical web/mobile SALE_CREATE shape: the desktop sends ONLY
 * the server-authoritative fields and never trusts client-side prices. The
 * server computes pricing, unit conversion, stock validation and accounting.
 *
 * Reference: apps/web/app/components/pos/checkout-sheet.tsx buildSaleMutation()
 *            apps/mobile/src/pos-model.ts buildSaleMutation()
 *
 * The payload is intentionally narrow:
 *   {
 *     currencyCode: "GHS",
 *     customerId?: "uuid",
 *     paymentMethod: "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER",
 *     lines: [{ itemId, saleUnitCode, quantity }, ...]
 *   }
 *
 * No `priceMinor`, no `totalMinor`, no `unitPrice` — those are server-derived.
 */

import type { QueuedMutation } from "@tradeos/client-core/sync-runtime";
import type { DesktopCartLine, DesktopPaymentMethod } from "./types.js";

/** Payment methods accepted for immediate desktop checkout. */
const IMMEDIATE_PAYMENTS: ReadonlySet<DesktopPaymentMethod> = new Set([
  "CASH",
  "MOMO",
  "CARD",
  "BANK",
  "OTHER",
]);

export interface DesktopSaleMutationInput {
  clientId: string;
  clientMutationId: string;
  businessId: string;
  branchId: string;
  currencyCode: string;
  paymentMethod: DesktopPaymentMethod;
  occurredAt: string;
  cart: readonly DesktopCartLine[];
  /** Optional customer id; omitted means walk-in. */
  customerId?: string | undefined;
}

/**
 * Server-authoritative SALE_CREATE mutation shape. The payload contains only
 * `{ currencyCode, customerId?, paymentMethod, lines: [{itemId, saleUnitCode, quantity}] }`.
 * No client-side prices/totals are sent.
 */
export type DesktopSaleMutation = QueuedMutation & {
  payload: {
    currencyCode: string;
    paymentMethod: DesktopPaymentMethod;
    lines: Array<{ itemId: string; saleUnitCode: string; quantity: number }>;
  } & ({ customerId: string } | { customerId?: undefined });
};

/**
 * Build a SALE_CREATE mutation ready for `OfflineMutationQueue.enqueue()`.
 * Throws on any invariant violation (empty cart, invalid quantities, etc.).
 */
export function buildSaleMutation(input: DesktopSaleMutationInput): DesktopSaleMutation {
  if (input.cart.length === 0) {
    throw new Error("Add at least one item before charging.");
  }
  if (!IMMEDIATE_PAYMENTS.has(input.paymentMethod)) {
    throw new Error("Payment method is not supported by desktop checkout.");
  }
  if (!/^[A-Z]{3}$/.test(input.currencyCode.toUpperCase())) {
    throw new Error("Currency must be a three-letter code.");
  }
  for (const line of input.cart) {
    assertQuantity(line.quantity);
    if (!line.itemId.trim() || !line.saleUnitCode.trim()) {
      throw new Error("Every sale line needs an item and sale unit.");
    }
  }

  const currencyCode = input.currencyCode.toUpperCase();
  const lines = input.cart.map((line) => ({
    itemId: line.itemId,
    saleUnitCode: line.saleUnitCode,
    quantity: line.quantity,
  }));

  // customerId is included only when provided (walk-in is the default).
  const payload: DesktopSaleMutation["payload"] = input.customerId
    ? { currencyCode, paymentMethod: input.paymentMethod, customerId: input.customerId, lines }
    : { currencyCode, paymentMethod: input.paymentMethod, lines };

  return {
    clientId: input.clientId,
    clientMutationId: input.clientMutationId,
    businessId: input.businessId,
    branchId: input.branchId,
    mutationType: "SALE_CREATE",
    occurredAt: input.occurredAt,
    payload,
  };
}

function assertQuantity(quantity: number): void {
  if (!Number.isFinite(quantity)) {
    throw new Error("Quantity must be a valid finite number.");
  }
  if (quantity <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }
}
