import { formatMoney, parseMoneyInput } from "@tradeos/contracts";

export type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  creditLimitMinor: number | null;
  creditTermsDays: number;
  balanceMinor: number;
  availableCreditMinor: number | null;
  creditEnabled: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LedgerEntry = {
  id: string;
  branchId: string;
  currencyCode: string;
  entryType: "CREDIT_SALE" | "PAYMENT" | "CREDIT_REFUND" | "ADJUSTMENT";
  balanceDeltaMinor: number;
  sourceType: string;
  sourceId: string;
  actorName: string | null;
  occurredAt: string;
};

export type CreditObligation = {
  id: string;
  saleId: string;
  originalMinor: number;
  openMinor: number;
  issuedAt: string;
  dueAt: string;
};

export type CustomerDetail = {
  customer: Customer;
  obligations: CreditObligation[];
  ledger: LedgerEntry[];
};

export type PaymentMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";

export function formatCustomerMoney(minor: number, currencyCode: string): string {
  return formatMoney(minor, currencyCode);
}

export function customerMoneyToMinor(value: string, currencyCode: string): number {
  const minor = parseMoneyInput(value, currencyCode);
  return minor !== null && minor >= 0 ? minor : 0;
}

export function formatCustomerDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
