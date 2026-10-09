import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

  it("uses canonical TradeOS tokens and touch-safe responsive return styling", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readFileSync(path.join(appRoot, "returns.css"), "utf8");
    for (const legacy of ["var(--line)", "var(--muted)", "var(--brand)", "var(--ink)", "var(--surface-soft)"]) expect(css).not.toContain(legacy);
    expect(css).toMatch(/return-[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*767px/);
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
