import { describe, expect, it } from "vitest";
import { dashboardQuickActions } from "./dashboard-actions";

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
});
