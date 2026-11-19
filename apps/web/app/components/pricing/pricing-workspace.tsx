"use client";

import { useActionFeedbackMessages } from "../ui/action-feedback";
import {useCallback,useEffect,useMemo,useState} from "react";
import {formatMoney} from "@tradeos/contracts";
import {useWorkspace} from "../workspace/use-workspace";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import {indexInventory,projectSellableItems} from "../../../lib/catalog-read-model";
import {MoneyInput} from "../ui/money-input";
import styles from "./pricing-workspace.module.css";

type Rate={id:string;itemId:string;itemName:string;unitCode:string;
  priceMinor:number;active:boolean;updatedAt:string};
type Request={id:string;branchId:string;customerId:string|null;customerName:string;
  itemId:string;itemName:string;unitCode:string;quantity:number;
  baseUnitPriceMinor:number;requestedUnitPriceMinor:number;
  reason:string;status:string;requestedByMembershipId:string;
  createdAt:string;expiresAt:string|null;reviewedAt:string|null};
const CONTROL=["OWNER","ADMIN","MANAGER"];
const ELIGIBLE=[...CONTROL,"CASHIER","SALES","STAFF"];
function asDate(value:string){return new Date(value).toLocaleDateString("en-GB",{
  day:"2-digit",month:"2-digit",year:"numeric",timeZone:"Africa/Accra"});}
export function PricingWorkspace(){
  const {session,role,customers,catalog,inventory,queue}=useWorkspace();
  const businessId=session?.businessId??"";
  const branchId=session?.branchId??"";
  const currencyCode=session?.currencyCode??"GHS";
  const manager=CONTROL.includes(role);
  const canSell=ELIGIBLE.includes(role);
  const online=queue.online;
  const sellable=useMemo(()=>projectSellableItems(catalog,indexInventory(inventory)),
    [catalog,inventory]);
  const [customerId,setCustomerId]=useState("");
  const [itemKey,setItemKey]=useState("");
  const [priceMinor,setPriceMinor]=useState<number|null>(null);
  const [requestCustomerId,setRequestCustomerId]=useState("");
  const [requestItemKey,setRequestItemKey]=useState("");
  const [qty,setQty]=useState(1);
  const [proposedMinor,setProposedMinor]=useState<number|null>(null);
  const [reason,setReason]=useState("");
  const [rates,setRates]=useState<Rate[]>([]);
  const [requests,setRequests]=useState<Request[]>([]);
  const [pendingRequestId,setPendingRequestId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  useActionFeedbackMessages(notice,error);
  const item=sellable.find(s=>s.key===itemKey);
  const requestItem=sellable.find(s=>s.key===requestItemKey);
  const activeCustomers=customers.filter(c=>c.active);
  const fetchJson=useCallback(async(path:string,options?:RequestInit)=>{
    const response=await getOfflineQueue().authenticatedFetch(path,options);
    if(!response.ok)throw new Error(await readApiErrorMessage(response));
    return response.json() as Promise<unknown>;
  },[]);
  const refresh=useCallback(async()=>{
    if(!businessId||!online||!canSell)return;
    try{
      const requestResult=await fetchJson(
        "/v1/pricing/discount-requests?businessId="+encodeURIComponent(businessId)) as {
          requests:Request[]};
      setRequests(requestResult.requests);
    }catch(e){setError(e instanceof Error?e.message:"Discount requests could not be loaded");}
  },[businessId,online,canSell,fetchJson]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    if(!online||!businessId||!canSell)return;
    const ticker=window.setInterval(()=>void refresh(),20_000);
    return ()=>window.clearInterval(ticker);
  },[online,businessId,canSell,refresh]);
  const loadRates=useCallback(async()=>{
    if(!manager||!businessId||!customerId||!online){setRates([]);return;}
    try{
      const data=await fetchJson("/v1/pricing/customer-rates?businessId="+
        encodeURIComponent(businessId)+"&customerId="+encodeURIComponent(customerId)) as{
        rates:Rate[]};
      setRates(data.rates);
    }catch(e){setError(e instanceof Error?e.message:"Customer rates unavailable");}
  },[manager,businessId,customerId,online,fetchJson]);
  useEffect(()=>{void loadRates();},[loadRates]);
  async function updateRates(active=true){
    if(!manager||!businessId||!customerId||!item||!online||busy||
      priceMinor===null)return;
    setBusy(true);setNotice(null);setError(null);
    try{
      await fetchJson("/v1/pricing/customer-rates",{method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({businessId,customerId,itemId:item.itemId,
          unitCode:item.unitCode,priceMinor,active})});
      await loadRates();
      setNotice(active?"Customer-specific selling rate saved.":"Customer special rate deactivated.");
    }catch(e){setError(e instanceof Error?e.message:"Could not save special price");}
    finally{setBusy(false);}
  }
  async function requestDiscount(){
    if(!canSell||!businessId||!branchId||!requestItem||!online||busy||
      proposedMinor===null||!Number.isInteger(qty)||qty<=0)return;
    setBusy(true);setNotice(null);setError(null);
    const clientRequestId=pendingRequestId??crypto.randomUUID();
    setPendingRequestId(clientRequestId);
    try{
      await fetchJson("/v1/pricing/discount-requests",{method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({businessId,branchId,
          customerId:requestCustomerId||null,
          itemId:requestItem.itemId,unitCode:requestItem.unitCode,
          quantity:qty,requestedPriceMinor:proposedMinor,
          reason,clientRequestId})});
      setPendingRequestId(null);
      setNotice("Discount request sent to the business owner or manager. "+
        "The price cannot be used until approved.");
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Could not submit request");}
    finally{setBusy(false);}
  }
  async function reviewRequest(id:string,decision:"approve"|"reject"){
    if(!manager||!businessId||!online||busy)return;
    if(!window.confirm((decision==="approve"?"Approve":"Reject")+
      " this discount? Each approval is limited to one exact sale and expires after 30 minutes."))return;
    setBusy(true);setError(null);setNotice(null);
    try{
      await fetchJson("/v1/pricing/discount-requests/"+
        encodeURIComponent(id)+"/"+decision,{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({businessId})});
      setNotice("Discount "+(decision==="approve"?"approved":"rejected")+".");
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Review failed");}
    finally{setBusy(false);}
  }
  const pending=requests.filter(r=>r.status==="PENDING");
  if(!canSell)return <div className={styles.page}>
    <h1>Pricing access unavailable</h1>
    <p>Your role cannot request or authorize negotiated selling prices.</p>
  </div>;
  return <div className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>Sales controls</span>
        <h1>Special prices & approvals</h1>
        <p>Keep standard catalog prices intact. Give negotiated rates to
          particular customers or request a one-time discount for approval.</p></div>
      <button type="button" onClick={()=>void refresh()} disabled={!online||busy}>
        Refresh requests{pending.length?" ("+pending.length+" pending)":""}
      </button>
    </header>
    {!online?<p className={styles.warning}>Pricing approvals require a live
      connection. Offline sales still use the normal server-verified sync rules.</p>:null}
    {error?<p className={styles.error} role="alert">{error}</p>:null}
    {notice?<p className={styles.notice} role="status">{notice}</p>:null}
    <div className={styles.columns}>
      {manager?<section className={styles.panel}>
        <h2>Customer-specific prices</h2>
        <p>A contracted customer can have an individual price per item and
          sellable unit. The server applies it automatically when their account
          is selected at checkout.</p>
        <label>Customer
          <select value={customerId} onChange={e=>{setCustomerId(e.target.value);setRates([]);}}>
            <option value="">Select customer</option>
            {activeCustomers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Catalog item and unit
          <select value={itemKey} onChange={e=>{
            setItemKey(e.target.value);
            setPriceMinor(sellable.find(s=>s.key===e.target.value)?.priceMinor??null);
          }}>
            <option value="">Choose item</option>
            {sellable.map(s=><option key={s.key} value={s.key}>
              {s.name} · {s.unitLabel}{s.sku?" ("+s.sku+")":""}</option>)}
          </select>
        </label>
        {item?<p>Standard price: <strong>{formatMoney(item.priceMinor,currencyCode)}</strong></p>:null}
        <MoneyInput currencyCode={currencyCode} valueMinor={priceMinor}
          onChange={setPriceMinor} label="Customer-specific unit price" placeholder="0"/>
        <button className={styles.primary} type="button" disabled={!online||busy||
          !customerId||!item||priceMinor===null||priceMinor<=0||priceMinor>item.priceMinor}
          onClick={()=>void updateRates(true)}>Save negotiated price</button>
        <h3>Saved rates</h3>
        {rates.length===0?<p>No negotiated rates recorded for this customer.</p>:
          <div className={styles.rates}>{rates.map(r=><div key={r.id} className={styles.rate}>
            <span><strong>{r.itemName}</strong> · {r.unitCode}
              <small>{r.active?"Active":"Inactive"} · Updated {asDate(r.updatedAt)}</small></span>
            <strong>{formatMoney(r.priceMinor,currencyCode)}</strong>
            {r.active?<button type="button" disabled={!online||busy} onClick={()=>{
              const sellableItem=sellable.find(s=>s.itemId===r.itemId&&s.unitCode===r.unitCode);
              if(!sellableItem)return;
              setItemKey(sellableItem.key);setPriceMinor(r.priceMinor);
              if(window.confirm("Deactivate this negotiated price for this customer?")){
                setBusy(true);setNotice(null);setError(null);
                void fetchJson("/v1/pricing/customer-rates",{method:"PUT",
                  headers:{"Content-Type":"application/json"},
                  body:JSON.stringify({businessId,customerId,itemId:r.itemId,
                    unitCode:r.unitCode,priceMinor:r.priceMinor,active:false})})
                  .then(()=>loadRates())
                  .then(()=>setNotice("Customer-specific price deactivated."))
                  .catch(e=>setError(e instanceof Error?e.message:"Could not deactivate"))
                  .finally(()=>setBusy(false));
              }
            }}>Deactivate</button>:null}
          </div>)}</div>}
      </section>:null}
      <section className={styles.panel}>
        <h2>Request one-time discount</h2>
        <p>A cashier can propose a lower price without changing the catalog.
          A different authorized manager or owner must review it before use.</p>
        <label>Customer (optional)
          <select value={requestCustomerId} onChange={e=>{
            setRequestCustomerId(e.target.value);setPendingRequestId(null);}}>
            <option value="">Walk-in customer</option>
            {activeCustomers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Item and unit
          <select value={requestItemKey} onChange={e=>{
            setRequestItemKey(e.target.value);
            setProposedMinor(null);setPendingRequestId(null);
          }}>
            <option value="">Select item</option>
            {sellable.map(s=><option key={s.key} value={s.key}>
              {s.name} · {s.unitLabel}{s.sku?" ("+s.sku+")":""}</option>)}
          </select>
        </label>
        {requestItem?<p>Catalog price:
          {" "}<strong>{formatMoney(requestItem.priceMinor,currencyCode)}</strong></p>:null}
        <label>Quantity
          <input type="number" min={1} max={100000} step={1}
            value={qty} onChange={e=>{setQty(Number(e.target.value));
              setPendingRequestId(null);}}/>
        </label>
        <MoneyInput currencyCode={currencyCode} valueMinor={proposedMinor}
          onChange={v=>{setProposedMinor(v);setPendingRequestId(null);}}
          label="Requested unit price" placeholder="0"/>
        <label>Reason for discount
          <textarea rows={3} maxLength={500} value={reason} onChange={e=>{
            setReason(e.target.value);setPendingRequestId(null);
          }} placeholder="Customer negotiation, damaged packaging, bulk purchase…"/>
        </label>
        <button type="button" className={styles.primary}
          disabled={!online||busy||!requestItem||proposedMinor===null||
            proposedMinor<=0||proposedMinor>=requestItem.priceMinor||reason.trim().length<8}
          onClick={()=>void requestDiscount()}>Request approval</button>
      </section>
    </div>
    <section className={styles.panel}>
      <h2>{manager?"Pending requests — manager inbox":"My discount requests"}</h2>
      <p>Pending and approved prices are visible here. An approval expires
        after 30 minutes and is valid for one matching sale only.</p>
      {requests.length===0?<p>No requests yet.</p>:
      <div className={styles.requestList}>{requests.map(r=><article key={r.id}
        className={styles.request}>
        <div><strong>{r.itemName}</strong> · {r.quantity} {r.unitCode}
          <p>{r.customerName} · Requested {asDate(r.createdAt)} · {r.status}</p>
          <p>{r.reason}</p></div>
        <div className={styles.requestTotals}>
          <span>Base: {formatMoney(r.baseUnitPriceMinor,currencyCode)}</span>
          <strong>Requested: {formatMoney(r.requestedUnitPriceMinor,currencyCode)}</strong>
          {r.status==="APPROVED"?<small>Approval ID: {r.id}</small>:null}
          {manager&&r.status==="PENDING"?<div className={styles.actions}>
            <button type="button" className={styles.primary}
              disabled={!online||busy} onClick={()=>void reviewRequest(r.id,"approve")}>
              Approve</button>
            <button type="button" disabled={!online||busy}
              onClick={()=>void reviewRequest(r.id,"reject")}>Reject</button>
          </div>:null}
        </div>
      </article>)}</div>}
    </section>
  </div>;
}
