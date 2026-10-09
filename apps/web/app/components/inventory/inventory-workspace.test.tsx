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

  it("shows adjustment actions only to stock-write roles and surfaces failed adjustments for review", async () => {
    const module = await loadWorkspace();
    expect(module?.InventoryWorkspace).toBeTypeOf("function");
    if (!module?.InventoryWorkspace) return;
    const base = { items, currencyCode: "GHS", loadingId: null, onOpen: () => undefined, businessId: "business-1", branchId: "branch-1", onRefresh: () => undefined };
    const owner = renderToStaticMarkup(React.createElement(module.InventoryWorkspace, { ...base, role: "OWNER" }));
    const inventory = renderToStaticMarkup(React.createElement(module.InventoryWorkspace, { ...base, role: "INVENTORY" }));
    const accountant = renderToStaticMarkup(React.createElement(module.InventoryWorkspace, { ...base, role: "ACCOUNTANT" }));
    const viewer = renderToStaticMarkup(React.createElement(module.InventoryWorkspace, { ...base, role: "VIEWER" }));
    expect(owner).toContain("Adjust stock");
    expect(inventory).toContain("Adjust stock");
    expect(accountant).not.toContain("Adjust stock");
    expect(viewer).not.toContain("Adjust stock");
    const root = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(root, "inventory-workspace.tsx"), "utf8");
    expect(source).toContain("InventoryAdjustmentSheet");
    expect(source).toContain("getFailedMutations");
    expect(source).toContain("queueChangedEvent");
    expect(source).toContain("needs review");
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

// Task 7: design-system primitives + mobile record-card contracts
describe("Inventory design-system and mobile contracts", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

  it("uses the shared CommandBar primitive for the inventory command row", () => {
    const ws = read("inventory-workspace.tsx");
    expect(ws).toContain("CommandBar");
  });

  it("uses MobileRecordCard for mobile inventory rows rather than relying solely on the desktop table", () => {
    const ws = read("inventory-workspace.tsx");
    expect(ws).toContain("MobileRecordCard");
  });

  it("never frames inventory as edit-balance (movement-derived invariant)", () => {
    const ws = read("inventory-workspace.tsx");
    const detail = read("inventory-detail-sheet.tsx");
    const adj = read("inventory-adjustment-sheet.tsx");
    for (const src of [ws, detail, adj]) {
      expect(src).not.toMatch(/Edit balance|Set stock|Save stock|New balance/);
    }
  });

  it("frames adjustments as corrections/reclassifications with reason, not direct balance editing", () => {
    const adj = read("inventory-adjustment-sheet.tsx");
    expect(adj).toMatch(/Count correction|Quarantine|Damage|Waste|Explanation|reason/i);
    expect(adj).toContain("INVENTORY_ADJUSTMENT_CREATE");
  });
});
