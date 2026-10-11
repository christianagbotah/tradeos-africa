"use client";

import { useMemo, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { InventoryAdjustmentSheet } from "./inventory-adjustment-sheet";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconBox, IconRefresh, IconSearch } from "../ui/icons";
import type { CatalogItem } from "../workspace/workspace-provider";

export function InventoryWorkspace() {
  const { catalog, role, refreshCatalog } = useWorkspace();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "LOW" | "OUT" | "TRACKED">("ALL");
  const [adjusting, setAdjusting] = useState<CatalogItem | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"].includes(role);

  const tracked = useMemo(() => catalog.filter((c) => c.trackInventory && c.status === "ACTIVE"), [catalog]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tracked.filter((c) => {
      if (filter === "OUT" && (c.inventoryAvailable ?? 0) > 0) return false;
      if (filter === "LOW" && (c.inventoryAvailable ?? 0) > 5) return false;
      if (filter === "TRACKED" && !c.trackInventory) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.sku ?? "").toLowerCase().includes(q);
    });
  }, [tracked, query, filter]);

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Inventory</span>
          <h1 className="tos-page__title">Inventory</h1>
          <p className="tos-page__subtitle">Stock on hand for tracked items. Adjustments are evidence-grade and reconcile to the cashbook.</p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => void refreshCatalog()}>Refresh</Button>
        </div>
      </header>

      <div className="tos-toolbar">
        <div className="tos-toolbar__search">
          <IconSearch className="tos-toolbar__search-icon" />
          <input
            type="search"
            className="tos-toolbar__search-input"
            placeholder="Search tracked items…"
            aria-label="Search inventory"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="tos-select" style={{ width: "auto", height: 40 }} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="ALL">All tracked</option>
          <option value="LOW">Low stock (≤5)</option>
          <option value="OUT">Out of stock</option>
        </select>
        <span className="tos-toolbar__spacer" />
        <span className="tos-section__sub">{filtered.length} item(s)</span>
      </div>

      {tracked.length === 0 ? (
        <StatePanel
          variant="empty"
          icon={<IconBox className="tos-state__icon" />}
          title="No tracked inventory"
          text="Mark catalog items as 'track inventory' to manage stock levels here."
          actionLabel="Open catalog"
          onAction={() => { window.location.href = "/catalog"; }}
        />
      ) : filtered.length === 0 ? (
        <StatePanel inline variant="empty" title="No matches" text="No items match the current filter." />
      ) : (
        <div className="tos-table-wrap">
          <div className="tos-table-scroll">
            <table className="tos-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>SKU</th>
                  <th data-align="right">On-hand</th>
                  <th data-align="right">Available</th>
                  <th data-align="center">Status</th>
                  {canWrite ? <th data-align="center">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const avail = c.inventoryAvailable ?? 0;
                  const out = avail <= 0;
                  const low = avail > 0 && avail <= 5;
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="tos-table__cell-main">
                          <span className="tos-table__cell-title">{c.name}</span>
                          <span className="tos-table__cell-sub">{c.saleUnitName}</span>
                        </div>
                      </td>
                      <td className="tos-table__mono">{c.sku ?? "—"}</td>
                      <td data-align="right" className="tos-table__num">{c.inventoryOnHand ?? "—"}</td>
                      <td data-align="right" className="tos-table__num">{c.inventoryAvailable ?? "—"}</td>
                      <td data-align="center">
                        <span className={`tos-badge ${out ? "tos-badge--danger" : low ? "tos-badge--warning" : "tos-badge--positive"}`}>
                          <span className="tos-badge__dot" />{out ? "Out" : low ? "Low" : "OK"}
                        </span>
                      </td>
                      {canWrite ? (
                        <td data-align="center">
                          <Button size="sm" variant="outline" onClick={() => setAdjusting(c)}>Adjust</Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <InventoryAdjustmentSheet item={adjusting} onClose={() => setAdjusting(null)} onSaved={() => setAdjusting(null)} />
    </div>
  );
}
