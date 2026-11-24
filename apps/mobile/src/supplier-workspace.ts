import type {MobileCatalogItem,MobileSupplier,MobileSupplierInput} from "./api-client";
import {parseMinorAmount,creditTerms} from "./customer-payment";
export const canManageSuppliers=(role:string)=>["OWNER","ADMIN","MANAGER","INVENTORY","ACCOUNTANT"].includes(role);
export const canPaySuppliers=(role:string)=>["OWNER","ADMIN","MANAGER","ACCOUNTANT"].includes(role);
export type PurchaseLineDraft={itemId:string;purchaseUnitCode:string;quantity:string;cost:string};
export type PurchaseSettlement="SUPPLIER_CREDIT"|"CASH"|"MOMO"|"CARD"|"BANK"|"OTHER";
export type SupplierTransaction={type:"PURCHASE_RECEIVE_CREATE";payload:{supplierId:string;purchaseOrderId?:string;supplierReference?:string;settlementMethod:PurchaseSettlement;moneyAccountId?:string;lines:Array<{itemId:string;purchaseUnitCode:string;purchaseOrderLineId?:string;quantity:number;unitCostMinor:number}>}}|{type:"SUPPLIER_PAYMENT_CREATE";payload:{supplierId:string;amountMinor:number;method:Exclude<PurchaseSettlement,"SUPPLIER_CREDIT">;moneyAccountId:string;providerReference?:string}}|{type:"PURCHASE_RETURN_CREATE";payload:{supplierId:string;originalPurchaseId:string;recoveryMethod:"CREDIT_NOTE";lines:Array<{purchaseLineId:string;quantity:number;sourceLocation:"AVAILABLE"|"QUARANTINE"}>}};
export function supplierInput(d:{name:string;phone:string;email:string;address:string;terms:string},role:string):MobileSupplierInput{
 const name=d.name.trim(),phone=d.phone.trim(),email=d.email.trim(),address=d.address.trim();
 if(!name||name.length>160||phone.length>40||email.length>254||address.length>500||(email&&!email.includes("@")))throw new Error("Check supplier contact information.");
 return {name,phone:phone||null,email:email||null,address:address||null,...(canPaySuppliers(role)?{paymentTermsDays:creditTerms(d.terms)}:{})};
}
export function purchaseInput(supplier:MobileSupplier,drafts:PurchaseLineDraft[],catalog:MobileCatalogItem[],businessId:string,reference:string,settlementMethod:PurchaseSettlement,moneyAccountId?:string):Extract<SupplierTransaction,{type:"PURCHASE_RECEIVE_CREATE"}>{
 if(!supplier.active||!drafts.length||drafts.length>100)throw new Error("Select an active supplier and 1–100 lines.");
 if(settlementMethod!=="SUPPLIER_CREDIT"&&!moneyAccountId)throw new Error("Select the account used to pay.");
 const lines=drafts.map(l=>{
   const item=catalog.find(i=>i.id===l.itemId&&i.businessId===businessId&&i.active&&i.trackStock&&i.kind==="PRODUCT");
   if(!item?.units.some(u=>u.code===l.purchaseUnitCode&&u.canPurchase))throw new Error("Select a valid purchase unit.");
   const quantity=Number(l.quantity);
   if(!/^\d+(?:\.\d{1,8})?$/.test(l.quantity.trim())||!Number.isFinite(quantity)||quantity<=0||quantity>1e6)throw new Error("Enter a valid quantity.");
   return {itemId:l.itemId,purchaseUnitCode:l.purchaseUnitCode,quantity,unitCostMinor:parseMinorAmount(l.cost,true)};
 });
 return {type:"PURCHASE_RECEIVE_CREATE",payload:{supplierId:supplier.id,supplierReference:reference.trim(),settlementMethod,...(settlementMethod!=="SUPPLIER_CREDIT"&&moneyAccountId?{moneyAccountId}:{}),lines}};
}
export function supplierPayment(supplier:MobileSupplier,amount:string,method:Exclude<PurchaseSettlement,"SUPPLIER_CREDIT">,account:string,reference:string):Extract<SupplierTransaction,{type:"SUPPLIER_PAYMENT_CREATE"}>{
 const amountMinor=parseMinorAmount(amount);
 if(amountMinor>supplier.balanceMinor||!account||reference.trim().length>200)throw new Error("Payment must not exceed the outstanding balance; select a valid account.");
 return {type:"SUPPLIER_PAYMENT_CREATE",payload:{supplierId:supplier.id,amountMinor,method,moneyAccountId:account,providerReference:reference.trim()}};
}
