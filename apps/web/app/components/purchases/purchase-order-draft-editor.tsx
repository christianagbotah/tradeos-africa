"use client";

import { confirmAction } from "../ui/action-dialog";

import {useMemo,useState} from "react";
import {formatMoney} from "@tradeos/contracts";
import {useWorkspace} from "../workspace/use-workspace";
import {useApiFetch} from "../../../lib/use-api-fetch";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import {MoneyInput} from "../ui/money-input";
import {purchasableUnits} from "../../../lib/catalog-read-model";
import {
  purchaseOrderCostMissing,selectPurchaseOrderItem,selectPurchaseOrderSupplier,
  selectPurchaseOrderUnit,validatePurchaseOrderLines,
  type PurchaseOrderDraftLine,
} from "../../../lib/purchase-order-draft-guards";
import type {Supplier} from "./supplier-sheet";
import styles from "./purchase-order-draft-editor.module.css";

export interface EditablePurchaseOrder {
  id:string;status:"DRAFT"|"ISSUED"|"CANCELLED";updatedAt:string;
  supplierId:string;supplierName:string;currencyCode:string;
  orderNumber:string;notes:string;expectedDeliveryDate:string|null;
  lines:readonly {
    itemId:string;purchaseUnitCode:string;quantity:number;unitCostMinor:number;
  }[];
}
interface Props {
  order:EditablePurchaseOrder;
  onClose:()=>void;
  onSaved:()=>void;
}
const makeLine=():PurchaseOrderDraftLine=>({
  key:crypto.randomUUID(),itemId:"",purchaseUnitCode:"",
  quantity:"1",unitCostMinor:null,
});
const originalLines=(order:EditablePurchaseOrder):PurchaseOrderDraftLine[]=>
  order.lines.map(line=>({
    key:crypto.randomUUID(),itemId:line.itemId,
    purchaseUnitCode:line.purchaseUnitCode,
    quantity:String(line.quantity),unitCostMinor:line.unitCostMinor,
  }));

export function PurchaseOrderDraftEditor({order,onClose,onSaved}:Props){
  const {session,role,catalog,queue}=useWorkspace();
  const canWrite=["OWNER","ADMIN","MANAGER","INVENTORY"].includes(role);
  const [supplierId,setSupplierId]=useState(order.supplierId);
  const [deliveryDate,setDeliveryDate]=useState(order.expectedDeliveryDate??"");
  const [notes,setNotes]=useState(order.notes);
  const [lines,setLines]=useState<PurchaseOrderDraftLine[]>(()=>originalLines(order));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const supplierPath=session?
    `/v1/suppliers?businessId=${encodeURIComponent(session.businessId)}&limit=100`:null;
  const {data:supplierData,loading:suppliersLoading,error:supplierError}=
    useApiFetch<{suppliers:Supplier[]}>(supplierPath);
  const suppliers=useMemo(()=>supplierData?.suppliers.filter(s=>s.active)??[],
    [supplierData]);
  const items=useMemo(()=>catalog.filter(item=>
    item.active&&item.kind==="PRODUCT"&&item.trackStock&&
    purchasableUnits(item).length>0),[catalog]);
  const byId=useMemo(()=>new Map(items.map(item=>[item.id,item])),[items]);
  const valid=validatePurchaseOrderLines(lines,items);
  const missingCosts=purchaseOrderCostMissing(lines);
  const total=lines.reduce((sum,line)=>sum+
    Math.round((line.unitCostMinor??0)*(Number(line.quantity)||0)),0);
  const changed=supplierId!==order.supplierId||deliveryDate!==
    (order.expectedDeliveryDate??"")||notes!==order.notes||
    lines.length!==order.lines.length||lines.some((line,index)=>{
      const old=order.lines[index];
      return !old||line.itemId!==old.itemId||
        line.purchaseUnitCode!==old.purchaseUnitCode||
        Number(line.quantity)!==old.quantity||line.unitCostMinor!==old.unitCostMinor;
    });
  const allowed=order.status==="DRAFT"&&canWrite&&Boolean(session);
  const validSupplier=Boolean(supplierId)&&(
    supplierId===order.supplierId||suppliers.some(s=>s.id===supplierId));
  const canSave=allowed&&queue.online&&!busy&&changed&&valid&&validSupplier;
  const updateLine=(key:string,patch:Partial<PurchaseOrderDraftLine>)=>{
    setLines(previous=>previous.map(line=>
      line.key===key?{...line,...patch}:line));
    setError(null);
  };
  async function dismiss(){
    if(busy)return;
    if(changed&&!await confirmAction("Discard unsaved purchase-order changes?"))return;
    onClose();
  }
  async function save(){
    if(!canSave||!session)return;
    setBusy(true);setError(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(
        `/v1/purchase-orders/${encodeURIComponent(order.id)}`,{
          method:"PATCH",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            businessId:session.businessId,supplierId,
            notes,expectedDeliveryDate:deliveryDate||undefined,
            expectedUpdatedAt:order.updatedAt,
            lines:lines.map(line=>({itemId:line.itemId,
              purchaseUnitCode:line.purchaseUnitCode,
              quantity:Number(line.quantity),unitCostMinor:line.unitCostMinor!,
            })),
          }),
        });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      onSaved();
    }catch(cause){
      setError(cause instanceof Error?cause.message:
        "Could not save. The draft has not changed.");
    }finally{setBusy(false);}
  }
  const unavailableSupplier=supplierId===order.supplierId&&!suppliers.some(
    supplier=>supplier.id===order.supplierId);
  return <section className={styles.editor} aria-label="Edit saved purchase order"
    onKeyDown={event=>{
      if(event.key==="Escape"&&!busy){event.stopPropagation();dismiss();}
    }}>
    <header className={styles.heading}>
      <div><p className={styles.kicker}>Unissued draft · {order.orderNumber}</p>
        <h2>Edit saved purchase order</h2>
        <p>Save changes to this draft only. Issued orders and receipts cannot be edited.</p>
      </div>
      <button type="button" className={styles.secondary} disabled={busy}
        onClick={dismiss}>Close editor</button>
    </header>
    <div className={styles.fields}>
      <label className={styles.field}>Supplier
        <select value={supplierId} disabled={!allowed||suppliersLoading}
          onChange={event=>{
            const next=event.target.value;
            setLines(prev=>selectPurchaseOrderSupplier(prev,supplierId,next));
            setSupplierId(next);setError(null);
          }}>
          <option value="">Choose a supplier</option>
          {unavailableSupplier?<option value={order.supplierId}>
            {order.supplierName} (confirm still active)</option>:null}
          {suppliers.map(supplier=><option key={supplier.id} value={supplier.id}>
            {supplier.name}</option>)}
        </select>
      </label>
      <label className={styles.field}>Expected delivery date (optional)
        <input type="date" value={deliveryDate} disabled={!allowed}
          onChange={event=>{setDeliveryDate(event.target.value);setError(null);}}/>
      </label>
    </div>
    {supplierError?<p className={styles.warning} role="alert">{supplierError}</p>:null}
    <div className={styles.itemTitle}>
      <h3>Purchase-order lines</h3><span>{lines.length}/50</span>
    </div>
    <p className={styles.hint}>On a small screen, scroll the item rows horizontally.
      Changing a product, purchasing unit or supplier clears the previous supplier cost.</p>
    <div className={styles.scroll} role="region" tabIndex={0}
      aria-label="Editable purchase order items, scroll horizontally">
      <div className={styles.rows}>
        <div className={styles.columnLabels} aria-hidden="true">
          <span>No.</span><span>Item</span><span>Purchasing unit</span>
          <span>Quantity</span><span>Supplier unit cost</span>
          <span>Line total</span><span/>
        </div>
        {lines.map((line,index)=>{
          const item=byId.get(line.itemId);
          const units=item?purchasableUnits(item):[];
          const lineTotal=Math.round((line.unitCostMinor??0)*
            (Number(line.quantity)||0));
          return <div key={line.key} className={styles.line}>
            <span className={styles.index}>{index+1}</span>
            <select aria-label={`Edit line ${index+1} product`} value={line.itemId}
              disabled={!allowed} onChange={event=>{
                const next=byId.get(event.target.value);
                setLines(prev=>prev.map(row=>row.key===line.key?
                  selectPurchaseOrderItem(row,event.target.value,
                    next?purchasableUnits(next)[0]?.code??"":""):row));
                setError(null);
              }}>
              <option value="">Choose product</option>
              {!item&&line.itemId?<option value={line.itemId}>
                Current product unavailable — replace</option>:null}
              {items.map(i=><option key={i.id} value={i.id}>
                {i.name}{i.sku?` · ${i.sku}`:""}</option>)}
            </select>
            <select aria-label={`Edit line ${index+1} purchasing unit`}
              value={line.purchaseUnitCode} disabled={!allowed||!item}
              onChange={event=>{
                setLines(prev=>prev.map(row=>row.key===line.key?
                  selectPurchaseOrderUnit(row,event.target.value):row));
                setError(null);
              }}>
              {!item?<option value={line.purchaseUnitCode}>Choose product first</option>:null}
              {units.map(unit=><option key={unit.code} value={unit.code}>
                {unit.label}</option>)}
            </select>
            <input aria-label={`Edit line ${index+1} quantity`} type="number"
              min="0.00000001" max="1000000" step="any" inputMode="decimal"
              value={line.quantity} disabled={!allowed}
              onChange={event=>updateLine(line.key,{quantity:event.target.value})}/>
            <div className={styles.cost}>
              <MoneyInput currencyCode={order.currencyCode}
                valueMinor={line.unitCostMinor} disabled={!allowed} required
                id={`tos-edit-po-cost-${line.key}`}
                aria-label={`Edit line ${index+1} supplier unit cost`}
                onChange={amount=>updateLine(line.key,{unitCostMinor:amount})}/>
            </div>
            <strong className={styles.lineTotal}>{formatMoney(
              lineTotal,order.currencyCode)}</strong>
            <button type="button" className={styles.remove}
              disabled={!allowed||lines.length===1}
              aria-label={`Remove draft line ${index+1}`}
              onClick={()=>{setLines(prev=>prev.filter(r=>r.key!==line.key));
                setError(null);}}>×</button>
          </div>;
        })}
      </div>
    </div>
    <button type="button" className={styles.secondary}
      disabled={!allowed||lines.length>=50}
      onClick={()=>{setLines(prev=>[...prev,makeLine()]);setError(null);}}>
      + Add item
    </button>
    <label className={styles.field}>Notes / delivery terms
      <textarea rows={3} maxLength={2000} value={notes} disabled={!allowed}
        onChange={event=>{setNotes(event.target.value);setError(null);}}/>
    </label>
    {missingCosts.length?<p className={styles.warning} role="status">
      Enter a supplier unit cost for line{missingCosts.length>1?"s":""}
      {" "}{missingCosts.join(", ")} before saving.</p>:null}
    <div className={styles.total}>
      <span>{missingCosts.length?
        "Current subtotal — supplier costs still missing":
        "Revised purchase order total"}</span>
      <strong>{formatMoney(total,order.currencyCode)}</strong>
    </div>
    {changed?<p className={styles.hint} role="status">
      Unsaved draft changes. Other users' newer changes cannot be overwritten;
      a version conflict requires refreshing this order.
    </p>:null}
    {!queue.online?<p className={styles.warning} role="status">
      Connect to the internet to save purchase-order changes.</p>:null}
    {error?<p className={styles.warning} role="alert">{error}
      {error.toLowerCase().includes("reload")||
        error.toLowerCase().includes("changed elsewhere")?
        <button type="button" className={styles.secondary}
          onClick={async()=>{
            if(await confirmAction("Discard local edits and reload the latest order?"))onSaved();
          }}>Reload saved order</button>:null}
    </p>:null}
    <footer className={styles.actions}>
      <button type="button" className={styles.secondary}
        disabled={busy} onClick={dismiss}>Discard / close</button>
      <button type="button" className={styles.primary}
        disabled={!canSave} onClick={()=>void save()}>
        {busy?"Saving…":"Save draft changes"}
      </button>
    </footer>
  </section>;
}
