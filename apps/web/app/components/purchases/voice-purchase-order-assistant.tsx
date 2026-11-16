"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {formatMoney} from "@tradeos/contracts";
import {purchasableUnits,type CatalogItem,type SellableItem}
  from "../../../lib/catalog-read-model";
import {searchPosCatalog} from "../../../lib/pos-catalog-search";
import {parseVoicePOCorrection,type VoicePOCorrection}
  from "../../../lib/voice-purchase-order-correction";
import {normalizeForCatalogVoice} from "../../../lib/voice-catalog-matcher";
import {
  draftVoicePurchaseOrder,type VoicePurchaseOrderDraft,
} from "../../../lib/voice-purchase-order-draft";
import {MoneyInput} from "../ui/money-input";
import type {Supplier} from "./supplier-sheet";
import styles from "./voice-purchase-order-assistant.module.css";

type SpokenResult={transcript:string};
type SpeechEvent={results:ArrayLike<ArrayLike<SpokenResult>>};
type SpeechEngine={
  lang:string;continuous:boolean;interimResults:boolean;
  onresult:((event:SpeechEvent)=>void)|null;
  onerror:((event:{error:string})=>void)|null;
  onend:(()=>void)|null;
  start:()=>void;stop:()=>void;abort:()=>void;
};
type SpeechFactory=new()=>SpeechEngine;
type SpeechWindow=Window&{
  SpeechRecognition?:SpeechFactory;webkitSpeechRecognition?:SpeechFactory;
};
export type VoicePOReviewLine={
  itemId:string;purchaseUnitCode:string;quantity:number;unitCostMinor:number;
};
type ReviewRow={
  key:string;itemId:string;purchaseUnitCode:string;quantity:string;
  costMinor:number|null;confidence:string;
  suggestedCostMinor:number|null;suggestedCostPhrase:string|null;
};
type Props={
  items:readonly CatalogItem[];
  suppliers:readonly Supplier[];
  currencyCode:string;
  onApply:(supplierId:string,lines:VoicePOReviewLine[])=>boolean;
  onClose:()=>void;
};
const example="Create a purchase order from Comfort Supplies: two door number zero five eight and three door number three two six.";
export function VoicePurchaseOrderAssistant({
  items,suppliers,currencyCode,onApply,onClose,
}:Props){
  const [transcript,setTranscript]=useState("");
  const [language,setLanguage]=useState("en-GH");
  const [listening,setListening]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [draft,setDraft]=useState<VoicePurchaseOrderDraft|null>(null);
  const [rows,setRows]=useState<ReviewRow[]>([]);
  const [supplierId,setSupplierId]=useState("");
  const [reviewed,setReviewed]=useState(false);
  const [lookup,setLookup]=useState("");
  const [correctionText,setCorrectionText]=useState("");
  const [correctionError,setCorrectionError]=useState<string|null>(null);
  const [correction,setCorrection]=useState<VoicePOCorrection|null>(null);
  const [correctionSnapshot,setCorrectionSnapshot]=useState("");
  const [correctionTargetKey,setCorrectionTargetKey]=useState("");
  const [replacementId,setReplacementId]=useState("");
  const [replacementChoices,setReplacementChoices]=useState<CatalogItem[]>([]);
  const [unitCode,setUnitCode]=useState("");
  const [correctionSupplierId,setCorrectionSupplierId]=useState("");

  const speech=useRef<SpeechEngine|null>(null);
  const byId=useMemo(()=>new Map(items.map(item=>[item.id,item])),[items]);
  const correctionCatalog=useMemo<SellableItem[]>(()=>items.map(item=>{
    const unit=purchasableUnits(item)[0]!;
    return {
      key:item.id+":"+unit.code,itemId:item.id,name:item.name,sku:item.sku,
      kind:item.kind,unitCode:unit.code,unitLabel:unit.label,
      priceMinor:0,trackStock:true,stockUnitCode:item.stockUnitCode,
      availableStock:null,
    };
  }),[items]);
  const supplierMention=useMemo(()=>{
    const heard=normalizeForCatalogVoice(transcript);
    const matches=suppliers.filter(s=>s.active&&
      normalizeForCatalogVoice(s.name).length>=3&&
      heard.includes(normalizeForCatalogVoice(s.name)));
    return matches.length===1?matches[0]:null;
  },[suppliers,transcript]);
  const filteredItems=useMemo(()=>{
    if(!lookup.trim())return items.slice(0,40);
    const q=normalizeForCatalogVoice(lookup);
    return items.filter(i=>normalizeForCatalogVoice(
      i.name+" "+(i.sku??"")).includes(q)).slice(0,40);
  },[items,lookup]);
  useEffect(()=>()=>{speech.current?.abort();speech.current=null;},[]);
  function stop(){speech.current?.stop();setListening(false);}
  function start(mode:"order"|"correction"="order"){
    if(listening)return;
    const w=window as SpeechWindow;
    const Factory=w.SpeechRecognition??w.webkitSpeechRecognition;
    if(!Factory){
      if(mode==="correction")setCorrectionError(
        "Microphone unavailable. Type the correction below.");
      else setError("This browser does not support speech recognition. Type the purchase order below.");
      return;
    }
    if(mode==="order"){
      setError(null);setDraft(null);setRows([]);setSupplierId("");
      setCorrection(null);setReviewed(false);
    }else{
      setCorrectionError(null);setCorrection(null);setReviewed(false);
    }
    const engine=new Factory();speech.current=engine;
    engine.lang=language;engine.continuous=true;engine.interimResults=false;
    const prior=(mode==="correction"?correctionText:transcript).trim();
    engine.onresult=event=>{
      const words=Array.from(event.results)
        .map(result=>result[0]?.transcript??"").filter(Boolean).join(" ");
      const next=[prior,words].filter(Boolean).join(" ");
      if(mode==="correction"){
        setCorrectionText(next.slice(0,500));setCorrection(null);
      }else setTranscript(next.slice(0,2000));
    };
    engine.onerror=e=>{
      setListening(false);
      const message=e.error==="not-allowed"||e.error==="service-not-allowed"?
        "Microphone permission denied. Type the instruction instead.":
        "Speech recognition stopped. Check the transcript and try again.";
      if(mode==="correction")setCorrectionError(message);
      else setError(message);
    };
    engine.onend=()=>{setListening(false);speech.current=null;};
    try{engine.start();setListening(true);}
    catch{speech.current=null;setListening(false);
      if(mode==="correction")setCorrectionError(
        "Could not start the microphone. Type the correction instead.");
      else setError("Could not start the microphone. Type the order instead.");}
  }
  function prepare(){
    stop();
    const next=draftVoicePurchaseOrder(transcript,items,
      suppliers.filter(s=>s.active).map(s=>s.name));
    setDraft(next);
    setCorrection(null);setCorrectionError(null);setCorrectionText("");
    setSupplierId("");
    setRows(next.lines.map(line=>({
      key:crypto.randomUUID(),itemId:line.itemId,
      purchaseUnitCode:line.purchaseUnitCode,
      quantity:String(line.quantity),costMinor:null,
      confidence:line.confidence,
      suggestedCostMinor:line.suggestedUnitCostMinor,
      suggestedCostPhrase:line.suggestedCostPhrase,
    })));
    setReviewed(false);setError(null);
  }
  function updateRow(key:string,patch:Partial<ReviewRow>){
    setRows(prev=>prev.map(row=>row.key===key?{...row,...patch}:row));
    setCorrection(null);setCorrectionError(null);setReviewed(false);
  }
  function addItem(item:CatalogItem){
    if(rows.length>=50)return;
    const unit=purchasableUnits(item)[0];
    if(!unit)return;
    setRows(prev=>[...prev,{
      key:crypto.randomUUID(),itemId:item.id,purchaseUnitCode:unit.code,
      quantity:"1",costMinor:null,confidence:"manual",
      suggestedCostMinor:null,suggestedCostPhrase:null,
    }]);
    setCorrection(null);setReviewed(false);
  }
  const draftSnapshot=()=>JSON.stringify({
    supplierId,
    rows:rows.map(r=>[r.key,r.itemId,r.purchaseUnitCode,r.quantity,
      r.costMinor,r.suggestedCostMinor]),
  });
  function prepareCorrection(){
    if(!draft)return;
    const parsed=parseVoicePOCorrection(correctionText,rows.length);
    setCorrection(null);setCorrectionError(null);
    setReplacementId("");setReplacementChoices([]);
    setUnitCode("");setCorrectionSupplierId("");
    if(!parsed.ok){setCorrectionError(parsed.message);return;}
    const next=parsed.value;
    const target=next.kind==="SUPPLIER"?null:rows[next.index]??null;
    const item=target?byId.get(target.itemId):null;
    setCorrectionSnapshot(draftSnapshot());
    setCorrectionTargetKey(target?.key??"");
    if(next.kind==="REPLACE"){
      const choices=searchPosCatalog(correctionCatalog,next.itemQuery,12).items
        .map(match=>byId.get(match.itemId)).filter(
          (value):value is CatalogItem=>Boolean(value));
      setReplacementChoices(choices);
      if(!choices.length){
        setCorrectionError("No purchasable catalog match. Try a different item name or SKU.");
        return;
      }
    }
    if(next.kind==="UNIT"){
      const available=item?purchasableUnits(item):[];
      const normalized=normalizeForCatalogVoice(next.unitQuery).replace(/s$/,"");
      const matching=available.find(u=>
        normalizeForCatalogVoice(u.code).replace(/s$/,"")===normalized||
        normalizeForCatalogVoice(u.label).replace(/s$/,"")===normalized);
      if(!matching){
        setCorrectionError("That purchasing unit is not configured for this item. Choose a listed unit.");
      }else setUnitCode(matching.code);
    }
    if(next.kind==="COST"&&next.perUnit&&item){
      const selected=purchasableUnits(item).find(u=>u.code===target?.purchaseUnitCode);
      const normalized=normalizeForCatalogVoice(next.perUnit).replace(/s$/,"");
      if(!selected||![selected.code,selected.label].some(
        u=>normalizeForCatalogVoice(u).replace(/s$/,"")===normalized)){
        setCorrectionError("The spoken cost unit differs from the chosen purchasing unit.");
        return;
      }
    }
    if(next.kind==="SUPPLIER"){
      const matches=suppliers.filter(s=>s.active&&normalizeForCatalogVoice(s.name)
        .includes(next.supplierQuery));
      if(matches.length===0){
        setCorrectionError("No matching active supplier. Say the saved supplier name.");
        return;
      }
    }
    setCorrection(next);
    if(next.kind!=="UNIT")setCorrectionError(null);
  }
  function confirmCorrection(){
    if(!draft||!correction)return;
    if(correctionSnapshot!==draftSnapshot()||
      (correction.kind!=="SUPPLIER"&&
        rows[correction.index]?.key!==correctionTargetKey)){
      setCorrection(null);
      setCorrectionError("The order changed. Prepare the correction again.");
      return;
    }
    const change=correction;
    const current=change.kind==="SUPPLIER"?null:rows[change.index];
    const item=current?byId.get(current.itemId):null;
    if(change.kind==="SUPPLIER"){
      const supplier=suppliers.find(s=>s.id===correctionSupplierId&&s.active);
      if(!supplier){setCorrectionError("Select a saved active supplier first.");return;}
      setSupplierId(supplier.id);
      if(supplier.id!==supplierId)setRows(prev=>prev.map(row=>({
        ...row,costMinor:null,suggestedCostMinor:null,suggestedCostPhrase:null,
      })));
    }else if(change.kind==="REMOVE"){
      setRows(prev=>prev.filter((_,i)=>i!==change.index));
    }else if(change.kind==="QUANTITY"){
      setRows(prev=>prev.map((row,i)=>i===change.index?
        {...row,quantity:String(change.quantity)}:row));
    }else if(change.kind==="COST"){
      if(!item||!current){setCorrectionError("The chosen item no longer exists.");return;}
      setRows(prev=>prev.map((row,i)=>i===change.index?
        {...row,costMinor:change.unitCostMinor,
          suggestedCostMinor:null,suggestedCostPhrase:null}:row));
    }else if(change.kind==="UNIT"){
      if(!item||!purchasableUnits(item).some(u=>u.code===unitCode)){
        setCorrectionError("Choose a configured purchasing unit first.");return;
      }
      setRows(prev=>prev.map((row,i)=>i===change.index?
        {...row,purchaseUnitCode:unitCode,costMinor:null,
          suggestedCostMinor:null,suggestedCostPhrase:null}:row));
    }else{
      const selected=replacementChoices.some(x=>x.id===replacementId);
      const replacement=selected?byId.get(replacementId):undefined;
      const unit=replacement&&replacement.active&&replacement.kind==="PRODUCT"&&
        replacement.trackStock?purchasableUnits(replacement)[0]:null;
      if(!replacement||!unit){
        setCorrectionError("Select a purchasable catalog replacement first.");return;
      }
      setRows(prev=>prev.map((row,i)=>i===change.index?
        {...row,itemId:replacement.id,purchaseUnitCode:unit.code,
          quantity:"1",costMinor:null,suggestedCostMinor:null,
          suggestedCostPhrase:null,confidence:"manual"}:row));
    }
    setCorrection(null);setCorrectionError(null);setCorrectionText("");
    setReplacementId("");setUnitCode("");setCorrectionSupplierId("");
    setReviewed(false);
  }
  const valid=rows.length>0&&rows.length<=50&&Boolean(supplierId)&&
    suppliers.some(s=>s.id===supplierId&&s.active)&&rows.every(row=>{
      const item=byId.get(row.itemId);
      const quantity=Number(row.quantity);
      return item&&item.active&&item.kind==="PRODUCT"&&item.trackStock&&
        purchasableUnits(item).some(u=>u.code===row.purchaseUnitCode)&&
        Number.isFinite(quantity)&&quantity>0&&quantity<=1_000_000&&
        Math.abs(quantity*1e8-Math.round(quantity*1e8))<.001&&
        row.costMinor!==null&&Number.isSafeInteger(row.costMinor)&&row.costMinor>=0;
    });
  const total=rows.reduce((n,r)=>n+
    Math.round((r.costMinor??0)*(Number(r.quantity)||0)),0);
  function apply(){
    if(!valid||!reviewed||correction)return;
    const reviewedLines=rows.map(row=>({
      itemId:row.itemId,purchaseUnitCode:row.purchaseUnitCode,
      quantity:Number(row.quantity),unitCostMinor:row.costMinor!,
    }));
    if(onApply(supplierId,reviewedLines))onClose();
  }
  return <div className={styles.backdrop} role="presentation">
    <section role="dialog" aria-modal="true" aria-label="Speak a purchase order"
      className={styles.dialog}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>Purchase order · voice assistant</span>
          <h2>Speak a purchase order</h2>
          <p>Say supplier and item names or SKUs, then check every detail before saving.</p>
        </div>
        <button type="button" className={styles.close} onClick={()=>{
          stop();onClose();
        }} aria-label="Close purchase order assistant">×</button>
      </header>
      <div className={styles.body}>
        <p className={styles.hint}>
          Example: “{example}”
        </p>
        <div className={styles.buttons}>
          <label className={styles.language}>Speech language
            <select value={language} onChange={e=>setLanguage(e.target.value)}
              disabled={listening}>
              <option value="en-GH">English (Ghana)</option>
              <option value="en-GB">English (UK)</option>
              <option value="en-US">English (US)</option>
            </select>
          </label>
          <button className={styles.primary} type="button"
            onClick={listening?stop:()=>start("order")}>
            {listening?"Stop recording":"🎙 Speak order"}
          </button>
        </div>
        {error?<p className={styles.error} role="alert">{error}</p>:null}
        <label className={styles.field}>Review or type your order
          <textarea rows={3} value={transcript} maxLength={2000}
            placeholder="Order 2 door number 058 and 3 bags of cement from Comfort Supplies"
            onChange={e=>{
              setTranscript(e.target.value);
              setDraft(null);setRows([]);setSupplierId("");
              setCorrection(null);setCorrectionText("");setReviewed(false);
            }}/>
        </label>
        <button type="button" className={styles.secondary}
          disabled={!transcript.trim()||listening} onClick={prepare}>
          Find catalog products
        </button>
        {draft?<div className={styles.review}>
          <h3>Review proposed order</h3>
          {draft.warnings.map((message,i)=>
            <p className={styles.hint} key={i}>{message}</p>)}
          {supplierMention?<p className={styles.hint}>
            Supplier mentioned: <strong>{supplierMention.name}</strong>.
            <button type="button" className={styles.linkButton}
              onClick={()=>{
                setSupplierId(supplierMention.id);setCorrection(null);setReviewed(false);
              }}>
              Select this supplier
            </button>
          </p>:null}
          <label className={styles.field}>Supplier · required
            <select value={supplierId} onChange={e=>{
              setSupplierId(e.target.value);setCorrection(null);setReviewed(false);
            }}>
              <option value="">Choose the correct supplier</option>
              {suppliers.filter(s=>s.active).map(s=>
                <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <section className={styles.correctionPanel}
            aria-label="Correct purchase order by voice">
            <h4>Correct this order by voice or text</h4>
            <p className={styles.hint}>
              Say “change item two quantity to five”, “set item one unit to carton”,
              “change item two cost to ₵120.50”, “replace item one with SKU 058”,
              “remove item three”, or “change supplier to Comfort Supplies”.
              A correction only changes this unposted draft after confirmation.
            </p>
            <div className={styles.buttons}>
              <button type="button" className={styles.secondary}
                onClick={listening?stop:()=>start("correction")}>
                {listening?"Stop microphone":"🎙 Speak correction"}
              </button>
            </div>
            <label className={styles.field}>Correction instruction
              <input type="text" value={correctionText} maxLength={500}
                aria-label="Spoken purchase-order correction"
                placeholder="Change item two quantity to five"
                onChange={e=>{
                  setCorrectionText(e.target.value);
                  setCorrection(null);setCorrectionError(null);
                }}/>
            </label>
            <button type="button" className={styles.secondary}
              disabled={!correctionText.trim()||listening} onClick={prepareCorrection}>
              Prepare correction for review
            </button>
            {correctionError?<p className={styles.error} role="alert">
              {correctionError}</p>:null}
            {correction?<div className={styles.correctionPreview}>
              {correction.kind!=="SUPPLIER"?<p>
                Item {correction.index+1}: <strong>{
                  byId.get(rows[correction.index]?.itemId??"")?.name??"Unknown"
                }</strong>
              </p>:null}
              {correction.kind==="REMOVE"?<p>Proposed change: remove this draft line.</p>:null}
              {correction.kind==="QUANTITY"?<p>
                Proposed quantity: <strong>{correction.quantity}</strong>
              </p>:null}
              {correction.kind==="COST"?<p>
                Proposed supplier unit cost: <strong>{
                  formatMoney(correction.unitCostMinor,currencyCode)}</strong>
                {correction.perUnit?" per "+correction.perUnit:" per selected purchasing unit"}.
                Confirm this amount against the supplier quote.
              </p>:null}
              {correction.kind==="UNIT"?<label className={styles.field}>
                Select the actual configured purchasing unit
                <select value={unitCode} onChange={e=>{setUnitCode(e.target.value);setCorrectionError(null);}}>
                  <option value="">Choose purchasing unit</option>
                  {(byId.get(rows[correction.index]?.itemId??"")?
                    purchasableUnits(byId.get(rows[correction.index]?.itemId??"")!):[]
                  ).map(unit=><option key={unit.code} value={unit.code}>
                    {unit.label}</option>)}
                </select>
                <span className={styles.hint}>Changing a unit clears existing supplier costs.</span>
              </label>:null}
              {correction.kind==="REPLACE"?<label className={styles.field}>
                Select the replacement catalog product
                <select value={replacementId}
                  onChange={e=>{setReplacementId(e.target.value);setCorrectionError(null);}}>
                  <option value="">Select the exact purchasable item</option>
                  {replacementChoices.map(item=><option key={item.id} value={item.id}>
                    {item.name} · {item.sku??"No SKU"}</option>)}
                </select>
                <span className={styles.hint}>Replacement resets the quantity to one, selects the new product's default purchasing unit, and clears old costs. Verify all three.</span>
              </label>:null}
              {correction.kind==="SUPPLIER"?<label className={styles.field}>
                Select the saved active supplier
                <select value={correctionSupplierId}
                  onChange={e=>{setCorrectionSupplierId(e.target.value);setCorrectionError(null);}}>
                  <option value="">Choose the correct supplier</option>
                  {suppliers.filter(s=>s.active&&
                    normalizeForCatalogVoice(s.name).includes(correction.supplierQuery)
                  ).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>:null}
              <button type="button" className={styles.primary}
                disabled={(correction.kind==="REPLACE"&&!replacementId)||
                  (correction.kind==="UNIT"&&!unitCode)||
                  (correction.kind==="SUPPLIER"&&!correctionSupplierId)}
                onClick={confirmCorrection}>Confirm change to draft only</button>
            </div>:null}
          </section>
          <div className={styles.listHeading}>
            <h4>Items and supplier unit costs</h4><span>{rows.length}/50</span>
          </div>
          <div className={styles.rows}>
            {rows.map((row,index)=>{
              const item=byId.get(row.itemId);
              const units=item?purchasableUnits(item):[];
              return <article className={styles.row} key={row.key}>
                <div className={styles.rowTop}>
                  <strong>Item {index+1}</strong>
                  <button className={styles.remove} type="button"
                    aria-label={"Remove proposed item "+(index+1)}
                    onClick={()=>{
                      setRows(prev=>prev.filter(r=>r.key!==row.key));
                      setCorrection(null);setReviewed(false);
                    }}>Remove</button>
                </div>
                <div className={styles.inputs}>
                  <label className={styles.field}>Catalog item
                    <select value={row.itemId}
                      onChange={e=>{
                        const next=byId.get(e.target.value);
                        updateRow(row.key,{
                          itemId:e.target.value,
                          purchaseUnitCode:next?purchasableUnits(next)[0]?.code??"":"",
                          costMinor:null,suggestedCostMinor:null,
                          suggestedCostPhrase:null,
                        });
                      }}>
                      <option value="">Choose an item</option>
                      {items.map(i=><option key={i.id} value={i.id}>
                        {i.name} · {i.sku||"No SKU"}
                      </option>)}
                    </select>
                  </label>
                  <label className={styles.field}>Purchasing unit
                    <select value={row.purchaseUnitCode}
                      onChange={e=>updateRow(row.key,{
                        purchaseUnitCode:e.target.value,
                        costMinor:null,suggestedCostMinor:null,
                        suggestedCostPhrase:null,
                      })}>
                      {units.map(unit=><option key={unit.code} value={unit.code}>
                        {unit.label}</option>)}
                    </select>
                  </label>
                  <label className={styles.field}>Quantity
                    <input type="number" inputMode="decimal" min="0.00000001"
                      max="1000000" step="any" value={row.quantity}
                      onChange={e=>updateRow(row.key,{quantity:e.target.value})}/>
                  </label>
                  <div className={styles.cost}>
                    {row.suggestedCostMinor!==null&&row.costMinor===null?
                      <div className={styles.costSuggestion} role="note">
                        <span>Speech suggested {formatMoney(row.suggestedCostMinor,currencyCode)} per selected unit</span>
                        <small>Heard: “{row.suggestedCostPhrase}”. Verify against the supplier quote.</small>
                        <button className={styles.secondary} type="button"
                          onClick={()=>updateRow(row.key,{
                            costMinor:row.suggestedCostMinor,
                          })}>Use suggested cost</button>
                      </div>:null}
                    <MoneyInput currencyCode={currencyCode}
                      label="Supplier unit cost · required"
                      valueMinor={row.costMinor}
                      onChange={amount=>updateRow(row.key,{costMinor:amount})}/>
                  </div>
                </div>
                {row.confidence==="similar"?<p className={styles.hint}>
                  Similar-sounding match. Check item and SKU before proceeding.
                </p>:null}
                <div className={styles.lineTotal}>
                  Estimated line amount:
                  <strong>{formatMoney(Math.round(
                    (row.costMinor??0)*(Number(row.quantity)||0)),currencyCode)}</strong>
                </div>
              </article>;
            })}
          </div>
          {draft.suggestions.length?<section className={styles.suggestions}>
            <h4>Similar products to consider</h4>
            {draft.suggestions.map(line=>{
              const item=byId.get(line.itemId);
              return item?<div className={styles.suggestion} key={item.id}>
                <span>{item.name} · {item.sku??"No SKU"}</span>
                <button type="button" className={styles.secondary}
                  disabled={rows.length>=50}
                  onClick={()=>addItem(item)}>Add for review</button>
              </div>:null;
            })}
          </section>:null}
          <section className={styles.suggestions}>
            <h4>Need another item?</h4>
            <label className={styles.field}>Find an active catalog product
              <input type="search" value={lookup}
                placeholder="Search product name or SKU"
                onChange={e=>setLookup(e.target.value)}/>
            </label>
            {lookup.trim()?<div className={styles.searchResults}>
              {filteredItems.length?filteredItems.map(item=>
                <div className={styles.suggestion} key={item.id}>
                  <span>{item.name} · {item.sku??"No SKU"}</span>
                  <button className={styles.secondary} type="button"
                    disabled={rows.length>=50} onClick={()=>addItem(item)}>
                    Add</button>
                </div>):<p>No purchasable catalog match.</p>}
            </div>:null}
          </section>
          <div className={styles.total}>
            <span>Estimated order amount</span><strong>{formatMoney(total,currencyCode)}</strong>
          </div>
          <p className={styles.hint}>
            Supplier unit costs must be reviewed and explicitly entered or
            accepted one line at a time. The system never substitutes retail
            selling prices for supplier prices.
            Applying fills the order form only; it does not save, issue,
            pay for or receive stock.
          </p>
          <label className={styles.confirm}>
            <input type="checkbox" checked={reviewed}
              onChange={e=>setReviewed(e.target.checked)}/>
            I verified supplier, SKUs, purchasing units, quantities and costs.
          </label>
          <button type="button" className={styles.primary}
            disabled={!valid||!reviewed||Boolean(correction)} onClick={apply}>
            Use reviewed details in order form
          </button>
        </div>:null}
      </div>
    </section>
  </div>;
}
