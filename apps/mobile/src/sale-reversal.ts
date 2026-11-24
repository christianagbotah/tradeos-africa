import type {MobileSaleDetail,MobileCatalogItem} from "./api-client";
export const canReverseSale=(role:string)=>["OWNER","ADMIN","MANAGER","CASHIER"].includes(role);
export const refundMethods=["ORIGINAL_METHOD","CASH","MOMO","CARD","BANK","CUSTOMER_CREDIT"] as const;
export type RefundMethod=typeof refundMethods[number];
export type Disposition="RESTOCK"|"QUARANTINE"|"DISCARD"|"NOT_APPLICABLE";
export type ReturnLine={saleLineId:string;quantity:number;disposition:Disposition};
export type ReplacementLine={itemId:string;saleUnitCode:string;quantity:number};
export type SaleReversal={type:"RETURN_CREATE";payload:{originalSaleId:string;reason:string;refundMethod:RefundMethod;lines:ReturnLine[]}}|{type:"EXCHANGE_CREATE";payload:{originalSaleId:string;reason:string;settlementMethod:RefundMethod;returnedLines:ReturnLine[];replacementLines:ReplacementLine[]}};
export function returnable(line:MobileSaleDetail["lines"][number]){
 return Math.max(0,Math.min(line.quantity-line.quantityReturned,line.quantityReturnable??Infinity));
}
export function availableDispositions(line:MobileSaleDetail["lines"][number]):readonly Disposition[]{
 return line.itemKind==="PRODUCT"?["RESTOCK","QUARANTINE","DISCARD","NOT_APPLICABLE"]:["NOT_APPLICABLE"];
}
export function positiveQuantity(text:string){
 const quantity=Number(text);
 if(!/^\d+(?:\.\d{1,8})?$/.test(text.trim())||!Number.isFinite(quantity)||quantity<=0||quantity>1e6)throw new Error("Enter a positive quantity with up to eight decimal places.");
 return quantity;
}
export function buildReversal(sale:MobileSaleDetail,reason:string,method:RefundMethod,returned:ReturnLine[],replacement:ReplacementLine[],catalog:readonly MobileCatalogItem[],exchange:boolean):SaleReversal{
 if(!["COMPLETED","PARTIALLY_REFUNDED"].includes(sale.status))throw new Error("This sale is not returnable.");
 if(!reason.trim()||reason.trim().length>1000||!returned.length)throw new Error("Select items and enter a return reason.");
 if(!refundMethods.includes(method)||method==="CUSTOMER_CREDIT"&&!sale.customer?.id)throw new Error("Choose an eligible refund method.");
 if(new Set(returned.map(l=>l.saleLineId)).size!==returned.length)throw new Error("Return each sale line once.");
 for(const l of returned){
   const original=sale.lines.find(x=>x.id===l.saleLineId);
   if(!original||!Number.isFinite(l.quantity)||l.quantity<=0||l.quantity>returnable(original)||!availableDispositions(original).includes(l.disposition))throw new Error("Check return quantities and stock disposition.");
 }
 if(!exchange)return {type:"RETURN_CREATE",payload:{originalSaleId:sale.id,reason:reason.trim(),refundMethod:method,lines:returned}};
 if(!replacement.length)throw new Error("Add a replacement item.");
 for(const l of replacement){
   if(!Number.isFinite(l.quantity)||l.quantity<=0||!catalog.some(i=>i.businessId===sale.businessId&&i.active&&i.id===l.itemId&&i.units.some(u=>u.code===l.saleUnitCode&&u.canSell&&u.defaultSalePriceMinor!==null)))throw new Error("Check replacement items and units.");
 }
 return {type:"EXCHANGE_CREATE",payload:{originalSaleId:sale.id,reason:reason.trim(),settlementMethod:method,returnedLines:returned,replacementLines:replacement}};
}
