import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ui=readFileSync(fileURLToPath(new URL("./supplier-document-delivery.tsx",import.meta.url)),"utf8");
const styles=readFileSync(fileURLToPath(new URL("./supplier-document-delivery.module.css",import.meta.url)),"utf8");
const purchaseOrder=readFileSync(fileURLToPath(
  new URL("../../(workspace)/purchase-orders/[orderId]/page.tsx",import.meta.url)),"utf8");

describe("purchase order supplier delivery UX",()=>{
  it("requires explicit recipient and supplier-expectation confirmation",()=>{
    expect(ui).toContain("confirmedRecipients[row.id]");
    expect(ui).toContain("confirmedConsent[row.id]");
    expect(ui).toContain("I verified this supplier email address is correct");
    expect(ui).toContain("I confirm this supplier expects this purchasing message");
    expect(ui).toContain("Authorize email send");
    expect(ui).toContain("!email?.ready");
    expect(ui).toContain('["OWNER","ADMIN","MANAGER"]');
  });
  it("shows actual provider acceptance, never claims inbox delivery",()=>{
    expect(ui).toContain("Accepted by email provider");
    expect(ui).toContain("This does not guarantee inbox delivery");
    expect(ui).toContain("does not prove delivery");
    expect(ui).toContain("Manual copy");
    expect(ui).toContain("not counted as a sent message");
    expect(ui).toContain("Copy for manual sharing");
    expect(ui).toContain("WhatsApp provider sending is not connected");
  });
  it("requires non-receipt confirmation and limits retry after SMTP ambiguity",()=>{
    expect(ui).toContain("confirmedNoDelivery[row.id]");
    expect(ui).toContain("I checked with the supplier and confirmed non-receipt");
    expect(ui).toContain('row.status==="REVIEW_REQUIRED"');
    expect(ui).toContain("row.attemptCount<3");
    expect(ui).toContain("Authorize retry");
    expect(ui).toContain("supplier");
  });
  it("mounts only on issued purchase orders and excludes the widget from print",()=>{
    expect(purchaseOrder).toContain("<SupplierDocumentDelivery");
    expect(purchaseOrder).toContain('order.status==="ISSUED"');
    expect(styles).toContain("@media print{.shell{display:none!important}}");
    expect(styles).toContain("grid-template-columns:minmax(0,1fr)");
  });
});
