import {describe,it,expect} from "vitest";
import {spokenUnitCostHints,spokenItemCostHint,resolveSpokenPurchasingUnit}
  from "./voice-purchase-order-details";
import type {CatalogItem} from "./catalog-read-model";
import {normalizeForCatalogVoice} from "./voice-catalog-matcher";
const sample:CatalogItem={
  id:"cement",name:"Cement",sku:"CMT-50",kind:"PRODUCT",active:true,
  trackStock:true,stockUnitCode:"bag",taxCategory:null,createdAt:null,updatedAt:"",
  conversions:[],units:[
    {code:"carton",label:"Carton",canPurchase:true,canSell:false,
      canStock:false,defaultSalePriceMinor:null},
    {code:"bag",label:"Bag",canPurchase:true,canSell:true,
      canStock:true,defaultSalePriceMinor:4500},
  ],
};
describe("spoken purchasing units and supplier costs",()=>{
  it("parses cedi and decimal currency amounts without float scaling",()=>{
    const hints=spokenUnitCostHints(
      "Cement at ₵1,250.50 per carton and door unit cost 25.05");
    expect(hints.map(h=>h.amountMinor)).toEqual([125050,2505]);
    expect(hints[0]?.unitName).toBe("carton");
    expect(hints[0]?.explicitUnitCost).toBe(true);
  });
  it("does not label a total price as unit cost",()=>{
    const hints=spokenUnitCostHints("Cement for 400 cedis");
    expect(hints).toHaveLength(1);
    expect(hints[0]?.explicitUnitCost).toBe(false);
    expect(spokenItemCostHint({
      hints,end:0,nextStart:100,unitCode:"bag",item:sample,unitWasSpoken:true,
    }).minor).toBe(null);
  });
  it("understands a configured purchase unit, without inventing conversions",()=>{
    const text=normalizeForCatalogVoice("Order two cartons of cement");
    const start=text.indexOf("cement");
    expect(resolveSpokenPurchasingUnit({
      text,item:sample,start,end:start+6,nextStart:text.length,
    }).code).toBe("carton");
    const unknown=normalizeForCatalogVoice("Order two pallets of cement");
    const at=unknown.indexOf("cement");
    const fallback=resolveSpokenPurchasingUnit({
      text:unknown,item:sample,start:at,end:at+6,nextStart:unknown.length,
    });
    expect(fallback.code).toBe("carton");
    expect(fallback.warning).toMatch(/not configured/);
  });
  it("requires the price-per-unit to agree with the chosen purchasing unit",()=>{
    const hints=spokenUnitCostHints("Cement at 50.75 cedis per bag");
    expect(spokenItemCostHint({
      hints,end:7,nextStart:200,unitCode:"bag",item:sample,unitWasSpoken:true,
    }).minor).toBe(5075);
    expect(spokenItemCostHint({
      hints,end:7,nextStart:200,unitCode:"carton",item:sample,unitWasSpoken:true,
    }).minor).toBe(null);
  });
});

describe("unsafe amount recognition is rejected",()=>{
  it("does not truncate three decimal places or overly long numbers",()=>{
    expect(spokenUnitCostHints("Cement at 120.500 per bag")).toEqual([]);
    expect(spokenUnitCostHints("Cement at 123456789012 per bag")).toEqual([]);
  });
  it("recognizes each as a per-unit cue",()=>{
    const hints=spokenUnitCostHints("Cement at 125.25 cedis each");
    expect(hints).toHaveLength(1);
    expect(hints[0]?.explicitUnitCost).toBe(true);
    expect(hints[0]?.amountMinor).toBe(12525);
  });
});
