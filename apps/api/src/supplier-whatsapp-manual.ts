/**
 * This only prepares a user-initiated WhatsApp compose action.
 * No provider send, delivery verification, or tracked "sent" state exists.
 */
export function normalizeSupplierWhatsAppPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/[\s().-]+/g, "");
  if (raw.startsWith("+")) {
    const number = raw.slice(1);
    return /^[1-9]\d{7,14}$/.test(number) ? number : null;
  }
  // Ghanaian local mobile numbers, including common 02x/05x allocations.
  if (/^0[25]\d{8}$/.test(raw)) return "233" + raw.slice(1);
  // Country code included without plus, e.g. 233241234567.
  if (/^233[25]\d{8}$/.test(raw)) return raw;
  // A bare international number with no '+' is ambiguous; never guess.
  return null;
}
export interface SupplierWhatsAppSummary {
  orderNumber: string;
  businessName: string;
  branchName: string;
  supplierName: string;
  currencyCode: string;
  totalMinor: number;
  expectedDate: string | null;
}
function clean(value: string, max: number) {
  return value.replace(/[\r\n\t\x00-\x1f\x7f]+/g, " ").trim().slice(0,max);
}
export function makeSupplierWhatsAppSummary(details: SupplierWhatsAppSummary) {
  if (!Number.isSafeInteger(details.totalMinor) || details.totalMinor < 0 ||
      !/^[A-Z]{3}$/.test(details.currencyCode)) {
    throw new Error("INVALID_PURCHASE_ORDER_SUMMARY");
  }
  const amount = new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(details.totalMinor / 100);
  const displayAmount = details.currencyCode === "GHS" ?
    "₵" + amount : details.currencyCode + " " + amount;
  const expected = details.expectedDate ?
    details.expectedDate.split("-").reverse().join("/") : "To be confirmed";
  return [
    "Hello " + clean(details.supplierName, 150) + ",",
    "Purchase order: " + clean(details.orderNumber, 80),
    "From: " + clean(details.businessName, 180) + " — " +
      clean(details.branchName, 180),
    "Total: " + displayAmount,
    "Expected delivery: " + expected,
    "I will attach the full purchase-order PDF separately for your review.",
    "Please confirm availability and delivery arrangements.",
    "This order is not confirmation of goods receipt or payment.",
  ].join("\n");
}
