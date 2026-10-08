import { describe, expect, it } from "vitest";
import { dashboardAttentionForRole, dashboardCanViewReports, dashboardQuickActions } from "./dashboard-actions";

describe("dashboard quick-action permissions", () => {
  it("keeps VIEWER read-only by exposing no write-oriented quick actions", () => {
    expect(dashboardQuickActions("VIEWER")).toEqual([]);
  });
  it("gives INVENTORY only receiving and catalog creation actions", () => {
    expect(dashboardQuickActions("INVENTORY").map((item) => item.label)).toEqual(["Receive stock", "Add item"]);
  });
  it("gives CASHIER sale and expense actions but not credit-control actions", () => {
    expect(dashboardQuickActions("CASHIER").map((item) => item.label)).toEqual(["Sell", "Record expense"]);
  });
  it("matches ACCOUNTANT write capabilities without exposing Sell", () => {
    const labels = dashboardQuickActions("ACCOUNTANT").map((item) => item.label);
    expect(labels).toEqual(["Receive stock", "Record expense", "Customer payment"]);
    expect(labels).not.toContain("Sell");
  });
  it("shows the Reports header action only to report-authorized roles", () => {
    expect(dashboardCanViewReports("OWNER")).toBe(true);
    expect(dashboardCanViewReports("ACCOUNTANT")).toBe(true);
    expect(dashboardCanViewReports("VIEWER")).toBe(true);
    expect(dashboardCanViewReports("CASHIER")).toBe(false);
    expect(dashboardCanViewReports("INVENTORY")).toBe(false);
  });
  it("keeps overdue-debt recommendations role-safe", () => {
    const attention = [{ id: "overdue-receivables", priority: "warning" as const, title: "Customer debt needs attention", detail: "Some receivables are overdue.", href: "/customers", actionLabel: "Collect debt", amountMinor: 12000 }];
    expect(dashboardAttentionForRole("VIEWER", attention)[0]?.actionLabel).toBe("Review customers");
    expect(dashboardAttentionForRole("CASHIER", attention)[0]?.actionLabel).toBe("Review customers");
    expect(dashboardAttentionForRole("ACCOUNTANT", attention)[0]?.actionLabel).toBe("Collect debt");
    expect(dashboardAttentionForRole("UNKNOWN", attention)).toEqual([]);
  });

});
