import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isWorkspaceNavActive, visibleWorkspaceNav, workspaceNavigation } from "./workspace-navigation";

describe("TradeOS application shell navigation", () => {
  it("uses real workspace routes rather than hash anchors", () => {
    expect(workspaceNavigation.map((item) => item.href)).toEqual([
      "/dashboard", "/sell", "/sales", "/customers", "/purchases", "/inventory", "/catalog", "/returns", "/cashbook", "/operations", "/reports",
    ]);
    expect(workspaceNavigation.every((item) => item.href.startsWith("/") && !item.href.includes("#"))).toBe(true);
  });

  it("marks the cashbook route active from pathname", () => {
    expect(isWorkspaceNavActive("/cashbook", "/cashbook")).toBe(true);
    expect(isWorkspaceNavActive("/cashbook/history", "/cashbook")).toBe(true);
    expect(isWorkspaceNavActive("/sales", "/cashbook")).toBe(false);
  });

  it("gives OWNER every destination while CASHIER and VIEWER get purposeful subsets", () => {
    expect(visibleWorkspaceNav("OWNER")).toHaveLength(11);
    expect(visibleWorkspaceNav("CASHIER").map((item) => item.href)).toEqual([
      "/dashboard", "/sell", "/sales", "/customers", "/returns", "/cashbook", "/operations",
    ]);
    const viewer = visibleWorkspaceNav("VIEWER").map((item) => item.href);
    expect(viewer).not.toContain("/sell");
    expect(viewer).toContain("/reports");
    expect(viewer).toContain("/cashbook");
  });

  it("renders aria-current from route state and keeps mobile drawer local to shell", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(dir, "app-shell.tsx"), "utf8");
    expect(source).toContain('aria-current={active ? "page" : undefined}');
    expect(source).toMatch(/useState\(false\)/);
    expect(source).toContain("usePathname()");
  });
});
