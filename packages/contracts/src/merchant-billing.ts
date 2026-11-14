export type MerchantBillingSubscriptionStatus =
  | "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELED" | "EXPIRED";
export type MerchantBillingInvoiceStatus =
  | "DRAFT" | "OPEN" | "PARTIALLY_PAID" | "PAID" | "VOID" | "UNCOLLECTIBLE" | "REFUNDED";
export type MerchantBillingPaymentStatus =
  | "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED" | "REFUNDED" | "PARTIALLY_REFUNDED";

export interface MerchantBillingSubscription {
  id: string;
  planName: string;
  planCode: string;
  billingInterval: "MONTHLY" | "ANNUAL" | "CUSTOM";
  planAmountMinor: number;
  currencyCode: string;
  status: MerchantBillingSubscriptionStatus;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface MerchantBillingInvoice {
  id: string;
  invoiceNumber: string;
  status: MerchantBillingInvoiceStatus;
  totalMinor: number;
  amountPaidMinor: number;
  outstandingMinor: number;
  currencyCode: string;
  issuedAt: string;
  dueAt: string;
  periodStart: string;
  periodEnd: string;
}

export interface MerchantBillingPayment {
  id: string;
  invoiceNumber: string;
  status: MerchantBillingPaymentStatus;
  provider: string;
  method: string;
  amountMinor: number;
  currencyCode: string;
  receivedAt: string;
  reconciledAt: string | null;
}

export interface MerchantBillingOverview {
  businessId: string;
  generatedAt: string;
  subscription: MerchantBillingSubscription | null;
  invoices: MerchantBillingInvoice[];
  payments: MerchantBillingPayment[];
  invoiceHistoryLimited: boolean;
  paymentHistoryLimited: boolean;
  paymentCollectionEnabled: false;
  notice: string;
}
