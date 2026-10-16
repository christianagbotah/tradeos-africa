export const PLATFORM_ADMIN_ROLES = [
  "SUPER_ADMIN",
  "PLATFORM_ADMIN",
  "DEVELOPER",
  "SUPPORT",
  "BILLING",
  "OPERATIONS",
] as const;

export type PlatformAdminRole = typeof PLATFORM_ADMIN_ROLES[number];
export type PlatformClient = "WEB" | "WINDOWS" | "MACOS" | "ANDROID" | "IOS";

export interface PlatformAdminUser {
  id: string;
  email: string;
  displayName: string;
  role: PlatformAdminRole;
  lastLoginAt: string | null;
}

export interface AdminPlatformUserSummary {
  id: string;
  email: string;
  displayName: string;
  role: PlatformAdminRole;
  active: boolean;
  credentialProvisioned: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformAdminSession {
  expiresAt: string;
  idleExpiresAt: string;
}

export interface AdminProfile {
  id: string;
  email: string;
  displayName: string;
  role: PlatformAdminRole;
  lastLoginAt: string | null;
}

export interface AdminSessionSummary {
  id: string;
  deviceKey: string;
  platform: PlatformClient;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  current: boolean;
}

export interface PlatformAdminLoginRequest {
  identifier: string;
  password: string;
  platform: PlatformClient;
  deviceKey: string;
}

export interface PlatformAdminLoginResponse {
  adminUser: PlatformAdminUser;
  session: PlatformAdminSession;
}

export interface AdminTenantSummary {
  id: string;
  name: string;
  businessType: string;
  status: string;
  countryCode: string;
  currencyCode: string;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  branchCount: number;
  deviceCount: number;
  lastSeenAt: string | null;
  updatedAt: string;
}

export interface AdminTenantDetail extends AdminTenantSummary {
  timezone: string;
  createdAt: string;
  branches: Array<{ id: string; name: string; code: string; active: boolean; timezone: string }>;
  subscription: null | {
    id: string;
    planId: string;
    planCode: string;
    planName: string;
    status: string;
    trialEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
  };
  entitlementOverrideCount: number;
}

export interface AdminTenantAccessRoleSummary {
  role: string;
  staffCount: number;
  activeStaffCount: number;
  membershipCount: number;
  activeMembershipCount: number;
}

export interface AdminTenantAccessSummary {
  staffTotal: number;
  activeStaff: number;
  membershipTotal: number;
  activeMemberships: number;
  roles: AdminTenantAccessRoleSummary[];
  membershipStatuses: Array<{ status: string; count: number }>;
}

export interface AdminTenantContact {
  userId: string;
  staffId: string | null;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
  role: string;
  membershipStatus: string;
}

export interface AdminTenantBillingSummary {
  available: boolean;
  openInvoiceCount: number | null;
  overdueInvoiceCount: number | null;
  openBalanceMinor: number | null;
  overdueBalanceMinor: number | null;
}

export interface AdminTenant360 extends AdminTenantDetail {
  access: AdminTenantAccessSummary;
  contacts: AdminTenantContact[];
  devices: AdminDeviceSummary[];
  billing: AdminTenantBillingSummary;
  recentActivity: AdminAuditEvent[];
}

export type AdminBillingInterval = "MONTHLY" | "ANNUAL" | "CUSTOM";
export type AdminSubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELED" | "EXPIRED";

export interface AdminPlanEntitlement {
  code: string;
  value: unknown;
}

export interface AdminSubscriptionPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  currencyCode: string;
  amountMinor: number;
  billingInterval: AdminBillingInterval;
  trialDays: number;
  public: boolean;
  active: boolean;
  entitlements: AdminPlanEntitlement[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminBusinessSubscription {
  id: string;
  businessId: string;
  businessName: string;
  planId: string;
  planCode: string;
  planName: string;
  status: AdminSubscriptionStatus;
  provider: string | null;
  providerCustomerReference: string | null;
  providerSubscriptionReference: string | null;
  trialEndsAt: string | null;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdminSubscriptionInvoiceStatus = "DRAFT" | "OPEN" | "PARTIALLY_PAID" | "PAID" | "VOID" | "UNCOLLECTIBLE" | "REFUNDED";
export type AdminSubscriptionPaymentStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED" | "REFUNDED" | "PARTIALLY_REFUNDED";
export type AdminSubscriptionRefundStatus = "REQUESTED" | "SUCCEEDED" | "FAILED";

export interface AdminSubscriptionInvoice {
  id: string;
  businessId: string;
  businessName: string;
  subscriptionId: string;
  invoiceNumber: string;
  currencyCode: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  status: AdminSubscriptionInvoiceStatus;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  provider: string | null;
  providerInvoiceReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSubscriptionPayment {
  id: string;
  businessId: string;
  businessName: string;
  invoiceId: string;
  invoiceNumber: string;
  amountMinor: number;
  currencyCode: string;
  method: string;
  provider: string;
  providerEventReference: string;
  providerTransactionReference: string;
  status: AdminSubscriptionPaymentStatus;
  failureCode: string | null;
  failureMessage: string | null;
  receivedAt: string;
  reconciledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSubscriptionPaymentRefund {
  id: string;
  businessId: string;
  paymentId: string;
  amountMinor: number;
  currencyCode: string;
  provider: string;
  providerEventReference: string;
  providerRefundReference: string;
  status: AdminSubscriptionRefundStatus;
  failureCode: string | null;
  failureMessage: string | null;
  requestedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminDeviceSummary {
  id: string;
  businessId: string;
  businessName: string;
  branchId: string | null;
  branchName: string | null;
  deviceKey: string;
  platform: PlatformClient;
  appVersion: string;
  releaseChannel: string;
  status: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  health: "ONLINE" | "STALE" | "UNKNOWN";
}

export interface AdminAuditEvent {
  id: string;
  platformUserId: string | null;
  platformUserDisplayName: string | null;
  businessId: string | null;
  businessName: string | null;
  eventType: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface AdminClientRelease {
  id: string;
  platform: PlatformClient;
  version: string;
  buildNumber: string | null;
  releaseChannel: string;
  status: string;
  minimumSupportedVersion: string | null;
  rolloutPercent: number;
  releaseNotes: string | null;
  releasedAt: string | null;
  createdAt: string;
}

export interface AdminFeatureFlag {
  id: string;
  code: string;
  businessId: string | null;
  businessName: string | null;
  enabled: boolean;
  configuration: Record<string, unknown>;
  updatedByPlatformUserId: string | null;
  updatedAt: string;
}
