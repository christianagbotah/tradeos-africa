import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page=readFileSync(resolve(__dirname,"catalog-item-sheet.tsx"),"utf8");
const quick=readFileSync(resolve(__dirname,"../pos/quick-serve.tsx"),"utf8");
const css=readFileSync(resolve(__dirname,"../../workspace-shell.css"),"utf8");
const contract=readFileSync(resolve(__dirname,"../../../lib/mutation-builders.ts"),"utf8");

describe("price-driven waakye, fish and service onboarding",()=>{
  it("adds shortcuts only for prepared food and non-stock services",()=>{
    expect(page).toContain('kind !== "PRODUCT" ? (');
    expect(page).toContain('addQuickPriceUnits(units, quickPrices');
    expect(page).toContain('newItem: !item');
    expect(page).toContain('hasConversions: conversions.length > 0');
    expect(page).toContain('disabled={!canWrite || busy || !quickPrices.trim()}');
    expect(page).toContain('role="alert" className="tos-catalog-price-setup__error"');
  });
  it("uses the existing canonical catalog mutation and verified POS selling prices",()=>{
    expect(page).toContain("buildCatalogItemCreatePayload(base)");
    expect(page).toContain("buildCatalogItemUpdatePayload(");
    expect(page).toContain("units: toPayloadUnits()");
    expect(page).toContain("defaultSalePriceMinor: unit.priceMinor");
    expect(quick).toContain("onPick(item)");
    expect(quick).toContain("item.unitLabel");
    expect(quick).toContain("item.priceMinor");
    expect(contract).toContain("CATALOG_WRITE_ROLES");
  });
  it("keeps controls usable on narrow phones",()=>{
    expect(css).toContain(".tos-catalog-price-setup {");
    expect(css).toContain(".tos-catalog-price-setup__row");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(css).toContain(".tos-catalog-price-setup__row > button { width: 100%; }");
  });
});
