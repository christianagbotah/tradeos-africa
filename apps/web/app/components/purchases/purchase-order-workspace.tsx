"use client";
import { useActionFeedbackMessages } from "../ui/action-feedback";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { MoneyInput } from "../ui/money-input";
import { purchasableUnits } from "../../../lib/catalog-read-model";
import {
  selectPurchaseOrderItem,selectPurchaseOrderUnit,selectPurchaseOrderSupplier,
  purchaseOrderCostMissing,validatePurchaseOrderLines,
  type PurchaseOrderDraftLine,
} from "../../../lib/purchase-order-draft-guards";
import type { Supplier } from "./supplier-sheet";
import {VoicePurchaseOrderAssistant,type VoicePOReviewLine}
  from "./voice-purchase-order-assistant";
import styles from "./purchase-order-workspace.module.css";

type Status = "DRAFT" | "ISSUED" | "CANCELLED";
interface Order {
  id:string;orderNumber:string;status:Status;totalMinor:number;currencyCode:string;
  supplierName:string;createdAt:string;expectedDeliveryDate:string|null;
}
type DraftLine=PurchaseOrderDraftLine;
const makeLine=():DraftLine=>({
  key:crypto.randomUUID(),itemId:"",purchaseUnitCode:"",quantity:"1",unitCostMinor:null,
});
const date=(value:string|null)=>value?new Intl.DateTimeFormat("en-GB",{
  day:"2-digit",month:"2-digit",year:"numeric",timeZone:"Africa/Accra",
}).format(new Date(value)):"—";

export function PurchaseOrderWorkspace(){
  const {session,role,catalog,queue}=useWorkspace();
  const [supplierId,setSupplierId]=useState("");
  const [expectedDeliveryDate,setExpectedDeliveryDate]=useState("");
  const [notes,setNotes]=useState("");
  const [lines,setLines]=useState<DraftLine[]>([makeLine()]);
  const [filter,setFilter]=useState<"ALL"|Status>("ALL");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  useActionFeedbackMessages(notice,error);
  const [voiceOpen,setVoiceOpen]=useState(false);
  const [issueCandidate,setIssueCandidate]=useState<Order|null>(null);
  const issueCancelButton=useRef<HTMLButtonElement>(null);
  const requestId=useRef<string|null>(null);
  const canWrite=["OWNER","ADMIN","MANAGER","INVENTORY"].includes(role);
  const canIssue=["OWNER","ADMIN","MANAGER"].includes(role);
  const currency=session?.currencyCode??"GHS";
  const supplierPath=session?`/v1/suppliers?businessId=${encodeURIComponent(session.businessId)}&limit=100`:null;
  const orderPath=session?`/v1/purchase-orders?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&limit=100`:null;
  const {data:suppliersData,loading:suppliersLoading,error:supplierError}=useApiFetch<{suppliers:Supplier[]}>(supplierPath);
  const {data:ordersData,loading:ordersLoading,error:ordersError,refetch}=useApiFetch<{orders:Order[]}>(orderPath);
  const suppliers=useMemo(()=>suppliersData?.suppliers.filter(s=>s.active)??[],[suppliersData]);
  const items=useMemo(()=>catalog.filter(i=>i.active&&i.kind==="PRODUCT"&&
    i.trackStock&&purchasableUnits(i).length>0),[catalog]);
  const byId=useMemo(()=>new Map(items.map(i=>[i.id,i])),[items]);
  const valid=validatePurchaseOrderLines(lines,items);
  const missingCostLines=purchaseOrderCostMissing(lines);
  const total=lines.reduce((sum,l)=>
    sum+Math.round((l.unitCostMinor??0)*(Number(l.quantity)||0)),0);
  useEffect(()=>{
    if(issueCandidate)issueCancelButton.current?.focus();
  },[issueCandidate]);
  const visible=(ordersData?.orders??[]).filter(o=>filter==="ALL"||o.status===filter);
  const dirty=()=>{requestId.current=null;};
  const updateLine=(key:string,patch:Partial<DraftLine>)=>{
    dirty();setLines(prev=>prev.map(l=>l.key===key?{...l,...patch}:l));
  };
  async function create(){
    if(!session||!canWrite||!queue.online||busy||!supplierId||!valid)return;
    setError(null);setNotice(null);setBusy(true);
    requestId.current??=crypto.randomUUID();
    try{
      const response=await getOfflineQueue().authenticatedFetch("/v1/purchase-orders",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          businessId:session.businessId,branchId:session.branchId,
          supplierId,clientRequestId:requestId.current,
          notes, ...(expectedDeliveryDate?{expectedDeliveryDate}:{}),
          lines:lines.map(l=>({
            itemId:l.itemId,purchaseUnitCode:l.purchaseUnitCode,
            quantity:Number(l.quantity),unitCostMinor:l.unitCostMinor!,
          })),
        }),
      });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const result=await response.json() as {order:Order;idempotentReplay:boolean};
      setNotice(`${result.order.orderNumber} saved as a draft. Review and issue it before sending to the supplier.`);
      setLines([makeLine()]);setSupplierId("");setExpectedDeliveryDate("");setNotes("");
      requestId.current=null;refetch();
    }catch(e){setError(e instanceof Error?e.message:"Could not create purchase order");}
    finally{setBusy(false);}
  }
  async function transition(order:Order,action:"issue"|"cancel"){
    if(!session||!canIssue||!queue.online||busy)return;
    if(action==="issue"&&(
      !issueCandidate||issueCandidate.id!==order.id||order.status!=="DRAFT"))return;
    if(action==="cancel"&&!window.confirm(`Cancel ${order.orderNumber}? This cannot be undone.`))return;
    setBusy(true);setError(null);setNotice(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(
        `/v1/purchase-orders/${encodeURIComponent(order.id)}/${action}`,{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({businessId:session.businessId}),
        });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      setNotice(`${order.orderNumber} ${action==="issue"?"issued":"cancelled"}.`);
      setIssueCandidate(null);
      refetch();
    }catch(e){setError(e instanceof Error?e.message:"Could not update purchase order");}
    finally{setBusy(false);}
  }
  return <main className={styles.workspace}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Purchasing · Supplier documents</p>
        <h1>Purchase orders</h1>
        <p>Plan and issue orders before receiving stock. No stock or money is recorded when an order is created.</p>
      </div>
      <Link className={styles.secondary} href="/purchases">Back to Purchases</Link>
    </header>
    <div className={styles.columns}>
      <section className={styles.panel} aria-label="Create purchase order">
        <div className={styles.listHeading}>
          <h2>Create purchase order</h2>
          {canWrite?<button type="button" className={styles.secondary}
            onClick={()=>setVoiceOpen(true)}>🎙 Speak an order</button>:null}
        </div>
        <p className={styles.muted}>Save a draft, then review and issue it to your supplier.</p>
        <label className={styles.field}>Supplier
          <select value={supplierId} disabled={!canWrite||suppliersLoading}
            onChange={e=>{
              const next=e.target.value;
              setLines(prev=>selectPurchaseOrderSupplier(prev,supplierId,next));
              setSupplierId(next);dirty();
            }}>
            <option value="">{suppliersLoading?"Loading suppliers…":"Choose supplier"}</option>
            {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {supplierError?<p className={styles.error} role="alert">{supplierError}</p>:null}
        <label className={styles.field}>Expected delivery (optional)
          <input type="date" value={expectedDeliveryDate} disabled={!canWrite}
            onChange={e=>{setExpectedDeliveryDate(e.target.value);dirty();}}/>
        </label>
        <div className={styles.lineSection}>
          <div className={styles.lineHeading}><h3>Order items</h3>
            <span>{lines.length} line{lines.length!==1?"s":""}</span></div>
          <p className={styles.scrollHint}>On smaller screens, scroll the item rows sideways to see every field.</p>
          <div className={styles.scroll} role="region" tabIndex={0}
            aria-label="Purchase order items, scroll horizontally to view all fields">
            <div className={styles.rows}>
              <div className={styles.rowLabels} aria-hidden="true">
                <span>No.</span><span>Item</span><span>Unit</span><span>Qty</span>
                <span>Unit cost</span><span>Total</span><span/>
              </div>
              {lines.map((line,index)=>{
                const item=byId.get(line.itemId);
                const units=item?purchasableUnits(item):[];
                const lineTotal=Math.round((line.unitCostMinor??0)*(Number(line.quantity)||0));
                return <div key={line.key} className={styles.lineRow}>
                  <span className={styles.lineIndex}>{index+1}</span>
                  <select aria-label={`Line ${index+1} item`} value={line.itemId}
                    disabled={!canWrite} onChange={e=>{
                      const next=byId.get(e.target.value);
                      dirty();
                      setLines(prev=>prev.map(l=>l.key===line.key?
                        selectPurchaseOrderItem(l,e.target.value,
                          next?purchasableUnits(next)[0]?.code??"":""):l));
                    }}>
                    <option value="">Choose item</option>
                    {items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <select aria-label={`Line ${index+1} purchasing unit`}
                    value={line.purchaseUnitCode} disabled={!canWrite||!item}
                    onChange={e=>{
                      dirty();setLines(prev=>prev.map(l=>l.key===line.key?
                        selectPurchaseOrderUnit(l,e.target.value):l));
                    }}>
                    {!item?<option value="">Choose item first</option>:null}
                    {units.map(u=><option key={u.code} value={u.code}>{u.label}</option>)}
                  </select>
                  <input aria-label={`Line ${index+1} quantity`} type="number"
                    min="0.00000001" max="1000000" step="any" inputMode="decimal"
                    value={line.quantity} disabled={!canWrite}
                    onChange={e=>updateLine(line.key,{quantity:e.target.value})}/>
                  <div className={styles.cost}>
                    <MoneyInput currencyCode={currency} valueMinor={line.unitCostMinor}
                      id={`tos-po-cost-${line.key}`}
                      disabled={!canWrite} required
                      onChange={minor=>updateLine(line.key,{
                        unitCostMinor:minor})} aria-label={`Line ${index+1} unit cost`}/>
                  </div>
                  <strong className={styles.lineTotal}>{formatMoney(lineTotal,currency)}</strong>
                  <button type="button" className={styles.remove} disabled={!canWrite||lines.length===1}
                    aria-label={`Remove line ${index+1}`}
                    onClick={()=>{dirty();setLines(prev=>prev.filter(l=>l.key!==line.key));}}>×</button>
                </div>;
              })}
            </div>
          </div>
          <button className={styles.secondary} type="button" disabled={!canWrite||lines.length>=50}
            onClick={()=>{dirty();setLines(prev=>[...prev,makeLine()]);}}>+ Add item</button>
        </div>
        <label className={styles.field}>Notes / terms
          <textarea rows={3} maxLength={2000} disabled={!canWrite} value={notes}
            placeholder="Delivery terms, address or special instructions"
            onChange={e=>{setNotes(e.target.value);dirty();}}/>
        </label>
        {missingCostLines.length>0?<p className={styles.costReminder} role="status">
          Enter supplier unit cost for line{missingCostLines.length>1?"s":""} {missingCostLines.join(", ")}.
          Prices are never assumed when products, purchasing units or suppliers change.
        </p>:null}
        <div className={styles.totalPreview}>
          <span>{missingCostLines.length>0?
            "Current subtotal — supplier costs still missing":
            "Estimated purchase order total"}</span>
          <strong>{formatMoney(total,currency)}</strong>
        </div>
        <p className={styles.muted}>Supplier prices and line totals are saved with the document. No purchase receipt, supplier debt or stock is created yet.</p>
        <button className={styles.primary} type="button"
          disabled={!canWrite||!queue.online||busy||!supplierId||!valid}
          onClick={()=>void create()}>{busy?"Saving…":"Create draft order"}</button>
        {!queue.online?<p className={styles.muted}>Connect to the internet to create or issue orders.</p>:null}
      </section>
      <section className={styles.panel} aria-label="Recent purchase orders">
        <div className={styles.listHeading}>
          <h2>Recent orders</h2>
          <button className={styles.secondary} type="button" onClick={refetch}>Refresh</button>
        </div>
        <div className={styles.filters}>
          {(["ALL","DRAFT","ISSUED","CANCELLED"] as const).map(status=>
            <button type="button" key={status} aria-pressed={filter===status}
              className={filter===status?styles.selected:styles.secondary}
              onClick={()=>setFilter(status)}>{status==="ALL"?"All":status}</button>)}
        </div>
        {notice?<p role="status" className={styles.success}>{notice}</p>:null}
        {error?<p role="alert" className={styles.error}>{error}</p>:null}
        {ordersError?<p role="alert" className={styles.error}>{ordersError}</p>:null}
        {ordersLoading?<p>Loading orders…</p>:visible.length===0?
          <p className={styles.muted}>There are no purchase orders matching this filter.</p>:
          <div className={styles.orderList}>
            {visible.map(order=><article className={styles.order} key={order.id}>
              <div className={styles.orderTop}>
                <strong>{order.orderNumber}</strong>
                <span className={styles.status}>{order.status}</span>
              </div>
              <p>{order.supplierName}</p>
              <div className={styles.orderMeta}>
                <span>{date(order.createdAt)}</span>
                <strong>{formatMoney(order.totalMinor,order.currencyCode)}</strong>
              </div>
              <div className={styles.actions}>
                <Link className={styles.secondary} href={`/purchase-orders/${order.id}`}>Preview</Link>
                {order.status==="DRAFT"&&canIssue?
                  <button className={styles.primary} disabled={busy||!queue.online}
                    type="button" onClick={()=>{
                      setError(null);setIssueCandidate(order);
                    }}>Issue order</button>:null}
                {order.status!=="CANCELLED"&&canIssue?
                  <button className={styles.danger} disabled={busy||!queue.online}
                    type="button" onClick={()=>void transition(order,"cancel")}>Cancel</button>:null}
              </div>
            </article>)}
          </div>}
      </section>
    </div>
    {issueCandidate&&canIssue?<div className={styles.confirmBackdrop}
      role="presentation">
      <section className={styles.confirmDialog} role="alertdialog" aria-modal="true"
        aria-labelledby="tos-po-issue-title" aria-describedby="tos-po-issue-description"
        onKeyDown={event=>{
          if(event.key==="Escape"&&!busy)setIssueCandidate(null);
        }}>
        <h2 id="tos-po-issue-title">Confirm issuing this purchase order</h2>
        <p id="tos-po-issue-description" className={styles.muted}>
          Verify the supplier, order number and total before issuing. Issuing
          changes the order status; it does not record a supplier payment or
          stock receipt, and it does not automatically email the supplier.
        </p>
        <dl className={styles.confirmSummary}>
          <div><dt>Purchase order</dt><dd>{issueCandidate.orderNumber}</dd></div>
          <div><dt>Supplier</dt><dd>{issueCandidate.supplierName}</dd></div>
          <div><dt>Order amount</dt><dd>{formatMoney(
            issueCandidate.totalMinor,issueCandidate.currencyCode)}</dd></div>
          <div><dt>Expected delivery</dt><dd>{date(
            issueCandidate.expectedDeliveryDate)}</dd></div>
        </dl>
        {error?<p role="alert" className={styles.error}>{error}</p>:null}
        <div className={styles.confirmActions}>
          <button type="button" className={styles.secondary} disabled={busy}
            ref={issueCancelButton}
            onClick={()=>setIssueCandidate(null)}>Keep as draft</button>
          <button type="button" className={styles.primary} disabled={busy||!queue.online}
            onClick={()=>void transition(issueCandidate,"issue")}>
            {busy?"Issuing…":"Confirm issue order"}
          </button>
        </div>
      </section>
    </div>:null}
    {voiceOpen&&canWrite?<VoicePurchaseOrderAssistant
      items={items} suppliers={suppliers} currencyCode={currency}
      onClose={()=>setVoiceOpen(false)}
      onApply={(chosenSupplier,reviewed:VoicePOReviewLine[])=>{
        if(!canWrite||reviewed.length===0||reviewed.length>50)return false;
        const existing=Boolean(supplierId)||lines.some(line=>line.itemId!=="");
        if(existing&&!window.confirm(
          "Replace the current order items and supplier with the reviewed voice draft?"))
          return false;
        dirty();setSupplierId(chosenSupplier);
        setLines(reviewed.map(line=>({
          key:crypto.randomUUID(),itemId:line.itemId,
          purchaseUnitCode:line.purchaseUnitCode,quantity:String(line.quantity),
          unitCostMinor:line.unitCostMinor,
        })));
        setError(null);
        setNotice("Voice order copied for review. Check notes and delivery date, then use Create draft order to save. Nothing was issued or paid.");
        return true;
      }}/>:null}
  </main>;
}
