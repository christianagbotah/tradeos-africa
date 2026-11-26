import {normalizeForCatalogVoice} from "./voice-catalog-matcher";

/** Parses changes to an unposted draft; requires separate UI confirmation. */
export type VoiceDraftCorrection=
  | {kind:"REMOVE";index:number}
  | {kind:"QUANTITY";index:number;quantity:number}
  | {kind:"REPLACE";index:number;productQuery:string};
export type VoiceCorrectionResult=
  | {ok:true;value:VoiceDraftCorrection}
  | {ok:false;message:string};

const numbers:Record<string,number>={
  one:1,first:1,two:2,second:2,three:3,third:3,
  four:4,fourth:4,five:5,fifth:5,six:6,sixth:6,
  seven:7,seventh:7,eight:8,eighth:8,nine:9,ninth:9,
  ten:10,tenth:10,
};
const amounts:Record<string,number>={
  ...numbers,eleven:11,twelve:12,twenty:20,thirty:30,
  forty:40,fifty:50,hundred:100,
};
const ordinal="\\d{1,2}(?:st|nd|rd|th)?|one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|seventh|eight|eighth|nine|ninth|ten|tenth";
const itemRegex=new RegExp("\\b(?:item|line|product)(?:\\s+(?:number|no))?\\s+("+ordinal+")\\b");
const getNumber=(s:string)=>numbers[s]??Number(s.replace(/(?:st|nd|rd|th)$/,""));
const getQuantity=(s:string)=>amounts[s]??Number(s);

export function parseVoiceDraftCorrection(
  command:string,linesCount:number,
):VoiceCorrectionResult{
  const text=normalizeForCatalogVoice(command.slice(0,500)).trim();
  if(!text)return {ok:false,message:"Speak or type the correction first."};
  if(/\b(?:discount|reduce price|price to|unit price|give at|special price)\b/.test(text))
    return {ok:false,message:"Price changes need manager approval in Prices & approvals."};
  const target=itemRegex.exec(text);
  if(!target)return {ok:false,message:
    "Specify an item number, such as 'change item two to SKU 326'."};
  const number=getNumber(target[1]!);
  if(!Number.isInteger(number)||number<1||number>linesCount)
    return {ok:false,message:"That item number is not in the current draft."};
  const index=number-1;
  const before=text.slice(0,target.index).trim();
  const after=text.slice(target.index+target[0].length).trim();
  if(/\b(?:remove|delete|drop|cancel)\b/.test(before))
    return {ok:true,value:{kind:"REMOVE",index}};
  const qtyRequest=/\b(?:quantity|qty)\b/.test(before)||
    /^(?:quantity|qty)\b/.test(after);
  const tail=after.match(/(?:quantity|qty)\s+(?:to|as|is|equals)?\s*(\d{1,3}|[a-z]+)/)||
    (qtyRequest?after.match(/(?:to|as|is|equals)\s+(\d{1,3}|[a-z]+)\s*$/):null);
  if(qtyRequest||tail){
    const q=getQuantity(tail?.[1]??"");
    if(!Number.isInteger(q)||q<1||q>500)
      return {ok:false,message:"Specify a quantity from 1 to 500."};
    return {ok:true,value:{kind:"QUANTITY",index,quantity:q}};
  }
  if(!/\b(?:change|edit|replace|correct|swap|update)\b/.test(before))
    return {ok:false,message:
      "Say 'change item two to [product]' or 'remove item one'."};
  const replacement=after.match(/^(?:to|with|as|for)\s+(.+)$/);
  const productQuery=replacement?.[1]?.trim()??"";
  if(productQuery.length<2)
    return {ok:false,message:"Say the replacement product name or SKU."};
  return {ok:true,value:{kind:"REPLACE",index,productQuery}};
}
