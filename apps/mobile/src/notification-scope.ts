import type { BusinessNotificationsResponse } from "@tradeos/contracts";

const READ_ROLES = new Set(["OWNER","ADMIN","MANAGER","ACCOUNTANT"]);

/** Financial notifications follow the same role boundary as the API and web portal. */
export function canReadMobileNotifications(role: string): boolean {
  return READ_ROLES.has(role);
}

/** A response from any previous tenant/branch is discarded instead of cached. */
export function notificationResponseMatchesContext(
  value: BusinessNotificationsResponse,
  businessId: string,
  branchId: string,
): boolean {
  return value.businessId === businessId && value.branchId === branchId;
}
