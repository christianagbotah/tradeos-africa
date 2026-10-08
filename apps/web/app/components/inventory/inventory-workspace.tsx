"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { getFailedMutations, queueChangedEvent } from "../../lib/offline-sync";
import { InventoryAdjustmentSheet } from "./inventory-adjustment-sheet";
import type { InventoryItem } from "./types";

export type InventoryFilter = "ALL" | "EMPTY" | "EXCEPTIONS";

export function filterInventory(items: InventoryItem[], query: string, filter: InventoryFilter): InventoryItem[] {
  const normalized = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === "EMPTY" && item.available > 0) return false;
    if (filter === "EXCEPTIONS" && item.quarantine <= 0 && item.damaged <= 0 && item.waste <= 0) return false;
    if (!normalized) return true;
    return [item.name, item.sku ?? "", item.stockUnitCode].join(" ").toLowerCase().includes(normalized);
  });
}

export function InventoryWorkspace({ items, currencyCode, loadingId, onOpen, businessId, branchId, role, onRefresh }: {
  items: InventoryItem[];
  currencyCode: string;
  loadingId: string | null;
  onOpen: (item: InventoryItem) => void;
  businessId: string;
  branchId: string;
  role: string;
  onRefresh: () => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<InventoryFilter>("ALL");
  const [adjustmentItem, setAdjustmentItem] = useState<InventoryItem | null>(null);
  const [failedAdjustments, setFailedAdjustments] = useState(() => failedFor(businessId, branchId));
  const [message, setMessage] = useState<string | null>(null);
  const canAdjust = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"].includes(role);
  useEffect(() => {
    const refreshFailed = () => setFailedAdjustments(failedFor(businessId, branchId));
    refreshFailed();
    window.addEventListener(queueChangedEvent, refreshFailed);
    return () => window.removeEventListener(queueChangedEvent, refreshFailed);
  }, [businessId, branchId]);
  const visible = useMemo(() => filterInventory(items, query, filter), [items, query, filter]);
  const counts = useMemo(() => ({
    ALL: items.length,
    EMPTY: items.filter((item) => item.available <= 0).length,
    EXCEPTIONS: items.filter((item) => item.quarantine > 0 || item.damaged > 0 || item.waste > 0).length,
  }), [items]);
  const totalValue = useMemo(() => items.reduce((sum, item) => sum + item.inventoryValueMinor, 0), [items]);

  return <section className="inventory-workspace">
    <div className="inventory-workspace-head">
      <div><span>Movement-derived stock</span><h3>Branch inventory</h3><p>Balances come from posted movements. Open an item to see why stock changed; TradeOS never edits an on-hand number directly.</p></div>
      <div className="inventory-value-summary"><span>Inventory value</span><strong>{formatMoney(totalValue, currencyCode)}</strong></div>
    </div>
    <div className="inventory-commandbar">
      <label className="inventory-search"><span>Search inventory</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Product, SKU or stock unit" /></label>
      <div className="inventory-filterbar" role="tablist" aria-label="Inventory filters">
        {([ ["ALL", "All"], ["EMPTY", "Empty"], ["EXCEPTIONS", "Exceptions"] ] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : undefined} onClick={() => setFilter(value)}><span>{label}</span><strong>{counts[value]}</strong></button>)}
      </div>
    </div>
    {failedAdjustments.length > 0 ? <div className="inventory-adjustment-review" role="status"><strong>{failedAdjustments.length} inventory adjustment{failedAdjustments.length === 1 ? "" : "s"} needs review</strong><span>{failedAdjustments[0]?.result.errorMessage ?? "Refresh the item and review the rejected quantity before retrying."}</span></div> : null}
    {message ? <div className="inventory-adjustment-status" role="status">{message}</div> : null}
    <div className="inventory-modern-list">
      {visible.length === 0 ? <div className="inventory-empty-modern"><strong>No inventory items match this view.</strong><span>Change the search or stock-state filter.</span></div> : visible.map((item) => <article className="inventory-row-modern" key={item.id}>
        <div className="inventory-row-identity"><strong>{item.name}</strong><span>{item.sku ?? `Stock unit · ${item.stockUnitCode}`}</span></div>
        <StockFact label="Available" value={`${formatQuantity(item.available)} ${item.stockUnitCode}`} alert={item.available <= 0} />
        <StockFact label="Quarantine" value={formatQuantity(item.quarantine)} alert={item.quarantine > 0} />
        <StockFact label="Damaged" value={formatQuantity(item.damaged)} alert={item.damaged > 0} />
        <StockFact label="Waste" value={formatQuantity(item.waste)} alert={item.waste > 0} />
        <div className="inventory-row-financial"><span>Average cost</span><strong>{item.averageStockUnitCostMinor === null ? "—" : `${formatMoney(item.averageStockUnitCostMinor, currencyCode)} / ${item.stockUnitCode}`}</strong><small>Inventory value {formatMoney(item.inventoryValueMinor, currencyCode)}</small></div>
        <div className="inventory-row-actions"><Button variant="secondary" type="button" disabled={loadingId === item.id} onClick={() => onOpen(item)}>{loadingId === item.id ? "Opening…" : "Movement history"}</Button>{canAdjust ? <Button type="button" onClick={() => setAdjustmentItem(item)}>Adjust stock</Button> : null}</div>
      </article>)}
    </div>
    <InventoryAdjustmentSheet open={Boolean(adjustmentItem)} item={adjustmentItem} businessId={businessId} branchId={branchId} role={role} onClose={() => setAdjustmentItem(null)} onQueued={async (nextMessage) => { setMessage(nextMessage); setFailedAdjustments(failedFor(businessId, branchId)); await onRefresh(); }} />
  </section>;
}

function failedFor(businessId: string, branchId: string) {
  return getFailedMutations().filter((entry) => entry.mutation.businessId === businessId && entry.mutation.branchId === branchId && entry.mutation.mutationType === "INVENTORY_ADJUSTMENT_CREATE");
}

function StockFact({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return <div className={alert ? "inventory-row-fact alert" : "inventory-row-fact"}><span>{label}</span><strong>{value}</strong></div>;
}
function formatQuantity(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value); }
function formatMoney(minor: number, currencyCode: string): string { return currencyCode === "GHS" ? `₵${(minor / 100).toFixed(2)}` : new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100); }
