import {
  filterSellableItems,type SellableItem,
} from "./catalog-read-model";
import {
  rankSpokenCatalogProducts,normalizeForCatalogVoice,
} from "./voice-catalog-matcher";

/**
 * Deliberately separates ordinary exact matches from approximate suggestions.
 * Even an excellent similar match must be clicked by the cashier to enter
 * the cart. All items are from the active, sellable catalog projection.
 */
export interface PosCatalogSearchResult {
  items:SellableItem[];
  approximate:boolean;
}
const compact=(v:string)=>normalizeForCatalogVoice(v).replace(/\s/g,"");
function editDistance(a:string,b:string):number{
  if(Math.abs(a.length-b.length)>2)return 3;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const curr=[i];
    for(let j=1;j<=b.length;j++){
      curr[j]=Math.min(
        (curr[j-1]??100)+1,(prev[j]??100)+1,
        (prev[j-1]??100)+(a[i-1]===b[j-1]?0:1),
      );
    }
    prev=curr;
  }
  return prev[b.length]??3;
}
function approxScore(query:string,item:SellableItem):number{
  const word=normalizeForCatalogVoice(query);
  if(!word||word.length<3)return 0;
  const tokens=normalizeForCatalogVoice(item.name).split(" ");
  const qTokens=word.split(" ");
  if(qTokens.length>3)return 0;
  // Do not turn a mistyped numeric SKU into a different SKU.
  if(qTokens.some(t=>/^\d+$/.test(t)))return 0;
  let matched=0,total=0;
  for(const q of qTokens){
    if(q.length<3)continue;
    total++;
    const best=tokens.reduce((high,token)=>{
      if(token===q)return 1;
      if(token.length<4||q.length<4)return high;
      const distance=editDistance(q,token);
      const similarity=1-distance/Math.max(q.length,token.length);
      return similarity>=0.72?Math.max(high,similarity):high;
    },0);
    matched+=best;
  }
  return total>0?matched/total:0;
}
export function searchPosCatalog(
  items:readonly SellableItem[],query:string,limit=60,
):PosCatalogSearchResult{
  const normalized=normalizeForCatalogVoice(query).trim();
  if(!normalized)return {items:[...items],approximate:false};
  const exact=filterSellableItems(items,query);
  if(exact.length)return {items:exact,approximate:false};
  if(normalized.length<3)return {items:[],approximate:false};
  // The POS search field itself supplies explicit product/SKU context.
  // This preserves a leading zero when the user types 'zero five eight'.
  const ranked=rankSpokenCatalogProducts("SKU "+query,items)
    .map(result=>({item:result.item,score:result.score}));
  const best=new Map<string,{item:SellableItem;score:number}>();
  for(const entry of ranked){
    if(entry.score>=0.51)best.set(entry.item.key,entry);
  }
  for(const item of items){
    const score=approxScore(normalized,item);
    if(score>=0.72){
      const old=best.get(item.key);
      if(!old||old.score<score)best.set(item.key,{item,score});
    }
  }
  return {
    approximate:true,
    items:[...best.values()].sort((a,b)=>b.score-a.score||
      a.item.name.localeCompare(b.item.name)).slice(0,Math.max(1,Math.min(limit,60)))
      .map(result=>result.item),
  };
}
