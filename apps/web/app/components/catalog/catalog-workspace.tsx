"use client";

import React, { useMemo, useState } from "react";
import { catalogCapabilities } from "../../lib/lifecycle-capabilities";
import type { CatalogItem } from "../../lib/workspace-types";
import { Button } from "../ui/button";
import { CatalogList } from "./catalog-list";

export type CatalogFilter = "ALL" | "PRODUCT" | "SERVICE" | "ARCHIVED";

export function filterCatalogItems(items: CatalogItem[], filter: CatalogFilter, query: string): CatalogItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter === "ARCHIVED") {
      if (item.active) return false;
    } else {
      if (!item.active) return false;
      if (filter === "PRODUCT" && item.kind !== "PRODUCT" && item.kind !== "PREPARED_PRODUCT") return false;
      if (filter === "SERVICE" && item.kind !== "SERVICE") return false;
    }
    if (!normalizedQuery) return true;
    return [item.name, item.sku ?? "", ...item.units.map((unit) => `${unit.label} ${unit.code}`)]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

export function CatalogWorkspace({
  businessId,
  branchId,
  currencyCode,
  role,
  items,
  onRefresh,
}: {
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  items: CatalogItem[];
  onRefresh: () => Promise<void> | void;
}) {
  const capabilities = catalogCapabilities(role);
  const [filter, setFilter] = useState<CatalogFilter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null);
  const visibleItems = useMemo(() => filterCatalogItems(items, filter, query), [filter, items, query]);

  const counts = useMemo(() => ({
    ALL: items.filter((item) => item.active).length,
    PRODUCT: items.filter((item) => item.active && (item.kind === "PRODUCT" || item.kind === "PREPARED_PRODUCT")).length,
    SERVICE: items.filter((item) => item.active && item.kind === "SERVICE").length,
    ARCHIVED: items.filter((item) => !item.active).length,
  }), [items]);

  return (
    <section className="catalog-workspace" data-business-id={businessId} data-branch-id={branchId}>
      <div className="catalog-commandbar">
        <label className="catalog-search">
          <span>Search catalog</span>
          <input
            type="search"
            aria-label="Search products or services"
            placeholder="Search products or services"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {capabilities.canCreate ? (
          <Button type="button" onClick={() => window.dispatchEvent(new CustomEvent("tradeos:catalog-create-requested"))}>Add item</Button>
        ) : null}
      </div>

      <div className="catalog-filterbar" role="tablist" aria-label="Catalog filters">
        {([
          ["ALL", "All"],
          ["PRODUCT", "Products"],
          ["SERVICE", "Services"],
          ["ARCHIVED", "Archived"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={filter === value ? "active" : undefined}
            onClick={() => setFilter(value)}
          >
            <span>{label}</span><strong>{counts[value]}</strong>
          </button>
        ))}
      </div>

      <div className="catalog-list-header" aria-hidden="true">
        <span>Item</span><span>Selling</span><span>Stock</span><span>Status</span><span />
      </div>
      <CatalogList
        items={visibleItems}
        currencyCode={currencyCode}
        capabilities={capabilities}
        onOpenItem={setSelectedItem}
      />

      {selectedItem ? (
        <aside className="catalog-inspector" aria-label={`${selectedItem.name} details`}>
          <div>
            <span className="catalog-inspector-kicker">Selected item</span>
            <strong>{selectedItem.name}</strong>
            <p>{selectedItem.units.length} configured unit{selectedItem.units.length === 1 ? "" : "s"}. Full editing opens in the item workspace.</p>
          </div>
          <Button variant="ghost" type="button" onClick={() => setSelectedItem(null)}>Close</Button>
        </aside>
      ) : null}

      <button className="catalog-refresh-link" type="button" onClick={() => void onRefresh()}>Refresh catalog</button>
    </section>
  );
}
