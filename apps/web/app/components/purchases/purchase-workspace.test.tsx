import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

async function loadWorkspace() {
  const modulePath = "./purchase-workspace";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const purchases = [
  { id: "p1", supplierId: "s1", supplierName: "Accra Supplies", supplierReference: "INV-404", totalMinor: 25000, currencyCode: "GHS", receivedAt: "2026-10-08T09:00:00.000Z", receiverName: "Ama", lineCount: 1, settlementMethod: "BANK" },
  { id: "p2", supplierId: "s2", supplierName: "Tema Wholesale", supplierReference: null, totalMinor: 10000, currencyCode: "GHS", receivedAt: "2026-10-07T09:00:00.000Z", receiverName: "Yaw", lineCount: 2, settlementMethod: "SUPPLIER_CREDIT" },
];

describe("PurchaseWorkspace", () => {
  it("filters receipt history by supplier/reference/payment text", async () => {
    const module = await loadWorkspace();
    expect(module?.filterPurchases).toBeTypeOf("function");
    if (!module?.filterPurchases) return;
    expect(module.filterPurchases(purchases, "inv-404").map((item: { id: string }) => item.id)).toEqual(["p1"]);
    expect(module.filterPurchases(purchases, "supplier credit").map((item: { id: string }) => item.id)).toEqual(["p2"]);
  });

  it("renders professional immutable history rows with open-receipt actions", async () => {
    const module = await loadWorkspace();
    expect(module?.PurchaseWorkspace).toBeTypeOf("function");
    if (!module?.PurchaseWorkspace) return;
    const html = renderToStaticMarkup(React.createElement(module.PurchaseWorkspace, { purchases, loadingId: null, onOpen: () => undefined }));
    for (const text of ["Search purchases", "Recent purchases", "Accra Supplies", "Tema Wholesale", "Open receipt", "Supplier Credit"]) expect(html).toContain(text);
    expect(html).not.toMatch(/Edit purchase|Delete purchase/);
  });

  it("uses canonical Z.ai command, mobile-record and state primitives", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const source = fs.readFileSync(path.join(root, "components", "purchases", "purchase-workspace.tsx"), "utf8");
    for (const contract of ["CommandBar", "MobileRecordCard", "StatePanel", "StatusBadge"]) expect(source).toContain(contract);
    expect(source).toContain("purchase-history-row--desktop");
    expect(source).toContain("purchase-history-row--mobile");
  });

  it("replaces the monolithic receipt/history implementation while preserving purchase returns", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const source = fs.readFileSync(path.join(root, "components", "purchases-inventory.tsx"), "utf8");
    expect(source).toContain("PurchaseReceiptBuilder");
    expect(source).toContain("PurchaseWorkspace");
    expect(source).toContain("PurchaseDetailSheet");
    expect(source).toContain("PurchaseReturnSheet");
    const returnSource = fs.readFileSync(path.join(root, "components", "purchases", "purchase-return-sheet.tsx"), "utf8");
    expect(returnSource).toContain("PURCHASE_RETURN_CREATE");
    expect(source).not.toMatch(/function PurchaseReceipt\(/);
    expect(source).not.toMatch(/function RecentPurchases\(/);
  });
});
