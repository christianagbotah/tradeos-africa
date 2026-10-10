"use client";

import React, { useMemo, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import type { PosSellableItem } from "./pos-model";

export function filterPosSellables(items: readonly PosSellableItem[], query: string): PosSellableItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...items];
  return items.filter((item) => [item.name, item.sku ?? "", item.unitLabel, item.unitCode]
    .join(" ")
    .toLowerCase()
    .includes(normalized));
}

const kindLabel = (kind: PosSellableItem["kind"]) => kind === "SERVICE" ? "Services" : kind === "PREPARED_PRODUCT" ? "Prepared" : "Products";
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || name.slice(0, 2).toUpperCase();

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
  const [kindFilter, setKindFilter] = useState<"ALL" | PosSellableItem["kind"]>("ALL");
  const filtered = useMemo(() => filterPosSellables(items, query).filter((item) => kindFilter === "ALL" || item.kind === kindFilter), [items, query, kindFilter]);
  const grouped = useMemo(() => {
    const map = new Map<string, PosSellableItem[]>();
    for (const item of filtered) map.set(item.itemId, [...(map.get(item.itemId) ?? []), item]);
    return Array.from(map.values());
  }, [filtered]);
  const kinds = useMemo(() => Array.from(new Set(items.map((item) => item.kind))), [items]);

  return (
    <section className="pos-browser" aria-label="Products and services">
      <label className="pos-product-search">
        <span className="pos-visually-hidden">Find item or service</span>
        <span className="pos-search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search product, SKU or scan barcode…"
          aria-label="Search product, SKU or scan barcode"
        />
        <span className="pos-scan-icon" aria-hidden="true">⌗</span>
      </label>

      <div className="pos-category-chips" role="group" aria-label="Product type filter">
        <button type="button" className={kindFilter === "ALL" ? "active" : undefined} aria-pressed={kindFilter === "ALL"} onClick={() => setKindFilter("ALL")}>All</button>
        {kinds.map((kind) => <button key={kind} type="button" className={kindFilter === kind ? "active" : undefined} aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kind)}>{kindLabel(kind)}</button>)}
      </div>

      {grouped.length === 0 ? (
        <div className="pos-browser-empty">
          <strong>No sellable item found</strong>
          <span>Try another name, SKU or selling unit.</span>
        </div>
      ) : (
        <div className="pos-product-grid">
          {grouped.map((units) => {
            const item = units[0]!;
            const primary = units[0]!;
            const alternates = units.slice(1);
            return (
              <article className="pos-product-card" key={item.itemId}>
                <button className="pos-product-primary" type="button" aria-label={`Add ${primary.name} · ${primary.unitLabel}`} onClick={() => onAdd(primary)}>
                  <span className={`pos-product-avatar pos-product-avatar--${item.kind === "SERVICE" ? "service" : "product"}`} aria-hidden="true">{initials(item.name)}</span>
                  <span className="pos-product-copy">
                    <strong>{item.name}</strong>
                    <span><b>{formatMoney(primary.priceMinor, currencyCode)}</b><small>/{primary.unitLabel.toLowerCase()}</small></span>
                    {alternates.length ? <em>also: {alternates.map((unit) => unit.unitLabel.toLowerCase()).join(", ")}</em> : <em>{item.kind === "SERVICE" ? "service" : item.sku ?? "single unit"}</em>}
                  </span>
                </button>
                {alternates.length ? <div className="pos-alt-units" aria-label={`${item.name} alternate selling units`}>{alternates.map((unit) => <button key={unit.key} type="button" onClick={() => onAdd(unit)} title={`${unit.unitLabel} · ${formatMoney(unit.priceMinor, currencyCode)}`}>{unit.unitLabel}</button>)}</div> : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
