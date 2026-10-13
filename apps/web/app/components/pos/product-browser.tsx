"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { filterSellableItems, type CatalogKind, type SellableItem } from "../../../lib/catalog-read-model";
import { StatePanel } from "../ui/state-panel";
import { MoneyValue } from "../business/money-value";
import {
  IconSearch,
  IconClose,
  IconPackage,
  IconReceipt,
  IconBox,
  IconPackageOpen,
} from "../ui/icons";

const KIND_META: Record<CatalogKind, { label: string; chip: string; tile: string; Icon: typeof IconPackage }> = {
  PRODUCT: { label: "Products", chip: "Products", tile: "Product", Icon: IconPackage },
  SERVICE: { label: "Services", chip: "Services", tile: "Service", Icon: IconReceipt },
  PREPARED_PRODUCT: { label: "Prepared", chip: "Prepared", tile: "Prepared", Icon: IconBox },
};

interface ProductBrowserProps {
  /** Sellable projection — one entry per (item, sellable unit with price). */
  items: readonly SellableItem[];
  currencyCode: string;
  onPick: (item: SellableItem) => void;
  /** Map of sellable key → quantity already in cart, to surface "in cart" pills. */
  cartQuantities?: Readonly<Record<string, number>>;
  /** Exposes the search input element so the shell can focus it (F2). */
  searchRef?: RefObject<HTMLInputElement | null>;
}

type FilterKind = "ALL" | CatalogKind;

export function ProductBrowser({ items, currencyCode, onPick, cartQuantities, searchRef }: ProductBrowserProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<FilterKind>("ALL");
  const internalRef = useRef<HTMLInputElement | null>(null);
  const inputRef = searchRef ?? internalRef;

  const searched = useMemo(() => filterSellableItems(items, query), [items, query]);

  const availableKinds = useMemo<readonly CatalogKind[]>(() => {
    const seen = new Set<CatalogKind>();
    for (const c of searched) seen.add(c.kind);
    return Array.from(seen);
  }, [searched]);

  const kindCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of searched) m[c.kind] = (m[c.kind] ?? 0) + 1;
    return m;
  }, [searched]);

  const filtered = useMemo(
    () => searched.filter((c) => kind === "ALL" || c.kind === kind),
    [searched, kind],
  );

  // Auto-focus the search on desktop (fine pointer + wide viewport) on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fine = window.matchMedia("(pointer: fine)");
    const wide = window.matchMedia("(min-width: 1024px)");
    if (fine.matches && wide.matches) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [inputRef]);

  // F2 focuses search from anywhere on desktop.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [inputRef]);

  const showChips = availableKinds.length > 1;
  const hasCatalog = items.length > 0;
  const hasMatches = filtered.length > 0;

  return (
    <div className="tos-pos__browser">
      <div className="tos-pos-search">
        <IconSearch className="tos-pos-search__icon" />
        <input
          ref={inputRef}
          type="search"
          className="tos-pos-search__input"
          placeholder="Search products by name or SKU…"
          aria-label="Search products"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="tos-pos-search__clear"
            onClick={() => { setQuery(""); inputRef.current?.focus(); }}
            aria-label="Clear search"
          >
            <IconClose style={{ width: 16, height: 16 }} />
          </button>
        ) : (
          <span className="tos-pos-search__hint" aria-hidden="true">
            <span className="tos-pos-search__hint-kbd">F2</span>
            to search
          </span>
        )}
      </div>

      {showChips ? (
        <div className="tos-pos-chips" role="group" aria-label="Filter by type">
          <button
            type="button"
            className="tos-pos-chip"
            aria-pressed={kind === "ALL"}
            onClick={() => setKind("ALL")}
          >
            All
            <span className="tos-pos-chip__count">{searched.length}</span>
          </button>
          {availableKinds.map((k) => (
            <button
              key={k}
              type="button"
              className="tos-pos-chip"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {KIND_META[k].chip}
              <span className="tos-pos-chip__count">{kindCounts[k] ?? 0}</span>
            </button>
          ))}
          <span className="tos-pos-chips-meta">
            {hasMatches ? `${filtered.length} shown` : "No matches"}
          </span>
        </div>
      ) : null}

      {!hasCatalog ? (
        <StatePanel
          variant="empty"
          icon={<IconPackageOpen className="tos-state__icon" />}
          title="No products in your catalog yet"
          text="Add products in Catalog to start selling. Each product can sell in multiple units — crate, bottle, glass — each with its own server-set price."
          actionLabel="Open catalog"
          onAction={() => { window.location.href = "/catalog"; }}
        />
      ) : !hasMatches ? (
        <StatePanel
          inline
          variant="empty"
          icon={<IconSearch className="tos-state__icon" />}
          title="No matches"
          text={`Nothing matches "${query}"${kind !== "ALL" ? ` in ${KIND_META[kind].label}` : ""}. Try a different search or filter.`}
        />
      ) : (
        <div className="tos-product-grid">
          {filtered.map((item) => {
            const outOfStock =
              item.trackStock &&
              item.availableStock !== null &&
              item.availableStock <= 0;
            const lowStock =
              item.trackStock &&
              item.availableStock !== null &&
              item.availableStock > 0 &&
              item.availableStock <= 5;
            const inCartQty = cartQuantities?.[item.key] ?? 0;
            const meta = KIND_META[item.kind];
            const Icon = meta.Icon;
            return (
              <button
                key={item.key}
                type="button"
                className={`tos-product-tile tos-animate-fade-in${outOfStock ? " tos-product-tile--out" : ""}`}
                onClick={() => onPick(item)}
                disabled={outOfStock}
                aria-label={`Add ${item.name} (${item.unitLabel}) to cart`}
              >
                <span className="tos-product-tile__media" aria-hidden="true">
                  <Icon className="tos-product-tile__media-icon" />
                  {inCartQty > 0 ? null : <span className="tos-product-tile__kind">{meta.tile}</span>}
                </span>
                {inCartQty > 0 ? (
                  <span className="tos-product-tile__pill" aria-label={`${inCartQty} in cart`}>
                    {inCartQty} in cart
                  </span>
                ) : null}
                <span className="tos-product-tile__name">{item.name}</span>
                <span className="tos-product-tile__sub">
                  {item.unitLabel}{item.sku ? ` · ${item.sku}` : ""}
                </span>
                <span className="tos-product-tile__row">
                  <span className="tos-product-tile__price">
                    <MoneyValue minor={item.priceMinor} currencyCode={currencyCode} />
                  </span>
                  {item.trackStock ? (
                    <span
                      className={
                        outOfStock
                          ? "tos-product-tile__stock tos-product-tile__stock--out"
                          : lowStock
                            ? "tos-product-tile__stock tos-product-tile__stock--low"
                            : "tos-product-tile__stock"
                      }
                    >
                      {outOfStock
                        ? "Out of stock"
                        : item.availableStock !== null
                          ? `${item.availableStock} left`
                          : "Stock tracked"}
                    </span>
                  ) : null}
                </span>
                {outOfStock ? (
                  <span className="tos-product-tile__badge" aria-hidden="true">
                    <span className="tos-product-tile__badge-tag">Sold out</span>
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
