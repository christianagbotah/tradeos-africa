export const DASHBOARD_COMPARISON_BASELINE = "yesterday";

export function dashboardFinancialCacheKey(businessId: string, branchId: string, localDate: string): string {
  return `tradeos.dashboard.v1:${businessId}:${branchId}:financial:${localDate}`;
}
