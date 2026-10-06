"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { clientApi, messageFrom } from "../lib/client-api";
import {
  enqueueMutation,
  flushPendingMutations,
  getOrCreateClientId,
  mutationAppliedEvent,
  type AppliedMutationDetail,
} from "../lib/offline-sync";

type CatalogItem = {
  id: string;
  name: string;
  kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  trackStock: boolean;
  stockUnitCode: string | null;
  active: boolean;
  units: Array<{ code: string; label: string; canPurchase: boolean }>;
  conversions: Array<{ fromUnitCode: string; toUnitCode: string; factor: number }>;
};

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  balanceMinor: number;
};

type InventoryItem = {
  id: string;
  sku: string | null;
  name: string;
  stockUnitCode: string;
  available: number;
  quarantine: number;
  damaged: number;
  waste: number;
  averageStockUnitCostMinor: number | null;
  inventoryValueMinor: number;
};

type PurchaseSummary = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierReference: string | null;
  totalMinor: number;
  currencyCode: string;
  receivedAt: string;
  receiverName: string | null;
  lineCount: number;
  settlementMethod: string;
};

type ReceiptLine = {
  key: string;
  itemId: string;
  itemName: string;
  purchaseUnitCode: string;
  purchaseUnitLabel: string;
  quantity: number;
  unitCostMinor: number;
  estimatedStockQuantity: number | null;
  stockUnitCode: string | null;
};

type Props = {
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  catalog: CatalogItem[];
};

const receiveRoles = new Set(["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"]);
const supplierPaymentRoles = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

export function PurchasesInventory({ businessId, branchId, currencyCode, role, catalog }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const canReceive = receiveRoles.has(role);
  const canPaySupplier = supplierPaymentRoles.has(role);

  const refresh = async () => {
    try {
      const [supplierData, inventoryData, purchaseData] = await Promise.all([
        clientApi<{ suppliers: Supplier[] }>(`/api/tradeos/v1/suppliers?businessId=${encodeURIComponent(businessId)}&limit=200`),
        clientApi<{ items: InventoryItem[] }>(`/api/tradeos/v1/inventory?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}`),
        clientApi<{ purchases: PurchaseSummary[] }>(`/api/tradeos/v1/purchases?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}&limit=20`),
      ]);
      setSuppliers(supplierData.suppliers);
      setInventory(inventoryData.items);
      setPurchases(purchaseData.purchases);
    } catch (error) {
      setMessage(messageFrom(error));
    }
  };

  useEffect(() => {
    void refresh();
    const onApplied = (event: Event) => {
      const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
      if (detail?.businessId === businessId && detail.branchId === branchId && ["PURCHASE_RECEIVE_CREATE","SUPPLIER_PAYMENT_CREATE","SALE_CREATE","RETURN_CREATE","REFUND_CREATE"].includes(detail.mutationType)) {
        void refresh();
      }
    };
    window.addEventListener(mutationAppliedEvent, onApplied);
    return () => window.removeEventListener(mutationAppliedEvent, onApplied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, branchId]);

  const lowOrEmpty = useMemo(() => inventory.filter((item) => item.available <= 0).length, [inventory]);

  return (
    <section className="panel purchase-inventory-panel" id="purchases">
      <div className="panel-heading">
        <div><p className="eyebrow">Procurement · stock receiving</p><h2>Suppliers, purchases & inventory</h2></div>
        <div className="inventory-summary"><span>Tracked products</span><strong>{inventory.length}</strong><small>{lowOrEmpty} empty item{lowOrEmpty === 1 ? "" : "s"}</small></div>
      </div>

      {canReceive ? (
        <div className="procurement-actions">
          <SupplierCreate businessId={businessId} onCreated={(supplier) => { setSuppliers((current) => [...current, supplier].sort((a,b) => a.name.localeCompare(b.name))); setMessage("Supplier added."); }} />
          <PurchaseReceipt
            businessId={businessId}
            branchId={branchId}
            currencyCode={currencyCode}
            suppliers={suppliers.filter((supplier) => supplier.active)}
            catalog={catalog}
            onMessage={setMessage}
          />
        </div>
      ) : <div className="inventory-readonly-note">Your role can view stock and purchase history but cannot receive inventory.</div>}

      <div className="supplier-balances">{suppliers.map(supplier => <div className="purchase-history-row" key={supplier.id}><strong>{supplier.name} · Payable {formatMoney(supplier.balanceMinor,currencyCode)}</strong>{canPaySupplier && supplier.balanceMinor > 0 ? <SupplierPayment businessId={businessId} branchId={branchId} supplier={supplier} onMessage={setMessage} /> : null}</div>)}</div>
      <div className="procurement-grid">
        <InventoryTable items={inventory} currencyCode={currencyCode} />
        <RecentPurchases purchases={purchases} />
      </div>
      {message ? <div className="procurement-message">{message}</div> : null}
    </section>
  );
}

function SupplierCreate({ businessId, onCreated }: { businessId: string; onCreated: (supplier: Supplier) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const result = await clientApi<{ supplier: Supplier }>("/api/tradeos/v1/suppliers", {
        method: "POST",
        body: JSON.stringify({ businessId, name: name.trim(), phone: phone.trim() || null, email: email.trim() || null }),
      });
      setName(""); setPhone(""); setEmail(""); setOpen(false); onCreated(result.supplier);
    } catch (reason) { setError(messageFrom(reason)); }
    finally { setBusy(false); }
  };

  return (
    <div className="supplier-create">
      <button className="ghost-button" type="button" onClick={() => setOpen((value) => !value)}>{open ? "Close supplier form" : "+ Add supplier"}</button>
      {open ? <form className="supplier-form" onSubmit={(event) => void submit(event)}>
        <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Supplier name" /></label>
        <label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="optional" /></label>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="optional" /></label>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save supplier"}</button>
        {error ? <span className="form-error supplier-error">{error}</span> : null}
      </form> : null}
    </div>
  );
}

function PurchaseReceipt({ businessId, branchId, currencyCode, suppliers, catalog, onMessage }: {
  businessId: string;
  branchId: string;
  currencyCode: string;
  suppliers: Supplier[];
  catalog: CatalogItem[];
  onMessage: (message: string | null) => void;
}) {
  const purchasable = catalog.filter((item) => item.active && item.kind === "PRODUCT" && item.trackStock && item.stockUnitCode && item.units.some((unit) => unit.canPurchase));
  const [supplierId, setSupplierId] = useState("");
  const [settlementMethod, setSettlementMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [itemId, setItemId] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [busy, setBusy] = useState(false);

  const selectedItem = purchasable.find((item) => item.id === itemId) ?? null;
  const purchaseUnits = selectedItem?.units.filter((unit) => unit.canPurchase) ?? [];
  const totalMinor = useMemo(() => lines.reduce((sum, line) => sum + Math.round(line.unitCostMinor * line.quantity), 0), [lines]);

  useEffect(() => {
    if (!supplierId && suppliers[0]) setSupplierId(suppliers[0].id);
  }, [supplierId, suppliers]);

  useEffect(() => {
    if (!itemId && purchasable[0]) setItemId(purchasable[0].id);
  }, [itemId, purchasable]);

  useEffect(() => {
    const item = purchasable.find((candidate) => candidate.id === itemId);
    const firstUnit = item?.units.find((unit) => unit.canPurchase);
    setUnitCode(firstUnit?.code ?? "");
  }, [itemId]);

  const addLine = () => {
    if (!selectedItem || !unitCode) return;
    const parsedQuantity = Number(quantity);
    const unitCostMinor = moneyToMinor(unitCost);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || unitCostMinor < 0 || !unitCost.trim()) {
      onMessage("Enter a positive purchase quantity and a valid unit cost.");
      return;
    }
    const unit = purchaseUnits.find((candidate) => candidate.code === unitCode);
    const estimatedStockQuantity = convertQuantity(selectedItem, unitCode, selectedItem.stockUnitCode!, parsedQuantity);
    setLines((current) => [...current, {
      key: crypto.randomUUID(),itemId:selectedItem.id,itemName:selectedItem.name,purchaseUnitCode:unitCode,
      purchaseUnitLabel:unit?.label ?? unitCode,quantity:parsedQuantity,unitCostMinor,
      estimatedStockQuantity,stockUnitCode:selectedItem.stockUnitCode,
    }]);
    setQuantity(""); setUnitCost(""); onMessage(null);
  };

  const receive = async () => {
    if (!supplierId || lines.length === 0 || busy) return;
    setBusy(true); onMessage(null);
    try {
      enqueueMutation({
        clientId:getOrCreateClientId(),clientMutationId:crypto.randomUUID(),businessId,branchId,
        mutationType:"PURCHASE_RECEIVE_CREATE",occurredAt:new Date().toISOString(),
        payload:{ supplierId, settlementMethod, ...(reference.trim()?{supplierReference:reference.trim()}:{}), lines:lines.map((line)=>({
          itemId:line.itemId,purchaseUnitCode:line.purchaseUnitCode,quantity:line.quantity,unitCostMinor:line.unitCostMinor,
        })) },
      });
      setLines([]); setReference("");
      if (!navigator.onLine) { onMessage("Purchase receipt saved offline. Stock will post when this device reconnects."); return; }
      const summary = await flushPendingMutations();
      if (summary.rejected > 0) onMessage("Receipt is saved but needs review before stock can post.");
      else if (summary.applied > 0) onMessage("Purchase received and stock updated.");
      else onMessage("Purchase receipt queued for synchronization.");
    } catch (error) { onMessage(messageFrom(error)); }
    finally { setBusy(false); }
  };

  return (
    <div className="purchase-receipt-box">
      <div className="purchase-receipt-head"><div><p className="eyebrow">Stock top-up</p><strong>Receive a purchase</strong></div><span>{formatMoney(totalMinor,currencyCode)}</span></div>
      {suppliers.length === 0 ? <div className="inventory-readonly-note">Add a supplier before receiving stock.</div> : purchasable.length === 0 ? <div className="inventory-readonly-note">Configure a tracked product with a purchase unit first.</div> : <>
        <div className="receipt-context-row">
          <label>Supplier<select value={supplierId} onChange={(event)=>setSupplierId(event.target.value)}>{suppliers.map((supplier)=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <label>Settlement<select value={settlementMethod} onChange={event=>setSettlementMethod(event.target.value)}>{["CASH","MOMO","CARD","BANK","OTHER","SUPPLIER_CREDIT"].map(method=><option key={method} value={method}>{method === "SUPPLIER_CREDIT" ? "Supplier credit (pay later)" : method}</option>)}</select></label>
          <label>Supplier invoice/reference<input value={reference} onChange={(event)=>setReference(event.target.value)} placeholder="optional" /></label>
        </div>
        <div className="receipt-line-builder">
          <label>Product<select value={itemId} onChange={(event)=>setItemId(event.target.value)}>{purchasable.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Purchase unit<select value={unitCode} onChange={(event)=>setUnitCode(event.target.value)}>{purchaseUnits.map((unit)=><option key={unit.code} value={unit.code}>{unit.label}</option>)}</select></label>
          <label>Quantity<input inputMode="decimal" value={quantity} onChange={(event)=>setQuantity(event.target.value)} placeholder="0" /></label>
          <label>Unit cost<input inputMode="decimal" value={unitCost} onChange={(event)=>setUnitCost(event.target.value)} placeholder="0.00" /></label>
          <button className="ghost-button" type="button" onClick={addLine}>Add line</button>
        </div>
        <div className="receipt-lines">
          {lines.length===0?<span className="receipt-empty">No lines added yet.</span>:lines.map((line)=><div className="receipt-line" key={line.key}>
            <div><strong>{line.itemName}</strong><span>{formatQuantity(line.quantity)} {line.purchaseUnitLabel} · {formatMoney(line.unitCostMinor,currencyCode)} each</span></div>
            <div className="receipt-stock-effect"><span>Stock effect</span><strong>{line.estimatedStockQuantity===null?"Server will convert":`+${formatQuantity(line.estimatedStockQuantity)} ${line.stockUnitCode}`}</strong></div>
            <strong>{formatMoney(Math.round(line.unitCostMinor*line.quantity),currencyCode)}</strong>
            <button className="text-button" type="button" onClick={()=>setLines((current)=>current.filter((candidate)=>candidate.key!==line.key))}>Remove</button>
          </div>)}
        </div>
        <button className="primary-button receive-stock-button" type="button" disabled={busy||lines.length===0||!supplierId} onClick={()=>void receive()}>{busy?"Receiving…":`Receive ${lines.length} line${lines.length===1?"":"s"} · ${formatMoney(totalMinor,currencyCode)}`}</button>
      </>}
    </div>
  );
}

function InventoryTable({ items, currencyCode }: { items: InventoryItem[]; currencyCode: string }) {
  return <div className="inventory-card"><div className="subpanel-head"><div><p className="eyebrow">Branch stock</p><h3>Inventory balances</h3></div><span>{items.length} tracked item{items.length===1?"":"s"}</span></div>
    <div className="inventory-table">
      {items.length===0?<div className="inventory-empty">No tracked products yet.</div>:items.map((item)=><div className="inventory-row" key={item.id}>
        <div><strong>{item.name}</strong><span>{item.sku??item.stockUnitCode}</span></div>
        <div><span>Available</span><strong className={item.available<=0?"stock-empty":""}>{formatQuantity(item.available)} {item.stockUnitCode}</strong></div>
        <div><span>Quarantine</span><strong>{formatQuantity(item.quarantine)}</strong></div>
        <div><span>Average cost</span><strong>{item.averageStockUnitCostMinor===null?"—":`${formatMoney(item.averageStockUnitCostMinor,currencyCode)} / ${item.stockUnitCode}`}</strong><span>Value {formatMoney(item.inventoryValueMinor,currencyCode)}</span></div>
      </div>)}
    </div>
  </div>;
}

function RecentPurchases({ purchases }: { purchases: PurchaseSummary[] }) {
  return <div className="purchase-history-card"><div className="subpanel-head"><div><p className="eyebrow">Receiving history</p><h3>Recent purchases</h3></div></div>
    <div className="purchase-history-list">{purchases.length===0?<div className="inventory-empty">No purchase receipts yet.</div>:purchases.map((purchase)=><div className="purchase-history-row" key={purchase.id}>
      <div><strong>{purchase.supplierName}</strong><span>{purchase.supplierReference??`${purchase.lineCount} line${purchase.lineCount===1?"":"s"}`} · {formatDate(purchase.receivedAt)}</span></div>
      <div><strong>{formatMoney(purchase.totalMinor,purchase.currencyCode)}</strong><span>{purchase.settlementMethod.replaceAll("_", " ")} · {purchase.receiverName??"Staff"}</span></div>
    </div>)}</div>
  </div>;
}

function convertQuantity(item: CatalogItem, from: string, to: string, quantity: number): number | null {
  if (from===to) return quantity;
  const edges = new Map<string,Array<{to:string;factor:number}>>();
  for (const conversion of item.conversions) {
    const forward=edges.get(conversion.fromUnitCode)??[]; forward.push({to:conversion.toUnitCode,factor:conversion.factor}); edges.set(conversion.fromUnitCode,forward);
    const reverse=edges.get(conversion.toUnitCode)??[]; reverse.push({to:conversion.fromUnitCode,factor:1/conversion.factor}); edges.set(conversion.toUnitCode,reverse);
  }
  const queue:Array<{unit:string;value:number}>=[{unit:from,value:quantity}]; const seen=new Set([from]);
  while(queue.length){const current=queue.shift()!; for(const edge of edges.get(current.unit)??[]){if(seen.has(edge.to))continue; const value=current.value*edge.factor; if(edge.to===to)return value; seen.add(edge.to); queue.push({unit:edge.to,value});}}
  return null;
}

function moneyToMinor(value:string):number {
  const normalized=value.trim().replace(/,/g,"");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return -1;
  const [whole,fraction=""]=normalized.split(".");
  const minor=Number(BigInt(whole!)*100n+BigInt(fraction.padEnd(2,"0")));
  return Number.isSafeInteger(minor)?minor:-1;
}
function formatMoney(minor:number,currencyCode:string):string { return currencyCode==="GHS"?`₵${(minor/100).toFixed(2)}`:new Intl.NumberFormat(undefined,{style:"currency",currency:currencyCode}).format(minor/100); }
function formatQuantity(value:number):string { return new Intl.NumberFormat(undefined,{maximumFractionDigits:4}).format(value); }
function formatDate(value:string):string { return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)); }

function SupplierPayment({businessId,branchId,supplier,onMessage}:{businessId:string;branchId:string;supplier:Supplier;onMessage:(message:string)=>void}) {
 const [amount,setAmount]=useState(""); const [method,setMethod]=useState("CASH"); const [busy,setBusy]=useState(false);
 const submit=async(event:FormEvent)=>{
  event.preventDefault(); const amountMinor=moneyToMinor(amount);
  if (!Number.isSafeInteger(amountMinor) || amountMinor<=0 || amountMinor>supplier.balanceMinor) {onMessage("Enter a payment within the supplier payable balance.");return;}
  setBusy(true);
  try {enqueueMutation({clientId:getOrCreateClientId(),clientMutationId:crypto.randomUUID(),businessId,branchId,mutationType:"SUPPLIER_PAYMENT_CREATE",occurredAt:new Date().toISOString(),payload:{supplierId:supplier.id,amountMinor,method}});
   setAmount(""); const result=await flushPendingMutations(); onMessage(result.rejected ? "Supplier payment needs review." : "Supplier payment saved; it will post when synchronized.");
  } catch(error){onMessage(messageFrom(error));} finally{setBusy(false);}
 };
 return <form className="supplier-form" onSubmit={event=>void submit(event)}><label>Payment amount<input required inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)} /></label><label>Method<select value={method} onChange={event=>setMethod(event.target.value)}>{["CASH","MOMO","CARD","BANK","OTHER"].map(value=><option key={value}>{value}</option>)}</select></label><button disabled={busy} className="primary-button">Pay supplier</button></form>;
}
