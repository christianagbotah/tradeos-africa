import {describe,expect,it} from "vitest";
import type {CatalogItem} from "./catalog-read-model";
import {
  selectPurchaseOrderItem,selectPurchaseOrderUnit,selectPurchaseOrderSupplier,
  purchaseOrderCostMissing,validatePurchaseOrderLines,
} from "./purchase-order-draft-guards";
const sample:CatalogItem={
  id:"i1",name:"Cement",sku:"CMT",kind:"PRODUCT",active:true,
  trackStock:true,stockUnitCode:"bag",taxCategory:null,createdAt:null,updatedAt:"",
  conversions:[],units:[
    {code:"bag",label:"Bag",canPurchase:true,canSell:true,canStock:true,
      defaultSalePriceMinor:10000},
    {code:"carton",label:"Carton",canPurchase:true,canSell:false,canStock:false,
      defaultSalePriceMinor:null},
  ],
};
const start={key:"k1",itemId:"i1",purchaseUnitCode:"bag",quantity:"5",unitCostMinor:5000};
describe("supplier order form price guard",()=>{
  it("does not inherit a quote when the item changes",()=>{
    expect(selectPurchaseOrderItem(start,"i2","piece")).toEqual({
      key:"k1",itemId:"i2",purchaseUnitCode:"piece",quantity:"1",unitCostMinor:null,
    });
    expect(selectPurchaseOrderItem(start,"i1","bag")).toEqual(start);
  });
  it("does not inherit the cost when the purchasing unit changes",()=>{
    expect(selectPurchaseOrderUnit(start,"carton")).toMatchObject({
      purchaseUnitCode:"carton",unitCostMinor:null,quantity:"5",
    });
    expect(selectPurchaseOrderUnit(start,"bag")).toEqual(start);
  });
  it("clears supplier-specific quotations when supplier changes",()=>{
    expect(selectPurchaseOrderSupplier([start],"s1","s2")[0]?.unitCostMinor)
      .toBe(null);
    expect(selectPurchaseOrderSupplier([start],"s1","s1")[0]?.unitCostMinor)
      .toBe(5000);
  });
  it("requires explicit cost, including an intentional zero",()=>{
    expect(validatePurchaseOrderLines([{...start,unitCostMinor:null}],[sample]))
      .toBe(false);
    expect(validatePurchaseOrderLines([{...start,unitCostMinor:0}],[sample]))
      .toBe(true);
    expect(purchaseOrderCostMissing([start,{...start,unitCostMinor:null}]))
      .toEqual([2]);
  });
  it("requires a real active catalog item and configured buying unit",()=>{
    expect(validatePurchaseOrderLines([start],[sample])).toBe(true);
    expect(validatePurchaseOrderLines([{...start,purchaseUnitCode:"pallet"}],[sample]))
      .toBe(false);
    expect(validatePurchaseOrderLines([start],[{...sample,active:false}]))
      .toBe(false);
    expect(validatePurchaseOrderLines([start],[{...sample,kind:"SERVICE"}]))
      .toBe(false);
  });
  it("rejects unsafe quantities and money overflow",()=>{
    expect(validatePurchaseOrderLines([{...start,quantity:"0"}],[sample])).toBe(false);
    expect(validatePurchaseOrderLines([{...start,quantity:"1.123456789"}],[sample]))
      .toBe(false);
    expect(validatePurchaseOrderLines([{...start,unitCostMinor:Number.MAX_SAFE_INTEGER}],[sample]))
      .toBe(false);
  });
});
