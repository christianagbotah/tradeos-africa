export const BUSINESS_ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "CASHIER",
  "SALES",
  "INVENTORY",
  "ACCOUNTANT",
  "STAFF",
  "VIEWER",
] as const;

export type BusinessRole = (typeof BUSINESS_ROLES)[number];

export const STAFF_INVITATION_STATUSES = ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"] as const;
export type StaffInvitationStatus = (typeof STAFF_INVITATION_STATUSES)[number];
export type StaffMembershipStatus = "ACTIVE" | "SUSPENDED" | null;

export interface StaffDirectoryAccess {
  membershipId: string | null;
  userId: string | null;
  membershipStatus: StaffMembershipStatus;
  invitationId: string | null;
  invitationStatus: "PENDING" | "EXPIRED" | null;
  invitationExpiresAt: string | null;
}

export interface StaffDirectoryItem {
  id: string;
  businessId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: BusinessRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  access: StaffDirectoryAccess;
}

export interface CreateStaffRequest {
  businessId: string;
  displayName: string;
  email?: string | null;
  phone?: string | null;
  role: BusinessRole;
}

export interface UpdateStaffRequest {
  businessId: string;
  displayName?: string;
  email?: string | null;
  phone?: string | null;
  role?: BusinessRole;
}

export interface StaffInvitationSummary {
  id: string;
  businessId: string;
  staffId: string;
  invitedEmail: string | null;
  invitedPhoneE164: string | null;
  role: BusinessRole;
  status: StaffInvitationStatus;
  expiresAt: string;
  createdAt: string;
}

export interface StaffInvitationResponse {
  invitation: StaffInvitationSummary;
  acceptanceToken: string;
}

export interface CreateStaffInvitationRequest {
  businessId: string;
}

export interface StaffAccessMutationRequest {
  businessId: string;
}

export interface AcceptStaffInvitationRequest {
  acceptanceToken: string;
}

export interface RegisterStaffInvitationRequest extends AcceptStaffInvitationRequest {
  displayName: string;
  password: string;
  platform: "WEB" | "WINDOWS" | "MACOS" | "ANDROID" | "IOS";
  deviceKey: string;
  appVersion: string;
}

export interface StaffInvitationAcceptance {
  businessId: string;
  staffId: string;
  role: BusinessRole;
}

export interface RegisterStaffInvitationResponse {
  user: {
    id: string;
    displayName: string;
    email: string | null;
    phoneE164: string | null;
    avatarUrl: string | null;
  };
  session: {
    accessToken: string;
    refreshToken: string;
    clientId: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
  };
  acceptance: StaffInvitationAcceptance;
}
