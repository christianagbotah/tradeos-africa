"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { clientApi, messageFrom } from "../lib/client-api";
import { readFeatureCache, writeFeatureCache } from "../lib/feature-cache";
import { captureSessionEpoch, isSessionEpochCurrent } from "../lib/session-lifecycle";
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
  paymentTermsDays: number;
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
  view: "purchases" | "inventory";
};

const receiveRoles = new Set(["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"]);
const supplierPaymentRoles = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

type PurchasesInventorySnapshot = { suppliers: Supplier[]; inventory: InventoryItem[]; purchases: PurchaseSummary[] };
function isPurchasesInventorySnapshot(value: unknown): value is PurchasesInventorySnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PurchasesInventorySnapshot>;
  return Array.isArray(row.suppliers) && Array.isArray(row.inventory) && Array.isArray(row.purchases);
}
function isPurchaseDetail(value: unknown): value is { lines: ReturnablePurchaseLine[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { lines?: unknown }).lines));
}

export function PurchasesInventory({ businessId, branchId, currencyCode, role, catalog, view }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([]);
  const [returnPurchase, setReturnPurchase] = useState<PurchaseSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canReceive = receiveRoles.has(role);
  const canPaySupplier = supplierPaymentRoles.has(role);

  const refresh = async () => {
    const sessionEpoch = captureSessionEpoch();
    const cached = readFeatureCache("purchases-inventory", businessId, branchId, "root", isPurchasesInventorySnapshot);
    if (cached) {
      setSuppliers(cached.suppliers);
      setInventory(cached.inventory);
      setPurchases(cached.purchases);
    }
    if (!navigator.onLine) {
      setMessage(cached ? "Offline: showing saved suppliers, purchases and inventory for this branch." : "Offline: no saved purchase or inventory data exists for this branch yet.");
      return;
    }
    try {
      const [supplierData, inventoryData, purchaseData] = await Promise.all([
        clientApi<{ suppliers: Supplier[] }>(`/api/tradeos/v1/suppliers?businessId=${encodeURIComponent(businessId)}&limit=200`),
        clientApi<{ items: InventoryItem[] }>(`/api/tradeos/v1/inventory?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}`),
        clientApi<{ purchases: PurchaseSummary[] }>(`/api/tradeos/v1/purchases?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}&limit=20`),
      ]);
      const next: PurchasesInventorySnapshot = { suppliers: supplierData.suppliers, inventory: inventoryData.items, purchases: purchaseData.purchases };
      if (!isSessionEpochCurrent(sessionEpoch)) return;
      setSuppliers(next.suppliers);
      setInventory(next.inventory);
      setPurchases(next.purchases);
      writeFeatureCache("purchases-inventory", businessId, branchId, next);
      setMessage(null);
    } catch (error) {
      if (!isSessionEpochCurrent(sessionEpoch)) return;
      setMessage(cached ? `Showing saved branch data. ${messageFrom(error)}` : messageFrom(error));
    }
  };

  useEffect(() => {
    void refresh();
    const onApplied = (event: Event) => {
      const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
      if (detail?.businessId === businessId && detail.branchId === branchId && ["PURCHASE_RETURN_CREATE","PURCHASE_RECEIVE_CREATE","SUPPLIER_PAYMENT_CREATE","SALE_CREATE","RETURN_CREATE","REFUND_CREATE"].includes(detail.mutationType)) {
        void refresh();
      }
    };
    window.addEventListener(mutationAppliedEvent, onApplied);
    return () => window.removeEventListener(mutationAppliedEvent, onApplied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, branchId]);

  const lowOrEmpty = useMemo(() => inventory.filter((item) => item.available <= 0).length, [inventory]);

  return (
    <section className="panel purchase-inventory-panel" id={view === "purchases" ? "purchases" : "inventory"} data-purchase-view={view}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{view === "purchases" ? "Procurement · stock receiving" : "Stock control · branch inventory"}</p>
          <h2>{view === "purchases" ? "Suppliers & purchases" : "Inventory"}</h2>
        </div>
        <div className="inventory-summary"><span>Tracked products</span><strong>{inventory.length}</strong><small>{lowOrEmpty} empty item{lowOrEmpty === 1 ? "" : "s"}</small></div>
      </div>

      {view === "purchases" ? <>
        {canReceive ? (
          <div className="procurement-actions">
            <SupplierCreate businessId={businessId} canManageTerms={canPaySupplier} onCreated={(supplier) => { setSuppliers((current) => [...current, supplier].sort((a,b) => a.name.localeCompare(b.name))); setMessage("Supplier added."); }} />
            <PurchaseReceipt businessId={businessId} branchId={branchId} currencyCode={currencyCode} suppliers={suppliers.filter((supplier) => supplier.active)} catalog={catalog} onMessage={setMessage} />
          </div>
        ) : <div className="inventory-readonly-note">Your role can view purchase history but cannot receive inventory.</div>}
        <div className="supplier-balances">{suppliers.map(supplier => <div className="purchase-history-row" key={supplier.id}><div><strong>{supplier.name} · {supplier.balanceMinor < 0 ? "Supplier credit" : "Payable"} {formatMoney(Math.abs(supplier.balanceMinor),currencyCode)}</strong><span>Terms: Net {supplier.paymentTermsDays} day{supplier.paymentTermsDays === 1 ? "" : "s"}</span></div>{canPaySupplier ? <SupplierTerms businessId={businessId} supplier={supplier} onSaved={()=>void refresh()} onMessage={setMessage} /> : null}{canPaySupplier && supplier.balanceMinor > 0 ? <SupplierPayment businessId={businessId} branchId={branchId} supplier={supplier} onMessage={setMessage} /> : null}</div>)}</div>
        <RecentPurchases purchases={purchases} onReturn={canReceive ? setReturnPurchase : undefined} />
        {returnPurchase ? <PurchaseReturn key={returnPurchase.id} businessId={businessId} branchId={branchId} purchase={returnPurchase} onClose={()=>setReturnPurchase(null)} onMessage={setMessage} /> : null}
      </> : <InventoryTable items={inventory} currencyCode={currencyCode} />}
      {message ? <div className="procurement-message">{message}</div> : null}
    </section>
  );
}

function SupplierCreate({ businessId, canManageTerms, onCreated }: { businessId: string; canManageTerms: boolean; onCreated: (supplier: Supplier) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const result = await clientApi<{ supplier: Supplier }>("/api/tradeos/v1/suppliers", {
        method: "POST",
        body: JSON.stringify({ businessId, name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, ...(canManageTerms ? { paymentTermsDays: Number(paymentTermsDays || 0) } : {}) }),
      });
      setName(""); setPhone(""); setEmail(""); setPaymentTermsDays("0"); setOpen(false); onCreated(result.supplier);
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
{canManageTerms ? <label>Payment terms (days)<input inputMode="numeric" min="0" max="3650" value={paymentTermsDays} onChange={(event) => setPaymentTermsDays(event.target.value.replace(/\D/g, ""))} /></label> : null}
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

function RecentPurchases({ purchases, onReturn }: { purchases: PurchaseSummary[]; onReturn?: ((purchase: PurchaseSummary) => void) | undefined }) {
  return <div className="purchase-history-card"><div className="subpanel-head"><div><p className="eyebrow">Receiving history</p><h3>Recent purchases</h3></div></div>
    <div className="purchase-history-list">{purchases.length===0?<div className="inventory-empty">No purchase receipts yet.</div>:purchases.map((purchase)=><div className="purchase-history-row" key={purchase.id}>
      <div><strong>{purchase.supplierName}</strong><span>{purchase.supplierReference??`${purchase.lineCount} line${purchase.lineCount===1?"":"s"}`} · {formatDate(purchase.receivedAt)}</span></div>
      <div><strong>{formatMoney(purchase.totalMinor,purchase.currencyCode)}</strong><span>{purchase.settlementMethod.replaceAll("_", " ")} · {purchase.receiverName??"Staff"}</span></div>
      {onReturn ? <button type="button" className="ghost-button" onClick={()=>onReturn(purchase)}>Return purchase</button> : null}
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

function SupplierTerms({ businessId, supplier, onSaved, onMessage }: { businessId: string; supplier: Supplier; onSaved: () => void; onMessage: (message: string | null) => void }) {
  const [days,setDays]=useState(String(supplier.paymentTermsDays));
  const [busy,setBusy]=useState(false);
  useEffect(()=>setDays(String(supplier.paymentTermsDays)),[supplier.id,supplier.paymentTermsDays]);
  const save=async()=>{ if(busy) return; setBusy(true); onMessage(null); try { await clientApi(`/api/tradeos/v1/suppliers/${supplier.id}`,{method:"PATCH",body:JSON.stringify({businessId,paymentTermsDays:Number(days||0)})}); onMessage("Supplier payment terms updated. New credit purchases will snapshot the new due date."); onSaved(); } catch(error){ onMessage(messageFrom(error)); } finally { setBusy(false); } };
  return <div className="supplier-terms-inline"><label>Net days<input inputMode="numeric" min="0" max="3650" value={days} onChange={(event)=>setDays(event.target.value.replace(/\D/g,""))} /></label><button type="button" className="text-button" disabled={busy} onClick={()=>void save()}>{busy?"Saving…":"Save terms"}</button></div>;
}

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


type ReturnablePurchaseLine = {id:string;itemName:string;purchaseUnitCode:string;purchaseQuantity:number;stockUnitCode:string;stockQuantity:number;lineCostMinor:number;returnedQuantity:number;remainingQuantity:number;returnedRecoveryMinor:number};
function returnPreview(line:ReturnablePurchaseLine, quantity:number):number {
 const original=BigInt(Math.round(line.purchaseQuantity*1e8));
 if (original<=0n || !Number.isFinite(quantity) || quantity<0 || quantity>line.remainingQuantity) return 0;
 const cumulative=BigInt(Math.round(line.returnedQuantity*1e8))+BigInt(Math.round(quantity*1e8));
 return Number((BigInt(line.lineCostMinor)*cumulative+original/2n)/original)-line.returnedRecoveryMinor;
}
function PurchaseReturn({businessId,branchId,purchase,onClose,onMessage}:{businessId:string;branchId:string;purchase:PurchaseSummary;onClose:()=>void;onMessage:(message:string)=>void}) {
 const [lines,setLines]=useState<ReturnablePurchaseLine[]>([]);
 const [quantities,setQuantities]=useState<Record<string,string>>({});
 const [locations,setLocations]=useState<Record<string,string>>({});
 const [method,setMethod]=useState("CREDIT_NOTE");
 const [busy,setBusy]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [loadError,setLoadError]=useState<string | null>(null);
 useEffect(()=>{
  let active=true;
  const cached=readFeatureCache("purchase-detail",businessId,branchId,purchase.id,isPurchaseDetail);
  if(cached){setLines(cached.lines);setLoaded(true);}
  if(!navigator.onLine){if(!cached)setLoadError("Offline: this purchase has not been opened on this device yet.");return()=>{active=false;};}
  clientApi<{lines:ReturnablePurchaseLine[]}>(`/api/tradeos/v1/purchases/${purchase.id}?businessId=${encodeURIComponent(businessId)}`).then(data=>{if(active){setLines(data.lines);setLoaded(true);setLoadError(null);writeFeatureCache("purchase-detail",businessId,branchId,data,purchase.id);}}).catch(error=>{if(active&&!cached)setLoadError(messageFrom(error));});
  return()=>{active=false;};
 },[businessId,branchId,purchase.id]);
 const preview=lines.reduce((sum,line)=>sum+returnPreview(line,Number(quantities[line.id]||0)),0);
 const submit=async(event:FormEvent)=>{
  event.preventDefault();
  const selected=lines.filter(line=>Number(quantities[line.id]||0)>0);
  if(!selected.length || selected.some(line=>!Number.isFinite(Number(quantities[line.id])) || Number(quantities[line.id])>line.remainingQuantity)){onMessage("Choose quantities within the remaining purchased quantities.");return;}
  setBusy(true);
  try {
   enqueueMutation({clientId:getOrCreateClientId(),clientMutationId:crypto.randomUUID(),businessId,branchId,mutationType:"PURCHASE_RETURN_CREATE",occurredAt:new Date().toISOString(),payload:{originalPurchaseId:purchase.id,supplierId:purchase.supplierId,recoveryMethod:method,lines:selected.map(line=>({purchaseLineId:line.id,quantity:Number(quantities[line.id]),sourceLocation:locations[line.id]||"AVAILABLE"}))}});
   onClose();
   if(!navigator.onLine){onMessage("Purchase return saved offline; stock and recovery will post when synchronized.");return;}
   const result=await flushPendingMutations();onMessage(result.rejected ? "Purchase return needs review." : "Purchase return saved for synchronization.");
  }catch(error){onMessage(messageFrom(error));}finally{setBusy(false);}
 };
 return <form className="purchase-receipt-box" onSubmit={event=>void submit(event)}>
  <div className="purchase-receipt-head"><strong>Return to {purchase.supplierName}</strong><button className="ghost-button" type="button" onClick={onClose}>Close</button></div>
  {!loaded ? <p>{loadError || "Loading original purchase…"}</p> : lines.map(line=><div className="receipt-line-builder" key={line.id}>
   <div><strong>{line.itemName}</strong><p>Remaining {formatQuantity(line.remainingQuantity)} {line.purchaseUnitCode} · Originally {formatQuantity(line.purchaseQuantity)} {line.purchaseUnitCode} = {formatQuantity(line.stockQuantity)} {line.stockUnitCode}</p></div>
   <label>Return quantity ({line.purchaseUnitCode})<input type="number" min="0" max={line.remainingQuantity} step="0.00000001" disabled={line.remainingQuantity<=0} value={quantities[line.id]||""} onChange={event=>setQuantities(current=>({...current,[line.id]:event.target.value}))}/></label>
   <label>Stock source<select value={locations[line.id]||"AVAILABLE"} onChange={event=>setLocations(current=>({...current,[line.id]:event.target.value}))}><option>AVAILABLE</option><option>QUARANTINE</option></select></label>
  </div>)}
  <label>Recovery method<select value={method} onChange={event=>setMethod(event.target.value)}>{["CREDIT_NOTE","CASH","MOMO","CARD","BANK","OTHER"].map(value=><option key={value} value={value}>{value==="CREDIT_NOTE"?"Supplier credit note":value}</option>)}</select></label>
  <p>{method==="CREDIT_NOTE"?"Supplier credit":"Supplier recovery"} preview: {formatMoney(preview,purchase.currencyCode)}</p>
  <button className="primary-button" disabled={busy||!loaded} type="submit">Save purchase return</button>
 </form>;
}
