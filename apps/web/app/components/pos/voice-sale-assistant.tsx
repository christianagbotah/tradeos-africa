"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import { filterSellableItems, type SellableItem } from "../../../lib/catalog-read-model";
import {rankSpokenCatalogProducts} from "../../../lib/voice-catalog-matcher";
import type { Customer } from "../workspace/workspace-provider";
import {
  draftVoiceTransaction, type VoiceDraft, type VoicePayment,
} from "../../../lib/voice-transaction-draft";
import type { CartLine } from "./cart-panel";
import styles from "./voice-sale-assistant.module.css";

type SpokenResult = { transcript: string };
type SpeechEvent = { results: ArrayLike<ArrayLike<SpokenResult>> };
type SpeechEngine = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type SpeechFactory = new() => SpeechEngine;
type WindowWithRecognition = Window & {
  SpeechRecognition?:SpeechFactory; webkitSpeechRecognition?:SpeechFactory;
};
type Props = {
  sellable: readonly SellableItem[];
  customers: readonly Customer[];
  currencyCode: string;
  onApply: (lines: CartLine[],customerId:string|null,payment:VoicePayment) => boolean;
  onClose: () => void;
};
const sample = "Record a sale: Comfort Mensah bought two door number 058 and one door number 326, paid by MoMo.";
export function VoiceSaleAssistant({sellable,customers,currencyCode,onApply,onClose}:Props) {
  const [transcript,setTranscript]=useState("");
  const [draft,setDraft]=useState<VoiceDraft|null>(null);
  const [recognitionError,setRecognitionError]=useState<string|null>(null);
  const [listening,setListening]=useState(false);
  const [reviewed,setReviewed]=useState(false);
  const [customerId,setCustomerId]=useState<string>("");
  const [paymentMethod,setPaymentMethod]=useState<VoicePayment>("UNSPECIFIED");
  const [language,setLanguage]=useState("en-GH");
  const [catalogSearch,setCatalogSearch]=useState("");
  const manualMatches=useMemo(()=>{
    if(!catalogSearch.trim())return [];
    const exact=filterSellableItems(sellable,catalogSearch).slice(0,12);
    if(exact.length)return exact;
    return rankSpokenCatalogProducts(catalogSearch,sellable).slice(0,10)
      .map(candidate=>candidate.item);
  },[catalogSearch,sellable]);
  const activeRef=useRef<SpeechEngine|null>(null);
  useEffect(()=>()=>{activeRef.current?.abort();activeRef.current=null;},[]);
  function stop(){
    activeRef.current?.stop();
    setListening(false);
  }
  function start(){
    if(listening)return;
    const w=window as WindowWithRecognition;
    const Factory=w.SpeechRecognition??w.webkitSpeechRecognition;
    if(!Factory){
      setRecognitionError(
        "Voice recognition is not available in this browser. Type or paste the transaction below.");
      return;
    }
    setRecognitionError(null);
    setReviewed(false);
    setDraft(null);
    const engine=new Factory();
    activeRef.current=engine;
    engine.lang=language;
    engine.continuous=false;
    engine.interimResults=true;
    const prior=transcript.trim();
    engine.onresult=(event)=>{
      const segments=Array.from(event.results)
        .map(segment=>segment[0]?.transcript??"").filter(Boolean);
      setTranscript([prior,segments.join(" ")].filter(Boolean).join(" ").slice(0,2000));
    };
    engine.onerror=(event)=>{
      setListening(false);
      setRecognitionError(
        event.error==="not-allowed"||event.error==="service-not-allowed"?
          "Microphone permission was denied. Enable it in your browser or use text entry.":
          "Speech recognition stopped ("+event.error+"). Check the transcript and try again.");
    };
    engine.onend=()=>{
      activeRef.current=null;
      setListening(false);
    };
    try{engine.start();setListening(true);}
    catch{activeRef.current=null;setListening(false);
      setRecognitionError("Could not start voice recognition. Try manual text entry.");}
  }
  function analyze(){
    if(!transcript.trim())return;
    const result=draftVoiceTransaction(transcript,sellable,customers);
    setDraft(result);
    setCustomerId(result.customerId??"");
    setPaymentMethod(result.paymentMethod);
    setReviewed(false);
    setRecognitionError(null);
  }
  function updateLine(index:number,update:{item?:SellableItem;quantity?:number}){
    setDraft(prev=>prev?{...prev,lines:prev.lines.map((line,i)=>
      i===index?{...line,...update}:line)}:prev);
    setReviewed(false);
  }
  function addCandidate(item:SellableItem){
    setDraft(prev=>{
      if(!prev)return prev;
      const alreadyAdded=prev.lines.some(line=>line.item.key===item.key);
      if(alreadyAdded)return prev;
      return {...prev,
        lines:[...prev.lines,{item,quantity:1,
          spoken:"Confirmed in catalog",confidence:"similar"}],
        suggestions:prev.suggestions.filter(s=>s.item.key!==item.key)};
    });
    setReviewed(false);
    setRecognitionError(null);
  }
  function apply(){
    if(!draft||!reviewed||draft.intent!=="SALE"||!draft.lines.length)return;
    const cleaned=draft.lines.filter(l=>
      Number.isInteger(l.quantity)&&l.quantity>0&&l.quantity<=500);
    if(!cleaned.length)return;
    if(cleaned.length!==draft.lines.length){
      setRecognitionError("Fix quantities before applying the draft.");return;
    }
    const keys=new Set(cleaned.map(l=>l.item.key));
    if(keys.size!==cleaned.length){
      setRecognitionError("A product appears more than once. Combine duplicate lines first.");return;
    }
    if(onApply(cleaned.map(l=>({sellable:l.item,quantity:l.quantity})),
      customerId||null,paymentMethod))onClose();
  }
  const totalMinor=draft?.lines.reduce((total,line)=>
    total+line.item.priceMinor*line.quantity,0)??0;
  return <div className={styles.backdrop} role="presentation">
    <section className={styles.dialog} role="dialog" aria-modal="true"
      aria-label="Voice-assisted transaction draft">
      <header className={styles.header}>
        <div>
          <h2>Speak a transaction</h2>
          <p>Record sales by voice, then check every product and amount before checkout.</p>
        </div>
        <button type="button" className={styles.close} onClick={()=>{stop();onClose();}}
          aria-label="Close voice assistant">×</button>
      </header>
      <div className={styles.body}>
        <p className={styles.privacy}>The browser's speech provider may process your audio.
          TradeOS receives no raw audio from this feature. Use a quiet area when speaking
          customer names and amounts; do not dictate card details or PINs.</p>
        <div className={styles.controls}>
          <label>Speech language
            <select value={language} onChange={e=>setLanguage(e.target.value)}
              disabled={listening}>
              <option value="en-GH">English (Ghana)</option>
              <option value="en-GB">English (UK)</option>
              <option value="en-US">English (US)</option>
            </select>
          </label>
          <button type="button" className={styles.primary}
            onClick={listening?stop:start}>
            {listening?"Stop listening":"🎙 Start speaking"}
          </button>
          {listening?<span role="status">Listening…</span>:null}
        </div>
        <label className={styles.field}>Your transaction
          <textarea rows={4} value={transcript} maxLength={2000}
            placeholder={sample}
            onChange={e=>{setTranscript(e.target.value);setDraft(null);setReviewed(false);}}/>
        </label>
        {recognitionError?<p className={styles.warning} role="alert">{recognitionError}</p>:null}
        <div className={styles.controls}>
          <button type="button" className={styles.primary} disabled={!transcript.trim()||listening}
            onClick={analyze}>Prepare draft for review</button>
          <button type="button" onClick={()=>{
            stop();setTranscript("");setDraft(null);setReviewed(false);setCustomerId("");
          }}>Clear</button>
        </div>
        {draft?<div className={styles.review}>
          <h3>Review draft — nothing has been posted</h3>
          <p>Detected intent: <strong>{draft.intent==="SALE"?"Sale":
            draft.intent==="PURCHASE_ORDER"?"Purchase order":"Not recognized"}</strong>.
            {draft.intent==="PURCHASE_ORDER"?
              " Confirm supplier, units and buying costs in Purchase Orders before saving.":null}</p>
          {draft.warnings.map((warning,i)=><p key={i} className={styles.warning}>
            {warning}</p>)}
          <div className={styles.lines}>
            {draft.lines.map((line,i)=><div key={i} className={styles.line}>
              <label>Item {i+1} {line.confidence==="similar"?"· Similar sounding — verify":""}
                <select value={line.item.key}
                  onChange={e=>{
                    const chosen=sellable.find(item=>item.key===e.target.value);
                    if(chosen)updateLine(i,{item:chosen});
                  }}>
                  {sellable.map(item=><option key={item.key} value={item.key}>
                    {item.name} · {item.unitLabel}{item.sku?" · "+item.sku:""}
                  </option>)}
                </select>
              </label>
              <label>Qty
                <input type="number" min={1} max={500} step={1} value={line.quantity}
                  onChange={e=>updateLine(i,{quantity:Number(e.target.value)})}/>
              </label>
              <div className={styles.money}>{formatMoney(
                line.item.priceMinor*line.quantity,currencyCode)}</div>
              <button type="button" aria-label={"Remove item "+(i+1)} onClick={()=>{
                setDraft(prev=>prev?{...prev,lines:prev.lines.filter((_,j)=>j!==i)}:prev);
                setReviewed(false);
              }}>Remove</button>
            </div>)}
          </div>
          {draft.suggestions.length ? <section className={styles.suggestSection}>
            <h4>Possible matching products</h4>
            <p>These were not automatically added. Check whether one of them
              matches what you said, then tap Add.</p>
            <div className={styles.candidates}>
              {draft.suggestions.map(s=><div key={s.item.key} className={styles.candidate}>
                <div><strong>{s.item.name}</strong>
                  <span>{s.item.sku||"No SKU"} · {s.item.unitLabel} · {formatMoney(
                    s.item.priceMinor,currencyCode)}</span></div>
                <button type="button" onClick={()=>addCandidate(s.item)}>
                  Add</button>
              </div>)}
            </div>
          </section> : null}
          <section className={styles.suggestSection}>
            <h4>Can't find the spoken product?</h4>
            <p>Search the actual catalog by name or SKU, including similar spellings.</p>
            <input type="search" value={catalogSearch}
              placeholder="Find a product or SKU to add…"
              aria-label="Find product manually in voice draft"
              onChange={e=>setCatalogSearch(e.target.value)} />
            {catalogSearch.trim()?<div className={styles.candidates}>
              {manualMatches.length?manualMatches.map(item=><div key={item.key}
                className={styles.candidate}>
                <div><strong>{item.name}</strong>
                  <span>{item.sku||"No SKU"} · {item.unitLabel} · {formatMoney(
                    item.priceMinor,currencyCode)}</span></div>
                <button type="button" onClick={()=>addCandidate(item)}>
                  Add</button>
              </div>):<p>No catalog match. Verify the item is active and has a selling unit with a price.</p>}
            </div>:null}
          </section>
          <label>Customer
            <select value={customerId} onChange={e=>{setCustomerId(e.target.value);setReviewed(false);}}>
              <option value="">Walk-in / select later</option>
              {customers.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>
                {c.name}
              </option>)}
            </select>
          </label>
          <label>Spoken payment preference
            <select value={paymentMethod}
              onChange={e=>{setPaymentMethod(e.target.value as VoicePayment);setReviewed(false);}}>
              <option value="UNSPECIFIED">Decide at checkout</option>
              <option value="CASH">Cash</option>
              <option value="MOMO">MoMo</option>
              <option value="BANK">Bank transfer</option>
              <option value="CARD">Card</option>
              <option value="CREDIT">Pay later / credit</option>
            </select>
          </label>
          <strong>Draft catalog total: {formatMoney(totalMinor,currencyCode)}</strong>
          {draft.paymentState==="PARTIAL"?<p className={styles.warning}>
            Partial payment was mentioned. Set the split and remaining credit in
            checkout; this draft will not infer the unpaid balance.</p>:null}
          <label className={styles.confirm}>
            <input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>
            I reviewed the customer, item identities, quantities and displayed amounts.
          </label>
          <button type="button" className={styles.primary} disabled={!reviewed||
            draft.intent!=="SALE"||draft.lines.length===0} onClick={apply}>
            Add reviewed items to sale cart
          </button>
          <p className={styles.privacy}>Adding the cart does not take payment or post a sale.
            Checkout calculates authoritative prices and requires a final confirmation.</p>
        </div>:null}
      </div>
    </section>
  </div>;
}
