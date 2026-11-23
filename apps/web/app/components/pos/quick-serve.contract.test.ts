import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source=(relative:string)=>readFileSync(fileURLToPath(new URL(relative,import.meta.url)),"utf8");
const pos=source("./pos-workspace.tsx");
const checkout=source("./checkout-sheet.tsx");
const quick=source("./quick-serve.tsx");
const css=source("./quick-serve.module.css");
describe("fast-queue POS risk controls",()=>{
  it("keeps the standard POS and allows a branch-specific remembered Quick Serve mode",()=>{
    expect(pos).toContain("Standard POS");
    expect(pos).toContain("Quick Serve · food & queues");
    expect(pos).toContain("tradeos.pos.quick-mode.v1:");
    expect(pos).toContain("disabled={lines.length>0||checkoutOpen}");
    expect(pos).toContain("<QuickServe");
    expect(pos).toContain("<CheckoutSheet");
    expect(pos).toContain("quickServe={quickMode}");
  });
  it("requires an explicit collected cash click, not an automatic payment",()=>{
    expect(checkout).toContain("Cash paid · Save ");
    expect(checkout).toContain("onClick={()=>void handleCharge(true)}");
    expect(checkout).toContain("const exactMode = exactCash && canQuickCash;");
    expect(checkout).toContain('paymentMethod==="CASH"');
    expect(checkout).toContain("quoteReady&&approvalValid");
    expect(checkout).toContain("!hubtelSelected");
    expect(checkout).toContain("submittingRef.current");
  });
  it("reuses the single canonical SALE_CREATE mutation and authoritative server quote",()=>{
    expect(checkout).toContain("buildSaleCreatePayload(");
    expect(checkout).toContain('mutationType: "SALE_CREATE"');
    expect(checkout).toContain('queue.authenticatedFetch("/v1/sync"');
    expect(checkout).toContain('mr.status === "REJECTED"');
    expect(checkout).toContain('mr.status === "RECEIVED"');
    expect(checkout).toContain('resultData?.status!=="COMPLETED"');
    expect(checkout).toContain("onComplete();");
    expect(checkout).toContain("if (exactMode) {");
    expect(checkout).toContain("await queue.enqueue(mutation)");
    expect(checkout).toContain("if (!stored) throw new Error");
  });
  it("does not fake MoMo or credit confirmations; full checkout is still accessible",()=>{
    expect(checkout).toContain("Customer gave different cash / MoMo / credit / print receipt");
    expect(checkout).toContain("setQuickManual(true)");
    expect(checkout).toContain("hubtelSelected");
    expect(checkout).toContain("AWAITING_PAYMENT");
    expect(checkout).toContain("pricing/quote");
  });
  it("supports responsive tap tiles, pinned favorites, and a mobile fixed total",()=>{
    expect(quick).toContain("quickServeStorageKey");
    expect(quick).toContain("cleanQuickServeFavourites");
    expect(quick).toContain("quickServeGroups");
    expect(quick).toContain("View / edit order");
    expect(quick).toContain('aria-label="Quick product buttons"');
    expect(quick).toContain("No customer registration needed.");
    expect(css).toContain("min-height:67px");
    expect(css).toContain(".portions");
    expect(quick).toContain("styles.groupWide");
    expect(css).toContain(".groupWide {grid-column:span 2}");
    expect(css).toContain(".groupWide .portions {grid-template-columns:repeat(3");
    expect(css).toContain("position:fixed;bottom:0");
    expect(css).toContain('data-expanded="true"');
  });
  it("provides a clear menu setup state and no fabricated sales products",()=>{
    expect(quick).toContain("Set up your menu once.");
    expect(quick).toContain('href="/catalog"');
    expect(quick).toContain("disabled={soldOut}");
    expect(quick).toContain("onPick(item)");
  });
});
