import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const read=(path:string)=>readFileSync(fileURLToPath(
  new URL(path,import.meta.url)),"utf8");
const ui=read("./document-delivery-panel.tsx");
const css=read("./document-delivery-panel.module.css");
const po=read("../../(workspace)/purchase-orders/[orderId]/page.tsx");
const commercial=read("../../(workspace)/documents/[documentId]/page.tsx");

describe("document delivery UX safety contracts",()=>{
  it("renders only on issued purchase orders and issued quotations/proformas",()=>{
    expect(po).toContain('kind="PURCHASE_ORDER"');
    expect(commercial).toContain('kind="COMMERCIAL_DOCUMENT"');
    expect(po).toContain('order.status==="ISSUED"');
    expect(commercial).toContain('document.status==="ISSUED"');
    expect(ui).toContain('props.status!=="ISSUED"');
  });
  it("requires recipient review and documents contact address overrides",()=>{
    expect(ui).toContain("recipientConfirmed:true");
    expect(ui).toContain("recipientOverrideReason:reason.trim()");
    expect(ui).toContain("reason.trim().length<12");
    expect(ui).toContain("I checked this address");
  });
  it("does not claim inbox delivery from mail-server acceptance",()=>{
    expect(ui).toContain("Recipient inbox delivery is not confirmed.");
    expect(ui).toContain("Accepted by mail server — delivery not confirmed");
    expect(ui).toContain("Manual review required — do not resend");
    expect(ui).toContain("WhatsApp delivery is");
    expect(ui).not.toContain('status:"DELIVERED"');
  });
  it("keeps all printouts free from merchant dispatch controls",()=>{
    expect(css).toContain("@media print");
    expect(css).toContain("display:none!important");
    expect(ui).toContain("Only an owner"); // protected copy
  });
});
