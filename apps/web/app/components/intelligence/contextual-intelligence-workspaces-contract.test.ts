import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const paths = {
  inventory: resolve(ROOT, "app/components/inventory/inventory-workspace.tsx"),
  customers: resolve(ROOT, "app/components/customers/customer-workspace.tsx"),
  purchases: resolve(ROOT, "app/components/purchases/supplier-workspace.tsx"),
  reports: resolve(ROOT, "app/components/reports/financial-reports.tsx"),
  settings: resolve(ROOT, "app/components/settings/settings-workspace.tsx"),
};

const source = (path: string) => readFileSync(path, "utf8");

function expectMount(path: string, surface: string, beforeMarker: string, afterMarker: string) {
  const code = source(path);
  expect(code).toContain("ContextualIntelligencePanel");
  expect(code).toContain(`<ContextualIntelligencePanel surface="${surface}" />`);
  const panel = code.indexOf(`<ContextualIntelligencePanel surface="${surface}" />`);
  expect(panel).toBeGreaterThan(code.indexOf(beforeMarker));
  expect(panel).toBeLessThan(code.indexOf(afterMarker));
}

describe("contextual intelligence workspace integration", () => {
  it("mounts inventory intelligence before inventory KPIs", () => {
    expectMount(paths.inventory, "inventory", 'className="tos-page__head"', 'className="tos-dashboard-stats');
  });

  it("mounts customer intelligence before customer KPIs", () => {
    expectMount(paths.customers, "customers", 'className="tos-page__head"', 'className="tos-dashboard-stats');
  });

  it("mounts purchasing intelligence before supplier KPIs", () => {
    expectMount(paths.purchases, "purchases", 'className="tos-page__head"', 'className="tos-dashboard-stats');
  });

  it("mounts performance intelligence before report range controls", () => {
    expectMount(paths.reports, "reports", 'className="tos-page__head"', 'className="tos-report-presets');
  });

  it("mounts settings readiness after the settings hero and before the settings layout", () => {
    expectMount(paths.settings, "settings", 'className="tos-settings__hero', 'className="tos-settings__layout');
  });
});
