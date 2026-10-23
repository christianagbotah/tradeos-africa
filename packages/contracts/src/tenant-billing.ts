export type TenantBillingSubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "PAUSED"
  | "CANCELED"
  | "EXPIRED";

export type TenantBillingInvoiceStatus =
  | "DRAFT"
  | "OPEN"
  | "PARTIALLY_PAID"
  | "PAID"
  | "VOID"
  | "UNCOLLECTIBLE"
  | "REFUNDED";

export type TenantBillingPaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED" | "REFUNDED" | "PARTIALLY_REFUNDED";
export type TenantBillingAction = "CANCEL_AT_PERIOD_END" | "RESUME";

export type TenantBillingEntitlement = {
  code: string;
  value: unknown;
};

export type TenantBillingPlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  currencyCode: string;
  amountMinor: number;
  billingInterval: "MONTHLY" | "ANNUAL" | "CUSTOM";
  trialDays: number;
  entitlements: TenantBillingEntitlement[];
};

export type TenantBillingSubscription = {
  id: string;
  status: TenantBillingSubscriptionStatus;
  plan: TenantBillingPlan;
  trialEndsAt: string | null;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  supportedActions: TenantBillingAction[];
};

export type TenantBillingOverview = {
  businessId: string;
  subscription: TenantBillingSubscription | null;
  effectiveEntitlements: TenantBillingEntitlement[];
  publicPlans: TenantBillingPlan[];
  generatedAt: string;
};

export type TenantBillingInvoiceSummary = {
  id: string;
  invoiceNumber: string;
  currencyCode: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  status: TenantBillingInvoiceStatus;
  periodStart: string;
  periodEnd: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type TenantBillingPaymentSummary = {
  id: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  currencyCode: string;
  amountMinor: number;
  status: TenantBillingPaymentStatus;
  provider: string | null;
  occurredAt: string;
  settledAt: string | null;
  createdAt: string;
};

export type TenantBillingInvoiceDetail = TenantBillingInvoiceSummary & {
  payments: TenantBillingPaymentSummary[];
};
