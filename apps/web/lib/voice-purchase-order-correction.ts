import {normalizeForCatalogVoice} from "./voice-catalog-matcher";

/**
 * Parses a single requested edit to an unposted purchase-order draft.
 * Parsing alone never changes a line, supplier, stock, price or document.
 */
export type VoicePOCorrection=
  | {kind:"REMOVE";index:number}
  | {kind:"QUANTITY";index:number;quantity:number}
  | {kind:"COST";index:number;unitCostMinor:number;perUnit:string|null}
  | {kind:"UNIT";index:number;unitQuery:string}
  | {kind:"REPLACE";index:number;itemQuery:string}
  | {kind:"SUPPLIER";supplierQuery:string};

export type VoicePOCorrectionResult=
  | {ok:true;value:VoicePOCorrection}
  | {ok:false;message:string};

const numberWords:Record<string,number>={
  a:1,an:1,one:1,first:1,two:2,second:2,three:3,third:3,
  four:4,fourth:4,five:5,fifth:5,six:6,sixth:6,
  seven:7,seventh:7,eight:8,eighth:8,nine:9,ninth:9,
  ten:10,tenth:10,eleven:11,twelve:12,twenty:20,
  thirty:30,forty:40,fifty:50,hundred:100,
};
const itemPattern=/\b(?:item|line|product)(?:\s+(?:number|no))?\s+(\d{1,2}(?:st|nd|rd|th)?|one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|seventh|eight|eighth|nine|ninth|ten|tenth)\b/;
const invalid=(message:string):VoicePOCorrectionResult=>({ok:false,message});
function parseIndex(value:string):number{
  return numberWords[value]??Number(value.replace(/(?:st|nd|rd|th)$/,""));
}
function amountMinor(value:string):number|null{
  const cleaned=value.replace(/,/g,"");
  if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(cleaned))return null;
  const [whole,decimal=""]=cleaned.split(".");
  const minor=Number(whole)*100+Number(decimal.padEnd(2,"0"));
  return Number.isSafeInteger(minor)?minor:null;
}
const action="(?:change|set|correct|replace|update|make|use|switch)";
const supplierPattern=new RegExp(
  "^(?:"+action+")\\s+(?:the\\s+)?supplier\\s+(?:(?:to|with|as|is)\\s+)?(.+)$",
);
function cleanUnit(s:string):string{return normalizeForCatalogVoice(s).trim();}
function parseQuantity(value:string):number|null{
  const normalized=cleanUnit(value);
  if(/^\d{1,6}$/.test(normalized)){
    const q=Number(normalized);
    return q>=1&&q<=1_000_000?q:null;
  }
  return numberWords[normalized]??null;
}
export function parseVoicePOCorrection(
  raw:string,linesCount:number,
):VoicePOCorrectionResult{
  const command=raw.trim().slice(0,500);
  if(!command)return invalid("Speak or type the correction first.");
  const normalized=cleanUnit(command);
  if(/\b(?:pay|paid|receive|received|issue|send|approve|submit|discount)\b/.test(normalized))
    return invalid("Voice cannot pay, receive stock, issue or approve orders.");
  const supplier=supplierPattern.exec(normalized);
  if(supplier){
    const query=supplier[1]?.trim()??"";
    if(query.length<2)return invalid("Name an existing supplier to select.");
    return {ok:true,value:{kind:"SUPPLIER",supplierQuery:query}};
  }
  const target=itemPattern.exec(normalized);
  if(!target)return invalid(
    "Specify the item number, such as 'change item two quantity to five'.");
  const number=parseIndex(target[1]!);
  if(!Number.isInteger(number)||number<1||number>linesCount)
    return invalid("That item number is not in the current purchase-order draft.");
  const index=number-1;
  const before=normalized.slice(0,target.index).trim();
  const after=normalized.slice(target.index+target[0].length).trim();
  if(/\b(?:remove|delete|drop|cancel)\b/.test(before)){
    if(after)return invalid("Remove one item at a time, without additional commands.");
    return {ok:true,value:{kind:"REMOVE",index}};
  }
  if(!/\b(?:change|set|correct|replace|edit|update|make|switch)\b/.test(before))
    return invalid("Say change, set or remove followed by an item number.");
  // Require one of the explicitly supported edit field names.
  const qtyField=/\b(?:quantity|qty|number of units)\b/.test(before)||
    /^(?:quantity|qty)\b/.test(after);
  if(qtyField){
    const tail=after.replace(/^(?:quantity|qty)\s*/,"")
      .replace(/^(?:to|as|is|equals)\s+/,"").trim();
    const quantity=parseQuantity(tail);
    if(quantity===null)return invalid("Specify a valid whole-number quantity.");
    return {ok:true,value:{kind:"QUANTITY",index,quantity}};
  }
  const unitField=/\b(?:purchase unit|purchasing unit|buying unit|unit of measure)\b/.test(before)||
    /^(?:(?:purchase|purchasing|buying)\s+)?unit\b(?!\s+(?:cost|price)\b)/.test(after);
  const costField=/\b(?:unit cost|supplier cost|purchase price|buying price|cost)\b/.test(before)||
    /^(?:(?:supplier|purchase|buying|unit)\s+)?(?:cost|price)\b/.test(after);
  if(unitField&&costField)return invalid(
    "Correct the purchase unit and supplier cost separately.");
  if(unitField){
    const unit=after.replace(/^(?:(?:purchase|purchasing|buying)\s+)?unit\s*/,"")
      .replace(/^(?:to|as|is|with)\s+/,"").trim();
    if(unit.length<2||unit.length>60||/\d/.test(unit))
      return invalid("Specify a configured purchasing unit such as carton or bag.");
    return {ok:true,value:{kind:"UNIT",index,unitQuery:unit}};
  }
  if(costField){
    // Parse from raw command to preserve decimal precision and currency symbols.
    const rawTarget=itemPattern.exec(command.toLowerCase());
    if(!rawTarget)return invalid("Specify a numbered purchase-order item.");
    const originalBefore=command.slice(0,rawTarget.index).toLowerCase();
    const originalAfter=command.slice(rawTarget.index+rawTarget[0].length).trim();
    const fromAfter=originalAfter.replace(
      /^(?:(?:supplier|purchase|buying|unit)\s+)?(?:cost|price)\s*/i,"")
      .replace(/^(?:to|as|is|equals|at)\s+/i,"").trim();
    const value=/^(?:₵|ghs|gh¢)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,7}(?:\.\d{1,2})?)\s*(?:₵|ghs|gh¢|cedis?)?(?:\s+per\s+([a-z]+))?$/i.exec(fromAfter);
    if(!value)return invalid(
      "State one exact per-unit supplier cost, for example 'item two cost to ₵120.50'.");
    const minor=amountMinor(value[1]!);
    if(minor===null)return invalid("Invalid supplier unit cost. Check decimals and commas.");
    // Standalone "price" with no cost context isn't a permitted discount.
    if(!/\b(?:cost|price)\b/.test(originalBefore)&&
      !/^(?:(?:supplier|purchase|buying|unit)\s+)?(?:cost|price)\b/i.test(originalAfter))
      return invalid("Specify the supplier unit cost explicitly.");
    return {ok:true,value:{kind:"COST",index,unitCostMinor:minor,
      perUnit:value[2]?.toLowerCase()??null}};
  }
  const replacement=after.match(/^(?:to|with|as|for)\s+(.+)$/);
  const itemQuery=replacement?.[1]?.trim()??"";
  if(itemQuery.length>=2&&itemQuery.length<=120)
    return {ok:true,value:{kind:"REPLACE",index,itemQuery}};
  return invalid(
    "Say 'replace item two with SKU 058', 'set item one unit to carton', "+
    "'change item two quantity to five', or 'change item two cost to ₵120.50'.");
}
