import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const load=(file:string)=>readFileSync(fileURLToPath(
  new URL(file,import.meta.url)),"utf8");
const css=load("../../workspace-shell.css");
const saleCss=load("../../(workspace)/sales/receipt/[saleId]/receipt.module.css");
const quoteCss=load("../../(workspace)/documents/[documentId]/document.module.css");
const poCss=load("../../(workspace)/purchase-orders/[orderId]/purchase-order-preview.module.css");
const sale=load("../../(workspace)/sales/receipt/[saleId]/page.tsx");
const quote=load("../../(workspace)/documents/[documentId]/page.tsx");
const po=load("../../(workspace)/purchase-orders/[orderId]/page.tsx");
const detail=load("../sales/sale-detail-sheet.tsx");
const checkout=load("../pos/checkout-sheet.tsx");

describe("document printing after blank-preview regression",()=>{
  it("removes navigation grid instead of invisibly retaining print ancestors",()=>{
    expect(css).toContain(".tos-shell:has(.tos-print-document)");
    expect(css).toContain("display: block !important;");
    expect(css).toContain(".tos-sidebar,");
    expect(css).toContain(".tos-topbar,");
    expect(css).toContain("display: none !important;");
    expect(css).toContain("overflow: visible !important;");
  });
  it("keeps all document content in normal print page flow",()=>{
    for(const value of [saleCss,quoteCss,poCss]){
      expect(value).not.toMatch(/visibility\s*:\s*hidden/i);
      expect(value).not.toMatch(/position\s*:\s*(?:fixed|absolute)/i);
    }
    expect(saleCss).toContain("position: static");
    expect(quoteCss).toContain("page-break-inside:auto");
    expect(poCss).toContain("overflow:visible");
    for(const value of [sale,quote,po]){
      expect(value).toContain("tos-print-document");
      expect(value).toContain("window.print()");
    }
  });
  it("opens receipts in the same window, avoiding blocked popup tabs",()=>{
    expect(detail).toContain("window.location.assign(path)");
    expect(checkout).toContain("window.location.assign(path)");
    expect(detail).not.toContain('window.open(path, "_blank"');
    expect(checkout).not.toContain('window.open(path, "_blank"');
  });
  it("retains print access after refunds and labels refunds accurately",()=>{
    expect(detail).toContain('"PARTIALLY_REFUNDED","REFUNDED"');
    expect(sale).toContain("SALE REFUNDED");
    expect(sale).toContain("PARTIALLY REFUNDED");
  });
});
