import type {MobileCatalogItem,MobilePurchaseDetail,MobilePurchaseOrder,MobilePurchaseOrderInput,MobileSupplier} from "./api-client";
import {purchaseInput,type PurchaseLineDraft,type SupplierTransaction} from "./supplier-workspace";
import {parseMinorAmount} from "./customer-payment";
export const canWritePurchaseOrders=(role:string)=>["OWNER","ADMIN","MANAGER","INVENTORY"].includes(role);
export const canControlPurchaseOrders=(role:string)=>["OWNER","ADMIN","MANAGER"].includes(role);
export type OrderDraft={requestId:string;supplierId:string;notes:string;delivery:string;lines:PurchaseLineDraft[];revision?:{id:string;expectedUpdatedAt:string}};
export function orderScope(order:{businessId:string;branchId:string},businessId:string,branchId:string){return order.businessId===businessId&&order.branchId===branchId;}
export function orderDraft(order:MobilePurchaseOrder,requestId:string):OrderDraft{
 return {requestId,supplierId:order.supplierId,notes:order.notes,delivery:order.expectedDeliveryDate??"",revision:{id:order.id,expectedUpdatedAt:order.updatedAt},lines:order.lines.map(l=>({itemId:l.itemId,purchaseUnitCode:l.purchaseUnitCode,quantity:String(l.quantity),cost:(l.unitCostMinor/100).toFixed(2)}))};
}
export function orderInput(d:OrderDraft,businessId:string,branchId:string,suppliers:MobileSupplier[],catalog:MobileCatalogItem[]):MobilePurchaseOrderInput{
 if(new Set(d.lines.map(line=>line.itemId)).size!==d.lines.length)throw new Error("Each product can appear only once in a purchase order.");
 const supplier=suppliers.find(s=>s.id===d.supplierId&&s.active);
 if(!supplier||d.lines.length>50||d.notes.length>2000)throw new Error("Select an active supplier, 1–50 lines and valid notes.");
 if(d.delivery&&(!/^\d{4}-\d{2}-\d{2}$/.test(d.delivery)||!Number.isFinite(Date.parse(d.delivery))||new Date(d.delivery).toISOString().slice(0,10)!==d.delivery))throw new Error("Enter a valid delivery date (YYYY-MM-DD).");
 const purchase=purchaseInput(supplier,d.lines,catalog,businessId,"","SUPPLIER_CREDIT");
 return {businessId,branchId,clientRequestId:d.requestId,supplierId:d.supplierId,notes:d.notes.trim(),...(d.delivery?{expectedDeliveryDate:d.delivery}:{}),lines:purchase.payload.lines};
}
function quantity(value:string){const n=Number(value);if(!/^\d+(?:\.\d{1,8})?$/.test(value.trim())||!Number.isFinite(n)||n<=0||n>1e6)throw new Error("Enter a positive quantity.");return n;}
export function linkedReceipt(order:MobilePurchaseOrder,selected:Record<string,{quantity:string;cost:string}>,reference:string):SupplierTransaction{
 if(order.status!=="ISSUED"||!order.canReceive)throw new Error("This order cannot receive more goods.");
 const lines=order.lines.filter(l=>selected[l.id]?.quantity.trim()).map(l=>{
   const entry=selected[l.id]!,qty=quantity(entry.quantity);
   if(qty>l.remainingQuantity)throw new Error("Delivery exceeds remaining ordered quantity.");
   return {purchaseOrderLineId:l.id,itemId:l.itemId,purchaseUnitCode:l.purchaseUnitCode,quantity:qty,unitCostMinor:parseMinorAmount(entry.cost,true)};
 });
 if(!lines.length)throw new Error("Enter delivered quantities.");
 return {type:"PURCHASE_RECEIVE_CREATE",payload:{supplierId:order.supplierId,purchaseOrderId:order.id,supplierReference:reference.trim(),settlementMethod:"SUPPLIER_CREDIT",lines}};
}
export function creditNoteReturn(detail:MobilePurchaseDetail,selected:Record<string,{quantity:string;sourceLocation:"AVAILABLE"|"QUARANTINE"}>):SupplierTransaction{
 const lines=detail.lines.filter(l=>selected[l.id]?.quantity.trim()).map(l=>{
   const entry=selected[l.id]!,qty=quantity(entry.quantity);
   if(qty>Math.max(0,l.purchaseQuantity-l.returnedQuantity))throw new Error("Return exceeds remaining purchased quantity.");
   return {purchaseLineId:l.id,quantity:qty,sourceLocation:entry.sourceLocation};
 });
 if(!lines.length)throw new Error("Choose at least one return line.");
 return {type:"PURCHASE_RETURN_CREATE",payload:{supplierId:detail.purchase.supplierId,originalPurchaseId:detail.purchase.id,recoveryMethod:"CREDIT_NOTE",lines}};
}
