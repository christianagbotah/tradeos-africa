import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CartLine, PosSellableItem } from "../pos/pos-model";

async function loadSheet() {
  const modulePath = "./exchange-sheet";
  try { return await import(/* @vite-ignore */ modulePath); } catch { return null; }
}

const sale = {
  id: "22222222-2222-4222-8222-222222222222", businessId: "b1", branchId: "br1", status: "COMPLETED", currencyCode: "GHS", totalMinor: 3000,
  completedAt: "2026-10-08T10:00:00.000Z", createdAt: "2026-10-08T09:59:00.000Z", customer: null, cashierName: "Yaw",
  lines: [
    { id: "l1", itemId: "i1", itemName: "Malt", itemKind: "PRODUCT", quantity: 2, quantityReturned: 0, quantityReturnable: 2, saleUnitCode: "bottle", unitNetMinor: 1500, unitTaxMinor: 0, lineTotalMinor: 3000 },
  ],
  payments: [{ id: "p1", method: "CASH", amountMinor: 3000, refundedMinor: 0, status: "SUCCEEDED", providerReference: null }],
};

const catalog: PosSellableItem[] = [
  { key: "i2:piece", itemId: "i2", name: "Premium Malt", sku: "PM-1", kind: "PRODUCT", unitCode: "piece", unitLabel: "Piece", priceMinor: 2200, trackStock: true, stockUnitCode: "piece" },
  { key: "i2:case", itemId: "i2", name: "Premium Malt", sku: "PM-1", kind: "PRODUCT", unitCode: "case", unitLabel: "Case", priceMinor: 24000, trackStock: true, stockUnitCode: "piece" },
  { key: "svc:service", itemId: "svc", name: "Delivery", sku: null, kind: "SERVICE", unitCode: "service", unitLabel: "Service", priceMinor: 500, trackStock: false, stockUnitCode: null },
];

const cart: CartLine[] = [{ key: "i2:piece", itemId: "i2", name: "Premium Malt", saleUnitCode: "piece", saleUnitLabel: "Piece", priceMinor: 2200, quantity: 2 }];

describe("ExchangeSheet", () => {
  it("builds a server-authoritative exchange payload without client price or customer fields", async () => {
    const module = await loadSheet();
    expect(module?.buildExchangePayload).toBeTypeOf("function");
    if (!module?.buildExchangePayload) return;
    const payload = module.buildExchangePayload(sale, {
      reason: "Customer changed product",
      settlementMethod: "CASH",
      returned: { l1: { selected: true, quantity: "1", disposition: "RESTOCK" } },
      cart,
    });
    expect(payload).toEqual({
      originalSaleId: sale.id,
      reason: "Customer changed product",
      settlementMethod: "CASH",
      returnedLines: [{ saleLineId: "l1", quantity: 1, disposition: "RESTOCK" }],
      replacementLines: [{ itemId: "i2", saleUnitCode: "piece", quantity: 2 }],
    });
    expect(JSON.stringify(payload)).not.toMatch(/priceMinor|customerId|unitNetMinor|lineTotalMinor/);
  });

  it("computes a display-only difference preview for customer pays, receives and even exchanges", async () => {
    const module = await loadSheet();
    expect(module?.exchangePreview).toBeTypeOf("function");
    if (!module?.exchangePreview) return;
    expect(module.exchangePreview(sale, { l1: { selected: true, quantity: "1", disposition: "RESTOCK" } }, cart)).toMatchObject({ returnedMinor: 1500, replacementMinor: 4400, netDifferenceMinor: 2900, label: "Customer pays" });
    const cheaper: CartLine[] = [{ ...cart[0]!, priceMinor: 500, quantity: 1 }];
    expect(module.exchangePreview(sale, { l1: { selected: true, quantity: "1", disposition: "RESTOCK" } }, cheaper)).toMatchObject({ netDifferenceMinor: -1000, label: "Customer receives" });
    const even: CartLine[] = [{ ...cart[0]!, priceMinor: 1500, quantity: 1 }];
    expect(module.exchangePreview(sale, { l1: { selected: true, quantity: "1", disposition: "RESTOCK" } }, even)).toMatchObject({ netDifferenceMinor: 0, label: "No difference" });
  });

  it("renders return selection, replacement cart, walk-in context, settlement controls and authoritative pricing guidance", async () => {
    const module = await loadSheet();
    expect(module?.ExchangeSheet).toBeTypeOf("function");
    if (!module?.ExchangeSheet) return;
    const html = renderToStaticMarkup(React.createElement(module.ExchangeSheet, {
      open: true,
      sale,
      catalog,
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      onClose: () => undefined,
      onMessage: () => undefined,
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    for (const text of ["Exchange items", "Walk-in customer", "Items coming back", "Replacement items", "Search replacements", "Premium Malt", "Difference preview", "Settlement method", "Reason", "TradeOS confirms current prices", "Process exchange"]) expect(html).toContain(text);
    expect(html).toMatch(/Decrease|Increase|Remove/i);
    expect(html).not.toMatch(/Edit original sale|Change original price|Save receipt/);
  });

  it("renders the linked replacement receipt, return correction and provider-processing state after apply", async () => {
    const module = await loadSheet();
    expect(module?.ExchangeLinkedResult).toBeTypeOf("function");
    if (!module?.ExchangeLinkedResult) return;
    const html = renderToStaticMarkup(React.createElement(module.ExchangeLinkedResult, { result: {
      exchangeCaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      originalSaleId: sale.id,
      returnCaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      replacementSaleId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      returnTotalMinor: 1500,
      replacementTotalMinor: 2200,
      netDifferenceMinor: 700,
      status: "PROCESSING",
    } }));
    for (const text of ["Exchange linked", "Replacement receipt", "Return correction", "PROCESSING", "CCCCCCCC", "BBBBBBBB"]) expect(html).toContain(text);
    expect(html).toMatch(/provider|processing|confirmation/i);
  });

  it("uses one durable EXCHANGE_CREATE mutation and keeps external provider outcomes pending/reviewable", () => {
    const sourcePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "exchange-sheet.tsx");
    expect(fs.existsSync(sourcePath)).toBe(true);
    if (!fs.existsSync(sourcePath)) return;
    const source = fs.readFileSync(sourcePath, "utf8");
    expect(source).toContain("EXCHANGE_CREATE");
    expect(source).toContain("enqueueMutation");
    expect(source).toContain("flushPendingMutations");
    expect(source).toContain("navigator.onLine");
    expect(source).toMatch(/needs review|pending synchronization/i);
    expect(source).not.toContain('mutationType: "RETURN_CREATE"');
    expect(source).not.toContain('mutationType: "SALE_CREATE"');
  });

  it("keeps phone exchange controls at 48px and integrates the catalog projection into the routes", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readFileSync(path.join(appRoot, "tradeos-app.css"), "utf8");
    const salesPage = fs.readFileSync(path.join(appRoot, "(workspace)", "sales", "page.tsx"), "utf8");
    const returnsPage = fs.readFileSync(path.join(appRoot, "(workspace)", "returns", "page.tsx"), "utf8");
    expect(css).toMatch(/exchange-[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/exchange-[\s\S]*font-size:\s*15px/);
    expect(salesPage).toContain("sellableItems");
    expect(returnsPage).toContain("sellableItems");
  });
});
