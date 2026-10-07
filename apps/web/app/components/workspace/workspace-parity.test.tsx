import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getPublicEntryMode } from "../public-entry";
import { visibleWorkspaceNav, workspaceNavigation } from "./workspace-navigation";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const allRoutes = ["/dashboard", "/sell", "/sales", "/customers", "/purchases", "/inventory", "/catalog", "/returns", "/cashbook", "/operations", "/reports"];

describe("multi-page workspace parity", () => {
  it("represents every primary module with a real route and no hash navigation", () => {
    expect(workspaceNavigation.map((item) => item.href)).toEqual(allRoutes);
    expect(workspaceNavigation.every((item) => item.href.startsWith("/") && !item.href.includes("#"))).toBe(true);
    for (const href of allRoutes) {
      expect(fs.existsSync(path.join(appRoot, "(workspace)", href.slice(1), "page.tsx"))).toBe(true);
    }
  });

  it("gives OWNER every route and CASHIER the core selling and money workflows", () => {
    expect(visibleWorkspaceNav("OWNER").map((item) => item.href)).toEqual(allRoutes);
    const cashier = visibleWorkspaceNav("CASHIER").map((item) => item.href);
    expect(cashier).toEqual(expect.arrayContaining(["/dashboard", "/sell", "/sales", "/customers", "/returns", "/cashbook", "/operations"]));
  });

  it("keeps VIEWER navigation read-only and away from mutation-first workspaces", () => {
    const viewer = visibleWorkspaceNav("VIEWER").map((item) => item.href);
    expect(viewer).toEqual(["/dashboard", "/sales", "/customers", "/purchases", "/inventory", "/cashbook", "/operations", "/reports"]);
    expect(viewer).not.toEqual(expect.arrayContaining(["/sell", "/catalog", "/returns"]));
  });

  it("guards direct VIEWER access to mutation-first routes in presentation", () => {
    for (const route of ["sell", "catalog", "returns"]) {
      const source = fs.readFileSync(path.join(appRoot, "(workspace)", route, "page.tsx"), "utf8");
      expect(source).toContain("canAccessWorkspaceRoute");
      expect(source).toContain("Read-only access");
    }
  });

  it("redirects a configured authenticated root entry to the dashboard", () => {
    expect(getPublicEntryMode({
      resolved: true,
      session: {
        user: { id: "u1", displayName: "Owner", email: "owner@example.com", phoneE164: null },
        client: { platform: "WEB", deviceKey: "test-device", appVersion: "test" },
        memberships: [{ id: "m1", businessId: "b1", businessName: "Demo Business", businessType: "RETAIL", businessStatus: "ACTIVE", role: "OWNER", staffId: "s1" }],
      },
      workspaceReady: true,
      error: null,
    })).toEqual({ kind: "redirect", href: "/dashboard" });
  });

  it("removes the legacy all-modules authenticated workspace", () => {
    expect(fs.existsSync(path.join(appRoot, "components", "tradeos-web-app.tsx"))).toBe(false);
  });
});
