import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");

describe("Z.ai authenticated composition boundary", () => {
  it("keeps the Z.ai application shell rather than the later mobile-context override", () => {
    const shell = read("components/workspace/app-shell.tsx");
    const css = read("workspace-shell.css");
    expect(shell).toContain("workspace-context-actions");
    expect(shell).toContain("MobileBottomNav");
    expect(shell).not.toContain("workspace-mobile-context-trigger");
    expect(css).not.toContain("workspace-mobile-context-trigger");
  });

  it("keeps Z.ai dashboard hierarchy: Today, then pulse, then quick actions", () => {
    const dashboard = read("components/dashboard/dashboard-command-center.tsx");
    const today = dashboard.indexOf('className="tos-today"');
    const pulse = dashboard.indexOf("<BusinessPulse");
    const actions = dashboard.indexOf('aria-labelledby="quick-actions-title"');
    expect(today).toBeGreaterThan(-1);
    expect(pulse).toBeGreaterThan(today);
    expect(actions).toBeGreaterThan(pulse);
  });

  it("keeps Z.ai POS composition and rejects the later replacement cart sheet", () => {
    const pos = read("components/pos/pos-workspace.tsx");
    const css = read("pos.css");
    expect(pos).toContain('className="pos-workspace-grid"');
    expect(pos).toContain('className="pos-charge-bar"');
    expect(pos).not.toContain("mobileCartOpen");
    expect(pos).not.toContain("pos-mobile-cart-sheet");
    expect(css).not.toContain("pos-mobile-cart-sheet");
  });
});
