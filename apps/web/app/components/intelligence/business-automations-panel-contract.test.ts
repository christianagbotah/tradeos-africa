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

it("offers guided create and edit controls without exposing arbitrary action types", () => {
  const panel = source(panelPath);
  expect(panel).toMatch(/Create automation/);
  expect(panel).toMatch(/Edit setup/);
  expect(panel).toMatch(/Automation template/);
  expect(panel).toMatch(/Scope/);
  expect(panel).toMatch(/Signal/);
  expect(panel).toMatch(/Severity threshold/);
  expect(panel).toMatch(/Assign to me/);
  expect(panel).toMatch(/Due within/);
  expect(panel).toMatch(/Preview/);
  expect(panel).toContain("saveGuidedBusinessAutomationPolicy");
  expect(panel).toContain("guidedAutomationDraftFromPolicy");
  expect(panel).not.toMatch(/POST_PAYMENT|REFUND|STOCK_WRITE_OFF|CHANGE_ROLE|CREATE_PURCHASE|CREATE_SALE/);
});

it("keeps the guided editor honest about automatic attention checks and manual cash review", () => {
  const panel = source(panelPath);
  expect(panel).toMatch(/manual template/i);
  expect(panel).toMatch(/checked automatically|runs automatically|automatic background/i);
  expect(panel).toMatch(/Run now/);
  expect(panel).not.toMatch(/background execution still needs the automation dispatcher/i);
});

it("has responsive styling for the guided editor and preview", () => {
  const css = source(resolve(root, "app/intelligence.css"));
  expect(css).toMatch(/\.tos-ai-automation-editor\s*\{/);
  expect(css).toMatch(/\.tos-ai-automation-editor__grid\s*\{/);
  expect(css).toMatch(/\.tos-ai-automation-preview\s*\{/);
  expect(css).toMatch(/\.tos-ai-automation-check\s*\{/);
  expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.tos-ai-automation-editor__grid/);
});
