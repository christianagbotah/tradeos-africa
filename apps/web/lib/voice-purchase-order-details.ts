import {purchasableUnits,type CatalogItem} from "./catalog-read-model";
import {normalizeForCatalogVoice} from "./voice-catalog-matcher";

export type SpokenCostHint={
  at:number;end:number;amountMinor:number;
  unitName:string|null;explicitUnitCost:boolean;phrase:string;
};
const MONEY_RE=/(?:unit\s+(?:cost|price)|cost\s+price|priced\s+at|at|for)\s*(?:of\s+)?(?:₵|ghs|gh¢|cedis?\s*)?\s*(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,7}(?:\.\d{1,2})?)(?![\d.,])\s*(?:₵|ghs|gh¢|cedis?)?\s*(?:(per\s+[a-z]+)|(\beach\b))?/gi;
function exactMinor(v:string):number|null{
  if(!/^(?:\d{1,7}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(v))return null;
  const [whole,decimal=""]=v.replace(/,/g,"").split(".");
  const amount=Number(whole)*100+Number(decimal.padEnd(2,"0"));
  return Number.isSafeInteger(amount)&&amount>=0?amount:null;
}
/** Exact minor-unit amounts grounded in unmodified speech, not retail prices. */
export function spokenUnitCostHints(raw:string):SpokenCostHint[]{
  const normalized=normalizeForCatalogVoice(raw);
  const found:SpokenCostHint[]=[];
  let cursor=0;
  for(const match of raw.matchAll(MONEY_RE)){
    const minor=exactMinor(match[1]??"");
    if(minor===null)continue;
    const phrase=normalizeForCatalogVoice(match[0]);
    const at=normalized.indexOf(phrase,cursor);
    if(at<0)continue;
    cursor=at+phrase.length;
    const unitName=match[2]?.replace(/^per\s+/i,"").toLowerCase()??null;
    const explicitlyUnit=/^(?:unit\s+(?:cost|price)|cost\s+price)/i.test(match[0])||
      Boolean(unitName)||Boolean(match[3]);
    found.push({at,end:cursor,amountMinor:minor,unitName,
      explicitUnitCost:explicitlyUnit,phrase:match[0].trim()});
  }
  return found;
}
function singular(raw:string):string{
  return normalizeForCatalogVoice(raw)
    .replace(/\bboxes\b/g,"box").replace(/\bcrates\b/g,"crate")
    .replace(/\bpieces\b/g,"piece").replace(/\bcases\b/g,"case")
    .replace(/\bbatches\b/g,"batch")
    .replace(/\b([a-z]{3,})s\b/g,"$1").replace(/\s+/g,"");
}
const PREFIX_RE=/(?:^|\s)(?:\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|dozen|twenty|thirty|fifty)\s+(cartons?|boxes?|bags?|sacks?|crates?|bottles?|pieces?|units?|packs?|rolls?|tins?|tubs?|pails?|pallets?|bundles?|pairs?|yards?|metres?|meters?|kilograms?|kgs?|litres?|liters?|drums?|tons?|tonnes?|cases?)(?:\s+of)?\s*$/;
const SUFFIX_RE=/^\s*(?:(?:in|as|by\s+the|per)\s+)(cartons?|boxes?|bags?|sacks?|crates?|bottles?|pieces?|units?|packs?|rolls?|tins?|tubs?|pails?|pallets?|bundles?|pairs?|yards?|metres?|meters?|kilograms?|kgs?|litres?|liters?|drums?|tons?|tonnes?|cases?)\b/;
const PER_UNIT_RE=/\bper\s+(cartons?|boxes?|bags?|sacks?|crates?|bottles?|pieces?|units?|packs?|rolls?|tins?|tubs?|pails?|pallets?|bundles?|pairs?|yards?|metres?|meters?|kilograms?|kgs?|litres?|liters?|drums?|tons?|tonnes?|cases?)\b/;
export function resolveSpokenPurchasingUnit(input:{
  text:string;item:CatalogItem;start:number;end:number;nextStart:number;
}):{code:string;unitPhrase:string|null;warning:string|null}{
  const units=purchasableUnits(input.item);
  const fallback=units[0]?.code??"";
  const before=input.text.slice(Math.max(0,input.start-90),input.start);
  const after=input.text.slice(input.end,input.nextStart);
  const phrase=before.match(PREFIX_RE)?.[1]??after.match(SUFFIX_RE)?.[1]??
    after.match(PER_UNIT_RE)?.[1]??null;
  if(!phrase)return {code:fallback,unitPhrase:null,warning:null};
  const sought=singular(phrase);
  const matched=units.find(unit=>
    singular(unit.code)===sought||singular(unit.label)===sought);
  if(!matched)return {code:fallback,unitPhrase:phrase,
    warning:"Spoken purchasing unit '"+phrase+"' is not configured for "+
      input.item.name+". Verify the unit manually."};
  return {code:matched.code,unitPhrase:phrase,warning:null};
}
export function spokenItemCostHint(input:{
  hints:readonly SpokenCostHint[];
  end:number;nextStart:number;unitCode:string;item:CatalogItem;
  unitWasSpoken:boolean;
}):{minor:number|null;evidence:string|null;warning:string|null}{
  const candidates=input.hints.filter(h=>h.at>=input.end&&h.at<input.nextStart);
  if(candidates.length===0)return {minor:null,evidence:null,warning:null};
  if(candidates.length!==1)return {minor:null,evidence:null,
    warning:"Several supplier amounts were heard for "+input.item.name+
      ". Enter the unit cost manually."};
  const hint=candidates[0]!;
  if(!hint.explicitUnitCost)return {minor:null,evidence:null,
    warning:"A price was heard for "+input.item.name+
      ", but it was not clearly a per-unit cost. Confirm manually."};
  if(purchasableUnits(input.item).length>1&&!input.unitWasSpoken&&!hint.unitName)
    return {minor:null,evidence:null,warning:
      "The product has multiple purchasing units. Confirm the unit before accepting the spoken cost."};
  if(hint.unitName){
    const target=purchasableUnits(input.item).find(unit=>unit.code===input.unitCode);
    if(!target||(singular(hint.unitName)!==singular(target.code)&&
      singular(hint.unitName)!==singular(target.label)))
      return {minor:null,evidence:null,
        warning:"Cost was spoken per '"+hint.unitName+
          "', which differs from the selected purchasing unit. Confirm manually."};
  }
  return {minor:hint.amountMinor,evidence:hint.phrase,warning:null};
}
