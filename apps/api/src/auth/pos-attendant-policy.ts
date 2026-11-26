/**
 * Deny-by-default SALE_CREATE boundary for the POS-only employee role.
 * The authenticated business membership, not a client-supplied role, chooses
 * this policy. Sale prices/tax/stock remain server-authoritative.
 */
export class PosAttendantPolicyError extends Error {
  readonly code = "POS_ATTENDANT_SCOPE_FORBIDDEN";
  readonly statusCode = 403;
}
export function assertPosAttendantSalePayload(raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PosAttendantPolicyError("POS-only accounts can only record valid sales.");
  }
  const payload=raw as Record<string,unknown>;
  const payment=payload.paymentMethod;
  if (payment !== "CASH") {
    throw new PosAttendantPolicyError("POS-only checkout currently accepts cash only; other tenders require a cashier or supervisor.");
  }
  if (payload.customerId !== undefined && payload.customerId !== null) {
    throw new PosAttendantPolicyError("Customer credit and account-specific pricing require a cashier or supervisor.");
  }
  if (payload.payments !== undefined) {
    throw new PosAttendantPolicyError("Split or account-based payments require a cashier or supervisor.");
  }
  if (payload.paymentProvider !== undefined) {
    throw new PosAttendantPolicyError("Electronic gateway checkout requires a cashier or supervisor.");
  }
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    throw new PosAttendantPolicyError("A POS-only sale needs at least one product or service.");
  }
  for (const rawLine of payload.lines) {
    if (!rawLine || typeof rawLine !== "object" || Array.isArray(rawLine)) {
      throw new PosAttendantPolicyError("Invalid POS-only sale line.");
    }
    const line=rawLine as Record<string,unknown>;
    if (line.priceApprovalId !== undefined) {
      throw new PosAttendantPolicyError("Discount approval selection requires a cashier or supervisor.");
    }
  }
}
