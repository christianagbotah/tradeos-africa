import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const route = (name: string) => fs.readFileSync(path.join(appRoot, "(workspace)", name, "page.tsx"), "utf8");

describe("workspace route composition", () => {
  it("mounts one intended major feature per primary route", () => {
    expect(route("sell")).toContain("<PosWorkspace");
    expect(route("sell")).not.toContain("<QuickSale");
    expect(route("sales")).toMatch(/<SalesAndReturns[\s\S]*view="sales"/);
    expect(route("customers")).toContain("<CustomerWorkspace");
    expect(route("purchases")).toMatch(/<PurchasesInventory[\s\S]*view="purchases"/);
    expect(route("inventory")).toMatch(/<PurchasesInventory[\s\S]*view="inventory"/);
    expect(route("catalog")).toContain("<CatalogWorkspace");
    expect(route("returns")).toMatch(/<SalesAndReturns[\s\S]*view="returns"/);
    expect(route("cashbook")).toContain("<CashbookExpenses");
    expect(route("operations")).toContain("<OperationsReconciliation");
    expect(route("reports")).toMatch(/<FinancialReports[\s\S]*view="reports"/);
  });

  it("keeps combined mutation sources shared behind presentation view props", () => {
    const purchases = fs.readFileSync(path.join(appRoot, "components", "purchases-inventory.tsx"), "utf8");
    const sales = fs.readFileSync(path.join(appRoot, "components", "sales-returns.tsx"), "utf8");
    expect(purchases).toMatch(/view:\s*"purchases"\s*\|\s*"inventory"/);
    expect(sales).toMatch(/view:\s*"sales"\s*\|\s*"returns"/);
    expect(purchases.match(/PURCHASE_RECEIVE_CREATE/g)?.length).toBe(2);
    expect(sales.match(/RETURN_CREATE/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("does not mount the legacy all-module workspace from route pages", () => {
    for (const name of ["sell", "sales", "customers", "purchases", "inventory", "catalog", "returns", "cashbook", "operations", "reports"]) {
      expect(route(name)).not.toContain("BusinessWorkspace");
      expect(route(name)).not.toContain("TradeOSWebApp");
    }
  });
});
