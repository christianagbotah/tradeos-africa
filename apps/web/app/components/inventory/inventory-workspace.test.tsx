import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadWorkspace() {
  const modulePath = "./inventory-workspace";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const items = [
  { id: "i1", sku: "CEM-001", name: "Cement", stockUnitCode: "bag", available: 20, quarantine: 2, damaged: 0, waste: 0, averageStockUnitCostMinor: 9000, inventoryValueMinor: 198000 },
  { id: "i2", sku: null, name: "Paint", stockUnitCode: "tin", available: 0, quarantine: 0, damaged: 3, waste: 1, averageStockUnitCostMinor: 4000, inventoryValueMinor: 12000 },
];

describe("InventoryWorkspace", () => {
  it("filters by identity and operational stock state", async () => {
    const module = await loadWorkspace();
    expect(module?.filterInventory).toBeTypeOf("function");
    if (!module?.filterInventory) return;
    expect(module.filterInventory(items, "cement", "ALL").map((item: { id: string }) => item.id)).toEqual(["i1"]);
    expect(module.filterInventory(items, "", "EMPTY").map((item: { id: string }) => item.id)).toEqual(["i2"]);
    expect(module.filterInventory(items, "", "EXCEPTIONS").map((item: { id: string }) => item.id)).toEqual(["i1", "i2"]);
  });

  it("renders professional derived-balance rows and movement-history actions without direct stock editing", async () => {
    const module = await loadWorkspace();
    expect(module?.InventoryWorkspace).toBeTypeOf("function");
    if (!module?.InventoryWorkspace) return;
    const html = renderToStaticMarkup(React.createElement(module.InventoryWorkspace, { items, currencyCode: "GHS", loadingId: null, onOpen: () => undefined }));
    for (const text of ["Search inventory", "Available", "Quarantine", "Damaged", "Waste", "Average cost", "Inventory value", "Movement history", "Cement", "Paint"]) expect(html).toContain(text);
    expect(html).not.toMatch(/Edit balance|Set stock|Save stock/);
  });

  it("replaces the legacy internal InventoryTable and keeps phone controls readable", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const coordinator = fs.readFileSync(path.join(root, "components", "purchases-inventory.tsx"), "utf8");
    const css = fs.readFileSync(path.join(root, "purchases-inventory.css"), "utf8");
    expect(coordinator).toContain("InventoryWorkspace");
    expect(coordinator).toContain("InventoryDetailSheet");
    expect(coordinator).not.toMatch(/function InventoryTable\(/);
    expect(css).toMatch(/inventory-workspace[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/inventory-row-modern[\s\S]*font-size:\s*15px/);
  });
});
