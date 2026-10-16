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
