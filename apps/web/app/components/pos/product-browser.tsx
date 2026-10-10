"use client";

import React, { useMemo, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import type { PosSellableItem } from "./pos-model";
import { ReferenceIcon } from "../ui/reference-icon";

export function filterPosSellables(items: readonly PosSellableItem[], query: string): PosSellableItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...items];
  return items.filter((item) => [item.name, item.sku ?? "", item.unitLabel, item.unitCode]
    .join(" ")
    .toLowerCase()
    .includes(normalized));
}

type Category = "ALL" | "PRODUCTS" | "SERVICES" | "STOCKED";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "IT";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
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
  const [category, setCategory] = useState<Category>("ALL");
  const filtered = useMemo(() => {
    const matchesQuery = filterPosSellables(items, query);
    if (category === "PRODUCTS") return matchesQuery.filter((item) => item.kind !== "SERVICE");
    if (category === "SERVICES") return matchesQuery.filter((item) => item.kind === "SERVICE");
    if (category === "STOCKED") return matchesQuery.filter((item) => item.trackStock);
    return matchesQuery;
  }, [items, query, category]);
  const grouped = useMemo(() => {
    const map = new Map<string, PosSellableItem[]>();
    for (const item of filtered) map.set(item.itemId, [...(map.get(item.itemId) ?? []), item]);
    return Array.from(map.values());
  }, [filtered]);

  return (
    <section className="pos-browser" aria-label="Products and services">
      <label className="pos-product-search">
        <span className="sr-only">Find product, SKU or barcode</span>
        <span className="pos-product-search-icon" aria-hidden="true"><ReferenceIcon name="search" /></span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search product, SKU or scan barcode…"
          aria-label="Search product, SKU or scan barcode"
        />
        <span className="pos-scan-hint" aria-hidden="true"><ReferenceIcon name="scan" /></span>
      </label>

      <div className="pos-category-strip" role="group" aria-label="Filter sellable items">
        {([
          ["ALL", "All"],
          ["PRODUCTS", "Products"],
          ["SERVICES", "Services"],
          ["STOCKED", "Stocked"],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" className={category === value ? "active" : ""} aria-pressed={category === value} onClick={() => setCategory(value)}>{label}</button>
        ))}
      </div>

      {grouped.length === 0 ? (
        <div className="pos-browser-empty">
          <strong>No sellable item found</strong>
          <span>Try another name, SKU, selling unit or filter.</span>
        </div>
      ) : (
        <div className="pos-product-grid">
          {grouped.map((units, index) => {
            const item = units[0]!;
            const alternate = units.slice(1).map((unit) => unit.unitLabel).join(", ");
            return (
              <article className={`pos-product-card pos-product-card--${index % 4}`} key={item.itemId}>
                <button className="pos-product-primary" type="button" aria-label={`Add ${item.name} · ${item.unitLabel}`} onClick={() => onAdd(item)}>
                  <span className="pos-product-initials" aria-hidden="true">{initials(item.name)}</span>
                  <span className="pos-product-copy">
                    <strong>{item.name}</strong>
                    <span className="pos-product-price"><b>{formatMoney(item.priceMinor, currencyCode)}</b><small>/{item.unitLabel}</small></span>
                    {alternate ? <small>also: {alternate}</small> : item.trackStock ? <small>stock: {item.stockUnitCode ?? item.unitCode}</small> : item.kind === "SERVICE" ? <small>service</small> : null}
                  </span>
                </button>
                {units.length > 1 ? (
                  <div className="pos-unit-choices" aria-label={`${item.name} selling units`}>
                    {units.slice(1).map((unit) => <button key={unit.key} type="button" className="pos-unit-choice" onClick={() => onAdd(unit)}><span>{unit.unitLabel}</span><strong>{formatMoney(unit.priceMinor, currencyCode)}</strong></button>)}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
