import {describe,it,expect} from "vitest";
import {draftVoicePurchaseOrder} from "./voice-purchase-order-draft";
import type {CatalogItem} from "./catalog-read-model";
const item=(name:string,sku:string,id:string,canPurchase=true):CatalogItem=>({
  id,name,sku,kind:"PRODUCT",active:true,trackStock:true,
  stockUnitCode:"piece",taxCategory:null,createdAt:null,updatedAt:"",
  units:[{code:"box",label:"Box",canPurchase,canSell:true,
    canStock:true,defaultSalePriceMinor:3000}],
  conversions:[],
});
const catalog=[
  item("Door number 058","058","door-a"),
  item("Door number 326","326","door-b"),
  item("Cement bag","CMT-50","cement"),
  item("Water bottle","WTR-1","water",false),
];
describe("spoken purchase-order draft",()=>{
  it("recognizes spoken SKU names and quantities",()=>{
    const draft=draftVoicePurchaseOrder(
      "Purchase order two door number zero five eight and three door number three twenty six",
      catalog,["Comfort Supplies"]);
    expect(draft.lines.map(x=>[x.itemId,x.quantity])).toEqual([
      ["door-a",2],["door-b",3],
    ]);
  });
  it("does not mistake a numeric SKU for another item quantity",()=>{
    const draft=draftVoicePurchaseOrder(
      "Buy door number 058 and door number 326",catalog);
    expect(draft.lines.map(x=>x.quantity)).toEqual([1,1]);
  });
  it("never copies a sale price into purchasing costs",()=>{
    const draft=draftVoicePurchaseOrder("order two cement bags",catalog);
    expect(draft.lines.map(x=>x.itemId)).toContain("cement");
    expect(JSON.stringify(draft)).not.toContain("3000");
  });
  it("excludes inactive, services, and items without purchasing units",()=>{
    const inactive={...item("Paper","X-1","paper"),active:false};
    const service={...item("Training","SERV","service"),kind:"SERVICE" as const};
    const result=draftVoicePurchaseOrder(
      "water bottle paper training cement bag",
      [...catalog,inactive,service]);
    expect(result.lines.map(l=>l.itemId)).not.toContain("water");
    expect(result.lines.map(l=>l.itemId)).not.toContain("paper");
    expect(result.lines.map(l=>l.itemId)).not.toContain("service");
  });
  it("does not invent an unknown product",()=>{
    const draft=draftVoicePurchaseOrder("order SKU 77777",catalog);
    expect(draft.lines).toHaveLength(0);
  });
});

describe("spoken purchase-unit and supplier-cost proposals",()=>{
  it("resolves multi-unit products and explicit per-unit prices",()=>{
    const carton={...item("Cement bag","CMT-50","cement"),units:[
      {code:"bag",label:"Bag",canPurchase:true,canSell:true,
        canStock:true,defaultSalePriceMinor:9999},
      {code:"carton",label:"Carton",canPurchase:true,canSell:false,
        canStock:false,defaultSalePriceMinor:null},
    ]};
    const result=draftVoicePurchaseOrder(
      "Order two cartons of cement bag at 120.50 cedis per carton",[carton]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      itemId:"cement",purchaseUnitCode:"carton",quantity:2,
      suggestedUnitCostMinor:12050,
    });
    expect(JSON.stringify(result)).not.toContain("9999");
  });
  it("does not invent supplier cost for unclear or aggregate prices",()=>{
    const result=draftVoicePurchaseOrder(
      "Order two cement bags for 550 cedis",[...catalog]);
    expect(result.lines[0]?.suggestedUnitCostMinor).toBe(null);
    expect(result.warnings.join(" ")).toMatch(/not clearly a per-unit cost/i);
  });
  it("separates explicit per-unit prices for two products",()=>{
    const result=draftVoicePurchaseOrder(
      "Buy 2 door number 058 at 25 cedis per box and 3 door number 326 at 35.50 cedis per box",
      catalog);
    expect(result.lines.map(l=>l.suggestedUnitCostMinor))
      .toEqual([2500,3550]);
  });
});

describe("multi-unit pricing safety",()=>{
  const material={...item("Cement bag","CMT-50","cement"),units:[
    {code:"bag",label:"Bag",canPurchase:true,canSell:true,
      canStock:true,defaultSalePriceMinor:4000},
    {code:"carton",label:"Carton",canPurchase:true,canSell:false,
      canStock:false,defaultSalePriceMinor:null},
  ]};
  it("recognizes per-unit after the product, even without a leading unit",()=>{
    const draft=draftVoicePurchaseOrder(
      "Order cement bag at 120.75 cedis per carton",[material]);
    expect(draft.lines[0]?.purchaseUnitCode).toBe("carton");
    expect(draft.lines[0]?.suggestedUnitCostMinor).toBe(12075);
  });
  it("requires explicit purchase unit with a multi-unit item",()=>{
    const draft=draftVoicePurchaseOrder(
      "Buy cement bag unit cost 130",[material]);
    expect(draft.lines[0]?.suggestedUnitCostMinor).toBe(null);
    expect(draft.warnings.join(" ")).toMatch(/multiple purchasing units/);
  });
  it("does not suggest a price when the spoken purchasing unit is unavailable",()=>{
    const draft=draftVoicePurchaseOrder(
      "Buy two pallets of cement bag at 100 cedis per pallet",[material]);
    expect(draft.lines[0]?.suggestedUnitCostMinor).toBe(null);
    expect(draft.warnings.join(" ")).toMatch(/not configured/);
  });
  it("requires cost unit to match purchasing unit",()=>{
    const draft=draftVoicePurchaseOrder(
      "Order two bags of cement bag at 120 cedis per carton",[material]);
    expect(draft.lines[0]?.purchaseUnitCode).toBe("bag");
    expect(draft.lines[0]?.suggestedUnitCostMinor).toBe(null);
    expect(draft.warnings.join(" ")).toMatch(/differs from the selected purchasing unit/);
  });
});

describe("numeric prices must not become product SKUs",()=>{
  it("excludes a different numeric SKU matching a spoken supplier cost",()=>{
    const priceCode=item("Plywood board","120","price-like-sku");
    const cement=item("Cement bag","CMT-50","cement");
    const draft=draftVoicePurchaseOrder(
      "Buy cement bag at 120 cedis per box",[priceCode,cement]);
    expect(draft.lines.map(l=>l.itemId)).toEqual(["cement"]);
    expect(draft.lines[0]?.suggestedUnitCostMinor).toBe(12000);
  });
});
