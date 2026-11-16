import {
  purchasableUnits,type CatalogItem,type SellableItem,
} from "./catalog-read-model";
import {normalizeForCatalogVoice,rankSpokenCatalogProducts}
  from "./voice-catalog-matcher";

export interface VoicePurchaseOrderLine{
  itemId:string;name:string;sku:string|null;
  purchaseUnitCode:string;quantity:number;
  confidence:"sku"|"name"|"similar";phrase:string;
}
export interface VoicePurchaseOrderDraft{
  lines:VoicePurchaseOrderLine[];
  suggestions:VoicePurchaseOrderLine[];
  warnings:string[];
  transcript:string;
}
const numberWords=new Map<string,number>([
  ["a",1],["an",1],["one",1],["two",2],["three",3],["four",4],
  ["five",5],["six",6],["seven",7],["eight",8],["nine",9],
  ["ten",10],["dozen",12],["twenty",20],["thirty",30],["fifty",50],
]);
function quantityBefore(text:string,start:number):number{
  const before=normalizeForCatalogVoice(text.slice(Math.max(0,start-80),start));
  const m=before.match(/(?:^|\s)(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|dozen|twenty|thirty|fifty)(?:\s+(?:bags?|sacks?|boxes?|cartons?|packs?|units?|pieces?|rolls?|bottles?|crates?|doors?|items?|of|the|number|no|sku|code|product|stock)){0,5}$/);
  if(!m)return 1;
  const prefix=before.slice(0,(m.index??0)+m[0].indexOf(m[1]!));
  if(/\b(?:number|no|sku|code|model)\s*$/.test(prefix))return 1;
  const q=numberWords.get(m[1]!)??Number(m[1]);
  return Number.isInteger(q)&&q>0&&q<=500?q:1;
}
function candidate(item:SellableItem,quantity:number,
  confidence:"sku"|"name"|"similar",phrase:string):VoicePurchaseOrderLine{
  return {itemId:item.itemId,name:item.name,sku:item.sku,
    purchaseUnitCode:item.unitCode,quantity,confidence,phrase};
}
/**
 * Catalog-grounded purchase order suggestions. Costs are intentionally
 * excluded: a retail selling price is never a supplier purchase cost.
 */
export function draftVoicePurchaseOrder(
  raw:string,catalog:readonly CatalogItem[],supplierNames:readonly string[]=[],
):VoicePurchaseOrderDraft{
  const transcript=raw.trim().slice(0,2000);
  const purchasable=catalog.filter(item=>
    item.active&&item.kind==="PRODUCT"&&item.trackStock&&
    purchasableUnits(item).length>0);
  const projection:SellableItem[]=purchasable.map(item=>{
    const unit=purchasableUnits(item)[0]!;
    return {
      key:item.id+":"+unit.code,itemId:item.id,name:item.name,sku:item.sku,
      kind:item.kind,unitCode:unit.code,unitLabel:unit.label,
      priceMinor:0,trackStock:true,stockUnitCode:item.stockUnitCode,
      availableStock:null,
    };
  });
  const matches=rankSpokenCatalogProducts(transcript,projection,supplierNames);
  const confident=matches.filter(m=>m.score>=(m.basis==="similar"?0.94:0.88))
    .sort((a,b)=>a.start-b.start||b.score-a.score);
  const selected:typeof confident=[];
  for(const match of confident){
    if(selected.some(other=>
      (match.start<other.end&&match.end>other.start)||
      match.item.itemId===other.item.itemId))continue;
    selected.push(match);
  }
  const words=normalizeForCatalogVoice(transcript);
  const lines=selected.slice(0,50).map(match=>candidate(
    match.item,quantityBefore(words,match.start),match.basis,match.phrase,
  ));
  const used=new Set(lines.map(line=>line.itemId));
  const suggestions=matches.filter(m=>!used.has(m.item.itemId))
    .slice(0,12).map(m=>candidate(m.item,1,m.basis,m.phrase));
  const warnings:string[]=[];
  if(!lines.length)warnings.push(
    "No confident product recognized. Select a suggested catalog item or add one manually.");
  if(suggestions.length)warnings.push(
    "Similar-sounding items were found. Confirm their identity and purchasing units.");
  if(confident.length>50)warnings.push("Only 50 lines can be drafted at once.");
  warnings.push(
    "Confirm supplier, item, purchasing unit, quantity and supplier cost before applying.");
  return {lines,suggestions,warnings,transcript};
}
