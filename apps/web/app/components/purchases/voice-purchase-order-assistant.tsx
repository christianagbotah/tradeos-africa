"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {formatMoney} from "@tradeos/contracts";
import {purchasableUnits,type CatalogItem} from "../../../lib/catalog-read-model";
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
  const speech=useRef<SpeechEngine|null>(null);
  const byId=useMemo(()=>new Map(items.map(item=>[item.id,item])),[items]);
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
  function start(){
    if(listening)return;
    const w=window as SpeechWindow;
    const Factory=w.SpeechRecognition??w.webkitSpeechRecognition;
    if(!Factory){
      setError("This browser does not support speech recognition. Type the purchase order below.");
      return;
    }
    setError(null);setDraft(null);setRows([]);setSupplierId("");setReviewed(false);
    const engine=new Factory();speech.current=engine;
    engine.lang=language;engine.continuous=true;engine.interimResults=false;
    const prior=transcript.trim();
    engine.onresult=event=>{
      const words=Array.from(event.results)
        .map(result=>result[0]?.transcript??"").filter(Boolean).join(" ");
      setTranscript([prior,words].filter(Boolean).join(" ").slice(0,2000));
    };
    engine.onerror=e=>{
      setListening(false);setError(
        e.error==="not-allowed"||e.error==="service-not-allowed"?
        "Microphone permission denied. Type the order instead.":
        "Speech recognition stopped. Review the transcript and try again.");
    };
    engine.onend=()=>{setListening(false);speech.current=null;};
    try{engine.start();setListening(true);}
    catch{speech.current=null;setListening(false);
      setError("Could not start the microphone. Type the order instead.");}
  }
  function prepare(){
    stop();
    const next=draftVoicePurchaseOrder(transcript,items,
      suppliers.filter(s=>s.active).map(s=>s.name));
    setDraft(next);
    setSupplierId("");
    setRows(next.lines.map(line=>({
      key:crypto.randomUUID(),itemId:line.itemId,
      purchaseUnitCode:line.purchaseUnitCode,
      quantity:String(line.quantity),costMinor:null,
      confidence:line.confidence,
    })));
    setReviewed(false);setError(null);
  }
  function updateRow(key:string,patch:Partial<ReviewRow>){
    setRows(prev=>prev.map(row=>row.key===key?{...row,...patch}:row));
    setReviewed(false);
  }
  function addItem(item:CatalogItem){
    if(rows.length>=50)return;
    const unit=purchasableUnits(item)[0];
    if(!unit)return;
    setRows(prev=>[...prev,{
      key:crypto.randomUUID(),itemId:item.id,purchaseUnitCode:unit.code,
      quantity:"1",costMinor:null,confidence:"manual",
    }]);
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
    if(!valid||!reviewed)return;
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
            onClick={listening?stop:start}>
            {listening?"Stop recording":"🎙 Speak order"}
          </button>
        </div>
        {error?<p className={styles.error} role="alert">{error}</p>:null}
        <label className={styles.field}>Review or type your order
          <textarea rows={3} value={transcript} maxLength={2000}
            placeholder="Order 2 door number 058 and 3 bags of cement from Comfort Supplies"
            onChange={e=>{
              setTranscript(e.target.value);
              setDraft(null);setRows([]);setSupplierId("");setReviewed(false);
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
              onClick={()=>{setSupplierId(supplierMention.id);setReviewed(false);}}>
              Select this supplier
            </button>
          </p>:null}
          <label className={styles.field}>Supplier · required
            <select value={supplierId} onChange={e=>{
              setSupplierId(e.target.value);setReviewed(false);
            }}>
              <option value="">Choose the correct supplier</option>
              {suppliers.filter(s=>s.active).map(s=>
                <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
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
                      setReviewed(false);
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
                        purchaseUnitCode:e.target.value})}>
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
            Supplier costs must be entered explicitly. The system never
            substitutes retail selling prices for supplier prices.
            Applying fills the order form only; it does not save, issue,
            pay for or receive stock.
          </p>
          <label className={styles.confirm}>
            <input type="checkbox" checked={reviewed}
              onChange={e=>setReviewed(e.target.checked)}/>
            I verified supplier, SKUs, purchasing units, quantities and costs.
          </label>
          <button type="button" className={styles.primary}
            disabled={!valid||!reviewed} onClick={apply}>
            Use reviewed details in order form
          </button>
        </div>:null}
      </div>
    </section>
  </div>;
}
