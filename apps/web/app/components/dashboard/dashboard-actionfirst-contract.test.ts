import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "dashboard-command-center.tsx"), "utf8");
const css = readFileSync(join(__dirname, "../../ui-primitives.css"), "utf8");

describe("mobile dashboard reliability and layout", () => {
  it("places role-authorized quick actions above the slower briefing panels", () => {
    const quick = source.indexOf("<DashboardQuickActions role={role} />");
    const stats = source.indexOf('<div className="tos-dashboard-stats tos-stagger">');
    const briefing = source.indexOf("<BusinessBriefingPanel />");
    expect(quick).toBeGreaterThan(0);
    expect(quick).toBeLessThan(stats);
    expect(stats).toBeLessThan(briefing);
  });
  it("does not hide the whole workspace on a sales API failure", () => {
    const component = source.slice(source.indexOf("export function DashboardCommandCenter()"), source.indexOf("function DashboardHeader("));
    expect(component).not.toMatch(/if \(error\)\s*\{\s*return/);
    expect(component).not.toMatch(/if \(loading\)\s*\{\s*return/);
    expect(component).toContain('title="Could not load recent sales"');
    expect(component).toContain('actionLabel="Retry sales"');
    expect(component).toContain('loading || error ? "—" : sales.length');
  });
  it("uses readable, non-overflowing two-column phone shortcut tiles", () => {
    expect(css).toMatch(/@media \(max-width: 640px\)\s*\{[^}]*\.tos-dashboard-header[\s\S]*?\.tos-dashboard-actions \.tos-quick-action-grid\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toContain('white-space: normal; overflow-wrap: break-word;');
  });
});
