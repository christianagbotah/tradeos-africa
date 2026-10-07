import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(workspaceDir, "../..");

const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");

describe("professional authenticated shell", () => {
  it("exposes an obvious topbar profile menu with sign out", () => {
    const shell = read("components/workspace/app-shell.tsx");
    expect(shell).toContain("workspace-profile-menu");
    expect(shell).toContain("workspace-profile-trigger");
    expect(shell).toContain("workspace-profile-dropdown");
    expect(shell).toContain("Sign out");
    expect(shell).toContain("aria-haspopup=\"menu\"");
    expect(shell).toContain("aria-expanded={profileOpen}");
  });

  it("applies a professional workspace-wide control system instead of browser defaults", () => {
    const css = read("workspace-shell.css");
    expect(css).toContain("--workspace-surface");
    expect(css).toMatch(/\.workspace-main\s+(input|select|textarea)/);
    expect(css).toMatch(/\.workspace-main\s+button/);
    expect(css).toContain("workspace-profile-dropdown");
    expect(css).toContain("workspace-content");
  });
  it("normalizes legacy module panels, forms and actions through one routed workspace polish layer", () => {
    const layout = read("layout.tsx");
    const css = read("workspace-polish.css");
    expect(layout).toContain('import "./workspace-polish.css"');
    for (const selector of [
      ".workspace-main .panel",
      ".workspace-main .form-row",
      ".workspace-main .primary-button",
      ".workspace-main .ghost-button",
      ".workspace-main .quick-item",
      ".workspace-main .purchase-inventory-panel",
      ".workspace-main .sales-return-panel",
      ".workspace-main .customer-credit-panel",
    ]) expect(css).toContain(selector);
  });

  it("contains Operations reconciliation tables on tablet and mobile", () => {
    const operations = read("components/operations-reconciliation.tsx");
    expect(operations).toContain('import { ResponsiveTable } from "./ui/responsive-table"');
    expect((operations.match(/<ResponsiveTable>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

});
