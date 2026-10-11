import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");
const route = (name: string) => read(`(workspace)/${name}/page.tsx`);

const primaryRoutes = [
  "sell",
  "sales",
  "customers",
  "purchases",
  "inventory",
  "catalog",
  "returns",
  "cashbook",
  "operations",
  "reports",
] as const;

describe("Z.ai all-page composition boundary", () => {
  it("keeps generic legacy page chrome out of every authenticated primary route", () => {
    for (const name of primaryRoutes) {
      const source = route(name);
      expect(source, `${name} should not import generic PageHeader`).not.toContain('components/ui/page-header');
      expect(source, `${name} should not import generic DataCard`).not.toContain('components/ui/data-card');
      expect(source, `${name} should not mount tradeos-page-stack`).not.toContain('tradeos-page-stack');
    }
  });

  it("uses the Z.ai route header inside coordinators that own their page composition", () => {
    for (const relative of [
      "components/purchases-inventory.tsx",
      "components/operations-reconciliation.tsx",
      "components/financial-reports.tsx",
      "components/cashbook-expenses.tsx",
    ]) {
      const source = read(relative);
      expect(source, `${relative} should use ZaiRouteHeader`).toContain("ZaiRouteHeader");
      expect(source, `${relative} should not use PageHeader`).not.toContain("<PageHeader");
    }
  });

  it("provides one Z.ai route surface grammar for page titles and permission states", () => {
    const header = read("components/ui/zai-route-header.tsx");
    const access = read("components/ui/zai-access-state.tsx");
    const css = read("zai-reference.css");

    expect(header).toContain('className="zai-route-header"');
    expect(header).toContain("zai-route-kicker");
    expect(access).toContain('className="zai-route-access"');
    expect(css).toContain(".zai-route-header");
    expect(css).toContain(".zai-route-access");
  });

  it("keeps each route wired to its existing business coordinator while replacing only presentation chrome", () => {
    expect(route("sell")).toContain("<PosWorkspace");
    expect(route("sales")).toContain("<SalesAndReturns");
    expect(route("customers")).toContain("<CustomerWorkspace");
    expect(route("purchases")).toContain("<PurchasesInventory");
    expect(route("inventory")).toContain("<PurchasesInventory");
    expect(route("catalog")).toContain("<CatalogWorkspace");
    expect(route("returns")).toContain("<SalesAndReturns");
    expect(route("cashbook")).toContain("<CashbookExpenses");
    expect(route("operations")).toContain("<OperationsReconciliation");
    expect(route("reports")).toContain("<FinancialReports");
  });
});

describe("Z.ai canonical stylesheet boundary", () => {
  it("loads focused canonical module styles instead of the legacy application monolith", () => {
    const layout = read("layout.tsx");
    expect(layout).not.toContain('import "./tradeos-app.css"');
    for (const file of [
      "globals.css",
      "purchases-inventory.css",
      "returns.css",
      "public-entry.css",
      "sales-returns.css",
      "transaction-evidence.css",
      "cashbook.css",
      "operations.css",
      "reports.css",
      "master-data.css",
    ]) {
      expect(layout).toContain(`import "./${file}"`);
    }
    expect(layout).toContain('import "./zai-reference.css"');
  });
});

describe("post-canonical report correctness styling", () => {
  it("keeps CFO priority severity badges visible after the module CSS cutover", () => {
    const css = read("reports.css");
    expect(css).toContain(".cfo-priority");
    expect(css).toContain(".cfo-priority.urgent");
    expect(css).toContain(".cfo-priority.medium");
    expect(css).toContain(".cfo-priority.low");
  });
});
