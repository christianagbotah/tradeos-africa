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
