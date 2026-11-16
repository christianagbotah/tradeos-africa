import type { SellableItem } from "./catalog-read-model";

/**
 * Conservative, review-only transcription interpreter. No model guesses prices
 * or posts a transaction. Browser recognition may use third-party speech.
 */
export type VoiceIntent = "SALE" | "PURCHASE_ORDER" | "UNKNOWN";
export type VoicePayment = "CASH" | "MOMO" | "BANK" | "CARD" | "CREDIT" | "UNSPECIFIED";
export interface VoiceCustomer { id: string; name: string }
export interface VoiceLine {
  item: SellableItem; quantity: number; spoken: string;
  confidence: "sku" | "name";
}
export interface VoiceDraft {
  intent: VoiceIntent; lines: VoiceLine[];
  customerId: string | null; customerName: string | null;
  paymentMethod: VoicePayment;
  paymentState: "FULL" | "PARTIAL" | "CREDIT" | "UNSPECIFIED";
  tenderedMinor: number | null; warnings: string[]; transcript: string;
}
const numberWords = new Map<string,number>([
  ["a",1],["an",1],["one",1],["single",1],["two",2],["three",3],
  ["four",4],["five",5],["six",6],["seven",7],["eight",8],["nine",9],
  ["ten",10],["dozen",12],
]);
function normalized(value: string): string {
  return value.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
}
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]{}\\]/g,"\\$&");
}
function quantityBefore(text: string, start: number): number {
  const before = normalized(text.slice(Math.max(0,start-45),start));
  const match = before.match(/(?:^|\s)(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|dozen)(?:\s+(?:packs?|pieces?|boxes?|bottles?|cartons?|units?|items?|bags?|pairs?|sets?|doors?|numbers?|no|of|the)){0,4}$/);
  if (!match) return 1;
  // A preceding SKU ("door number 058") must never turn the next line
  // into quantity 58 merely because the SKU ends the previous phrase.
  if (/\b(?:number|no|sku|code)\s+\d{2,}$/.test(before)) return 1;
  const qty = numberWords.get(match[1]!) ?? Number(match[1]);
  return Number.isInteger(qty)&&qty>0&&qty<=500 ? qty : 1;
}
function candidateMatch(text: string, item: SellableItem):
  {start:number;end:number;confidence:"name"|"sku"}|null {
  const sku=normalized(item.sku??"");
  const name=normalized(item.name);
  const candidates: Array<{start:number;end:number;confidence:"name"|"sku"}>=[];
  const normalizedText = normalized(text);
  const words=name.split(" ").filter(Boolean);
  const spokenAlternative=words.length===2?
    words[1]+" of "+words[0]:"";
  for (const [term,confidence] of [[name,"name"],[spokenAlternative,"name"],[sku,"sku"]] as const) {
    if (term.length<3) continue;
    const re=new RegExp("(?:^|\\s)("+escapeRegex(term)+")(?=\\s|$)","g");
    let m:RegExpExecArray|null;
    while ((m=re.exec(normalizedText))!==null) {
      const start=m.index+m[0].length-m[1]!.length;
      candidates.push({start,end:start+m[1]!.length,confidence});
    }
  }
  return candidates.sort((a,b)=>a.start-b.start||
    (b.end-b.start)-(a.end-a.start)||
    (a.confidence==="name"?-1:1))[0]??null;
}
function tenderFromSpeech(text:string):number|null {
  const m=text.match(/\b(?:paid|pay|received|gave|collected)\s+(?:an?\s+)?(?:amount\s+of\s+)?(?:ghs|cedis?|c[eè]dis?|₵)?\s*(\d{1,7}(?:\.\d{1,2})?)\b/i);
  if(!m)return null;
  const minor=Math.round(Number(m[1])*100);
  return Number.isSafeInteger(minor)&&minor>=0?minor:null;
}
export function draftVoiceTransaction(
  transcript: string, sellable: readonly SellableItem[],
  customers: readonly VoiceCustomer[],
): VoiceDraft {
  const safeTranscript=transcript.slice(0,2000).trim();
  const text=normalized(safeTranscript);
  const warnings:string[]=[];
  const intent:VoiceIntent=/\b(?:purchase order|order from supplier|buy stock|restock)\b/.test(text)
    ? "PURCHASE_ORDER"
    : /\b(?:sale|sell|sold|customer|bought|buying|walk in|checkout|purchased)\b/.test(text)
      ? "SALE" : "UNKNOWN";
  if(intent==="UNKNOWN")warnings.push("Choose Sale or Purchase Order before continuing.");
  const matches=sellable.flatMap(item=>{
    const candidate=candidateMatch(safeTranscript,item);
    return candidate?[{item,...candidate}]:[];
  }).sort((a,b)=>a.start-b.start||(b.end-b.start)-(a.end-a.start));
  const distinct:Array<(typeof matches)[number]>=[];
  for(const m of matches){
    if(distinct.some(existing=>m.start<existing.end && m.end>existing.start)){
      const sameStart=distinct.find(existing=>
        m.start<existing.end && m.end>existing.start);
      if(sameStart&&sameStart.item.key!==m.item.key){
        warnings.push("Overlapping item matches require confirmation; check the catalog selection.");
      }
      continue;
    }
    if(distinct.some(existing=>existing.item.key===m.item.key))continue;
    distinct.push(m);
  }
  const lines=distinct.slice(0,30).map(m=>({
    item:m.item,quantity:quantityBefore(text,m.start),
    spoken:safeTranscript.slice(0,180),confidence:m.confidence,
  }));
  if(matches.length>30)warnings.push("Only the first 30 item matches are shown.");
  if(lines.length===0)warnings.push("No exact sellable catalog item or SKU was recognized. Add items manually.");
  const customerMatches=customers.filter(c=>c.name.trim().length>=3&&
    text.includes(normalized(c.name)));
  const customerId=customerMatches.length===1?customerMatches[0]!.id:null;
  const customerName=customerMatches.length===1?customerMatches[0]!.name:null;
  if(customerMatches.length>1)warnings.push("More than one customer name was recognized; choose the customer manually.");
  if(/\b(?:customer|named|by name)\b/.test(text)&&!customerId
     &&!/\bwalk in\b/.test(text))warnings.push(
      "Check the customer name. An unmatched name will not create a new customer.");
  const paymentMethod:VoicePayment=/\b(?:momo|mobile money|mtn money|telecel cash)\b/.test(text)
    ?"MOMO":/\b(?:bank|transfer)\b/.test(text)?"BANK":
    /\b(?:card|visa|mastercard)\b/.test(text)?"CARD":
    /\b(?:cash|notes and coins)\b/.test(text)?"CASH":
    /\b(?:credit|pay later|on account)\b/.test(text)?"CREDIT":"UNSPECIFIED";
  const paymentState:VoiceDraft["paymentState"]=
    /\b(?:part payment|partial|paid part|partly paid|deposit|balance owing)\b/.test(text)
      ?"PARTIAL":/\b(?:on credit|credit sale|pay later|no payment)\b/.test(text)
        ?"CREDIT":/\b(?:fully paid|paid in full|full payment|paid all)\b/.test(text)
          ?"FULL":"UNSPECIFIED";
  if(/\b(?:special price|discount|reduce(?:d)?(?: the)? price|price change|gave it at)\b/.test(text)){
    warnings.push("Spoken discounts are never applied automatically. Request manager approval for a changed selling price.");
  }
  if(paymentState==="PARTIAL"||paymentState==="CREDIT"){
    warnings.push("Credit and part-payments require a linked customer, credit checks and explicit checkout review.");
  }
  if(intent==="PURCHASE_ORDER"){
    warnings.push("Purchase-order voice drafts are for review only; use Purchase Orders to confirm supplier and cost.");
  }
  warnings.push("Catalog prices are estimates until the server validates the final sale.");
  return {intent,lines,customerId,customerName,paymentMethod,
    paymentState,tenderedMinor:tenderFromSpeech(text),warnings,
    transcript:safeTranscript};
}
