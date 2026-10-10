import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadSheet() {
  const modulePath = "./purchase-return-sheet";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const purchase = {
  id: "p1", supplierId: "s1", supplierName: "Accra Supplies", supplierReference: "INV-404",
  totalMinor: 25000, currencyCode: "GHS", receivedAt: "2026-10-08T09:00:00.000Z", receiverName: "Ama", lineCount: 1, settlementMethod: "BANK",
};

describe("PurchaseReturnSheet", () => {
  it("is a canonical accessible purchase-correction dialog backed by the durable mutation", async () => {
    const module = await loadSheet();
    expect(module?.PurchaseReturnSheet).toBeTypeOf("function");
    if (!module?.PurchaseReturnSheet) return;
    const html = renderToStaticMarkup(React.createElement(module.PurchaseReturnSheet, {
      businessId: "b1", branchId: "br1", purchase, onClose: () => undefined, onMessage: () => undefined,
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Purchase return");
    expect(html).toContain("Accra Supplies");
  });

  it("keeps the server/offline correction contract and no legacy generic button classes", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const sourcePath = path.join(root, "purchase-return-sheet.tsx");
    expect(fs.existsSync(sourcePath)).toBe(true);
    if (!fs.existsSync(sourcePath)) return;
    const source = fs.readFileSync(sourcePath, "utf8");
    expect(source).toContain('mutationType: "PURCHASE_RETURN_CREATE"');
    expect(source).toContain("enqueueMutation");
    expect(source).toContain("flushPendingMutations");
    expect(source).not.toContain('className="primary-button"');
    expect(source).not.toContain('className="ghost-button"');
  });
});
