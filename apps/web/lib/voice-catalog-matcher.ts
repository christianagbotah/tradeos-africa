import type {SellableItem} from "./catalog-read-model";

/** Catalog-grounded matching: suggestions never authorize a sale or price. */
export type MatchBasis="sku"|"name"|"similar";
export interface CatalogVoiceMatch {
  item:SellableItem;start:number;end:number;score:number;
  basis:MatchBasis;phrase:string;
}
const DIGITS:Record<string,string>={
  zero:"0",oh:"0",o:"0",one:"1",won:"1",two:"2",to:"2",too:"2",
  three:"3",four:"4",for:"4",five:"5",six:"6",seven:"7",
  eight:"8",ate:"8",nine:"9",niner:"9",
};
const NUMBER_SMALL:Record<number,string>={
  0:"zero",1:"one",2:"two",3:"three",4:"four",5:"five",
  6:"six",7:"seven",8:"eight",9:"nine",10:"ten",
  11:"eleven",12:"twelve",13:"thirteen",14:"fourteen",
  15:"fifteen",16:"sixteen",17:"seventeen",18:"eighteen",
  19:"nineteen",20:"twenty",30:"thirty",40:"forty",
  50:"fifty",60:"sixty",70:"seventy",80:"eighty",90:"ninety",
};
const LETTER_SOUNDS:Record<string,string>={
  a:"ay",b:"bee",c:"see",d:"dee",e:"ee",f:"eff",g:"gee",
  h:"aitch",i:"eye",j:"jay",k:"kay",l:"ell",m:"em",n:"en",
  o:"oh",p:"pee",q:"cue",r:"are",s:"ess",t:"tee",u:"you",
  v:"vee",w:"double you",x:"ex",y:"why",z:"zed",
};
const FILLER=new Set([
  "a","an","the","of","and","for","to","from","number","no",
  "unit","units","item","items","sku","code","model",
  "piece","pieces","pack","packs",
]);
const IGNORE=new Set([
  "record","sale","sell","sold","selling","buy","buying","bought",
  "customer","walk","in","came","come","purchase","order","new",
  "paid","payment","via","with","cash","momo","money","mobile",
  "bank","card","balance","credit","name","named",
  "please","give","take","need","want","i","she","he","we",
  "they","some","then","now","than","at","each","was","is",
  "all","there","our","as","by","has","have","did","would",
]);
export function normalizeForCatalogVoice(value:string):string{
  return value.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/&/g," and ")
    .replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ")
    .replace(/\btake away\b/g,"takeaway")
    .replace(/\bsand paper\b/g,"sandpaper")
    .replace(/\bfly screen\b/g,"flyscreen");
}
const compact=(value:string)=>normalizeForCatalogVoice(value).replace(/\s+/g,"");
const escapeRegExp=(s:string)=>s.replace(/[\^$.*+?()[\]{}|\\]/g,"\\$&");
type Word={text:string;start:number;end:number};
function tokenize(text:string):Word[]{
  return [...text.matchAll(/\S+/g)].map(m=>({
    text:m[0],start:m.index,end:m.index+m[0].length,
  }));
}
function wordNumber(number:number):string{
  if(NUMBER_SMALL[number])return NUMBER_SMALL[number];
  if(number<100){
    const tens=Math.floor(number/10)*10;
    return NUMBER_SMALL[tens]+" "+NUMBER_SMALL[number%10];
  }
  if(number<1000){
    const h=Math.floor(number/100),tail=number%100;
    return NUMBER_SMALL[h]+" hundred"+(tail?" "+wordNumber(tail):"");
  }
  if(number<1000000){
    const thousands=Math.floor(number/1000),tail=number%1000;
    return wordNumber(thousands)+" thousand"+(tail?" "+wordNumber(tail):"");
  }
  return String(number);
}
function phraseAliases(code:string):string[]{
  const s=normalizeForCatalogVoice(code);
  const stripped=compact(code);
  if(!stripped)return[];
  const out=new Set<string>([s,stripped]);
  const groups=stripped.match(/[a-z]+|\d+/g)??[];
  const groupWords=groups.map(group=>/^\d+$/.test(group)?
    group.split("").map(d=>NUMBER_SMALL[Number(d)]).join(" "):group);
  out.add(groupWords.join(" "));
  out.add(groups.flatMap(g=>g.split("")).join(" "));
  out.add(groups.flatMap(g=>g.split("")).map(v=>
    /^\d$/.test(v)?NUMBER_SMALL[Number(v)]:v).join(" "));
  out.add(groups.flatMap(g=>g.split("")).map(v=>
    v==="0"?"oh":/^\d$/.test(v)?NUMBER_SMALL[Number(v)]:v).join(" "));
  out.add(groups.flatMap(g=>g.split("")).map(v=>
    v==="0"?"o":/^\d$/.test(v)?NUMBER_SMALL[Number(v)]:v).join(" "));
  out.add(groups.map(g=>/^\d+$/.test(g)?g:
    g.split("").join(" ")).join(" "));
  out.add(groups.map(g=>/^\d+$/.test(g)?
    wordNumber(Number(g)):g.split("").join(" ")).join(" "));
  out.add(groups.map(g=>/^\d+$/.test(g)?g.split("").map(x=>
    NUMBER_SMALL[Number(x)]).join(" "):g.split("").map(x=>
      LETTER_SOUNDS[x]??x).join(" ")).join(" "));
  if(groups.length===1&&/^\d{2,6}$/.test(stripped)){
    const digits=stripped.split("");
    const spokenDigits=digits.map(d=>NUMBER_SMALL[Number(d)]);
    const numeric=Number(stripped);
    if(numeric<1000000)out.add(wordNumber(numeric));
    if(stripped.startsWith("0")){
      out.add("oh "+spokenDigits.slice(1).join(" "));
      out.add("o "+spokenDigits.slice(1).join(" "));
      if(numeric<100)out.add("zero "+wordNumber(numeric));
      // Leading-zero loss is accepted only in explicit SKU context.
      out.add(String(numeric));
    }
    if(stripped.length===3){
      const lastTwo=Number(stripped.slice(1));
      if(lastTwo>=10&&lastTwo<100){
        out.add(spokenDigits[0]+" "+wordNumber(lastTwo));
      }
    }
  }
  // Speech engines sometimes hear "eight" as "ate", or "two" as "too".
  // Only literal inventory SKU variants are generated, never invented products.
  for(const spoken of [...out]){
    if(/\beight\b/.test(spoken))out.add(spoken.replace(/\beight\b/g,"ate"));
    if(/\btwo\b/.test(spoken))out.add(spoken.replace(/\btwo\b/g,"too"));
    if(/\bfour\b/.test(spoken))out.add(spoken.replace(/\bfour\b/g,"for"));
  }
  return [...out].map(normalizeForCatalogVoice).filter(x=>
    x.length>=2||(stripped.length===1&&x.length===1));
}
const CODE_CONTEXT=/(?:^|\s)(?:sku|skew|s k u|s k you|s q|es cue you|school code|stock code|stock keeping unit|item code|item number|product code|product number|code|number|no|model)(?:\s+|$)/;
const CODE_TAIL=/(?:^|\s)(?:sku|skew|s k u|s k you|s q|es cue you|school code|stock code|stock keeping unit|item code|item number|product code|product number|code|number|no|model)(?:\s+(?:is|as|of|the|number|code)){0,3}\s*$/;
function indexOfPhrase(text:string,phrase:string):Array<[number,number]>{
  if(!phrase)return[];
  const result:Array<[number,number]>=[];
  const re=new RegExp("(?:^|\\s)("+escapeRegExp(phrase)+")(?=\\s|$)","g");
  let m:RegExpExecArray|null;
  while((m=re.exec(text))!==null){
    const start=m.index+m[0].length-m[1]!.length;
    result.push([start,start+m[1]!.length]);
  }
  return result;
}
function codeContext(text:string,start:number,end:number,sku:string):boolean{
  const before=text.slice(Math.max(0,start-42),start);
  const after=text.slice(end,Math.min(text.length,end+18));
  if(!/^\d+$/.test(compact(sku)))return true;
  const tail=before.split(" ").slice(-5).join(" ");
  if(CODE_TAIL.test(tail))
    return true;
  if(/(?:door|doors|tile|tiles|item|items|product|products)\s*$/.test(tail))
    return true;
  if(/(?:bought|sold|sell|sale|give|need|take|buy)\s*$/.test(tail)&&
    /^\d{3,6}$/.test(compact(sku)))return true;
  if(/(?:paid|received|amount|cedis|momo|cash|balance)\s*$/.test(tail))return false;
  if(/(?:\d{2,}|\d+\s+\d+)\s*$/.test(tail))return false;
  if(/(?:cash|momo|cedis|bank|card)/.test(after))return false;
  return /^\d{3,6}$/.test(compact(sku)) &&
    compact(sku)===text.slice(start,end).replace(/\s+/g,"");
}
function findExactSku(text:string,item:SellableItem):CatalogVoiceMatch|null{
  if(!item.sku)return null;
  const sku=compact(item.sku);
  let best:CatalogVoiceMatch|null=null;
  for(const phrase of phraseAliases(item.sku)){
    const leadingDropped=/^\d+$/.test(sku)&&sku.startsWith("0")&&
      phrase===String(Number(sku));
    for(const [start,end] of indexOfPhrase(text,phrase)){
      const contextual=codeContext(text,start,end,item.sku);
      const before=text.slice(Math.max(0,start-30),start);
      const nearCode=CODE_TAIL.test(before)||CODE_CONTEXT.test(before) ||
        /(?:door|product|item)\s*$/.test(before);
      if(!contextual || (leadingDropped&&!nearCode))continue;
      const score=leadingDropped?0.84:nearCode?1.0:0.97;
      const match={item,start,end,score,basis:"sku" as const,phrase:text.slice(start,end)};
      if(!best||score>best.score||(score===best.score&&start<best.start))best=match;
    }
  }
  return best;
}
function stem(word:string):string{
  if(word.length>5&&word.endsWith("ies"))return word.slice(0,-3)+"y";
  if(word.length>4&&word.endsWith("es"))return word.slice(0,-2);
  if(word.length>3&&word.endsWith("s")&&!word.endsWith("ss"))return word.slice(0,-1);
  return word;
}
function phonetic(word:string):string{
  let s=stem(word).replace(/^kn/,"n").replace(/^wr/,"r")
    .replace(/^ph/,"f").replace(/^c(?=[eiy])/,"s")
    .replace(/^c/,"k").replace(/^qu/,"kw")
    .replace(/gh/g,"g").replace(/ck/g,"k").replace(/x/g,"ks")
    .replace(/z/g,"s").replace(/v/g,"f")
    .replace(/sh/g,"s").replace(/ch/g,"k")
    .replace(/th/g,"t");
  const first=s[0]??"";
  s=s.slice(1).replace(/[aeiouy]/g,"").replace(/([a-z])\1+/g,"$1");
  return (first+s).slice(0,7);
}
function editDistance(a:string,b:string):number{
  if(Math.abs(a.length-b.length)>3)return 5;
  let previous=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const current=[i];
    for(let j=1;j<=b.length;j++){
      current.push(Math.min(
        current[j-1]!+1,previous[j]!+1,
        previous[j-1]!+(a[i-1]===b[j-1]?0:1),
      ));
    }
    previous=current;
  }
  return previous[b.length]??5;
}
function tokenSimilarity(a:string,b:string):number{
  if(a===b)return 1;
  if(DIGITS[a]===b||DIGITS[b]===a)return 0.93;
  if(/^\d+$/.test(a)||/^\d+$/.test(b))return 0;
  if(a.length<3||b.length<3)return 0;
  if(stem(a)===stem(b))return 0.96;
  const length=Math.max(a.length,b.length);
  const distance=editDistance(a,b);
  const edit=1-distance/length;
  if(edit>=0.71)return edit;
  if(a.length>=4&&b.length>=4&&phonetic(a)===phonetic(b))return 0.79;
  return 0;
}
function findExactName(text:string,item:SellableItem):CatalogVoiceMatch|null{
  const name=normalizeForCatalogVoice(item.name);
  if(!name)return null;
  const aliases=new Set([name]);
  const words=name.split(" ");
  if(words.length===2)aliases.add(words[1]+" of "+words[0]);
  let best:CatalogVoiceMatch|null=null;
  for(const phrase of aliases){
    if(phrase.length<3)continue;
    for(const [start,end] of indexOfPhrase(text,phrase)){
      const match:CatalogVoiceMatch={
        item,start,end,score:0.99,basis:"name",phrase:text.slice(start,end),
      };
      if(!best||start<best.start)best=match;
    }
  }
  return best;
}
function findApproximateName(text:string,item:SellableItem,
  tokens:readonly Word[]):CatalogVoiceMatch|null{
  const name=normalizeForCatalogVoice(item.name);
  const target=name.split(" ").filter(x=>x&&!FILLER.has(x));
  if(!target.length)return null;
  let best:CatalogVoiceMatch|null=null;
  const targetWeight=target.reduce((s,t)=>s+(/^\d+$/.test(t)?2:1),0);
  // Limit the window so two distant names in a long dictated sale cannot
  // accidentally combine into one unrelated catalog product.
  const windowLength=Math.min(11,Math.max(4,target.length+4));
  for(let start=0;start<tokens.length;start++){
    const first=tokens[start]!.text;
    if(IGNORE.has(first)||FILLER.has(first))continue;
    if(!target.some(w=>tokenSimilarity(w,first)>=0.70))continue;
    const window=tokens.slice(start,start+windowLength);
    const used=new Set<number>();
    let matched=0, quality=0;
    let lastEnd=tokens[start]!.end,firstMatch=Number.MAX_SAFE_INTEGER;
    let hasNumeric=true;
    const words=[...target].sort((a,b)=>
      Number(/^\d+$/.test(b))-Number(/^\d+$/.test(a)) ||
      b.length-a.length);
    for(const word of words){
      let candidate=-1,sim=0;
      for(let j=0;j<window.length;j++){
        if(used.has(j)||IGNORE.has(window[j]!.text))continue;
        const current=tokenSimilarity(word,window[j]!.text);
        if(current>sim){sim=current;candidate=j;}
      }
      if(candidate<0||sim<0.70){
        if(/^\d+$/.test(word))hasNumeric=false;
        continue;
      }
      used.add(candidate);
      const weight=/^\d+$/.test(word)?2:1;
      matched+=weight;quality+=weight*sim;
      lastEnd=Math.max(lastEnd,window[candidate]!.end);
      firstMatch=Math.min(firstMatch,window[candidate]!.start);
    }
    if(!matched)continue;
    // Numeric model codes are not fuzzy matched to a different number.
    if(!hasNumeric)continue;
    const coverage=matched/targetWeight;
    const matchedTokens=used.size;
    if(target.length>1 && coverage<0.42)continue;
    if(target.length===1&&coverage!==1)continue;
    const span=lastEnd-firstMatch;
    const compactness=Math.min(1,(target.length*12)/Math.max(1,span));
    const score=Math.min(0.965,
      0.56*coverage+0.38*(quality/targetWeight)+0.06*compactness);
    // A weak similarity should be suggested, not automatically added.
    if(score<0.51)continue;
    const match:CatalogVoiceMatch={
      item,start:firstMatch,end:lastEnd,score,basis:"similar",
      phrase:text.slice(firstMatch,lastEnd),
    };
    if(!best||match.score>best.score ||
      (match.score===best.score&&match.start<best.start))best=match;
  }
  return best;
}

/** Returns all matched catalog units, including weaker candidates for review. */
export function rankSpokenCatalogProducts(
  transcript:string,items:readonly SellableItem[],
  knownCustomerNames:readonly string[]=[],
):CatalogVoiceMatch[]{
  let text=normalizeForCatalogVoice(transcript.slice(0,2000));
  // Keep indices stable while preventing accidental product matches inside a
  // person's name (e.g. customer "Rose" and an item named "Rose").
  for(const customer of knownCustomerNames){
    const n=normalizeForCatalogVoice(customer);
    if(n.length>=3)text=text.replace(
      new RegExp("(?:^|\\s)"+escapeRegExp(n)+"(?=\\s|$)","g"),
      m=>" ".repeat(m.length));
  }
  const results:CatalogVoiceMatch[]=[];
  const speechTokens=tokenize(text);
  for(const item of items){
    const exactSku=findExactSku(text,item);
    const exactName=findExactName(text,item);
    const fuzzy=findApproximateName(text,item,speechTokens);
    const best=[exactSku,exactName,fuzzy].filter(
      (m):m is CatalogVoiceMatch=>Boolean(m),
    ).sort((a,b)=>b.score-a.score||
      (b.end-b.start)-(a.end-a.start)||a.start-b.start)[0];
    if(best)results.push(best);
  }
  return results.sort((a,b)=>b.score-a.score||
    (b.end-b.start)-(a.end-a.start)||a.start-b.start||
    a.item.name.localeCompare(b.item.name)).slice(0,80);
}
