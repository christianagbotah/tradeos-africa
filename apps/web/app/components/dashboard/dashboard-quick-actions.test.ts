import { describe, expect, it } from "vitest";
import { dashboardQuickActionSegments } from "./dashboard-quick-actions";
import { visibleNavItems, type WorkspaceRole } from "../workspace/workspace-navigation";

function allowed(role: WorkspaceRole) {
  return new Set(visibleNavItems(role).map((item) => item.segment));
}

describe("dashboard role-aware quick actions", () => {
  it("promotes selling and merchant operations for owners", () => {
    expect(dashboardQuickActionSegments("OWNER")).toEqual(["sell", "catalog", "customers", "cashbook"]);
  });
  it("never offers forbidden financial operations to cashiers or viewers", () => {
    expect(dashboardQuickActionSegments("CASHIER")).toEqual(["sell", "catalog", "customers", "sales"]);
    expect(dashboardQuickActionSegments("VIEWER")).toEqual(["catalog", "customers", "sales", "settings"]);
    for (const role of ["CASHIER", "VIEWER"] as const) {
      expect(dashboardQuickActionSegments(role).every((segment) => allowed(role).has(segment))).toBe(true);
      expect(dashboardQuickActionSegments(role)).not.toContain("cashbook");
    }
  });
  it("does not render shortcuts before a valid role is resolved", () => {
    expect(dashboardQuickActionSegments(null)).toEqual([]);
  });
});
