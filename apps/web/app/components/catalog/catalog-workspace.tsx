"use client";

import { useMemo, useState } from "react";
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
} from "../ui/icons";
import type { CatalogItem } from "../workspace/workspace-provider";

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

export function CatalogWorkspace() {
  const { catalog, role, refreshCatalog, session } = useWorkspace();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"].includes(role);
  const currencyCode = session?.currencyCode ?? "GHS";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((c) => {
      if (kindFilter !== "ALL" && c.kind !== kindFilter) return false;
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.sku ?? "").toLowerCase().includes(q);
    });
  }, [catalog, query, kindFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = catalog.length;
    const active = catalog.filter((c) => c.status === "ACTIVE").length;
    const services = catalog.filter((c) => c.kind === "SERVICE").length;
    const lowStock = catalog.filter(
      (c) =>
        c.trackInventory &&
        c.status === "ACTIVE" &&
        (c.inventoryAvailable ?? 0) <= 5,
    ).length;
    return { total, active, services, lowStock };
  }, [catalog]);

  const clearFilters = () => {
    setQuery("");
    setKindFilter("ALL");
    setStatusFilter("ALL");
  };

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Master data</span>
          <h1 className="tos-page__title">Catalog</h1>
          <p className="tos-page__subtitle">
            Your products, services, and prepared items. Prices and stock are server-authoritative — the client never writes them directly.
          </p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => void refreshCatalog()}>Refresh</Button>
          {canWrite ? (
            <Button variant="gold" icon={<IconPlus className="tos-btn__icon" />} onClick={() => setFormOpen(true)}>Add item</Button>
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

      {catalog.length === 0 ? (
        <StatePanel
          variant="empty"
          icon={<IconBox className="tos-state__icon" />}
          title="No catalog items yet"
          text="Add your first product, prepared item, or service to start selling. Each item can track stock in its sale unit, and prices are set here — never negotiated at the POS."
          actionLabel={canWrite ? "Add item" : undefined}
          onAction={canWrite ? () => setFormOpen(true) : undefined}
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
              const avail = c.inventoryAvailable;
              const stockLabel = c.trackInventory
                ? avail === null
                  ? "Stock unknown"
                  : avail <= 0
                    ? "Out of stock"
                    : `${avail} ${c.saleUnitName} on hand`
                : "No stock tracked";
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className="tos-catalog-card tos-card-hover tos-animate-fade-in-up"
                    onClick={() => setEditing(c)}
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
                        <span className="tos-unit-pill">
                          <span className="tos-unit-pill__code">{c.saleUnitCode}</span>
                          <span className="tos-unit-pill__name">{c.saleUnitName}</span>
                        </span>
                        <span className="tos-catalog-card__stock">{stockLabel}</span>
                      </span>
                    </span>
                    <span className="tos-catalog-card__meta">
                      <MoneyValue minor={c.priceMinor} currencyCode={currencyCode} className="tos-catalog-card__price" />
                      <span className="tos-catalog-card__unit">per {c.saleUnitName}</span>
                      <span className={`tos-badge ${c.status === "ACTIVE" ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                        <span className="tos-badge__dot" />{c.status === "ACTIVE" ? "Active" : "Archived"}
                      </span>
                    </span>
                  </button>
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
                    const avail = c.inventoryAvailable;
                    return (
                      <tr key={c.id} data-clickable="true" onClick={() => setEditing(c)}>
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
                          <span className="tos-unit-pill">
                            <span className="tos-unit-pill__code">{c.saleUnitCode}</span>
                            <span className="tos-unit-pill__name">{c.saleUnitName}</span>
                          </span>
                        </td>
                        <td data-align="right">
                          <span className="tos-table__num">
                            <MoneyValue minor={c.priceMinor} currencyCode={currencyCode} tone="muted" />
                          </span>
                        </td>
                        <td data-align="right" className="tos-table__num">
                          {c.trackInventory
                            ? (avail === null ? "—" : `${avail} ${c.saleUnitCode}`)
                            : <span className="tos-table__muted">—</span>}
                        </td>
                        <td data-align="center">
                          <span className={`tos-badge ${c.status === "ACTIVE" ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                            <span className="tos-badge__dot" />{c.status === "ACTIVE" ? "Active" : "Archived"}
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
            <span className="tos-callout__sub"> Visit Inventory to record a stock correction — each adjustment creates an evidence-grade movement.</span>
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
