"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
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
import type { CatalogItem } from "../workspace/workspace-provider";

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

interface StockLevel {
  avail: number;
  onHand: number | null;
  reserved: number | null;
  out: boolean;
  low: boolean;
  tone: "ok" | "low" | "out";
  cardClass: string;
  badgeClass: string;
  label: string;
  qtyValClass: string;
}

function deriveLevel(c: CatalogItem): StockLevel {
  const avail = c.inventoryAvailable ?? 0;
  const onHand = c.inventoryOnHand;
  const reserved = onHand !== null ? Math.max(0, onHand - avail) : null;
  const out = avail <= 0;
  const low = avail > 0 && avail <= LOW_THRESHOLD;
  const tone: StockLevel["tone"] = out ? "out" : low ? "low" : "ok";
  return {
    avail,
    onHand,
    reserved,
    out,
    low,
    tone,
    cardClass: out ? "tos-stock-card tos-stock-card--out" : low ? "tos-stock-card tos-stock-card--low" : "tos-stock-card tos-stock-card--ok",
    badgeClass: out ? "tos-badge tos-badge--danger" : low ? "tos-badge tos-badge--warning" : "tos-badge tos-badge--positive",
    label: out ? "Out" : low ? "Low" : "OK",
    qtyValClass: out ? "tos-stock-card__qty-val tos-stock-card__qty-val--danger" : low ? "tos-stock-card__qty-val tos-stock-card__qty-val--warning" : "tos-stock-card__qty-val",
  };
}

export function InventoryWorkspace() {
  const { catalog, role, refreshCatalog } = useWorkspace();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("ALL");
  const [adjusting, setAdjusting] = useState<CatalogItem | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"].includes(role);

  const tracked = useMemo(
    () => catalog.filter((c) => c.trackInventory && c.status === "ACTIVE"),
    [catalog],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tracked.filter((c) => {
      const level = deriveLevel(c);
      if (filter === "OUT" && !level.out) return false;
      if (filter === "LOW" && !level.low) return false;
      if (filter === "OK" && (level.out || level.low)) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.sku ?? "").toLowerCase().includes(q);
    });
  }, [tracked, query, filter]);

  const stats = useMemo(() => {
    const totalTracked = tracked.length;
    let outCount = 0;
    let lowCount = 0;
    for (const c of tracked) {
      const level = deriveLevel(c);
      if (level.out) outCount += 1;
      else if (level.low) lowCount += 1;
    }
    const okCount = totalTracked - outCount - lowCount;
    return { totalTracked, okCount, lowCount, outCount };
  }, [tracked]);

  const clearFilters = () => {
    setQuery("");
    setFilter("ALL");
  };

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Inventory</span>
          <h1 className="tos-page__title">Inventory</h1>
          <p className="tos-page__subtitle">
            Stock on hand for tracked items. Adjustments are evidence-grade movements — the balance is derived from them, never overwritten directly.
          </p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => void refreshCatalog()}>Refresh</Button>
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
          text="Mark catalog items as 'track inventory' to manage stock levels here. Each tracked item counts on-hand and available units in its sale unit — adjustments create evidence-grade movements."
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
            {filtered.map((c) => {
              const level = deriveLevel(c);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`${level.cardClass} tos-card-hover tos-animate-fade-in-up`}
                    onClick={() => setAdjusting(c)}
                    aria-label={`Adjust stock for ${c.name}`}
                  >
                    <div className="tos-stock-card__head">
                      <div className="tos-stock-card__body">
                        <span className="tos-stock-card__title">{c.name}</span>
                        <span className="tos-stock-card__sub">
                          {c.sku ? `SKU ${c.sku}` : "No SKU"} · per {c.saleUnitName}
                        </span>
                      </div>
                      <span className={level.badgeClass}>
                        <span className="tos-badge__dot" />{level.label}
                      </span>
                    </div>
                    <div className="tos-stock-card__qty-row">
                      <div className="tos-stock-card__qty">
                        <span className="tos-stock-card__qty-label">Available</span>
                        <span className={level.qtyValClass}>
                          {level.avail}
                          <span className="tos-stock-card__qty-unit"> {c.saleUnitCode}</span>
                        </span>
                      </div>
                      <div className="tos-stock-card__qty">
                        <span className="tos-stock-card__qty-label">On-hand</span>
                        <span className="tos-stock-card__qty-val">
                          {level.onHand === null ? "—" : level.onHand}
                          {level.onHand !== null ? <span className="tos-stock-card__qty-unit"> {c.saleUnitCode}</span> : null}
                        </span>
                      </div>
                      {level.reserved !== null && level.reserved > 0 ? (
                        <div className="tos-stock-card__qty">
                          <span className="tos-stock-card__qty-label">Reserved</span>
                          <span className="tos-stock-card__qty-val">{level.reserved}</span>
                        </div>
                      ) : null}
                    </div>
                    {canWrite ? (
                      <div className="tos-stock-card__row" style={{ marginTop: "var(--tos-space-1)" }}>
                        <span className="tos-stock-card__sub" style={{ color: "var(--tos-text-soft)" }}>Tap to adjust stock</span>
                      </div>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Desktop: clean table with status + on-hand + available + reserved */}
          <div className="tos-table-wrap tos-table-wrap--desktop">
            <div className="tos-table-scroll">
              <table className="tos-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>SKU</th>
                    <th>Unit</th>
                    <th data-align="right">On-hand</th>
                    <th data-align="right">Available</th>
                    <th data-align="right">Reserved</th>
                    <th data-align="center">Level</th>
                    {canWrite ? <th data-align="center">Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const level = deriveLevel(c);
                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="tos-table__cell-main">
                            <span className="tos-table__cell-title">{c.name}</span>
                          </div>
                        </td>
                        <td className="tos-table__mono">{c.sku ?? "—"}</td>
                        <td className="tos-table__muted">{c.saleUnitCode}</td>
                        <td data-align="right" className="tos-table__num">
                          {level.onHand === null ? "—" : `${level.onHand} ${c.saleUnitCode}`}
                        </td>
                        <td data-align="right" className="tos-table__num">
                          {level.avail} {c.saleUnitCode}
                        </td>
                        <td data-align="right" className="tos-table__num tos-table__muted">
                          {level.reserved === null ? "—" : level.reserved}
                        </td>
                        <td data-align="center">
                          <span className={level.badgeClass}>
                            <span className="tos-badge__dot" />{level.label}
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
        </>
      )}

      <InventoryAdjustmentSheet item={adjusting} onClose={() => setAdjusting(null)} onSaved={() => setAdjusting(null)} />
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
