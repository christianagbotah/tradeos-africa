"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { formatMoney } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { InventoryAdjustmentSheet } from "./inventory-adjustment-sheet";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import {
  IconBox,
  IconInventory,
  IconPackageOpen,
  IconRefresh,
  IconSearch,
  IconTrending,
  IconTrendingDown,
} from "../ui/icons";
import type { CatalogItem, InventoryItem } from "../../../lib/catalog-read-model";

type StockFilter = "ALL" | "OK" | "LOW" | "OUT";

const STOCK_FILTERS: ReadonlyArray<{ value: StockFilter; label: string }> = [
  { value: "ALL", label: "All tracked" },
  { value: "OK", label: "In stock" },
  { value: "LOW", label: "Low stock" },
  { value: "OUT", label: "Out of stock" },
];

type StatIconTone = "gold" | "positive" | "warning" | "midnight" | "neutral";

const STAT_TILE_CLASS: Record<StatIconTone, string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

const LOW_THRESHOLD = 5;

/** A tracked catalog item joined with its last-known branch stock row. */
interface TrackedRow {
  item: CatalogItem;
  stock: InventoryItem | null;
  available: number;
  stockKnown: boolean;
  out: boolean;
  low: boolean;
  tone: "ok" | "low" | "out";
  cardClass: string;
  badgeClass: string;
  levelLabel: string;
  qtyValClass: string;
}

function buildRow(item: CatalogItem, stock: InventoryItem | null): TrackedRow {
  const stockKnown = stock !== null;
  const available = stock?.available ?? 0;
  const out = available <= 0;
  const low = available > 0 && available <= LOW_THRESHOLD;
  const tone: TrackedRow["tone"] = out ? "out" : low ? "low" : "ok";
  return {
    item,
    stock,
    available,
    stockKnown,
    out,
    low,
    tone,
    cardClass: out ? "tos-stock-card tos-stock-card--out" : low ? "tos-stock-card tos-stock-card--low" : "tos-stock-card tos-stock-card--ok",
    badgeClass: out ? "tos-badge tos-badge--danger" : low ? "tos-badge tos-badge--warning" : "tos-badge tos-badge--positive",
    levelLabel: out ? "Out" : low ? "Low" : "OK",
    qtyValClass: out ? "tos-stock-card__qty-val tos-stock-card__qty-val--danger" : low ? "tos-stock-card__qty-val tos-stock-card__qty-val--warning" : "tos-stock-card__qty-val",
  };
}

export function InventoryWorkspace() {
  const { catalog, inventory, role, refreshInventory, refreshCatalog, session } = useWorkspace();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("ALL");
  const [adjusting, setAdjusting] = useState<TrackedRow | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"].includes(role);
  const currencyCode = session?.currencyCode ?? "GHS";

  // Tracked = active, stock-tracked products joined with /v1/inventory rows
  // (per-branch AVAILABLE / QUARANTINE / DAMAGED / WASTE balances).
  const tracked = useMemo(() => {
    const byId = new Map(inventory.map((row) => [row.id, row]));
    return catalog
      .filter((c) => c.trackStock && c.active && c.kind !== "SERVICE")
      .map((item) => buildRow(item, byId.get(item.id) ?? null));
  }, [catalog, inventory]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tracked.filter((row) => {
      if (filter === "OUT" && !row.out) return false;
      if (filter === "LOW" && !row.low) return false;
      if (filter === "OK" && (row.out || row.low)) return false;
      if (!q) return true;
      return row.item.name.toLowerCase().includes(q) || (row.item.sku ?? "").toLowerCase().includes(q);
    });
  }, [tracked, query, filter]);

  const stats = useMemo(() => {
    const totalTracked = tracked.length;
    let outCount = 0;
    let lowCount = 0;
    for (const row of tracked) {
      if (row.out) outCount += 1;
      else if (row.low) lowCount += 1;
    }
    const okCount = totalTracked - outCount - lowCount;
    const totalValueMinor = inventory.reduce((sum, row) => sum + row.inventoryValueMinor, 0);
    return { totalTracked, okCount, lowCount, outCount, totalValueMinor };
  }, [tracked, inventory]);

  const clearFilters = () => {
    setQuery("");
    setFilter("ALL");
  };

  const handleRefresh = () => {
    void refreshInventory();
    void refreshCatalog();
  };

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Inventory</span>
          <h1 className="tos-page__title">Inventory</h1>
          <p className="tos-page__subtitle">
            Last-known stock for tracked items in this branch, counted in each item&apos;s stock unit. Adjustments are evidence-grade movements — the balance is derived from them, never overwritten directly.
          </p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={handleRefresh}>Refresh</Button>
        </div>
      </header>

      {/* KPI strip — 4-up desktop / 2x2 mobile. */}
      <div className="tos-dashboard-stats tos-stagger">
        <StatCard
          label="Tracked items"
          icon={<IconInventory className="tos-stat__icon-tile-svg" />}
          iconTone="gold"
          variant="hero"
          value={<span className="tos-stat__value tos-stat__value--hero">{stats.totalTracked}</span>}
          hint="Active, stock-tracked SKUs"
        />
        <StatCard
          label="In stock"
          icon={<IconTrending className="tos-stat__icon-tile-svg" />}
          iconTone="positive"
          value={<span className="tos-stat__value">{stats.okCount}</span>}
          hint="Above low threshold"
          hintTone="positive"
        />
        <StatCard
          label="Low stock"
          icon={<IconTrendingDown className="tos-stat__icon-tile-svg" />}
          iconTone={stats.lowCount > 0 ? "warning" : "neutral"}
          value={<span className="tos-stat__value">{stats.lowCount}</span>}
          hint={stats.lowCount > 0 ? "At or below 5 units" : "None low"}
          hintTone={stats.lowCount > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Out of stock"
          icon={<IconPackageOpen className="tos-stat__icon-tile-svg" />}
          iconTone={stats.outCount > 0 ? "warning" : "positive"}
          value={<span className="tos-stat__value">{stats.outCount}</span>}
          hint={stats.outCount > 0 ? "Needs restocking" : "None out"}
          hintTone={stats.outCount > 0 ? "warning" : "positive"}
        />
      </div>

      {/* Toolbar — search + stock-level chips */}
      <div className="tos-toolbar tos-toolbar--stacked">
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
        <div className="tos-filter-row">
          <span className="tos-filter-label">Level</span>
          {STOCK_FILTERS.map((f) => (
            <FilterChip key={f.value} pressed={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
            </FilterChip>
          ))}
          <span className="tos-toolbar__spacer" />
          <span className="tos-section__sub">{filtered.length} item(s)</span>
        </div>
      </div>

      {tracked.length === 0 ? (
        <StatePanel
          variant="empty"
          icon={<IconBox className="tos-state__icon" />}
          title="No tracked inventory"
          text="Mark catalog products as 'track inventory' to manage stock levels here. Each tracked item counts available, quarantined, damaged and waste units in its stock unit — adjustments create evidence-grade movements."
          actionLabel="Open catalog"
          onAction={() => { window.location.href = "/catalog"; }}
        />
      ) : filtered.length === 0 ? (
        <StatePanel
          inline
          variant="empty"
          icon={<IconSearch className="tos-state__icon" />}
          title="No matches"
          text="No items match the current filter. Try widening the level filter or clearing the search."
          actionLabel="Clear filters"
          onAction={clearFilters}
        />
      ) : (
        <>
          {/* Mobile: premium stock cards with status color stripe */}
          <ul className="tos-list-cards tos-stagger" aria-label="Inventory items">
            {filtered.map((row) => (
              <li key={row.item.id}>
                <button
                  type="button"
                  className={`${row.cardClass} tos-card-hover tos-animate-fade-in-up`}
                  onClick={() => setAdjusting(row)}
                  aria-label={`Adjust stock for ${row.item.name}`}
                >
                  <div className="tos-stock-card__head">
                    <div className="tos-stock-card__body">
                      <span className="tos-stock-card__title">{row.item.name}</span>
                      <span className="tos-stock-card__sub">
                        {row.item.sku ? `SKU ${row.item.sku}` : "No SKU"} · counted in {row.item.stockUnitCode ?? "stock units"}
                      </span>
                    </div>
                    <span className={row.badgeClass}>
                      <span className="tos-badge__dot" />{row.levelLabel}
                    </span>
                  </div>
                  <div className="tos-stock-card__qty-row">
                    <div className="tos-stock-card__qty">
                      <span className="tos-stock-card__qty-label">Available</span>
                      <span className={row.qtyValClass}>
                        {row.stockKnown ? row.available : "—"}
                        <span className="tos-stock-card__qty-unit"> {row.item.stockUnitCode ?? ""}</span>
                      </span>
                    </div>
                    {(row.stock?.quarantine ?? 0) > 0 ? (
                      <div className="tos-stock-card__qty">
                        <span className="tos-stock-card__qty-label">Quarantine</span>
                        <span className="tos-stock-card__qty-val">{row.stock?.quarantine}</span>
                      </div>
                    ) : null}
                    {(row.stock?.damaged ?? 0) > 0 ? (
                      <div className="tos-stock-card__qty">
                        <span className="tos-stock-card__qty-label">Damaged</span>
                        <span className="tos-stock-card__qty-val">{row.stock?.damaged}</span>
                      </div>
                    ) : null}
                    {(row.stock?.waste ?? 0) > 0 ? (
                      <div className="tos-stock-card__qty">
                        <span className="tos-stock-card__qty-label">Waste</span>
                        <span className="tos-stock-card__qty-val">{row.stock?.waste}</span>
                      </div>
                    ) : null}
                  </div>
                  {!row.stockKnown ? (
                    <div className="tos-stock-card__row" style={{ marginTop: "var(--tos-space-1)" }}>
                      <span className="tos-stock-card__sub" style={{ color: "var(--tos-text-soft)" }}>
                        No stock movements recorded yet for this branch.
                      </span>
                    </div>
                  ) : null}
                  {canWrite ? (
                    <div className="tos-stock-card__row" style={{ marginTop: "var(--tos-space-1)" }}>
                      <span className="tos-stock-card__sub" style={{ color: "var(--tos-text-soft)" }}>Tap to adjust stock</span>
                    </div>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: clean table with location balances */}
          <div className="tos-table-wrap tos-table-wrap--desktop">
            <div className="tos-table-scroll">
              <table className="tos-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>SKU</th>
                    <th>Stock unit</th>
                    <th data-align="right">Available</th>
                    <th data-align="right">Quarantine</th>
                    <th data-align="right">Damaged</th>
                    <th data-align="right">Waste</th>
                    <th data-align="right">Value</th>
                    <th data-align="center">Level</th>
                    {canWrite ? <th data-align="center">Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.item.id}>
                      <td>
                        <div className="tos-table__cell-main">
                          <span className="tos-table__cell-title">{row.item.name}</span>
                        </div>
                      </td>
                      <td className="tos-table__mono">{row.item.sku ?? "—"}</td>
                      <td className="tos-table__muted">{row.item.stockUnitCode ?? "—"}</td>
                      <td data-align="right" className="tos-table__num">
                        {row.stockKnown ? `${row.available} ${row.item.stockUnitCode ?? ""}`.trim() : "—"}
                      </td>
                      <td data-align="right" className="tos-table__num tos-table__muted">
                        {row.stock?.quarantine ?? 0}
                      </td>
                      <td data-align="right" className="tos-table__num tos-table__muted">
                        {row.stock?.damaged ?? 0}
                      </td>
                      <td data-align="right" className="tos-table__num tos-table__muted">
                        {row.stock?.waste ?? 0}
                      </td>
                      <td data-align="right" className="tos-table__num">
                        {(row.stock?.inventoryValueMinor ?? 0) > 0
                          ? formatMoney(row.stock?.inventoryValueMinor ?? 0, currencyCode)
                          : "—"}
                      </td>
                      <td data-align="center">
                        <span className={row.badgeClass}>
                          <span className="tos-badge__dot" />{row.levelLabel}
                        </span>
                      </td>
                      {canWrite ? (
                        <td data-align="center">
                          <Button size="sm" variant="outline" onClick={() => setAdjusting(row)}>Adjust</Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <InventoryAdjustmentSheet row={adjusting} onClose={() => setAdjusting(null)} onSaved={() => setAdjusting(null)} />
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
