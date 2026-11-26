export type BusinessNotificationKind = "ATTENTION" | "APPROVAL";
export interface BusinessNotificationItem {
  id: string;
  kind: BusinessNotificationKind;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  summary: string;
  occurredAt: string;
  readAt: string | null;
  href: "/inventory" | "/reports" | "/dashboard";
}
export interface BusinessNotificationsResponse {
  businessId: string;
  branchId: string;
  generatedAt: string;
  unreadCount: number;
  notifications: BusinessNotificationItem[];
  truncated: boolean;
}
