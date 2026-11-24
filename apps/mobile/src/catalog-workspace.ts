import type {MobileCatalogDraft,MobileCatalogItem,MobileCatalogPatch} from "./api-client";
import {parseMinorAmount} from "./customer-payment";
export const canManageCatalog=(role:string)=>["OWNER","ADMIN","MANAGER","INVENTORY"].includes(role);
export const canBrowseStock=(role:string)=>["OWNER","ADMIN","MANAGER","CASHIER","SALES","INVENTORY","ACCOUNTANT","STAFF","VIEWER"].includes(role);
export function simpleCatalogDraft(input:{name:string;sku:string;kind:"PRODUCT"|"SERVICE"|"PREPARED_PRODUCT";unitLabel:string;price:string;trackStock:boolean}):MobileCatalogDraft{
  const name=input.name.trim(),sku=input.sku.trim(),label=input.unitLabel.trim();
  if(!name||name.length>160||sku.length>160||!label||label.length>120)throw new Error("Check item name, SKU and unit label.");
  const trackStock=input.kind==="PRODUCT"&&input.trackStock;
  return {name,sku:sku||null,kind:input.kind,trackStock,stockUnitCode:trackStock?"unit":null,units:[{code:"unit",label,canPurchase:input.kind==="PRODUCT",canSell:true,canStock:trackStock,defaultSalePriceMinor:parseMinorAmount(input.price,true)}],conversions:[]};
}
export function catalogContactPatch(item:MobileCatalogItem,name:string,sku:string,prices:Record<string,string>):MobileCatalogPatch{
  if(!name.trim()||name.trim().length>160||sku.trim().length>160)throw new Error("Check item name and SKU.");
  return {expectedUpdatedAt:item.updatedAt,name:name.trim(),sku:sku.trim()||null,units:item.units.map(u=>({...u,defaultSalePriceMinor:u.canSell?parseMinorAmount(prices[u.code]??"",true):u.defaultSalePriceMinor}))};
}
export function reconcileCatalog(rows:readonly MobileCatalogItem[],item:MobileCatalogItem){
  return [item,...rows.filter(x=>x.id!==item.id)].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
