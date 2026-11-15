/** Final receipts are created only from authenticated, server-confirmed sales.
 * Client/offline mutation references are never receipts.
 */
export interface ReceiptSale {
  id: string;
  status: string;
  completedAt: string | null;
  createdAt: string;
  branchId: string;
  currencyCode: string;
  totalMinor: number;
  customer: { id: string; name: string | null; phone: string | null } | null;
  cashierName: string | null;
  lines: ReadonlyArray<{
    id: string;
    itemName: string;
    quantity: number;
    saleUnitCode: string;
    unitNetMinor: number;
    unitTaxMinor: number;
    lineTaxMinor: number;
    lineTotalMinor: number;
  }>;
  payments: ReadonlyArray<{
    id: string;
    method: string;
    amountMinor: number;
    refundedMinor: number;
    status: string;
    providerReference: string | null;
  }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReceiptIdentifier(value: string): boolean {
  return UUID.test(value);
}

export function canIssueReceipt(sale: ReceiptSale | null | undefined): sale is ReceiptSale {
  return Boolean(sale
    && sale.status === "COMPLETED"
    && isReceiptIdentifier(sale.id)
    && sale.completedAt
    && Number.isSafeInteger(sale.totalMinor)
    && sale.totalMinor >= 0
    && sale.lines.length > 0
    && sale.lines.every(line => Number.isSafeInteger(line.lineTotalMinor))
    && sale.payments.every(payment => payment.status !== "PENDING"));
}

export function receiptTotals(sale: ReceiptSale) {
  const grossPaidMinor = sale.payments
    .filter(p => p.method !== "CUSTOMER_CREDIT" && ["SUCCEEDED", "REVERSED", "PARTIALLY_REVERSED"].includes(p.status))
    .reduce((sum, p) => sum + p.amountMinor, 0);
  const refundedMinor = sale.payments.reduce((sum, p) => sum + p.refundedMinor, 0);
  const customerCreditMinor = sale.payments
    .filter(p => p.method === "CUSTOMER_CREDIT")
    .reduce((sum, p) => sum + p.amountMinor, 0);
  return {
    taxMinor: sale.lines.reduce((sum, line) => sum + line.lineTaxMinor, 0),
    customerCreditMinor,
    grossPaidMinor,
    refundedMinor,
    netPaidMinor: grossPaidMinor - refundedMinor,
  };
}

export function receiptUrl(saleId: string): string | null {
  return isReceiptIdentifier(saleId) ? `/sales/receipt/${encodeURIComponent(saleId)}` : null;
}

export function receiptTimestamp(iso: string, timezone = "Africa/Accra"): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Accra", day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(iso));
  }
}
