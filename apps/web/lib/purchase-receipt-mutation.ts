export const PURCHASE_RECEIVE_CREATE_TYPE = "PURCHASE_RECEIVE_CREATE" as const;

export type PurchaseSettlementMethod =
  | "CASH"
  | "MOMO"
  | "CARD"
  | "BANK"
  | "OTHER"
  | "SUPPLIER_CREDIT";

export interface PurchaseReceiveLineInput {
  itemId: string;
  purchaseUnitCode: string;
  quantity: number;
  unitCostMinor: number;
}

export interface PurchaseReceiveInput {
  supplierId: string;
  settlementMethod: PurchaseSettlementMethod;
  supplierReference?: string | null;
  moneyAccountId?: string | null;
  lines: ReadonlyArray<PurchaseReceiveLineInput>;
}

/**
 * Builds the exact PURCHASE_RECEIVE_CREATE payload consumed by the API.
 *
 * The branch/business identity lives on the mutation envelope and the server
 * injects receivedByStaffId from the authenticated session. Supplier credit
 * deliberately never carries a money account because no cash movement occurs.
 */
export function buildPurchaseReceivePayload(input: PurchaseReceiveInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    supplierId: input.supplierId,
    settlementMethod: input.settlementMethod,
    lines: input.lines.map((line) => ({
      itemId: line.itemId,
      purchaseUnitCode: line.purchaseUnitCode,
      quantity: line.quantity,
      unitCostMinor: line.unitCostMinor,
    })),
  };

  const supplierReference = input.supplierReference?.trim();
  if (supplierReference) payload.supplierReference = supplierReference;
  if (input.settlementMethod !== "SUPPLIER_CREDIT" && input.moneyAccountId) {
    payload.moneyAccountId = input.moneyAccountId;
  }

  return payload;
}
