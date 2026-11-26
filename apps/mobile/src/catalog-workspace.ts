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

export type AdditionalSaleUnit={label:string;price:string;factor:string};
export function multiUnitDraft(input:Parameters<typeof simpleCatalogDraft>[0],extras:readonly AdditionalSaleUnit[]):MobileCatalogDraft{
  const draft=simpleCatalogDraft(input);
  if(extras.length>20)throw new Error("Use at most 20 additional units.");
  for(const [index,unit] of extras.entries()){
    const label=unit.label.trim();
    if(!label||label.length>120||draft.units.some(u=>u.label.toLowerCase()===label.toLowerCase()))throw new Error("Every unit needs a unique label.");
    const factor=Number(unit.factor);
    if(draft.trackStock&&(!Number.isFinite(factor)||factor<=0))throw new Error("Enter a positive stock conversion factor.");
    const code="sale_"+(index+1);
    draft.units.push({code,label,canPurchase:false,canSell:true,canStock:false,defaultSalePriceMinor:parseMinorAmount(unit.price,true)});
    if(draft.trackStock)draft.conversions.push({fromUnitCode:code,toUnitCode:"unit",factor});
  }
  return draft;
}

/** Display filters only; no stock policy or valuation changes. */
export type StockAvailabilityFilter="all"|"available"|"out";
export function matchesStockAvailability(item:{available:number},filter:StockAvailabilityFilter):boolean{
  return filter==="all"||(filter==="available"?item.available>0:item.available<=0);
}
export function matchesCatalogQuery(item:{name:string;sku:string|null},query:string):boolean{
  const q=query.trim().toLowerCase();
  return !q||item.name.toLowerCase().includes(q)||(item.sku??"").toLowerCase().includes(q);
}
