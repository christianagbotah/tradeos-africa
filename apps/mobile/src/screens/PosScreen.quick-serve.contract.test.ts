import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source=readFileSync(resolve(__dirname,"PosScreen.tsx"),"utf8");
const model=readFileSync(resolve(__dirname,"../pos-model.ts"),"utf8");
const appModel=readFileSync(resolve(__dirname,"../app-model.ts"),"utf8");

describe("native food vendor quick-sale UX",()=>{
  it("offers Standard POS and Quick Serve without replacing the existing POS",()=>{
    expect(source).toContain("Standard POS");
    expect(source).toContain("Quick Serve");
    expect(source).toContain("groupMobileQuickServeItems(visibleItems)");
    expect(source).toContain("<CatalogCard");
    expect(source).toContain("setQuickServe(false)");
  });
  it("renders unit-specific stock-aware priced buttons, no price overrides",()=>{
    expect(source).toContain("formatMoney(item.priceMinor,currencyCode)");
    expect(source).toContain("onPress={()=>onAdd(item)}");
    expect(source).toContain("item.unitLabel");
    expect(source).toContain("outOfStock");
    expect(source).toContain("disabled={!canSell||outOfStock||snapshot.checkoutBusy}");
    expect(model).toContain('mutationType: "SALE_CREATE"');
  });
  it("keeps a fixed cash action and shows pending sync outcomes",()=>{
    expect(source).toContain("style={styles.quickSticky}");
    expect(source).toContain("Cash received · Record sale");
    expect(source).toContain("Records locally first.");
    expect(source).toContain('snapshot.paymentMethod!=="CASH"');
    expect(source).toContain('onPayment("CASH")');
    expect(source).toContain("quickServe&&snapshot.saleNotice");
    expect(source).toContain("Cached totals are estimates");
    expect(appModel).toContain('tone: "pending", message: "Sale saved on this device · pending sync."');
  });
  it("preserves normal payment selection and role gates",()=>{
    expect(source).toContain("!quickServe?<Card");
    expect(source).toContain("PAYMENT_METHODS.map");
    expect(source).toContain('const canSell = SALE_ROLES.has(ready.membership.role);');
    expect(source).toContain("disabled={!canSell||snapshot.checkoutBusy||snapshot.cart.length===0");
  });
});
