import type {MobileSaleDetail,MobileCatalogItem} from "./api-client";
export const canReverseSale=(role:string)=>["OWNER","ADMIN","MANAGER","CASHIER"].includes(role);
export const refundMethods=["ORIGINAL_METHOD","CASH","MOMO","CARD","BANK","CUSTOMER_CREDIT"] as const;
export type RefundMethod=typeof refundMethods[number];
export type Disposition="RESTOCK"|"QUARANTINE"|"DISCARD"|"NOT_RETURNED"|"NOT_APPLICABLE";
export type ReturnLine={saleLineId:string;quantity:number;disposition:Disposition};
export type ReplacementLine={itemId:string;saleUnitCode:string;quantity:number};
export type SaleReversal={type:"RETURN_CREATE";payload:{originalSaleId:string;reason:string;refundMethod:RefundMethod;expectedRefundTotalMinor?:number;lines:ReturnLine[]}}|{type:"EXCHANGE_CREATE";payload:{originalSaleId:string;reason:string;settlementMethod:RefundMethod;expectedNetDifferenceMinor?:number;returnedLines:ReturnLine[];replacementLines:ReplacementLine[]}};
export function returnable(line:MobileSaleDetail["lines"][number]){
 return Math.max(0,Math.min(line.quantity-line.quantityReturned,line.quantityReturnable??Infinity));
}
export function availableDispositions(line:MobileSaleDetail["lines"][number]):readonly Disposition[]{
 return line.itemKind==="PRODUCT"?["RESTOCK","QUARANTINE","DISCARD","NOT_RETURNED"]:line.itemKind==="PREPARED_PRODUCT"?["DISCARD","NOT_RETURNED","NOT_APPLICABLE"]:["NOT_APPLICABLE"];
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
 if(returned.some(l=>l.disposition==="NOT_RETURNED"))throw new Error("Exchanges require the item to be returned.");
 if(!replacement.length)throw new Error("Add a replacement item.");
 for(const l of replacement){
   if(!Number.isFinite(l.quantity)||l.quantity<=0||!catalog.some(i=>i.businessId===sale.businessId&&i.active&&i.id===l.itemId&&i.units.some(u=>u.code===l.saleUnitCode&&u.canSell&&u.defaultSalePriceMinor!==null)))throw new Error("Check replacement items and units.");
 }
 return {type:"EXCHANGE_CREATE",payload:{originalSaleId:sale.id,reason:reason.trim(),settlementMethod:method,returnedLines:returned,replacementLines:replacement}};
}

export function guardedReversal(sale:MobileSaleDetail,request:SaleReversal,catalog:readonly MobileCatalogItem[]):SaleReversal{
 if(sale.reversalAmountGuard!==true)throw new Error("This server does not yet support confirmed reversal amounts.");
 const returned=request.type==="RETURN_CREATE"?request.payload.lines:request.payload.returnedLines;
 const refund=returned.reduce((sum,l)=>{
   const original=sale.lines.find(x=>x.id===l.saleLineId);
   if(!original||!Number.isSafeInteger(original.unitNetMinor)||!Number.isSafeInteger(original.unitTaxMinor))throw new Error("Original price details are unavailable.");
   return sum+Math.round(original.unitNetMinor*l.quantity)+Math.round(original.unitTaxMinor!*l.quantity);
 },0);
 if(!Number.isSafeInteger(refund)||refund<0)throw new Error("Refund amount exceeds supported precision.");
 if(request.type==="RETURN_CREATE")return {...request,payload:{...request.payload,expectedRefundTotalMinor:refund}};
 const replacement=request.payload.replacementLines.reduce((sum,l)=>{
   const price=catalog.find(i=>i.id===l.itemId)?.units.find(u=>u.code===l.saleUnitCode)?.defaultSalePriceMinor;
   if(price===undefined||price===null)throw new Error("Replacement price is unavailable.");
   return sum+Math.round(price*l.quantity);
 },0);
 const difference=replacement-refund;
 if(!Number.isSafeInteger(difference))throw new Error("Exchange amount exceeds supported precision.");
 return {...request,payload:{...request.payload,expectedNetDifferenceMinor:difference}};
}
