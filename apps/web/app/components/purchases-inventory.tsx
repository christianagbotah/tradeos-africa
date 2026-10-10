import { FormEvent, useEffect, useMemo, useState } from "react";
import { clientApi, messageFrom } from "../lib/client-api";
import { SupplierWorkspace } from "./suppliers/supplier-workspace";
import type { Supplier } from "./suppliers/supplier-types";
import type { MoneyAccount } from "./treasury/types";
import { PurchaseReceiptBuilder } from "./purchases/purchase-receipt-builder";
import { PurchaseWorkspace } from "./purchases/purchase-workspace";
import { PurchaseDetailSheet } from "./purchases/purchase-detail-sheet";
import type { PurchaseCatalogItem, PurchaseDetail, PurchaseDetailLine, PurchaseSummary } from "./purchases/types";
import { InventoryWorkspace } from "./inventory/inventory-workspace";
import { InventoryDetailSheet } from "./inventory/inventory-detail-sheet";
import type { InventoryDetail, InventoryItem } from "./inventory/types";
import { PageHeader } from "./ui/page-header";
import { readFeatureCache, writeFeatureCache } from "../lib/feature-cache";
import { captureSessionEpoch, isSessionEpochCurrent } from "../lib/session-lifecycle";
import {
  enqueueMutation,
  flushPendingMutations,
  getOrCreateClientId,
  mutationAppliedEvent,
  type AppliedMutationDetail,
} from "../lib/offline-sync";

type Props = {
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  catalog: PurchaseCatalogItem[];
  view: "purchases" | "inventory";
};

const receiveRoles = new Set(["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"]);

type PurchasesInventorySnapshot = { suppliers: Supplier[]; inventory: InventoryItem[]; purchases: PurchaseSummary[]; accounts: MoneyAccount[] };
function isPurchasesInventorySnapshot(value: unknown): value is PurchasesInventorySnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PurchasesInventorySnapshot>;
  return Array.isArray(row.suppliers) && Array.isArray(row.inventory) && Array.isArray(row.purchases) && Array.isArray(row.accounts);
}
function isPurchaseDetail(value: unknown): value is PurchaseDetail {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PurchaseDetail>;
  return Boolean(row.purchase && Array.isArray(row.lines) && Array.isArray(row.returns));
}
function isInventoryDetail(value: unknown): value is InventoryDetail {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<InventoryDetail>;
  return Boolean(row.item && Array.isArray(row.movements));
}

export function PurchasesInventory({ businessId, branchId, currencyCode, role, catalog, view }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccount[]>([]);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseSummary | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PurchaseDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [returnPurchase, setReturnPurchase] = useState<PurchaseSummary | null>(null);
  const [selectedInventory, setSelectedInventory] = useState<InventoryItem | null>(null);
  const [inventoryDetail, setInventoryDetail] = useState<InventoryDetail | null>(null);
  const [inventoryLoadingId, setInventoryLoadingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canReceive = receiveRoles.has(role);

  const refresh = async () => {
    const sessionEpoch = captureSessionEpoch();
    const cached = readFeatureCache("purchases-inventory", businessId, branchId, "root", isPurchasesInventorySnapshot);
    if (cached) {
      setSuppliers(cached.suppliers);
      setInventory(cached.inventory);
      setPurchases(cached.purchases);
      setAccounts(cached.accounts);
    }
    if (!navigator.onLine) {
      setMessage(cached ? "Offline: showing saved suppliers, purchases and inventory for this branch." : "Offline: no saved purchase or inventory data exists for this branch yet.");
      return;
    }
    try {
      const [supplierData, inventoryData, purchaseData, accountData] = await Promise.all([
        clientApi<{ suppliers: Supplier[] }>(`/api/tradeos/v1/suppliers?businessId=${encodeURIComponent(businessId)}&limit=200`),
        clientApi<{ items: InventoryItem[] }>(`/api/tradeos/v1/inventory?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}`),
        clientApi<{ purchases: PurchaseSummary[] }>(`/api/tradeos/v1/purchases?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}&limit=50`),
        clientApi<{ accounts: MoneyAccount[] }>(`/api/tradeos/v1/money-accounts?businessId=${encodeURIComponent(businessId)}`),
      ]);
      const next: PurchasesInventorySnapshot = { suppliers: supplierData.suppliers, inventory: inventoryData.items, purchases: purchaseData.purchases, accounts: accountData.accounts };
      if (!isSessionEpochCurrent(sessionEpoch)) return;
      setSuppliers(next.suppliers);
      setInventory(next.inventory);
      setPurchases(next.purchases);
      setAccounts(next.accounts);
      writeFeatureCache("purchases-inventory", businessId, branchId, next);
      setMessage(null);
    } catch (error) {
      if (!isSessionEpochCurrent(sessionEpoch)) return;
      setMessage(cached ? `Showing saved branch data. ${messageFrom(error)}` : messageFrom(error));
    }
  };

  useEffect(() => {
    setSelectedPurchase(null);
    setSelectedDetail(null);
    setReturnPurchase(null);
    setSelectedInventory(null);
    setInventoryDetail(null);
    void refresh();
    const onApplied = (event: Event) => {
      const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
      if (detail?.businessId === businessId && detail.branchId === branchId && ["PURCHASE_RETURN_CREATE","PURCHASE_RECEIVE_CREATE","SUPPLIER_PAYMENT_CREATE","SALE_CREATE","RETURN_CREATE","REFUND_CREATE","INVENTORY_ADJUSTMENT_CREATE"].includes(detail.mutationType)) void refresh();
    };
    window.addEventListener(mutationAppliedEvent, onApplied);
    return () => window.removeEventListener(mutationAppliedEvent, onApplied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, branchId]);

  const openPurchase = async (purchase: PurchaseSummary) => {
    setSelectedPurchase(purchase);
    setSelectedDetail(null);
    const cached = readFeatureCache("purchase-detail", businessId, branchId, purchase.id, isPurchaseDetail);
    if (cached) setSelectedDetail(cached);
    if (!navigator.onLine) {
      if (!cached) setMessage("Offline: this purchase receipt has not been opened on this device yet.");
      return;
    }
    setDetailLoadingId(purchase.id);
    const sessionEpoch = captureSessionEpoch();
    try {
      const detail = await clientApi<PurchaseDetail>(`/api/tradeos/v1/purchases/${purchase.id}?businessId=${encodeURIComponent(businessId)}`);
      if (!isSessionEpochCurrent(sessionEpoch)) return;
      setSelectedDetail(detail);
      writeFeatureCache("purchase-detail", businessId, branchId, detail, purchase.id);
      setMessage(null);
    } catch (error) {
      if (!cached && isSessionEpochCurrent(sessionEpoch)) setMessage(messageFrom(error));
    } finally {
      if (isSessionEpochCurrent(sessionEpoch)) setDetailLoadingId(null);
    }
  };

  const openInventory = async (item: InventoryItem) => {
    setSelectedInventory(item);
    setInventoryDetail(null);
    const cached = readFeatureCache("inventory-detail", businessId, branchId, item.id, isInventoryDetail);
    if (cached) setInventoryDetail(cached);
    if (!navigator.onLine) {
      if (!cached) setMessage("Offline: movement history for this item has not been opened on this device yet.");
      return;
    }
    setInventoryLoadingId(item.id);
    const sessionEpoch = captureSessionEpoch();
    try {
      const detail = await clientApi<InventoryDetail>(`/api/tradeos/v1/inventory/${item.id}?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}&limit=100`);
      if (!isSessionEpochCurrent(sessionEpoch)) return;
      setInventoryDetail(detail);
      writeFeatureCache("inventory-detail", businessId, branchId, detail, item.id);
      setMessage(null);
    } catch (error) {
      if (!cached && isSessionEpochCurrent(sessionEpoch)) setMessage(messageFrom(error));
    } finally {
      if (isSessionEpochCurrent(sessionEpoch)) setInventoryLoadingId(null);
    }
  };

  const lowOrEmpty = useMemo(() => inventory.filter((item) => item.available <= 0).length, [inventory]);

  return <section className="purchase-inventory-workspace" id={view === "purchases" ? "purchases" : "inventory"} data-purchase-view={view}>
    <PageHeader
      eyebrow={view === "purchases" ? "Procurement · stock receiving" : "Stock control · branch inventory"}
      title={view === "purchases" ? "Suppliers & purchases" : "Inventory"}
      subtitle={view === "purchases"
        ? "Receive stock, inspect posted receipts and create linked supplier corrections without editing history."
        : "Review movement-derived stock, investigate item history and make controlled adjustments for this branch."}
      status={<div className="inventory-summary"><span>Tracked products</span><strong>{inventory.length}</strong><small>{lowOrEmpty} empty item{lowOrEmpty === 1 ? "" : "s"}</small></div>}
    />

    {view === "purchases" ? <>
      <SupplierWorkspace businessId={businessId} branchId={branchId} currencyCode={currencyCode} role={role} suppliers={suppliers} onRefresh={refresh} />
      {canReceive ? <div className="procurement-actions"><PurchaseReceiptBuilder businessId={businessId} branchId={branchId} currencyCode={currencyCode} suppliers={suppliers.filter((supplier) => supplier.active)} catalog={catalog} accounts={accounts} onMessage={setMessage} /></div> : <div className="inventory-readonly-note">Your role can view purchase history but cannot receive inventory.</div>}
      <PurchaseWorkspace purchases={purchases} loadingId={detailLoadingId} onOpen={(purchase) => void openPurchase(purchase)} />
      <PurchaseDetailSheet open={Boolean(selectedPurchase)} purchase={selectedPurchase} detail={selectedDetail} canReturn={canReceive} onClose={() => { setSelectedPurchase(null); setSelectedDetail(null); }} onReturn={() => { if (selectedPurchase) setReturnPurchase(selectedPurchase); setSelectedPurchase(null); setSelectedDetail(null); }} />
      {returnPurchase ? <PurchaseReturn key={returnPurchase.id} businessId={businessId} branchId={branchId} purchase={returnPurchase} onClose={() => setReturnPurchase(null)} onMessage={setMessage} /> : null}
    </> : <>
      <InventoryWorkspace items={inventory} currencyCode={currencyCode} loadingId={inventoryLoadingId} onOpen={(item) => void openInventory(item)} businessId={businessId} branchId={branchId} role={role} onRefresh={refresh} />
      <InventoryDetailSheet open={Boolean(selectedInventory)} detail={inventoryDetail} onClose={() => { setSelectedInventory(null); setInventoryDetail(null); }} />
    </>}
    {message ? <div className="procurement-message">{message}</div> : null}
  </section>;
}

function returnPreview(line: PurchaseDetailLine, quantity: number): number {
  const original = BigInt(Math.round(line.purchaseQuantity * 1e8));
  if (original <= 0n || !Number.isFinite(quantity) || quantity < 0 || quantity > line.remainingQuantity) return 0;
  const cumulative = BigInt(Math.round(line.returnedQuantity * 1e8)) + BigInt(Math.round(quantity * 1e8));
  return Number((BigInt(line.lineCostMinor) * cumulative + original / 2n) / original) - line.returnedRecoveryMinor;
}

function PurchaseReturn({ businessId, branchId, purchase, onClose, onMessage }: { businessId: string; branchId: string; purchase: PurchaseSummary; onClose: () => void; onMessage: (message: string) => void }) {
  const [lines, setLines] = useState<PurchaseDetailLine[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [method, setMethod] = useState("CREDIT_NOTE");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const sessionEpoch = captureSessionEpoch();
    const cached = readFeatureCache("purchase-detail", businessId, branchId, purchase.id, isPurchaseDetail);
    if (cached) { setLines(cached.lines); setLoaded(true); }
    if (!navigator.onLine) { if (!cached) setLoadError("Offline: this purchase has not been opened on this device yet."); return () => { active = false; }; }
    clientApi<PurchaseDetail>(`/api/tradeos/v1/purchases/${purchase.id}?businessId=${encodeURIComponent(businessId)}`).then((data) => { if (active && isSessionEpochCurrent(sessionEpoch)) { setLines(data.lines); setLoaded(true); setLoadError(null); writeFeatureCache("purchase-detail", businessId, branchId, data, purchase.id); } }).catch((error) => { if (active && isSessionEpochCurrent(sessionEpoch) && !cached) setLoadError(messageFrom(error)); });
    return () => { active = false; };
  }, [businessId, branchId, purchase.id]);
  const preview = lines.reduce((sum, line) => sum + returnPreview(line, Number(quantities[line.id] || 0)), 0);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const selected = lines.filter((line) => Number(quantities[line.id] || 0) > 0);
    if (!selected.length || selected.some((line) => !Number.isFinite(Number(quantities[line.id])) || Number(quantities[line.id]) > line.remainingQuantity)) { onMessage("Choose quantities within the remaining purchased quantities."); return; }
    setBusy(true);
    try {
      enqueueMutation({ clientId: getOrCreateClientId(), clientMutationId: crypto.randomUUID(), businessId, branchId, mutationType: "PURCHASE_RETURN_CREATE", occurredAt: new Date().toISOString(), payload: { originalPurchaseId: purchase.id, supplierId: purchase.supplierId, recoveryMethod: method, lines: selected.map((line) => ({ purchaseLineId: line.id, quantity: Number(quantities[line.id]), sourceLocation: locations[line.id] || "AVAILABLE" })) } });
      onClose();
      if (!navigator.onLine) { onMessage("Purchase return saved offline; stock and recovery will post when synchronized."); return; }
      const result = await flushPendingMutations(); onMessage(result.rejected ? "Purchase return needs review." : "Purchase return saved for synchronization.");
    } catch (error) { onMessage(messageFrom(error)); } finally { setBusy(false); }
  };
  return <form className="purchase-return-sheet" onSubmit={(event) => void submit(event)}>
    <div className="purchase-receipt-head"><div><span>Purchase correction</span><strong>Return to {purchase.supplierName}</strong></div><button  className="tos-button tos-button--secondary" type="button" onClick={onClose}>Close</button></div>
    {!loaded ? <p>{loadError || "Loading original purchase…"}</p> : lines.map((line) => <div className="receipt-line-builder" key={line.id}>
      <div><strong>{line.itemName}</strong><p>Remaining {formatQuantity(line.remainingQuantity)} {line.purchaseUnitCode} · Originally {formatQuantity(line.purchaseQuantity)} {line.purchaseUnitCode} = {formatQuantity(line.stockQuantity)} {line.stockUnitCode}</p></div>
      <label>Return quantity ({line.purchaseUnitCode})<input type="number" min="0" max={line.remainingQuantity} step="0.00000001" disabled={line.remainingQuantity <= 0} value={quantities[line.id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))} /></label>
      <label>Stock source<select value={locations[line.id] || "AVAILABLE"} onChange={(event) => setLocations((current) => ({ ...current, [line.id]: event.target.value }))}><option>AVAILABLE</option><option>QUARANTINE</option></select></label>
    </div>)}
    <label>Recovery method<select value={method} onChange={(event) => setMethod(event.target.value)}>{["CREDIT_NOTE","CASH","MOMO","CARD","BANK","OTHER"].map((value) => <option key={value} value={value}>{value === "CREDIT_NOTE" ? "Supplier credit note" : value}</option>)}</select></label>
    <p>{method === "CREDIT_NOTE" ? "Supplier credit" : "Supplier recovery"} preview: {formatMoney(preview, purchase.currencyCode)}</p>
    <button  className="tos-button tos-button--primary" disabled={busy || !loaded} type="submit">Save purchase return</button>
  </form>;
}

function formatMoney(minor: number, currencyCode: string): string { return currencyCode === "GHS" ? `₵${(minor / 100).toFixed(2)}` : new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100); }
function formatQuantity(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value); }
