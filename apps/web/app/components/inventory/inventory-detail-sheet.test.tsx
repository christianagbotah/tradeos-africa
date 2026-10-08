import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadSheet() {
  const modulePath = "./inventory-detail-sheet";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const detail = {
  item: { id: "i1", sku: "CEM-001", name: "Cement", stockUnitCode: "bag", active: true, available: 8, quarantine: 1, damaged: 0, waste: 0, averageStockUnitCostMinor: 9000, inventoryValueMinor: 81000 },
  movements: [
    { id: "m1", stockUnitCode: "bag", quantityDelta: 1, location: "QUARANTINE", reason: "SALE_RETURN", referenceType: "RETURN_LINE", referenceId: "r1", actorStaffId: "staff-1", actorName: "Ama", occurredAt: "2026-10-08T12:00:00.000Z" },
    { id: "m2", stockUnitCode: "bag", quantityDelta: -2, location: "AVAILABLE", reason: "SALE", referenceType: "SALE_LINE", referenceId: "s1", actorStaffId: "staff-1", actorName: "Ama", occurredAt: "2026-10-08T11:00:00.000Z" },
  ],
};

describe("InventoryDetailSheet", () => {
  it("renders derived balances and immutable movement evidence with actor, reason and reference", async () => {
    const module = await loadSheet();
    expect(module?.InventoryDetailSheet).toBeTypeOf("function");
    if (!module?.InventoryDetailSheet) return;
    const html = renderToStaticMarkup(React.createElement(module.InventoryDetailSheet, { open: true, detail, onClose: () => undefined }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    for (const text of ["Inventory movement history", "Balances are derived from posted movements", "Available", "Quarantine", "Damaged", "Waste", "Sale Return", "Sale", "Ama", "RETURN LINE", "+1", "-2"]) expect(html).toContain(text);
    expect(html).not.toMatch(/Edit balance|Set stock|Save stock|Delete movement/);
  });
});
