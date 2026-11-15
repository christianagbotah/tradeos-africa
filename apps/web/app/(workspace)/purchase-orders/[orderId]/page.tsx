"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { formatMoney } from "@tradeos/contracts";
import { useWorkspace } from "../../../components/workspace/use-workspace";
import { useApiFetch } from "../../../../lib/use-api-fetch";
import styles from "./purchase-order-preview.module.css";

type Status="DRAFT"|"ISSUED"|"CANCELLED";
interface PurchaseOrder {
  id:string;orderNumber:string;businessId:string;branchId:string;
  status:Status;currencyCode:string;businessName:string;branchName:string;
  supplierName:string;supplierPhone:string|null;supplierEmail:string|null;
  supplierAddress:string|null;notes:string;expectedDeliveryDate:string|null;
  subtotalMinor:number;taxMinor:number;totalMinor:number;
  issuedAt:string|null;cancelledAt:string|null;createdAt:string;
  lines:Array<{id:string;itemName:string;itemSku:string|null;
    purchaseUnitCode:string;purchaseUnitLabel:string;quantity:number;
    unitCostMinor:number;lineTotalMinor:number}>;
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
  const {session}=useWorkspace();
  const valid=UUID.test(params.orderId);
  const url=session&&valid?
    `/v1/purchase-orders/${encodeURIComponent(params.orderId)}?businessId=${encodeURIComponent(session.businessId)}`:null;
  const {data,loading,error}=useApiFetch<{order:PurchaseOrder}>(url);
  const order=data?.order;
  if(!valid)return <main className={styles.failure}>Invalid purchase order identifier.</main>;
  if(loading)return <main className={styles.failure}>Loading purchase order…</main>;
  if(error||!order)return <main className={styles.failure} role="alert">
    {error||"Purchase order is unavailable."}</main>;
  const money=(minor:number)=>formatMoney(minor,order.currencyCode);
  return <main className={styles.wrapper}>
    <div className={styles.actions}>
      <Link href="/purchase-orders">Back to purchase orders</Link>
      {order.status==="ISSUED"?<button type="button" onClick={()=>window.print()}>
        Print / Save as PDF</button>:null}
    </div>
    <article id="tradeos-supplier-po" className={styles.document}>
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
            <th>Quantity</th><th>Unit cost</th><th>Line total</th></tr></thead>
          <tbody>{order.lines.map((line,index)=><tr key={line.id}>
            <td>{index+1}</td>
            <td><strong>{line.itemName}</strong>
              <small>{line.itemSku?line.itemSku+" · ":""}{line.purchaseUnitLabel}</small></td>
            <td>{line.quantity.toLocaleString("en-GH",{maximumFractionDigits:8})}</td>
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
      {order.notes?<section className={styles.notes}><h2>Terms & instructions</h2>
        <p>{order.notes}</p></section>:null}
      <footer className={styles.footer}>
        <p>Supplier purchase order only. This is not proof of delivery, a supplier invoice
          or payment. Stock and supplier payables are recorded after goods are received.</p>
        <p>{order.orderNumber} · {order.businessName}</p>
      </footer>
    </article>
  </main>;
}
