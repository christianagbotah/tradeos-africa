"use client";

import React, { useMemo } from "react";
import type { PosSellableItem } from "./pos-model";

export function filterPosSellables(items: readonly PosSellableItem[], query: string): PosSellableItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...items];
  return items.filter((item) => [item.name, item.sku ?? "", item.unitLabel, item.unitCode]
    .join(" ")
    .toLowerCase()
    .includes(normalized));
}

export function ProductBrowser({
  items,
  query,
  currencyCode,
  onQueryChange,
  onAdd,
}: {
  items: PosSellableItem[];
  query: string;
  currencyCode: string;
  onQueryChange: (query: string) => void;
  onAdd: (item: PosSellableItem) => void;
}) {
  const filtered = useMemo(() => filterPosSellables(items, query), [items, query]);
  const grouped = useMemo(() => {
    const map = new Map<string, PosSellableItem[]>();
    for (const item of filtered) map.set(item.itemId, [...(map.get(item.itemId) ?? []), item]);
    return Array.from(map.values());
  }, [filtered]);

  return (
    <section className="pos-browser" aria-label="Products and services">
      <label className="pos-product-search">
        <span>Find item or service</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search products or services"
          aria-label="Search products or services"
        />
      </label>

      {grouped.length === 0 ? (
        <div className="pos-browser-empty">
          <strong>No sellable item found</strong>
          <span>Try another name, SKU or selling unit.</span>
        </div>
      ) : (
        <div className="pos-product-grid">
          {grouped.map((units) => {
            const item = units[0]!;
            return (
              <article className="pos-product-card" key={item.itemId}>
                <div className="pos-product-card-head">
                  <span className={`pos-product-kind pos-product-kind--${item.kind === "SERVICE" ? "service" : "product"}`} aria-hidden="true">
                    {item.kind === "SERVICE" ? "S" : "P"}
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.sku ?? (item.kind === "SERVICE" ? "Service" : "Product")}</small>
                  </div>
                </div>
                <div className="pos-unit-choices">
                  {units.map((unit) => (
                    <button
                      key={unit.key}
                      type="button"
                      className="pos-unit-choice"
                      aria-label={`Add ${unit.name} · ${unit.unitLabel}`}
                      onClick={() => onAdd(unit)}
                    >
                      <span>{unit.unitLabel}</span>
                      <strong>{formatMoney(unit.priceMinor, currencyCode)}</strong>
                    </button>
                  ))}
                </div>
                <div className="pos-product-meta">
                  {item.trackStock
                    ? <span>Stock tracked in {item.stockUnitCode ?? "configured unit"}</span>
                    : <span>{item.kind === "SERVICE" ? "Service · no stock" : "Stock not tracked"}</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatMoney(minor: number, currencyCode: string): string {
  if (currencyCode === "GHS") return `₵${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100);
}
