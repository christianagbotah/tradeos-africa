import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe,it,expect} from "vitest";
const file=(path:string)=>readFileSync(
  fileURLToPath(new URL(path,import.meta.url)),"utf8");
const order=file("./purchase-order-workspace.tsx");
const assistant=file("./voice-purchase-order-assistant.tsx");
const css=file("./voice-purchase-order-assistant.module.css");
describe("review-first spoken purchase orders",()=>{
  it("opens beside existing purchase order form without bypassing user permissions",()=>{
    expect(order).toContain("🎙 Speak an order");
    expect(order).toContain("voiceOpen&&canWrite");
    expect(order).toContain("<VoicePurchaseOrderAssistant");
    expect(order).toContain("setLines(reviewed.map(");
    expect(order).toContain("Replace the current order items and supplier");
    expect(order).toContain('onClick={()=>void create()}');
    expect(order).toContain('onClick={()=>void transition(order,"issue")}');
  });
  it("requires supplier, purchasing unit, cost and review before copying",()=>{
    expect(assistant).toContain("suppliers.some(s=>s.id===supplierId&&s.active)");
    expect(assistant).toContain("purchasableUnits(item).some");
    expect(assistant).toContain("row.costMinor!==null");
    expect(assistant).toContain("setReviewed(false)");
    expect(assistant).toContain("disabled={!valid||!reviewed}");
    expect(assistant).toContain("Use reviewed details in order form");
    expect(assistant).toContain("does not save, issue");
    expect(assistant).toContain('label="Supplier unit cost · required"');
  });
  it("has non-posting, accessible, responsive voice and manual fallbacks",()=>{
    expect(assistant).not.toContain("authenticatedFetch");
    expect(assistant).not.toContain("SALE_CREATE");
    expect(assistant).not.toContain("PURCHASE_RECEIVE_CREATE");
    expect(assistant).toContain('role="dialog" aria-modal="true"');
    expect(assistant).toContain("Type the order instead");
    expect(assistant).toContain('type="search"');
    expect(css).toContain("@media(max-width:760px)");
    expect(css).toContain("overflow-y:auto");
  });
});
