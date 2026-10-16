"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { CatalogItemSheet } from "./catalog-item-sheet";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import {
  IconBox,
  IconInventory,
  IconPackage,
  IconPackageOpen,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconTrending,
  IconTrash,
} from "../ui/icons";
import type { CatalogItem } from "../../../lib/catalog-read-model";
import { primarySellableUnit } from "../../../lib/catalog-read-model";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";

type KindFilter = "ALL" | CatalogItem["kind"];
type StatusFilter = "ALL" | "ACTIVE" | "ARCHIVED";

const KIND_FILTERS: ReadonlyArray<{ value: KindFilter; label: string }> = [
  { value: "ALL", label: "All kinds" },
  { value: "PRODUCT", label: "Products" },
  { value: "PREPARED_PRODUCT", label: "Prepared" },
  { value: "SERVICE", label: "Services" },
];

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "ARCHIVED", label: "Archived" },
];

type StatIconTone = "gold" | "positive" | "warning" | "midnight" | "neutral";

const STAT_TILE_CLASS: Record<StatIconTone, string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

const KIND_TILE_CLASS: Record<CatalogItem["kind"], string> = {
  PRODUCT: "tos-kind-tile tos-kind-tile--product",
  PREPARED_PRODUCT: "tos-kind-tile tos-kind-tile--prepared",
  SERVICE: "tos-kind-tile tos-kind-tile--service",
};

const KIND_ICON: Record<CatalogItem["kind"], ReactNode> = {
  PRODUCT: <IconPackage className="tos-kind-tile__svg" />,
  PREPARED_PRODUCT: <IconPackageOpen className="tos-kind-tile__svg" />,
  SERVICE: <IconReceipt className="tos-kind-tile__svg" />,
};

const KIND_LABEL: Record<CatalogItem["kind"], string> = {
  PRODUCT: "Product",
  PREPARED_PRODUCT: "Prepared",
  SERVICE: "Service",
};

const KIND_DESC: Record<CatalogItem["kind"], string> = {
  PRODUCT: "Stocked item",
  PREPARED_PRODUCT: "Made to order",
  SERVICE: "No stock tracked",
};

function networkFailureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? `Network request failed: ${error.message}`
    : "Network request failed";
}

export function CatalogWorkspace() {
  const { catalog, inventory, role, refreshCatalog, session } = useWorkspace();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteArmed, setBulkDeleteArmed] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"].includes(role);
  const canDelete = ["OWNER", "ADMIN"].includes(role);
  const currencyCode = session?.currencyCode ?? "GHS";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((c) => {
      if (kindFilter !== "ALL" && c.kind !== kindFilter) return false;
      if (statusFilter !== "ALL" && !(statusFilter === "ACTIVE" ? c.active : !c.active)) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.sku ?? "").toLowerCase().includes(q);
    });
  }, [catalog, query, kindFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = catalog.length;
    const active = catalog.filter((c) => c.active).length;
    const services = catalog.filter((c) => c.kind === "SERVICE").length;
    const lowStock = inventory.filter((i) => i.available <= 5).length;
    return { total, active, services, lowStock };
  }, [catalog, inventory]);

  const selectedItems = useMemo(
    () => catalog.filter((item) => selectedIds.has(item.id)),
    [catalog, selectedIds],
  );
  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));
  const hasActiveSelection = selectedItems.some((item) => item.active);
  const hasArchivedSelection = selectedItems.some((item) => !item.active);

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkDeleteArmed(false);
    setBulkNotice(null);
  }, [query, kindFilter, statusFilter]);

  useEffect(() => {
    const currentIds = new Set(catalog.map((item) => item.id));
    setSelectedIds((previous) => {
      const next = new Set([...previous].filter((id) => currentIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [catalog]);

  const clearFilters = () => {
    setQuery("");
    setKindFilter("ALL");
    setStatusFilter("ALL");
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (item: CatalogItem) => {
    setFormOpen(false);
    setEditing(item);
  };

  const toggleSelection = (itemId: string) => {
    setBulkDeleteArmed(false);
    setBulkNotice(null);
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setBulkDeleteArmed(false);
    setBulkNotice(null);
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allFilteredSelected) filtered.forEach((item) => next.delete(item.id));
      else filtered.forEach((item) => next.add(item.id));
      return next;
    });
  };

  const runBulkLifecycle = async (active: boolean) => {
    if (!session || !canWrite || bulkBusy) return;
    const targets = selectedItems.filter((item) => item.active !== active);
    if (targets.length === 0) return;
    setBulkBusy(true);
    setBulkDeleteArmed(false);
    setBulkNotice(null);
    const failures: Array<{ id: string; name: string; message: string }> = [];
    let changed = 0;
    try {
      for (const item of targets) {
        try {
          const response = await getOfflineQueue().authenticatedFetch(
            `/v1/catalog/items/${encodeURIComponent(item.id)}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                businessId: session.businessId,
                expectedUpdatedAt: item.updatedAt,
                active,
              }),
            },
          );
          if (!response.ok) {
            failures.push({ id: item.id, name: item.name, message: await readApiErrorMessage(response, "Status could not be changed") });
          } else {
            changed += 1;
          }
        } catch (error) {
          failures.push({ id: item.id, name: item.name, message: networkFailureMessage(error) });
        }
      }
      await refreshCatalog();
      setSelectedIds(new Set(failures.map((failure) => failure.id)));
      const action = active ? "reactivated" : "archived";
      setBulkNotice(
        failures.length > 0
          ? `${changed} item(s) ${action}. ${failures.length} could not be changed: ${failures.map((failure) => `${failure.name} — ${failure.message}`).join("; ")}`
          : `${changed} item(s) ${action}.`,
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkDelete = async () => {
    if (!session || !canDelete || bulkBusy || selectedItems.length === 0) return;
    if (!bulkDeleteArmed) {
      setBulkDeleteArmed(true);
      setBulkNotice("Permanent deletion only succeeds for items with no sales, purchase, stock or recipe history. Protected items should be archived instead.");
      return;
    }
    setBulkBusy(true);
    setBulkNotice(null);
    const failures: Array<{ id: string; name: string; message: string }> = [];
    let deleted = 0;
    try {
      for (const item of selectedItems) {
        try {
          const response = await getOfflineQueue().authenticatedFetch(
            `/v1/catalog/items/${encodeURIComponent(item.id)}?businessId=${encodeURIComponent(session.businessId)}&expectedUpdatedAt=${encodeURIComponent(item.updatedAt)}`,
            { method: "DELETE" },
          );
          if (!response.ok) {
            failures.push({ id: item.id, name: item.name, message: await readApiErrorMessage(response, "Item could not be deleted") });
          } else {
            deleted += 1;
          }
        } catch (error) {
          failures.push({ id: item.id, name: item.name, message: networkFailureMessage(error) });
        }
      }
      await refreshCatalog();
      setSelectedIds(new Set(failures.map((failure) => failure.id)));
      setBulkDeleteArmed(false);
      setBulkNotice(
        failures.length > 0
          ? `${deleted} item(s) deleted. ${failures.length} protected or changed item(s) remain selected: ${failures.map((failure) => `${failure.name} — ${failure.message}`).join("; ")}`
          : `${deleted} item(s) permanently deleted.`,
      );
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Master data</span>
          <h1 className="tos-page__title">Catalog</h1>
          <p className="tos-page__subtitle">
            Manage products, services and prepared items with consistent unit pricing and stock rules across your business.
          </p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => void refreshCatalog()}>Refresh</Button>
          {canWrite ? (
            <Button variant="gold" icon={<IconPlus className="tos-btn__icon" />} onClick={openCreate}>Add item</Button>
          ) : null}
        </div>
      </header>

      {/* KPI strip — 4-up desktop / 2x2 mobile. Mirrors dashboard + sales. */}
      <div className="tos-dashboard-stats tos-stagger">
        <StatCard
          label="Catalog items"
          icon={<IconBox className="tos-stat__icon-tile-svg" />}
          iconTone="gold"
          variant="hero"
          value={<span className="tos-stat__value tos-stat__value--hero">{stats.total}</span>}
          hint={`${stats.active} active`}
        />
        <StatCard
          label="Stocked products"
          icon={<IconPackage className="tos-stat__icon-tile-svg" />}
          iconTone="midnight"
          value={<span className="tos-stat__value">{stats.total - stats.services}</span>}
          hint="Track inventory"
        />
        <StatCard
          label="Services"
          icon={<IconReceipt className="tos-stat__icon-tile-svg" />}
          iconTone="neutral"
          value={<span className="tos-stat__value">{stats.services}</span>}
          hint="No stock tracked"
        />
        <StatCard
          label="Low stock"
          icon={<IconTrending className="tos-stat__icon-tile-svg" />}
          iconTone={stats.lowStock > 0 ? "warning" : "positive"}
          value={<span className="tos-stat__value">{stats.lowStock}</span>}
          hint={stats.lowStock > 0 ? "Needs reordering" : "Levels healthy"}
          hintTone={stats.lowStock > 0 ? "warning" : "positive"}
        />
      </div>

      {/* Toolbar — search + kind chips + status chips (stacked on mobile) */}
      <div className="tos-toolbar tos-toolbar--stacked">
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
        <div className="tos-filter-row">
          <span className="tos-filter-label">Kind</span>
          {KIND_FILTERS.map((k) => (
            <FilterChip key={k.value} pressed={kindFilter === k.value} onClick={() => setKindFilter(k.value)}>
              {k.label}
            </FilterChip>
          ))}
          <span className="tos-filter-label" style={{ marginLeft: "var(--tos-space-2)" }}>Status</span>
          {STATUS_FILTERS.map((s) => (
            <FilterChip key={s.value} pressed={statusFilter === s.value} onClick={() => setStatusFilter(s.value)}>
              {s.label}
            </FilterChip>
          ))}
          <span className="tos-toolbar__spacer" />
          <span className="tos-section__sub">{filtered.length} item(s)</span>
        </div>
      </div>

      {canWrite && filtered.length > 0 ? (
        <div className={`tos-bulk-bar ${selectedItems.length > 0 ? "tos-bulk-bar--active" : ""}`}>
          <div className="tos-bulk-bar__summary">
            <Button size="sm" variant="ghost" onClick={toggleAllFiltered}>
              {allFilteredSelected ? "Clear visible selection" : "Select all visible"}
            </Button>
            <span className="tos-bulk-bar__count">{selectedItems.length} selected</span>
          </div>
          {selectedItems.length > 0 ? (
            <div className="tos-bulk-bar__actions">
              <Button size="sm" variant="outline" onClick={() => void runBulkLifecycle(false)} loading={bulkBusy} disabled={!hasActiveSelection}>
                Archive selected
              </Button>
              <Button size="sm" variant="outline" onClick={() => void runBulkLifecycle(true)} loading={bulkBusy} disabled={!hasArchivedSelection}>
                Reactivate selected
              </Button>
              {canDelete ? (
                <Button size="sm" variant="danger" icon={<IconTrash style={{ width: 14, height: 14 }} />} onClick={() => void runBulkDelete()} loading={bulkBusy}>
                  {bulkDeleteArmed ? `Confirm delete ${selectedItems.length}` : "Delete selected"}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => { setSelectedIds(new Set()); setBulkDeleteArmed(false); setBulkNotice(null); }} disabled={bulkBusy}>
                Clear
              </Button>
            </div>
          ) : (
            <span className="tos-section__sub">Select items to archive, reactivate, or delete unused records in bulk.</span>
          )}
        </div>
      ) : null}

      {bulkNotice ? (
        <div className="tos-callout tos-callout--info" role="status">{bulkNotice}</div>
      ) : null}

      {catalog.length === 0 ? (
        <StatePanel
          variant="empty"
          icon={<IconBox className="tos-state__icon" />}
          title="No catalog items yet"
          text="Add your first product, prepared item, or service to start selling. Each item can track stock in its sale unit, and prices are set here — never negotiated at the POS."
          actionLabel={canWrite ? "Add item" : undefined}
          onAction={canWrite ? openCreate : undefined}
        />
      ) : filtered.length === 0 ? (
        <StatePanel
          inline
          variant="empty"
          icon={<IconSearch className="tos-state__icon" />}
          title="No matches"
          text="No items match the current filters. Try clearing the search or widening the kind/status filter."
          actionLabel="Clear filters"
          onAction={clearFilters}
        />
      ) : (
        <>
          {/* Mobile: premium tappable cards with kind tile + price + unit */}
          <ul className="tos-list-cards tos-stagger" aria-label="Catalog items">
            {filtered.map((c) => {
              const sellable = primarySellableUnit(c);
              const stock = inventory.find((i) => i.id === c.id) ?? null;
              const stockLabel = c.trackStock
                ? !stock
                  ? "Stock unknown"
                  : stock.available <= 0
                    ? "Out of stock"
                    : `${stock.available} ${c.stockUnitCode ?? ""} on hand`.trim()
                : "No stock tracked";
              return (
                <li key={c.id}>
                  <div className={`tos-selectable-card ${selectedIds.has(c.id) ? "tos-selectable-card--selected" : ""}`}>
                    {canWrite ? (
                      <label className="tos-row-select tos-row-select--card">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => toggleSelection(c.id)}
                          aria-label={`Select ${c.name}`}
                        />
                      </label>
                    ) : null}
                    <button
                      type="button"
                      className="tos-catalog-card tos-card-hover tos-animate-fade-in-up"
                      onClick={() => openEdit(c)}
                      aria-label={`Open ${c.name}`}
                    >
                    <span className={KIND_TILE_CLASS[c.kind]} aria-hidden="true">
                      {KIND_ICON[c.kind]}
                    </span>
                    <span className="tos-catalog-card__body">
                      <span className="tos-catalog-card__title">{c.name}</span>
                      <span className="tos-catalog-card__sub">
                        {c.sku ? `SKU ${c.sku}` : "No SKU"} · {KIND_LABEL[c.kind]}
                      </span>
                      <span className="tos-catalog-card__row">
                        {sellable ? (
                          <span className="tos-unit-pill">
                            <span className="tos-unit-pill__code">{sellable.code}</span>
                            <span className="tos-unit-pill__name">{sellable.label}</span>
                          </span>
                        ) : (
                          <span className="tos-unit-pill">
                            <span className="tos-unit-pill__code">—</span>
                            <span className="tos-unit-pill__name">No sellable unit</span>
                          </span>
                        )}
                        <span className="tos-catalog-card__stock">{stockLabel}</span>
                      </span>
                    </span>
                    <span className="tos-catalog-card__meta">
                      <MoneyValue minor={sellable?.defaultSalePriceMinor ?? 0} currencyCode={currencyCode} className="tos-catalog-card__price" />
                      <span className="tos-catalog-card__unit">{sellable ? `per ${sellable.label}` : ""}</span>
                      <span className={`tos-badge ${c.active ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                        <span className="tos-badge__dot" />{c.active ? "Active" : "Archived"}
                      </span>
                    </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop: clean table with kind label + unit pill */}
          <div className="tos-table-wrap tos-table-wrap--desktop">
            <div className="tos-table-scroll">
              <table className="tos-table">
                <thead>
                  <tr>
                    {canWrite ? (
                      <th className="tos-table__select-col">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleAllFiltered}
                          aria-label="Select all visible catalog items"
                        />
                      </th>
                    ) : null}
                    <th>Item</th>
                    <th>SKU</th>
                    <th>Kind</th>
                    <th>Sale unit</th>
                    <th data-align="right">Price</th>
                    <th data-align="right">Stock</th>
                    <th data-align="center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const sellable = primarySellableUnit(c);
                    const stock = inventory.find((i) => i.id === c.id) ?? null;
                    return (
                      <tr key={c.id} data-clickable="true" data-selected={selectedIds.has(c.id) ? "true" : undefined} onClick={() => openEdit(c)}>
                        {canWrite ? (
                          <td className="tos-table__select-col" onClick={(event) => event.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(c.id)}
                              onChange={() => toggleSelection(c.id)}
                              aria-label={`Select ${c.name}`}
                            />
                          </td>
                        ) : null}
                        <td>
                          <div className="tos-table__cell-main">
                            <span className="tos-table__cell-title">{c.name}</span>
                          </div>
                        </td>
                        <td className="tos-table__mono">{c.sku ?? "—"}</td>
                        <td>
                          <div className="tos-table__cell-main">
                            <span className="tos-table__cell-title">{KIND_LABEL[c.kind]}</span>
                            <span className="tos-table__cell-sub">{KIND_DESC[c.kind]}</span>
                          </div>
                        </td>
                        <td>
                          {sellable ? (
                            <span className="tos-unit-pill">
                              <span className="tos-unit-pill__code">{sellable.code}</span>
                              <span className="tos-unit-pill__name">{sellable.label}</span>
                            </span>
                          ) : (
                            <span className="tos-table__muted">—</span>
                          )}
                        </td>
                        <td data-align="right">
                          <span className="tos-table__num">
                            <MoneyValue minor={sellable?.defaultSalePriceMinor ?? 0} currencyCode={currencyCode} tone="muted" />
                          </span>
                        </td>
                        <td data-align="right" className="tos-table__num">
                          {c.trackStock
                            ? (stock ? `${stock.available} ${c.stockUnitCode ?? ""}`.trim() : "—")
                            : <span className="tos-table__muted">—</span>}
                        </td>
                        <td data-align="center">
                          <span className={`tos-badge ${c.active ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                            <span className="tos-badge__dot" />{c.active ? "Active" : "Archived"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <CatalogItemSheet item={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />
      {formOpen ? (
        <CatalogItemSheet open={true} item={null} onClose={() => setFormOpen(false)} onSaved={() => setFormOpen(false)} />
      ) : null}

      {/* Low-stock callout — guides users from catalog to inventory corrections */}
      {stats.lowStock > 0 ? (
        <div className="tos-callout tos-callout--warning">
          <span className="tos-callout__icon-wrap" aria-hidden="true">
            <IconInventory style={{ width: 16, height: 16 }} />
          </span>
          <span className="tos-callout__body">
            {stats.lowStock} item(s) are at or below 5 units on hand.
            <span className="tos-callout__sub"> Visit Inventory to record a stock correction. Every adjustment is kept in the stock history.</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

interface StatCardProps {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  hint?: string;
  hintTone?: "default" | "warning" | "positive";
  variant?: "default" | "hero";
  iconTone?: StatIconTone;
}

function StatCard({
  label,
  icon,
  value,
  hint,
  hintTone = "default",
  variant = "default",
  iconTone = "neutral",
}: StatCardProps) {
  const cls = variant === "hero"
    ? "tos-stat tos-card-hover tos-animate-fade-in-up tos-stat--hero"
    : "tos-stat tos-card-hover tos-animate-fade-in-up";

  const hintCls = hintTone === "warning"
    ? "tos-stat__hint tos-stat__hint--warning"
    : hintTone === "positive"
      ? "tos-stat__hint tos-stat__hint--positive"
      : "tos-stat__hint";

  return (
    <div className={cls}>
      <div className="tos-stat__head">
        <span className={STAT_TILE_CLASS[iconTone]} aria-hidden="true">
          {icon}
        </span>
        <span className="tos-stat__label">{label}</span>
      </div>
      {value}
      {hint ? <span className={hintCls}>{hint}</span> : null}
    </div>
  );
}

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="tos-filter-chip"
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
