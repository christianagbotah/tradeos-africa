import {describe,it,expect} from "vitest";
import {buildReversal,returnable,canReverseSale,availableDispositions} from "./sale-reversal";
import type {MobileSaleDetail,MobileCatalogItem} from "./api-client";
const sale={id:"s",businessId:"b",branchId:"br",status:"COMPLETED",customer:null,lines:[{id:"l",itemKind:"PRODUCT",quantity:3,quantityReturned:1,quantityReturnable:2}]} as MobileSaleDetail;
describe("native sale reversals",()=>{
 it("enforces remaining quantity and role boundary",()=>{
   expect(returnable(sale.lines[0]!)).toBe(2);
   expect(canReverseSale("POS_ATTENDANT")).toBe(false);
   expect(()=>buildReversal(sale,"Reason","CASH",[{saleLineId:"l",quantity:3,disposition:"RESTOCK"}],[],[],false)).toThrow();
 });
 it("does not restock services or refund credit without a customer",()=>{
   expect(availableDispositions({...sale.lines[0]!,itemKind:"SERVICE"})).toEqual(["NOT_APPLICABLE"]);
   expect(()=>buildReversal(sale,"Reason","CUSTOMER_CREDIT",[{saleLineId:"l",quantity:1,disposition:"RESTOCK"}],[],[],false)).toThrow();
 });
 it("sends canonical exchange line inputs, not client-set financial totals",()=>{
   const item={id:"p",businessId:"b",active:true,units:[{code:"each",canSell:true,defaultSalePriceMinor:200}]} as MobileCatalogItem;
   const x=buildReversal(sale,"Reason","CASH",[{saleLineId:"l",quantity:1,disposition:"RESTOCK"}],[{itemId:"p",saleUnitCode:"each",quantity:1}],[item],true);
   expect(x.type).toBe("EXCHANGE_CREATE");expect(x.payload).not.toHaveProperty("netDifferenceMinor");
 });
});
