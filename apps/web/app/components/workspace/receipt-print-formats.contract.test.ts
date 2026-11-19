import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const source=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
const css=source("../../(workspace)/sales/receipt/[saleId]/receipt.module.css");
const receipt=source("../../(workspace)/sales/receipt/[saleId]/page.tsx");
const sale=source("../sales/sale-detail-sheet.tsx");
const checkout=source("../pos/checkout-sheet.tsx");
const api=source("../../../../api/src/sales-read.ts");

describe("A5 and thermal sales receipt print and share contracts",()=>{
  it("offers A5, 80mm and 58mm physical print pages",()=>{
    expect(css).toContain("@page receiptA5 { size: A5 portrait;");
    expect(css).toContain("@page receipt80 { size: 80mm 210mm;");
    expect(css).toContain("@page receipt58 { size: 58mm 210mm;");
    expect(css).not.toContain("width: 76mm");
    expect(css).toContain(".paperA5");
    expect(css).toContain(".paper80");
    expect(css).toContain(".paper58");
    expect(css).toContain("break-inside: avoid;");
    expect(receipt).toContain("RECEIPT_PAPER_OPTIONS");
    expect(receipt).toContain("saveReceiptPaper");
    expect(receipt).toContain("window.print()");
  });
  it("shares a verified PDF file instead of only text",()=>{
    expect(receipt).toContain("shareVerifiedReceiptPdf(");
    expect(receipt).toContain("downloadVerifiedReceiptPdf(");
    expect(sale).toContain("shareVerifiedReceiptPdf(");
    expect(checkout).toContain("shareVerifiedReceiptPdf(");
    expect(sale).not.toContain("text: `Receipt ${saleId}`");
    expect(checkout).not.toContain("text: `Receipt ${result?.reference");
  });
  it("keeps receipt generation tenant-scoped and forbids pending payments",()=>{
    expect(api).toContain('"/v1/sales/:saleId/receipt.pdf"');
    expect(api).toContain('await requireBusinessRole(pool,auth,businessId,READ_ROLES)');
    expect(api).toContain('WHERE s.id=$1 AND s.business_id=$2');
    expect(api).toContain('payments.rows.some(p=>p.status==="PENDING")');
    expect(api).toContain('renderVerifiedSaleReceiptPdf(snapshot,paper)');
    expect(api).toContain('"Cache-Control","private, no-store"');
  });
});
