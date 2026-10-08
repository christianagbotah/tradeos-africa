import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadBuilder() {
  const modulePath = "./purchase-receipt-builder";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const line = {
  key: "line-1", itemId: "item-1", itemName: "Malt", purchaseUnitCode: "crate", purchaseUnitLabel: "Crate",
  quantity: 2, unitCostMinor: 12000, estimatedStockQuantity: 48, stockUnitCode: "bottle",
};

describe("PurchaseReceiptBuilder", () => {
  it("keeps draft lines directly editable and totals them deterministically", async () => {
    const module = await loadBuilder();
    expect(module?.updateReceiptLine).toBeTypeOf("function");
    expect(module?.receiptTotalMinor).toBeTypeOf("function");
    if (!module?.updateReceiptLine || !module?.receiptTotalMinor) return;
    const changed = module.updateReceiptLine([line], "line-1", { quantity: 3, unitCostMinor: 12500, purchaseUnitCode: "box", purchaseUnitLabel: "Box", estimatedStockQuantity: 36 });
    expect(changed[0]).toMatchObject({ quantity: 3, unitCostMinor: 12500, purchaseUnitCode: "box", purchaseUnitLabel: "Box", estimatedStockQuantity: 36 });
    expect(module.receiptTotalMinor(changed)).toBe(37500);
  });

  it("renders supplier/payment/account context and editable quantity/unit/cost/remove controls", async () => {
    const module = await loadBuilder();
    expect(module?.ReceiptLineEditor).toBeTypeOf("function");
    if (!module?.ReceiptLineEditor) return;
    const html = renderToStaticMarkup(React.createElement(module.ReceiptLineEditor, {
      lines: [line], currencyCode: "GHS",
      unitsForItem: () => [{ code: "crate", label: "Crate" }, { code: "box", label: "Box" }],
      onChange: () => undefined, onRemove: () => undefined,
    }));
    for (const label of ["Quantity", "Purchase unit", "Unit cost", "Remove", "Stock preview"]) expect(html).toContain(label);
    expect(html).toContain("Crate");
    expect(html).toContain("bottle");
  });

  it("keeps receipt controls phone-sized and does not move accounting math into CSS/UI copy", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readFileSync(path.join(appRoot, "purchases-inventory.css"), "utf8");
    expect(css).toMatch(/purchase-builder[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/purchase-line-editor[\s\S]*min-height:\s*48px/);
  });
});
