import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const file=(rel:string)=>readFileSync(
  fileURLToPath(new URL(rel,import.meta.url)),"utf8");
const assistant=file("./voice-purchase-order-assistant.tsx");
const order=file("./purchase-order-workspace.tsx");
const parser=file("../../../lib/voice-purchase-order-correction.ts");
const css=file("./voice-purchase-order-assistant.module.css");
describe("human-confirmed purchase-order voice corrections",()=>{
  it("separates spoken corrections from original purchase-order dictation",()=>{
    expect(assistant).toContain('start("correction")');
    expect(assistant).toContain("setCorrectionText(next.slice(0,500))");
    expect(assistant).toContain('start("order")');
    expect(assistant).toContain("Prepare correction for review");
    expect(assistant).toContain("Confirm change to draft only");
    expect(assistant).toContain("parseVoicePOCorrection(correctionText,rows.length)");
  });
  it("rejects old corrections and resets final review",()=>{
    expect(assistant).toContain("correctionSnapshot!==draftSnapshot()");
    expect(assistant).toContain("correctionTargetKey");
    expect(assistant).toContain("setReviewed(false)");
    expect(assistant).toContain("disabled={!valid||!reviewed||Boolean(correction)}");
    expect(assistant).toContain("if(!valid||!reviewed||correction)return");
  });
  it("requires active supplier, catalog replacement and purchasing-unit choices",()=>{
    expect(assistant).toContain("searchPosCatalog(correctionCatalog,next.itemQuery,12)");
    expect(assistant).toContain("Select the exact purchasable item");
    expect(assistant).toContain("Select the saved active supplier");
    expect(assistant).toContain("Choose purchasing unit");
    expect(assistant).toContain("purchasableUnits(item).some");
    expect(assistant).toContain("s.id===correctionSupplierId&&s.active");
    expect(assistant).toContain("costMinor:null,");
    expect(assistant).toContain('quantity:"1",costMinor:null');
    expect(assistant).toContain('if(supplier.id!==supplierId)setRows');
  });
  it("does not post purchases, issue orders, pay, or receive by voice",()=>{
    expect(parser).toContain("Voice cannot pay, receive stock, issue or approve orders");
    expect(assistant).not.toContain("authenticatedFetch");
    expect(order).toContain('onClick={()=>void create()}');
    expect(order).toContain('onClick={()=>void transition(order,"issue")}');
    expect(css).toContain("@media(max-width:440px)");
    expect(assistant).toContain('role="dialog" aria-modal="true"');
  });
});
