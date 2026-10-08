import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadSheet() {
  const modulePath = "./sale-detail-sheet";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const sale = {
  id: "22222222-2222-4222-8222-222222222222", businessId: "b1", branchId: "br1", status: "PARTIALLY_REFUNDED", currencyCode: "GHS", totalMinor: 30000,
  completedAt: "2026-10-08T10:00:00.000Z", createdAt: "2026-10-08T09:59:00.000Z", customer: { id: "c1", name: "Kojo Trading", phone: "0240000000" }, cashierName: "Yaw",
  lines: [{ id: "l1", itemId: "i1", itemName: "Malt", itemKind: "PRODUCT", quantity: 2, quantityReturned: 1, quantityReturnable: 1, saleUnitCode: "bottle", unitNetMinor: 14000, unitTaxMinor: 1000, lineTotalMinor: 30000 }],
  payments: [{ id: "p1", method: "MOMO", amountMinor: 30000, refundedMinor: 5000, status: "PARTIALLY_REVERSED", providerReference: "MOMO-REF-1" }],
};

describe("SaleDetailSheet", () => {
  it("renders posted receipt evidence as an accessible immutable sheet", async () => {
    const module = await loadSheet();
    expect(module?.SaleDetailSheet).toBeTypeOf("function");
    if (!module?.SaleDetailSheet) return;
    const html = renderToStaticMarkup(React.createElement(module.SaleDetailSheet, { sale, open: true, canProcessReturns: true, onClose: () => undefined }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/Posted receipt|read only/i);
    expect(html).toContain("Kojo Trading");
    expect(html).toContain("Malt");
    expect(html).toContain("1 of 2 returned");
    expect(html).toContain("MOMO");
    expect(html).toContain("PARTIALLY REVERSED");
    expect(html).toContain("Process return / refund");
    expect(html).not.toContain("Save changes");
    expect(html).not.toContain("Delete sale");
    expect(html).not.toContain("Edit sale");
  });

  it("hides correction action for read-only users and labels walk-in receipts clearly", async () => {
    const module = await loadSheet();
    expect(module?.SaleDetailSheet).toBeTypeOf("function");
    if (!module?.SaleDetailSheet) return;
    const html = renderToStaticMarkup(React.createElement(module.SaleDetailSheet, { sale: { ...sale, customer: null }, open: true, canProcessReturns: false, onClose: () => undefined }));
    expect(html).toContain("Walk-in customer");
    expect(html).not.toContain("Process return / refund");
  });
});
