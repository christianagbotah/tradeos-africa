"use client";

import { useMemo, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { CatalogItemSheet } from "./catalog-item-sheet";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconBox, IconPlus, IconRefresh, IconSearch } from "../ui/icons";
import type { CatalogItem } from "../workspace/workspace-provider";

export function CatalogWorkspace() {
  const { catalog, role, refreshCatalog, session } = useWorkspace();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"ALL" | CatalogItem["kind"]>("ALL");
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"].includes(role);
  const currencyCode = session?.currencyCode ?? "GHS";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((c) => {
      if (kindFilter !== "ALL" && c.kind !== kindFilter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.sku ?? "").toLowerCase().includes(q);
    });
  }, [catalog, query, kindFilter]);

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Master data</span>
          <h1 className="tos-page__title">Catalog</h1>
          <p className="tos-page__subtitle">Your products, services, and prepared items. Prices are server-authoritative.</p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => void refreshCatalog()}>Refresh</Button>
          {canWrite ? (
            <Button variant="gold" icon={<IconPlus className="tos-btn__icon" />} onClick={() => setFormOpen(true)}>Add item</Button>
          ) : null}
        </div>
      </header>

      <div className="tos-toolbar">
        <div className="tos-toolbar__search">
          <IconSearch className="tos-toolbar__search-icon" />
          <input
            type="search"
            className="tos-toolbar__search-input"
            placeholder="Search by name or SKU…"
            aria-label="Search catalog"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="tos-select" style={{ width: "auto", height: 40 }} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}>
          <option value="ALL">All kinds</option>
          <option value="PRODUCT">Products</option>
          <option value="PREPARED_PRODUCT">Prepared</option>
          <option value="SERVICE">Services</option>
        </select>
        <span className="tos-toolbar__spacer" />
        <span className="tos-section__sub">{filtered.length} item(s)</span>
      </div>

      {catalog.length === 0 ? (
        <StatePanel
          variant="empty"
          icon={<IconBox className="tos-state__icon" />}
          title="No catalog items yet"
          text="Add your first product to start selling. Each item can track stock and tax."
          actionLabel={canWrite ? "Add item" : undefined}
          onAction={canWrite ? () => setFormOpen(true) : undefined}
        />
      ) : filtered.length === 0 ? (
        <StatePanel inline variant="empty" title="No matches" text={`No items match "${query}".`} />
      ) : (
        <div className="tos-table-wrap">
          <div className="tos-table-scroll">
            <table className="tos-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>SKU</th>
                  <th>Kind</th>
                  <th>Unit</th>
                  <th data-align="right">Price</th>
                  <th data-align="right">Stock</th>
                  <th data-align="center">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} data-clickable="true" onClick={() => setEditing(c)}>
                    <td>
                      <div className="tos-table__cell-main">
                        <span className="tos-table__cell-title">{c.name}</span>
                      </div>
                    </td>
                    <td className="tos-table__mono">{c.sku ?? "—"}</td>
                    <td className="tos-table__muted">{c.kind}</td>
                    <td className="tos-table__muted">{c.saleUnitName}</td>
                    <td data-align="right">
                      <span className="tos-table__num"><MoneyValue minor={c.priceMinor} currencyCode={currencyCode} tone="muted" /></span>
                    </td>
                    <td data-align="right" className="tos-table__muted">
                      {c.trackInventory ? (c.inventoryAvailable ?? "—") : "—"}
                    </td>
                    <td data-align="center">
                      <span className={`tos-badge ${c.status === "ACTIVE" ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                        <span className="tos-badge__dot" />{c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CatalogItemSheet item={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />
      {formOpen ? (
        <CatalogItemSheet open={true} item={null} onClose={() => setFormOpen(false)} onSaved={() => setFormOpen(false)} />
      ) : null}
    </div>
  );
}
