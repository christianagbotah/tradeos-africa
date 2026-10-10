import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadSheet() {
  const modulePath = "./return-refund-sheet";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const sale = {
  id: "22222222-2222-4222-8222-222222222222", businessId: "b1", branchId: "br1", status: "PARTIALLY_REFUNDED", currencyCode: "GHS", totalMinor: 30000,
  completedAt: "2026-10-08T10:00:00.000Z", createdAt: "2026-10-08T09:59:00.000Z", customer: { id: "c1", name: "Kojo Trading", phone: "0240000000" }, cashierName: "Yaw",
  lines: [
    { id: "l1", itemId: "i1", itemName: "Malt", itemKind: "PRODUCT", quantity: 2, quantityReturned: 1, quantityReturnable: 1, saleUnitCode: "bottle", unitNetMinor: 14000, unitTaxMinor: 1000, lineTotalMinor: 30000 },
    { id: "l2", itemId: "i2", itemName: "Delivery", itemKind: "SERVICE", quantity: 1, quantityReturned: 0, quantityReturnable: 1, saleUnitCode: "service", unitNetMinor: 5000, unitTaxMinor: 0, lineTotalMinor: 5000 },
  ],
  payments: [{ id: "p1", method: "MOMO", amountMinor: 30000, refundedMinor: 5000, status: "PARTIALLY_REVERSED", providerReference: "MOMO-REF-1" }],
};

describe("ReturnRefundSheet", () => {
  it("renders accessible real-sale return controls, stock disposition and processing guidance", async () => {
    const module = await loadSheet();
    expect(module?.ReturnRefundSheet).toBeTypeOf("function");
    if (!module?.ReturnRefundSheet) return;
    const html = renderToStaticMarkup(React.createElement(module.ReturnRefundSheet, {
      sale, open: true, drafts: {}, mode: "RETURN_REFUND", refundMethod: "ORIGINAL_METHOD", reason: "Customer return", busy: false,
      refundPreviewMinor: 0, selectedLineCount: 0,
      onClose: () => undefined, onModeChange: () => undefined, onRefundMethodChange: () => undefined, onReasonChange: () => undefined, onDraftChange: () => undefined, onSubmit: () => undefined,
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Original sale");
    expect(html).toContain("Return + refund");
    expect(html).toContain("Refund only");
    expect(html).toContain("Available stock");
    expect(html).toContain("Not applicable");
    expect(html).toMatch(/MoMo.*card.*bank.*processing|provider.*confirm/i);
    expect(html).toContain("Process return / refund");
  });

  it("maps rejected or pending sync outcomes to truthful business copy", async () => {
    const module = await loadSheet();
    expect(module?.returnSyncMessage).toBeTypeOf("function");
    if (!module?.returnSyncMessage) return;
    expect(module.returnSyncMessage({ rejected: 1, received: 0, applied: 0 })).toMatch(/review/i);
    expect(module.returnSyncMessage({ rejected: 0, received: 1, applied: 0 })).toMatch(/pending|queued|sync/i);
    expect(module.returnSyncMessage({ rejected: 0, received: 0, applied: 1 })).toMatch(/applied|processing|provider/i);
  });
});


describe("ReturnRefundSheet evidence and consequence hierarchy", () => {
  const baseProps = {
    sale, open: true, drafts: { l1: { selected: true, quantity: "1", disposition: "RESTOCK" } },
    refundMethod: "ORIGINAL_METHOD", reason: "Customer return", busy: false,
    refundPreviewMinor: 15000, selectedLineCount: 1,
    onClose: () => undefined, onModeChange: () => undefined, onRefundMethodChange: () => undefined,
    onReasonChange: () => undefined, onDraftChange: () => undefined, onSubmit: () => undefined,
  };

  it("presents the original receipt as immutable evidence before correction controls", async () => {
    const module = await loadSheet();
    expect(module?.ReturnRefundSheet).toBeTypeOf("function");
    if (!module?.ReturnRefundSheet) return;
    const html = renderToStaticMarkup(React.createElement(module.ReturnRefundSheet, { ...baseProps, mode: "RETURN_REFUND" }));
    expect(html).toContain("return-original-evidence");
    expect(html).toContain("Posted receipt · read only");
    expect(html).toContain("This correction will be linked to the original sale");
    expect(html).toContain("Stock outcome");
    expect(html).toContain("Refund outcome");
  });

  it("makes refund-only stock behavior explicit, marks reason required, and uses refund-only action copy", async () => {
    const module = await loadSheet();
    expect(module?.ReturnRefundSheet).toBeTypeOf("function");
    if (!module?.ReturnRefundSheet) return;
    const html = renderToStaticMarkup(React.createElement(module.ReturnRefundSheet, { ...baseProps, mode: "REFUND_ONLY", reason: "" }));
    expect(html).toContain("Stock unchanged");
    expect(html).toContain("No stock return");
    expect(html).toMatch(/Reason[^<]*<input[^>]*required/);
    expect(html).toContain("Process refund only");
  });

  it("keeps prepared products on discard/waste rather than available stock", async () => {
    const module = await loadSheet();
    expect(module?.ReturnRefundSheet).toBeTypeOf("function");
    if (!module?.ReturnRefundSheet) return;
    const preparedSale = { ...sale, lines: [{ ...sale.lines[0], id: "prep-1", itemKind: "PREPARED_PRODUCT", itemName: "Prepared meal" }] };
    const html = renderToStaticMarkup(React.createElement(module.ReturnRefundSheet, {
      ...baseProps,
      sale: preparedSale,
      drafts: { "prep-1": { selected: true, quantity: "1", disposition: "DISCARD" } },
      mode: "RETURN_REFUND",
    }));
    expect(html).toContain("Discard / waste");
    expect(html).not.toContain("Available stock</option>");
  });
});
