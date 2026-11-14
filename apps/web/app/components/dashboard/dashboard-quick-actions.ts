import { visibleNavItems, type WorkspaceRole } from "../workspace/workspace-navigation";

/** Shortcuts are based on the same role navigation policy as the sidebar. */
export const DASHBOARD_ACTION_ORDER = [
  "sell", "catalog", "customers", "cashbook", "sales", "reports", "settings",
] as const;

export type DashboardActionSegment = (typeof DASHBOARD_ACTION_ORDER)[number];

export function dashboardQuickActionSegments(role: WorkspaceRole | null): DashboardActionSegment[] {
  const available = new Set(visibleNavItems(role).map((item) => item.segment));
  return DASHBOARD_ACTION_ORDER.filter((segment) => available.has(segment)).slice(0, 4);
}
