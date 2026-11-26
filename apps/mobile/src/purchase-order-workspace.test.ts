import {describe,it,expect} from "vitest";
import {linkedReceipt,creditNoteReturn,orderInput,canWritePurchaseOrders,canControlPurchaseOrders} from "./purchase-order-workspace";
import type {MobilePurchaseOrder,MobilePurchaseDetail,MobileSupplier,MobileCatalogItem} from "./api-client";
describe("native procurement",()=>{
 it("links partial receipts to original order and prevents over-delivery",()=>{
  const order={id:"po",supplierId:"s",status:"ISSUED",canReceive:true,lines:[{id:"l",itemId:"i",purchaseUnitCode:"box",remainingQuantity:3}]} as MobilePurchaseOrder;
  expect(linkedReceipt(order,{l:{quantity:"2",cost:"12.50"}},"ref").payload).toMatchObject({purchaseOrderId:"po",settlementMethod:"SUPPLIER_CREDIT",lines:[{purchaseOrderLineId:"l",quantity:2,unitCostMinor:1250}]});
  expect(()=>linkedReceipt(order,{l:{quantity:"4",cost:"12.50"}},"")).toThrow();
 });
 it("limits supplier returns to remaining purchase quantity",()=>{
  const detail={purchase:{id:"p",supplierId:"s"},lines:[{id:"l",purchaseQuantity:5,returnedQuantity:3}]} as MobilePurchaseDetail;
  expect(creditNoteReturn(detail,{l:{quantity:"2",sourceLocation:"QUARANTINE"}})).toMatchObject({type:"PURCHASE_RETURN_CREATE",payload:{originalPurchaseId:"p",recoveryMethod:"CREDIT_NOTE",lines:[{purchaseLineId:"l",quantity:2,sourceLocation:"QUARANTINE"}]}});
  expect(()=>creditNoteReturn(detail,{l:{quantity:"3",sourceLocation:"AVAILABLE"}})).toThrow();
 });
 it("separates order drafting and issuance permissions",()=>{
  expect(canWritePurchaseOrders("INVENTORY")).toBe(true);expect(canControlPurchaseOrders("INVENTORY")).toBe(false);expect(canControlPurchaseOrders("MANAGER")).toBe(true);
  const s={id:"s",active:true} as MobileSupplier;const i={id:"i",businessId:"b",active:true,trackStock:true,kind:"PRODUCT",units:[{code:"box",canPurchase:true}]} as MobileCatalogItem;
  const line={itemId:"i",purchaseUnitCode:"box",quantity:"2",cost:"10"};
  expect(()=>orderInput({requestId:"r",supplierId:"s",notes:"",delivery:"",lines:[line,line]},"b","br",[s],[i])).toThrow(/only once/);
  expect(orderInput({requestId:"r",supplierId:"s",notes:"",delivery:"2027-01-01",lines:[{itemId:"i",purchaseUnitCode:"box",quantity:"2",cost:"10"}]},"b","br",[s],[i])).toMatchObject({expectedDeliveryDate:"2027-01-01",lines:[{unitCostMinor:1000,quantity:2}]});
 });
});
