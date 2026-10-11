"use client";

import { useMemo, useState } from "react";
import type { CatalogItem } from "../workspace/workspace-provider";
import { StatePanel } from "../ui/state-panel";
import { MoneyValue } from "../business/money-value";
import { IconSearch } from "../ui/icons";

interface ProductBrowserProps {
  catalog: readonly CatalogItem[];
  currencyCode: string;
  onPick: (item: CatalogItem) => void;
}

export function ProductBrowser({ catalog, currencyCode, onPick }: ProductBrowserProps) {
  const [query, setQuery] = useState("");

  const activeItems = useMemo(
    () => catalog.filter((c) => c.status === "ACTIVE"),
    [catalog],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeItems;
    return activeItems.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.sku ?? "").toLowerCase().includes(q),
    );
  }, [activeItems, query]);

  return (
    <div className="tos-pos__browser">
      <div className="tos-toolbar">
        <div className="tos-toolbar__search">
          <IconSearch className="tos-toolbar__search-icon" />
          <input
            type="search"
            className="tos-toolbar__search-input"
            placeholder="Search products by name or SKU…"
            aria-label="Search products"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="tos-toolbar__spacer" />
        <span className="tos-section__sub">{filtered.length} item(s)</span>
      </div>

      {activeItems.length === 0 ? (
        <StatePanel
          variant="empty"
          title="No products in your catalog"
          text="Add products in Catalog to start selling. Each product can track stock and tax."
          actionLabel="Open catalog"
          onAction={() => { window.location.href = "/catalog"; }}
        />
      ) : filtered.length === 0 ? (
        <StatePanel
          inline
          variant="empty"
          title="No matches"
          text={`No products match "${query}". Try a different search.`}
        />
      ) : (
        <div className="tos-product-grid">
          {filtered.map((item) => {
            const outOfStock = item.trackInventory && item.inventoryAvailable !== null && item.inventoryAvailable <= 0;
            return (
              <button
                key={item.id}
                type="button"
                className="tos-product-tile"
                onClick={() => onPick(item)}
                disabled={outOfStock}
                aria-label={`Add ${item.name} to cart`}
              >
                <span className="tos-product-tile__name">{item.name}</span>
                <span className="tos-product-tile__sub">{item.saleUnitName}{item.sku ? ` · ${item.sku}` : ""}</span>
                <span className="tos-product-tile__price">
                  <MoneyValue minor={item.priceMinor} currencyCode={currencyCode} />
                </span>
                {item.trackInventory ? (
                  <span className="tos-product-tile__stock">
                    {outOfStock
                      ? "Out of stock"
                      : item.inventoryAvailable !== null
                        ? `${item.inventoryAvailable} in stock`
                        : "Stock not tracked"}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
