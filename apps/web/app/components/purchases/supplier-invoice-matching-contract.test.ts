import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const ui=readFileSync(fileURLToPath(new URL("./supplier-invoice-matching.tsx",import.meta.url)),"utf8");
const css=readFileSync(fileURLToPath(new URL("./supplier-invoice-matching.module.css",import.meta.url)),"utf8");
const preview=readFileSync(fileURLToPath(new URL("../../(workspace)/purchase-orders/[orderId]/page.tsx",import.meta.url)),"utf8");
const api=readFileSync(fileURLToPath(new URL("../../../../api/src/supplier-invoice-matches.ts",import.meta.url)),"utf8");
describe("supplier invoice match UI and accounting contract",()=>{
  it("matches posted receipts only, exposes actual invoice comparison and keeps signed differences",()=>{
    expect(ui).toContain("Select");
    expect(ui).toContain("invoiceTotalMinor-receiptTotal");
    expect(ui).toContain("poPriceVarianceMinor");
    expect(ui).toContain("supplier invoice total");
    expect(ui).toContain("selectedReceipts.map(r=>r.id)");
    expect(ui).toContain('m.status!=="CANCELLED"');
    expect(ui).toContain("claimed.has(r.id)");
    expect(ui).toContain("Use receipt total");
    expect(ui).toContain("No automatic tax posting occurs");
  });
  it("requires a manager reason for approval with differences and isolates print preview",()=>{
    expect(ui).toContain('APPROVE_ROLES=["OWNER","ADMIN","MANAGER"]');
    expect(ui).toContain("match.hasException&&approvalNote.length<12");
    expect(ui).toContain('action==="approve"?{approvalNote}');
    expect(ui).toContain("onClick={()=>void transition(m,\"approve\")}");
    expect(css).toContain("@media print{.workspace{display:none!important}}");
    expect(preview).toContain("<SupplierInvoiceMatching");
    expect(preview).toContain('order.receiptCount>0 && order.status!=="DRAFT"');
    expect(preview).toContain('onUpdated={refetch}');
  });
  it("captures invoice item quantities and costs with non-wrapping responsive columns",()=>{
    expect(ui).toContain("Supplier invoice item lines");
    expect(ui).toContain("invoice-item-preview");
    expect(ui).toContain("invoiceLines,notes");
    expect(ui).toContain("invoiceItemSubtotalMinor");
    expect(ui).toContain("invoiceAdjustmentMinor");
    expect(ui).toContain("lineDifferences");
    expect(ui).toContain("invoiceItemLines.map");
    expect(ui).toContain("Invoice quantity for");
    expect(ui).toContain("Invoice unit cost for");
    expect(css).toContain("min-width:940px");
    expect(css).toContain("overflow-x:auto");
    expect(css).toContain("grid-template-columns:");
  });
  it("keeps invoice evidence private and allows draft-only file replacement",()=>{
    expect(ui).toContain("Private invoice attachments");
    expect(ui).toContain("application/pdf,image/png,image/jpeg");
    expect(ui).toContain("FileReader");
    expect(ui).toContain("downloadEvidence(m.id,file)");
    expect(ui).toContain('method:"DELETE"');
    expect(ui).toContain('m.status==="DRAFT"&&canCreate');
    expect(ui).toContain("file.size>3*1024*1024");
    expect(api).toContain("EVIDENCE_MAX_BYTES=3*1024*1024");
    expect(api).toContain('header("Cache-Control","private, no-store")');
    expect(api).toContain('header("Content-Disposition"');
    expect(api).toContain("INVOICE_EVIDENCE_DRAFT_ONLY");
    expect(api).not.toMatch(/\/v1\/media\/.*evidence/);
  });
  it("has no direct payable or stock posting in supplier invoice match API",()=>{
    expect(api).toContain('status="APPROVED"'.replace('status="APPROVED"',"status='APPROVED'"));
    expect(api).toContain("A manager justification of at least 12 characters");
    expect(api).not.toMatch(/INSERT INTO (supplier_payable_ledger|inventory_movements|cashbook_entries)/);
    expect(api).toContain("purchase_order_id=$3 AND status='RECEIVED'");
    expect(api).toContain("INVOICE_MATCH_RECEIPT_CLAIMED");
  });
});
