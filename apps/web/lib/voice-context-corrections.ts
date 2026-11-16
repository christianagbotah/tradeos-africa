import {
  normalizeForCatalogVoice,
} from "./voice-catalog-matcher";
import type {VoiceCustomer,VoicePayment} from "./voice-transaction-draft";

export type VoiceContextCorrection=
  | {kind:"CUSTOMER";nameQuery:string;walkIn:boolean}
  | {kind:"PAYMENT";method:Exclude<VoicePayment,"UNSPECIFIED">};
export type ContextCorrectionResult=
  | {recognized:false}
  | {recognized:true;ok:false;message:string}
  | {recognized:true;ok:true;value:VoiceContextCorrection};
export type CustomerVoiceCandidate={
  customer:VoiceCustomer;score:number;
};
const normalize=(v:string)=>normalizeForCatalogVoice(v).trim();
const fail=(message:string):ContextCorrectionResult=>({
  recognized:true,ok:false,message,
});
const action=/^(?:change|set|correct|replace|update|use|select|switch|make)\b/;
const paymentWords:ReadonlyArray<[VoicePayment,RegExp]>=[
  ["MOMO",/\b(?:momo|mo mo|mobile money|mtn money|telecel cash)\b/],
  ["BANK",/\b(?:bank|transfer|bank transfer)\b/],
  ["CARD",/\b(?:card|visa|mastercard)\b/],
  ["CASH",/\b(?:cash|notes and coins)\b/],
  ["CREDIT",/\b(?:credit|pay later|on account)\b/],
];
/**
 * Recognize explicit corrections only. Does not authorize any payment,
 * grant credit or create customers. No model-generated names are accepted.
 */
export function parseVoiceContextCorrection(raw:string):ContextCorrectionResult{
  const text=normalize(raw.slice(0,500));
  if(!text)return {recognized:false};
  if(/\b(?:price|discount|reduced price|special rate)\b/.test(text))
    return fail("Price changes require the existing manager-approval workflow.");
  if(/^(?:walk in customer|walkin customer|customer is walk in|(?:use|select|set|change|make)\s+(?:the\s+)?walk in customer)$/.test(text))
    return {recognized:true,ok:true,value:{
      kind:"CUSTOMER",nameQuery:"",walkIn:true,
    }};
  if(/\b(?:customer|buyer)\b/.test(text)&&
    (action.test(text)||/^(?:customer|buyer)\s+(?:is|named)\b/.test(text))){
    const marker=/\b(?:customer|buyer)\b/.exec(text);
    const tail=text.slice(marker!.index+marker![0].length).trim()
      .replace(/^(?:name)\s*/,"")
      .replace(/^(?:(?:to|as|is|named|with)\s+)*/,"")
      .trim();
    if(/^(?:a\s+)?walk\s*in(?:\s+customer)?$/.test(tail))
      return {recognized:true,ok:true,value:{
        kind:"CUSTOMER",nameQuery:"",walkIn:true,
      }};
    if(tail.length<2||tail.length>100||/^\d+$/.test(tail))
      return fail("Say the saved customer name, or choose walk-in customer.");
    if(/\b(?:paid|payment|cash|momo|bank|transfer|card|credit)\b/.test(tail))
      return fail("Correct the customer and payment separately.");
    return {recognized:true,ok:true,value:{
      kind:"CUSTOMER",nameQuery:tail,walkIn:false,
    }};
  }
  if(/\b(?:payment|paid|pay via|pay by|pay with)\b/.test(text)&&
    (action.test(text)||/^(?:payment|paid)\b/.test(text))){
    if(/\b(?:part|partial|split|half|portion)\b/.test(text))
      return fail("Split and part payments must be reviewed in the checkout screen.");
    const cashAdjusted=text.replace(/\btelecel cash\b/g,"telecel mobile money");
    const detected=paymentWords.filter(([_,re])=>re.test(cashAdjusted));
    if(detected.length!==1)
      return fail("Specify one method: cash, MoMo, bank transfer, card, or credit.");
    const method=detected[0]![0];
    if(method==="UNSPECIFIED")return fail("Specify an exact payment method.");
    return {recognized:true,ok:true,value:{kind:"PAYMENT",method}};
  }
  return {recognized:false};
}
function distance(a:string,b:string):number{
  if(Math.abs(a.length-b.length)>2)return 4;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const next=[i];
    for(let j=1;j<=b.length;j++){
      next[j]=Math.min(
        next[j-1]!+1,prev[j]!+1,
        prev[j-1]!+Number(a[i-1]!==b[j-1]),
      );
    }
    prev=next;
  }
  return prev[b.length]??4;
}
function tokenScore(query:string,name:string):number{
  if(query===name)return 1;
  if(name.includes(query)&&query.length>=3)return 0.95;
  const words=query.split(" ").filter(Boolean);
  const targets=name.split(" ").filter(Boolean);
  if(!words.length)return 0;
  const used=new Set<number>();
  let total=0;
  for(const word of words){
    let chosen=-1,best=0;
    for(let i=0;i<targets.length;i++){
      if(used.has(i))continue;
      const target=targets[i]!;
      let score=word===target?1:0;
      if(!score&&word.length>=4&&target.length>=4){
        const d=distance(word,target);
        if(d<=2)score=1-d/Math.max(word.length,target.length);
      }
      if(score>best){best=score;chosen=i;}
    }
    if(best>=0.66&&chosen>=0)used.add(chosen);
    total+=best;
  }
  const average=total/words.length;
  return average>=0.67?average:0;
}
export function rankVoiceCustomerCandidates<T extends VoiceCustomer>(
  spokenName:string,customers:readonly T[],max=8,
):Array<{customer:T;score:number}>{
  const query=normalize(spokenName);
  if(query.length<2)return [];
  return customers.map(customer=>({
    customer,score:tokenScore(query,normalize(customer.name)),
  })).filter(candidate=>candidate.score>=0.67)
    .sort((a,b)=>b.score-a.score||
      a.customer.name.localeCompare(b.customer.name))
    .slice(0,Math.max(1,Math.min(max,20)));
}
