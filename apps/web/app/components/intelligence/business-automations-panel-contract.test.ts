import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const panelPath = resolve(root, "app/components/intelligence/business-automations-panel.tsx");
const dashboardPath = resolve(root, "app/components/dashboard/dashboard-command-center.tsx");

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("business automations control surface", () => {
  it("is mounted in the dashboard command center", () => {
    const dashboard = source(dashboardPath);
    expect(dashboard).toContain("BusinessAutomationsPanel");
  });

  it("is role-gated, offline-aware and exposes safe policy controls", () => {
    const panel = source(panelPath);
    expect(panel).toContain("canManageBusinessAutomations");
    expect(panel).toMatch(/queue\.online/);
    expect(panel).toMatch(/AI Automations/);
    expect(panel).toMatch(/Run now/);
    expect(panel).toMatch(/Enable|Disable/);
    expect(panel).toMatch(/policyVersion|Version/);
    expect(panel).toMatch(/Business-wide|Current branch|Branch/);
    expect(panel).toContain("mutateBusinessAutomationPolicy");
    expect(panel).toContain("runBusinessAutomationNow");
  });
});
