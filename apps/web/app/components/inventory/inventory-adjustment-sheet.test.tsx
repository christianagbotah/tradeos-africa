import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadSheet() {
  const modulePath = "./inventory-adjustment-sheet";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const item = {
  id: "i1", sku: "CEM-001", name: "Cement", stockUnitCode: "bag",
  available: 20, quarantine: 2, damaged: 1, waste: 0,
  averageStockUnitCostMinor: 9000, inventoryValueMinor: 207000,
};

describe("InventoryAdjustmentSheet", () => {
  it("maps count corrections and stock-state moves to event payloads without direct balance writes", async () => {
    const module = await loadSheet();
    expect(module?.inventoryAdjustmentPayload).toBeTypeOf("function");
    if (!module?.inventoryAdjustmentPayload) return;
    expect(module.inventoryAdjustmentPayload(item.id, { action: "COUNT_CORRECTION", direction: "ADD", sourceLocation: "AVAILABLE", countLocation: "AVAILABLE", quantity: "2", note: "Found on shelf" })).toEqual({
      itemId: item.id, destinationLocation: "AVAILABLE", quantity: 2, reasonCode: "COUNT_CORRECTION", note: "Found on shelf",
    });
    expect(module.inventoryAdjustmentPayload(item.id, { action: "COUNT_CORRECTION", direction: "REMOVE", sourceLocation: "AVAILABLE", countLocation: "QUARANTINE", quantity: "1", note: "Missing at count" })).toEqual({
      itemId: item.id, sourceLocation: "QUARANTINE", quantity: 1, reasonCode: "COUNT_CORRECTION", note: "Missing at count",
    });
    expect(module.inventoryAdjustmentPayload(item.id, { action: "QUARANTINE", direction: "REMOVE", sourceLocation: "AVAILABLE", countLocation: "AVAILABLE", quantity: "3", note: "Seal damaged" })).toEqual({
      itemId: item.id, sourceLocation: "AVAILABLE", destinationLocation: "QUARANTINE", quantity: 3, reasonCode: "QUARANTINE", note: "Seal damaged",
    });
    expect(module.inventoryAdjustmentPayload(item.id, { action: "DAMAGE", direction: "REMOVE", sourceLocation: "QUARANTINE", countLocation: "AVAILABLE", quantity: "1", note: "Confirmed damaged" })).toEqual({
      itemId: item.id, sourceLocation: "QUARANTINE", destinationLocation: "DAMAGED", quantity: 1, reasonCode: "DAMAGE", note: "Confirmed damaged",
    });
    expect(module.inventoryAdjustmentPayload(item.id, { action: "WASTE", direction: "REMOVE", sourceLocation: "DAMAGED", countLocation: "AVAILABLE", quantity: "1", note: "Disposed" })).toEqual({
      itemId: item.id, sourceLocation: "DAMAGED", destinationLocation: "WASTE", quantity: 1, reasonCode: "WASTE", note: "Disposed",
    });
  });

  it("renders a professional accessible adjustment flow with required explanation and server-authoritative preview", async () => {
    const module = await loadSheet();
    expect(module?.InventoryAdjustmentSheet).toBeTypeOf("function");
    if (!module?.InventoryAdjustmentSheet) return;
    const html = renderToStaticMarkup(React.createElement(module.InventoryAdjustmentSheet, {
      open: true,
      item,
      businessId: "business-1",
      branchId: "branch-1",
      role: "OWNER",
      onClose: () => undefined,
      onQueued: () => undefined,
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    for (const text of ["Adjust stock", "Count correction", "Quarantine", "Damage", "Waste", "Quantity", "Explanation", "Required", "Preview", "TradeOS calculates valuation", "Save adjustment"]) expect(html).toContain(text);
    expect(html).not.toMatch(/Edit balance|Set stock|Save stock|New balance/);
  });

  it("queues only the new adjustment mutation and maps rejected stock conflicts to review guidance", async () => {
    const module = await loadSheet();
    expect(module?.inventoryAdjustmentMessage).toBeTypeOf("function");
    if (module?.inventoryAdjustmentMessage) {
      expect(module.inventoryAdjustmentMessage("INVENTORY_INSUFFICIENT_STOCK")).toMatch(/changed|available|refresh|review/i);
      expect(module.inventoryAdjustmentMessage("INVENTORY_ITEM_NOT_FOUND")).toMatch(/item|refresh|available/i);
    }
    const root = path.dirname(fileURLToPath(import.meta.url));
    const sourcePath = path.join(root, "inventory-adjustment-sheet.tsx");
    expect(fs.existsSync(sourcePath)).toBe(true);
    if (!fs.existsSync(sourcePath)) return;
    const source = fs.readFileSync(sourcePath, "utf8");
    expect(source).toContain("INVENTORY_ADJUSTMENT_CREATE");
    expect(source).toContain("enqueueMutation");
    expect(source).toContain("flushPendingMutations");
    expect(source).toContain("navigator.onLine");
    expect(source).not.toMatch(/["'](?:PATCH|PUT)["'][^\n]*inventory/i);
  });

  it("keeps adjustment controls touch-safe on phones", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readdirSync(appRoot).filter((name) => name.endsWith(".css")).map((name) => fs.readFileSync(path.join(appRoot, name), "utf8")).join("\n");
    expect(css).toMatch(/inventory-adjustment[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/inventory-adjustment[\s\S]*font-size:\s*15px/);
  });
});
