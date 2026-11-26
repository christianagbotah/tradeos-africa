import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const source=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
const css=source("../../(workspace)/sales/receipt/[saleId]/receipt.module.css");
const receipt=source("../../(workspace)/sales/receipt/[saleId]/page.tsx");
const sale=source("../sales/sale-detail-sheet.tsx");
const checkout=source("../pos/checkout-sheet.tsx");
const api=source("../../../../api/src/sales-read.ts");
const workspaceCss=source("../../workspace-shell.css");
const pdfSource=source("../../../../api/src/sale-receipt-pdf.ts");

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
  it("shows mobile icon controls with accessible labels and preserves A5 printing",()=>{
    expect(receipt).toContain('aria-label="Print receipt"');
    expect(receipt).toContain('aria-label="Download receipt PDF"');
    expect(receipt).toContain('aria-label="Share receipt PDF"');
    expect(receipt).toContain('className={styles.actionButtons}');
    expect(css).toContain('.actionLabel { display: none; }');
    expect(css).toContain('.actionButtons button {');
    expect(css).toContain('width: 42px');
    expect(sale).toContain('aria-label="View or print receipt"');
    expect(sale).toContain('aria-label="Process return"');
    expect(sale).toContain('aria-label="Close sale detail"');
    expect(workspaceCss).toContain('.tos-sale-detail-actions .tos-sale-action__label { display: none; }');
  });
  it("isolates sales line-item cards from purchase editor styles",()=>{
    expect(sale).toContain('className="tos-sale-items"');
    expect(sale).toContain('className="tos-sale-item"');
    expect(sale).toContain('className="tos-sale-item__name"');
    expect(sale).not.toContain('className="tos-receipt-line"');
    expect(workspaceCss).toContain('.tos-sale-item__name {');
    expect(workspaceCss).toContain('white-space: normal;');
    expect(workspaceCss).toContain('overflow-wrap: anywhere;');
    expect(workspaceCss).toContain('.tos-sale-item__amount {');
  });
  it("keeps thermal receipt name, quantity, @ and price aligned in a single row",()=>{
    expect(receipt).toContain('className={styles.thermalCompactRow}');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) auto auto;');
    expect(pdfSource).toContain('const qtyText=l.quantity.toLocaleString("en-GH")+" × "+l.unitCode+" @";');
    expect(pdfSource).toContain('if(measured.sum<=content)');
  });
  it("keeps receipt generation tenant-scoped and forbids pending payments",()=>{
    expect(api).toContain('"/v1/sales/:saleId/receipt.pdf"');
    expect(api).toContain('const access=await requireBusinessRole(pool,auth,businessId,RECEIPT_ROLES)');
    expect(api).toContain('s.cashier_staff_id=$3::uuid');
    expect(api).toContain('[saleId,businessId,ownedStaffId]');
    expect(api).toContain('WHERE s.id=$1 AND s.business_id=$2');
    expect(api).toContain('payments.rows.some(p=>p.status==="PENDING")');
    expect(api).toContain('renderVerifiedSaleReceiptPdf(snapshot,paper)');
    expect(api).toContain('"Cache-Control","private, no-store"');
  });
});
