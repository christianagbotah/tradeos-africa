import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadSheet() {
  const modulePath = "./purchase-detail-sheet";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const purchase = {
  id: "p1", supplierId: "s1", supplierName: "Accra Supplies", supplierReference: "INV-404", totalMinor: 25000,
  currencyCode: "GHS", receivedAt: "2026-10-08T09:00:00.000Z", receiverName: "Ama", lineCount: 1, settlementMethod: "BANK",
};
const detail = {
  purchase: { id: "p1", businessId: "b1", branchId: "br1", supplierId: "s1", supplierName: "Accra Supplies", status: "RECEIVED", currencyCode: "GHS", totalMinor: 25000, settlementMethod: "BANK" },
  lines: [{ id: "pl1", itemId: "i1", itemName: "Malt", purchaseUnitCode: "crate", purchaseQuantity: 2, stockUnitCode: "bottle", stockQuantity: 48, unitCostMinor: 12500, lineCostMinor: 25000, returnedQuantity: 0, remainingQuantity: 2, returnedRecoveryMinor: 0 }],
  returns: [],
};

describe("PurchaseDetailSheet", () => {
  it("renders posted receipt evidence as immutable and exposes correction only by permission", async () => {
    const module = await loadSheet();
    expect(module?.PurchaseDetailSheet).toBeTypeOf("function");
    if (!module?.PurchaseDetailSheet) return;
    const allowed = renderToStaticMarkup(React.createElement(module.PurchaseDetailSheet, { open: true, purchase, detail, canReturn: true, onClose: () => undefined, onReturn: () => undefined }));
    const readonly = renderToStaticMarkup(React.createElement(module.PurchaseDetailSheet, { open: true, purchase, detail, canReturn: false, onClose: () => undefined, onReturn: () => undefined }));
    expect(allowed).toContain('role="dialog"');
    expect(allowed).toContain('aria-modal="true"');
    for (const text of ["Posted purchase receipt", "Accra Supplies", "INV-404", "Bank", "Malt", "2", "crate", "48", "bottle", "Recorded receipt is read-only"]) expect(allowed).toContain(text);
    expect(allowed).toContain("Create purchase return");
    expect(readonly).not.toContain("Create purchase return");
    expect(allowed).not.toMatch(/Edit purchase|Delete purchase|Save purchase/);
  });
});
