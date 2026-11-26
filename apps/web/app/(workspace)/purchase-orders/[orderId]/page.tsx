"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { formatMoney } from "@tradeos/contracts";
import { useWorkspace } from "../../../components/workspace/use-workspace";
import { useApiFetch } from "../../../../lib/use-api-fetch";
import { PurchaseReceiptBuilder } from "../../../components/purchases/purchase-receipt-builder";
import { SupplierInvoiceMatching } from "../../../components/purchases/supplier-invoice-matching";
import { SupplierDocumentDelivery } from "../../../components/purchases/supplier-document-delivery";
import { PurchaseOrderDraftEditor } from "../../../components/purchases/purchase-order-draft-editor";
import type { Supplier } from "../../../components/purchases/supplier-sheet";
import styles from "./purchase-order-preview.module.css";

type Status="DRAFT"|"ISSUED"|"CANCELLED";
interface PurchaseOrder {
  id:string;orderNumber:string;businessId:string;branchId:string;supplierId:string;
  updatedAt:string;
  status:Status;currencyCode:string;businessName:string;branchName:string;
  supplierName:string;supplierPhone:string|null;supplierEmail:string|null;
  supplierAddress:string|null;notes:string;expectedDeliveryDate:string|null;
  subtotalMinor:number;taxMinor:number;totalMinor:number;
  fulfillmentStatus:"NOT_RECEIVED"|"PARTIAL"|"RECEIVED";canReceive:boolean;
  receiptCount:number;receivedTotalMinor:number;priceVarianceMinor:number;
  receipts:Array<{id:string;receivedAt:string;totalMinor:number;
    supplierReference:string|null;settlementMethod:string}>;
  issuedAt:string|null;cancelledAt:string|null;createdAt:string;
  lines:Array<{id:string;itemId:string;itemName:string;itemSku:string|null;
    purchaseUnitCode:string;purchaseUnitLabel:string;quantity:number;
    unitCostMinor:number;lineTotalMinor:number;
    receivedQuantity:number;remainingQuantity:number;
    receivedCostMinor:number;priceVarianceMinor:number}>;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function date(value:string|null){
  if(!value)return "—";
  return new Intl.DateTimeFormat("en-GB",{
    day:"2-digit",month:"2-digit",year:"numeric",timeZone:"Africa/Accra",
  }).format(new Date(value));
}
export default function SupplierPurchaseOrderPreview(){
  const params=useParams<{orderId:string}>();
  const {session,role,queue}=useWorkspace();
  const [receiveOpen,setReceiveOpen]=useState(false);
  const [editOpen,setEditOpen]=useState(false);
  const valid=UUID.test(params.orderId);
  const url=session&&valid?
    `/v1/purchase-orders/${encodeURIComponent(params.orderId)}?businessId=${encodeURIComponent(session.businessId)}`:null;
  const {data,loading,error,refetch}=useApiFetch<{order:PurchaseOrder}>(url);
  const order=data?.order;
  const receiveRoles=["OWNER","ADMIN","MANAGER","INVENTORY","ACCOUNTANT"];
  const mayReceive=receiveRoles.includes(role)&&queue.online;
  const canEditDraft=["OWNER","ADMIN","MANAGER","INVENTORY"].includes(role);
  const suppliers=useMemo<readonly Supplier[]>(()=>order?[{
    id:order.supplierId,name:order.supplierName,phone:order.supplierPhone,
    email:order.supplierEmail,address:order.supplierAddress,
    paymentTermsDays:null,active:true,balanceMinor:0,updatedAt:order.createdAt,
  }]:[],[order]);
  if(!valid)return <main className={styles.failure}>Invalid purchase order identifier.</main>;
  if(loading)return <main className={styles.failure}>Loading purchase order…</main>;
  if(error||!order)return <main className={styles.failure} role="alert">
    {error||"Purchase order is unavailable."}</main>;
  const money=(minor:number)=>formatMoney(minor,order.currencyCode);
  return <main className={styles.wrapper}>
    <div className={styles.actions}>
      <Link href="/purchase-orders">Back to purchase orders</Link>
      {order.status==="DRAFT"&&canEditDraft?
        <button type="button" disabled={!queue.online||editOpen}
          onClick={()=>setEditOpen(true)}>Edit saved draft</button>:null}
      {order.canReceive&&receiveRoles.includes(role)?
        <button type="button" disabled={!mayReceive}
          title={!queue.online?"Connect to receive against current outstanding quantities":undefined}
          onClick={()=>setReceiveOpen(true)}>Receive delivery</button>:null}
      {order.status==="ISSUED"?<button type="button" onClick={()=>window.print()}>
        Print / Save as PDF</button>:null}
    </div>
    {editOpen&&order.status==="DRAFT"&&canEditDraft?
      <PurchaseOrderDraftEditor order={order}
        onClose={()=>setEditOpen(false)}
        onSaved={()=>{setEditOpen(false);refetch();}}/>:null}
    <article id="tradeos-supplier-po" className={`tos-print-document ${styles.document}`}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>TradeOS Africa · Purchasing</p>
        <div className={styles.heroRow}>
          <div><h1>PURCHASE ORDER</h1><p className={styles.number}>{order.orderNumber}</p></div>
          <div className={styles.heroAmount}>
            <span>TOTAL AMOUNT</span>
            <strong>{money(order.totalMinor)}</strong>
          </div>
        </div>
        <p className={styles.heroSub}>{order.businessName} · {order.branchName}</p>
      </header>
      <div className={styles.statusRow}>
        <span className={styles.status}>{order.status}</span>
        <span>{order.status==="DRAFT"?"Preview only — not issued to supplier":
          order.status==="CANCELLED"?"CANCELLED — do not fulfil":
          "Issued supplier purchase order"}</span>
      </div>
      <section className={styles.fulfillment}>
        <div><strong>Receiving status: {order.fulfillmentStatus==="NOT_RECEIVED"?"Not received":
          order.fulfillmentStatus==="PARTIAL"?"Partially received":"Fully received"}</strong>
          <p>{order.receiptCount} posted delivery receipt{order.receiptCount===1?"":"s"}
            {" · "}Goods received are recorded separately from the order.</p>
          {order.priceVarianceMinor!==0?
            <p role="status">Supplier cost difference on goods received:
              {" "}{money(order.priceVarianceMinor)} (actual minus ordered cost).</p>:null}
        </div>
        {order.canReceive&&receiveRoles.includes(role)?
          <button type="button" disabled={!mayReceive} onClick={()=>setReceiveOpen(true)}>
            Receive outstanding goods</button>:null}
      </section>
      <section className={styles.overview}>
        <div><h2>From</h2><strong>{order.businessName}</strong>
          <p>{order.branchName} branch</p></div>
        <div><h2>Supplier</h2><strong>{order.supplierName}</strong>
          {order.supplierAddress?<p>{order.supplierAddress}</p>:null}
          {order.supplierPhone?<p>Tel: {order.supplierPhone}</p>:null}
          {order.supplierEmail?<p>{order.supplierEmail}</p>:null}
        </div>
        <div><h2>Order dates</h2>
          <p>Created: <strong>{date(order.createdAt)}</strong></p>
          <p>Issued: <strong>{date(order.issuedAt)}</strong></p>
          <p>Expected delivery: <strong>{order.expectedDeliveryDate?
            date(order.expectedDeliveryDate+"T12:00:00Z"):"Not specified"}</strong></p>
        </div>
      </section>
      <div className={styles.itemsScroll}>
        <table className={styles.items}>
          <thead><tr><th>No.</th><th>Product / purchase unit</th>
            <th>Ordered</th><th>Received</th><th>Outstanding</th>
            <th>Unit cost</th><th>Line total</th></tr></thead>
          <tbody>{order.lines.map((line,index)=><tr key={line.id}>
            <td>{index+1}</td>
            <td><strong>{line.itemName}</strong>
              <small>{line.itemSku?line.itemSku+" · ":""}{line.purchaseUnitLabel}</small></td>
            <td>{line.quantity.toLocaleString("en-GH",{maximumFractionDigits:8})}</td>
            <td>{line.receivedQuantity.toLocaleString("en-GH",{maximumFractionDigits:8})}</td>
            <td><strong>{line.remainingQuantity.toLocaleString("en-GH",{maximumFractionDigits:8})}</strong></td>
            <td>{money(line.unitCostMinor)}</td>
            <td><strong>{money(line.lineTotalMinor)}</strong></td>
          </tr>)}</tbody>
        </table>
      </div>
      <section className={styles.totals}>
        <div><span>Subtotal</span><strong>{money(order.subtotalMinor)}</strong></div>
        {order.taxMinor>0?<div><span>Tax</span><strong>{money(order.taxMinor)}</strong></div>:null}
        <div className={styles.grand}><span>Order total</span>
          <strong>{money(order.totalMinor)}</strong></div>
      </section>
      {order.receipts.length>0?<section className={styles.receipts}>
        <h2>Posted deliveries</h2>
        <p>Receipt amounts are actual receiving costs, not the original PO commitment.</p>
        {order.receipts.map(receipt=><div key={receipt.id} className={styles.receipt}>
          <span>{date(receipt.receivedAt)}</span>
          <span>{receipt.supplierReference??`Receipt #${receipt.id.slice(0,8)}`}</span>
          <strong>{money(receipt.totalMinor)}</strong>
        </div>)}
        <Link href="/purchases">View purchases and supplier receipts</Link>
      </section>:null}
      {order.notes?<section className={styles.notes}><h2>Terms & instructions</h2>
        <p>{order.notes}</p></section>:null}
      <footer className={styles.footer}>
        <p>Supplier purchase order only. This is not proof of delivery, a supplier invoice
          or payment. Stock and supplier payables are recorded after goods are received.</p>
        <p>{order.orderNumber} · {order.businessName}</p>
      </footer>
    </article>
    {order.status==="ISSUED" &&
      ["OWNER","ADMIN","MANAGER","ACCOUNTANT","INVENTORY"].includes(role) ?
      <SupplierDocumentDelivery
        orderId={order.id} orderNumber={order.orderNumber} status={order.status}/>
      : null}
    {order.receiptCount>0 && order.status!=="DRAFT" &&
      ["OWNER","ADMIN","MANAGER","ACCOUNTANT","INVENTORY"].includes(role) ?
      <SupplierInvoiceMatching
        purchaseOrderId={order.id} orderNumber={order.orderNumber}
        currencyCode={order.currencyCode} receipts={order.receipts}
        receiptCount={order.receiptCount} onUpdated={refetch}
      /> : null}
    <PurchaseReceiptBuilder open={receiveOpen} suppliers={suppliers}
      purchaseOrderId={order.id} onClose={()=>setReceiveOpen(false)}
      onComplete={()=>{setReceiveOpen(false);refetch();}} />
  </main>;
}
