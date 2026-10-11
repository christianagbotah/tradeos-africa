/**
 * Inventory — on-hand stock overview.
 *
 * Filter bar (search, stock-state), inventory table (item, stock, unit,
 * value), low-stock warnings via badges, empty state. Stock is
 * movement-derived — the table is read-only; corrections go through a
 * movement dialog (outlined here, fully wired when the API session is live).
 *
 * State handling:
 *   - DEMO MODE: renders sample inventory with a DemoBanner.
 *   - SIGNED OUT: renders an AccessState.
 *   - READY: loads inventory from the API; on failure renders an AccessState.
 */
import { useEffect, useMemo, useState } from "react";
import type { DesktopInventoryRow, ScreenId } from "../lib/types.js";
import { SAMPLE_INVENTORY } from "../lib/sample-data.js";
import type { DesktopInventoryResponse } from "../lib/desktop-api-client.js";
import type { DesktopRuntime, DesktopReadyState } from "../lib/desktop-runtime.js";
import { fmtMoneyMinor, fmtNumber } from "../lib/format.js";
import { EmptyState } from "../components/EmptyState.js";
import { AccessState } from "../components/AccessState.js";
import { DemoBanner } from "../components/DemoBanner.js";
import {
  IconPackage,
  IconSearch,
  IconAlert,
  IconBox,
} from "../components/icons.js";

type StockFilter = "all" | "low" | "out";

export interface InventoryProps {
  runtime: DesktopRuntime | null;
  ready: DesktopReadyState | null;
  online: boolean;
  demoMode: boolean;
  onSignIn: () => void;
  onNavigate: (id: ScreenId) => void;
}

export function Inventory({ runtime, ready, online, demoMode, onSignIn }: InventoryProps) {
  const [query, setQuery] = useState("");
  const [stock, setStock] = useState<StockFilter>("all");
  const [rows, setRows] = useState<readonly DesktopInventoryRow[]>(demoMode ? SAMPLE_INVENTORY : []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (demoMode || !runtime || !ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    runtime.api.getInventory(ready.membership.businessId, ready.branch.id)
      .then((res: DesktopInventoryResponse) => {
        if (cancelled) return;
        setRows(res.items.map((item) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          stockUnitCode: item.stockUnitCode,
          category: null,
          onHand: item.available,
          reorderLevel: null,
          unitCostMinor: item.averageStockUnitCostMinor,
          unitPriceMinor: null,
        })));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [demoMode, runtime, ready, online]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const matchesQuery =
        !query ||
        r.name.toLowerCase().includes(query.toLowerCase()) ||
        (r.sku ?? "").toLowerCase().includes(query.toLowerCase());
      const matchesStock =
        stock === "all" ||
        (stock === "low" && r.onHand > 0 && (r.reorderLevel === null || r.onHand <= r.reorderLevel)) ||
        (stock === "out" && r.onHand === 0);
      return matchesQuery && matchesStock;
    });
  }, [rows, query, stock]);

  const totalValueMinor = useMemo(
    () => rows.reduce((s, r) => s + r.onHand * (r.unitCostMinor ?? 0), 0),
    [rows],
  );
  const lowCount = rows.filter((r) => r.onHand > 0 && (r.reorderLevel === null || r.onHand <= (r.reorderLevel ?? 0))).length;
  const outCount = rows.filter((r) => r.onHand === 0).length;

  if (demoMode) {
    return <InventoryBody demoMode rows={filtered} query={query} onQueryChange={setQuery} stock={stock} onStockChange={setStock} totalValueMinor={totalValueMinor} lowCount={lowCount} outCount={outCount} skuCount={rows.length} />;
  }
  if (!ready || !runtime) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <AccessState kind="sign-in-required" onSignIn={onSignIn} />
      </div>
    );
  }
  if (loading && rows.length === 0) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <div className="dsk-empty" style={{ minHeight: "320px" }}>
          <div className="dsk-empty__title">Loading inventory\u2026</div>
        </div>
      </div>
    );
  }
  if (error && rows.length === 0) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <AccessState kind="api-unavailable" detail={error} />
      </div>
    );
  }
  return <InventoryBody rows={filtered} query={query} onQueryChange={setQuery} stock={stock} onStockChange={setStock} totalValueMinor={totalValueMinor} lowCount={lowCount} outCount={outCount} skuCount={rows.length} />;
}

function ScreenHeader() {
  return (
    <div className="dsk-screen__head">
      <div>
        <div className="dsk-screen__eyebrow">Stock health</div>
        <h1 className="dsk-screen__title">Inventory</h1>
        <p className="dsk-screen__subtitle">
          On-hand quantities are derived from movements — never edited directly. Record a
          correction to adjust a count.
        </p>
      </div>
      <div className="dsk-screen__actions">
        <button type="button" className="dsk-btn dsk-btn--gold dsk-btn--sm" disabled>
          <IconPackage width={15} height={15} />
          New stock correction
        </button>
      </div>
    </div>
  );
}

function InventoryBody({
  demoMode,
  rows,
  query,
  onQueryChange,
  stock,
  onStockChange,
  totalValueMinor,
  lowCount,
  outCount,
  skuCount,
}: {
  demoMode?: boolean;
  rows: readonly DesktopInventoryRow[];
  query: string;
  onQueryChange: (v: string) => void;
  stock: StockFilter;
  onStockChange: (v: StockFilter) => void;
  totalValueMinor: number;
  lowCount: number;
  outCount: number;
  skuCount: number;
}) {
  return (
    <div className="dsk-screen">
      <ScreenHeader />
      {demoMode ? <DemoBanner /> : null}

      <div className="dsk-metricgrid">
        <div className="dsk-metric">
          <div className="dsk-metric__label">Stock value (cost)</div>
          <div className="dsk-metric__val tnum">{fmtMoneyMinor(totalValueMinor)}</div>
          <div className="dsk-metric__sub">{skuCount} SKUs</div>
        </div>
        <div className="dsk-metric">
          <div className="dsk-metric__label">Low stock</div>
          <div className="dsk-metric__val tnum" style={{ color: "var(--tos-warning)" }}>{lowCount}</div>
          <div className="dsk-metric__sub">At or below reorder level</div>
        </div>
        <div className="dsk-metric">
          <div className="dsk-metric__label">Out of stock</div>
          <div className="dsk-metric__val tnum" style={{ color: "var(--tos-danger)" }}>{outCount}</div>
          <div className="dsk-metric__sub">Reorder immediately</div>
        </div>
      </div>

      <div className="dsk-cmdbar">
        <div className="dsk-cmdbar__search">
          <IconSearch className="dsk-cmdbar__search-icon" />
          <input
            type="search"
            className="dsk-cmdbar__search-input"
            placeholder="Search item name or SKU\u2026"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search inventory"
          />
        </div>
        <div role="group" aria-label="Filter by stock state">
          {([
            { id: "all", label: "All" },
            { id: "low", label: "Low" },
            { id: "out", label: "Out" },
          ] as const).map((f) => (
            <button
              key={f.id}
              type="button"
              className="dsk-chip"
              aria-pressed={stock === f.id ? "true" : "false"}
              onClick={() => onStockChange(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="dsk-cmdbar__spacer" />
        <span className="dsk-text-muted" style={{ fontSize: 12 }}>
          {rows.length} {rows.length === 1 ? "item" : "items"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="dsk-card">
          <EmptyState
            icon={<IconBox width={44} height={44} />}
            title="No items match your filters"
            text="Try a different search or stock state. New stock arrivals update the on-hand count as movements."
            tag={demoMode ? "Sample data" : undefined}
          />
        </div>
      ) : (
        <div className="dsk-table__wrap">
          <table className="dsk-table">
            <thead>
              <tr>
                <th>Item</th>
                <th data-ctr>On hand</th>
                <th>Unit</th>
                <th data-num>Unit cost</th>
                <th data-num>Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOut = r.onHand === 0;
                const isLow = r.onHand > 0 && (r.reorderLevel === null || r.onHand <= (r.reorderLevel ?? 0));
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="dsk-table__cell-main">{r.name}</div>
                      <div className="dsk-table__cell-sub">{r.sku ?? r.stockUnitCode}</div>
                    </td>
                    <td data-ctr className="tnum dsk-text-strong">{fmtNumber(r.onHand)}</td>
                    <td className="dsk-text-muted">{r.stockUnitCode}</td>
                    <td data-num className="tnum">{r.unitCostMinor !== null ? fmtMoneyMinor(r.unitCostMinor) : "—"}</td>
                    <td data-num className="tnum dsk-text-strong">{fmtMoneyMinor(r.onHand * (r.unitCostMinor ?? 0))}</td>
                    <td>
                      {isOut ? (
                        <span className="dsk-badge dsk-badge--danger">
                          <span className="dsk-badge__dot" /> Out
                        </span>
                      ) : isLow ? (
                        <span className="dsk-badge dsk-badge--warning">
                          <IconAlert width={11} height={11} /> Low
                        </span>
                      ) : (
                        <span className="dsk-badge dsk-badge--positive">In stock</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
