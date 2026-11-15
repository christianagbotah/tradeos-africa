import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mobileMoreNavigationGroups, primaryNavItems, secondaryNavItems, type WorkspaceRole } from "./workspace-navigation";

const shell = readFileSync(join(__dirname, "app-shell.tsx"), "utf8");
const css = readFileSync(join(__dirname, "../../workspace-shell.css"), "utf8");

function links(role: WorkspaceRole) {
  return mobileMoreNavigationGroups(role).flatMap((group) => group.items);
}

describe("five-item mobile bottom navigation", () => {
  it("renders four primary role-aware links plus a real fifth More tab", () => {
    expect(primaryNavItems("OWNER").map((item) => item.shortLabel)).toEqual(["Home", "Sell", "Sales", "Customers"]);
    expect(shell).toContain('className="tos-bottomnav__link tos-bottomnav__more-link"');
    expect(shell).toContain('<span>More</span>');
    expect(shell).toContain('aria-haspopup="dialog"');
    expect(shell).not.toContain('className="tos-bottomnav__more"');
    expect(css).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
    expect(shell).toContain('aria-modal="true"');
  });

  it("fills More with grouped existing pages and canonical settings subsections", () => {
    const groups = mobileMoreNavigationGroups("OWNER");
    expect(groups.map((group) => group.title)).toEqual(["Sales & stock", "Operations & insights", "Business & account"]);
    const menu = links("OWNER");
    expect(menu.map((item) => item.id)).toEqual([
      "documents", "catalog", "inventory", "returns", "purchases", "purchase-orders", "cashbook", "operations", "reports",
      "business", "branches", "team", "billing", "devices", "profile", "security", "settings",
    ]);
    expect(menu.find((item) => item.id === "business")?.href).toBe("/settings?section=business");
    expect(menu.find((item) => item.id === "team")?.href).toBe("/settings?section=team");
    expect(menu.find((item) => item.id === "devices")?.href).toBe("/settings?section=devices");
    for (const item of secondaryNavItems("OWNER")) expect(menu.some((entry) => entry.id === item.id)).toBe(true);
  });

  it("keeps role restrictions in the mobile sheet", () => {
    const cashier = links("CASHIER");
    expect(cashier.some((item) => item.id === "documents" && item.href === "/documents")).toBe(true);
    expect(links("OWNER").some((item) => item.id === "purchase-orders" && item.href === "/purchase-orders")).toBe(true);
    expect(links("INVENTORY").some((item) => item.id === "purchase-orders")).toBe(true);
    expect(cashier.some((item) => item.id === "cashbook" || item.id === "returns" || item.id === "billing" || item.id === "team")).toBe(false);
    expect(cashier.some((item) => item.id === "profile")).toBe(true);
    expect(mobileMoreNavigationGroups(null)).toEqual([]);
    const viewer = links("VIEWER");
    expect(viewer.some((item) => item.id === "inventory" || item.id === "purchases")).toBe(false);
    expect(viewer.some((item) => item.id === "settings")).toBe(true);
  });

  it("closes the sheet after settings deep-link navigation and supports Escape", () => {
    expect(shell).toContain('onClick={onNavigate}');
    expect(shell).toContain('onNavigate={() => setMoreOpen(false)}');
    expect(shell).toContain('onKeyDown={handleMoreKeyDown}');
    expect(shell).toContain('event.key === "Escape"');
    expect(shell).toContain('moreCloseRef.current?.focus()');
  });
});

describe("settings mobile action layout", () => {
  it("uses a two-column action group for Edit/Add and Refresh/Sign out", () => {
    expect(css).toMatch(/\.tos-settings__header-actions\s*\{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toContain('.tos-settings__header-actions > .tos-btn');
    expect(css).toContain('white-space: normal;');
    expect(css).toContain('.tos-settings__header-actions > :only-child { grid-column: 1 / -1; }');
  });
  it("prevents long device identifiers from overflowing the session card", () => {
    expect(css).toContain('.tos-settings__session-main > span { overflow-wrap: anywhere; }');
  });
});
