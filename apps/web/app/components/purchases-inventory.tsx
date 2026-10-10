import { useEffect, useMemo, useState } from "react";
import { clientApi, messageFrom } from "../lib/client-api";
import { SupplierWorkspace } from "./suppliers/supplier-workspace";
import type { Supplier } from "./suppliers/supplier-types";
import type { MoneyAccount } from "./treasury/types";
import { PurchaseReceiptBuilder } from "./purchases/purchase-receipt-builder";
import { PurchaseWorkspace } from "./purchases/purchase-workspace";
import { PurchaseDetailSheet } from "./purchases/purchase-detail-sheet";
import { PurchaseReturnSheet } from "./purchases/purchase-return-sheet";
import type { PurchaseCatalogItem, PurchaseDetail, PurchaseSummary } from "./purchases/types";
import { InventoryWorkspace } from "./inventory/inventory-workspace";
import { InventoryDetailSheet } from "./inventory/inventory-detail-sheet";
import type { InventoryDetail, InventoryItem } from "./inventory/types";
import { PageHeader } from "./ui/page-header";
import { readFeatureCache, writeFeatureCache } from "../lib/feature-cache";
import { captureSessionEpoch, isSessionEpochCurrent } from "../lib/session-lifecycle";
import { mutationAppliedEvent, type AppliedMutationDetail } from "../lib/offline-sync";

type Props = {
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  catalog: PurchaseCatalogItem[];
  view: "purchases" | "inventory";
};

const receiveRoles = new Set(["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"]);

type PurchasesInventorySnapshot = {
  suppliers: Supplier[];
  inventory: InventoryItem[];
  purchases: PurchaseSummary[];
  accounts: MoneyAccount[];
};

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
      const next: PurchasesInventorySnapshot = {
        suppliers: supplierData.suppliers,
        inventory: inventoryData.items,
        purchases: purchaseData.purchases,
        accounts: accountData.accounts,
      };
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
      if (detail?.businessId === businessId && detail.branchId === branchId && ["PURCHASE_RETURN_CREATE", "PURCHASE_RECEIVE_CREATE", "SUPPLIER_PAYMENT_CREATE", "SALE_CREATE", "RETURN_CREATE", "REFUND_CREATE", "INVENTORY_ADJUSTMENT_CREATE"].includes(detail.mutationType)) {
        void refresh();
      }
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
      {canReceive
        ? <div className="procurement-actions"><PurchaseReceiptBuilder businessId={businessId} branchId={branchId} currencyCode={currencyCode} suppliers={suppliers.filter((supplier) => supplier.active)} catalog={catalog} accounts={accounts} onMessage={setMessage} /></div>
        : <div className="inventory-readonly-note">Your role can view purchase history but cannot receive inventory.</div>}
      <PurchaseWorkspace purchases={purchases} loadingId={detailLoadingId} onOpen={(purchase) => void openPurchase(purchase)} />
      <PurchaseDetailSheet
        open={Boolean(selectedPurchase)}
        purchase={selectedPurchase}
        detail={selectedDetail}
        canReturn={canReceive}
        onClose={() => { setSelectedPurchase(null); setSelectedDetail(null); }}
        onReturn={() => {
          if (selectedPurchase) setReturnPurchase(selectedPurchase);
          setSelectedPurchase(null);
          setSelectedDetail(null);
        }}
      />
      {returnPurchase ? <PurchaseReturnSheet key={returnPurchase.id} businessId={businessId} branchId={branchId} purchase={returnPurchase} onClose={() => setReturnPurchase(null)} onMessage={setMessage} /> : null}
    </> : <>
      <InventoryWorkspace items={inventory} currencyCode={currencyCode} loadingId={inventoryLoadingId} onOpen={(item) => void openInventory(item)} businessId={businessId} branchId={branchId} role={role} onRefresh={refresh} />
      <InventoryDetailSheet open={Boolean(selectedInventory)} detail={inventoryDetail} onClose={() => { setSelectedInventory(null); setInventoryDetail(null); }} />
    </>}

    {message ? <div className="procurement-message" role="status">{message}</div> : null}
  </section>;
}
