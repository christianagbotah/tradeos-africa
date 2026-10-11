/**
 * PosBrowser — product browser for the POS workspace.
 *
 * Keyboard-friendly: the search input is the default focus target (F2). The
 * product grid is a real grid of add-to-cart buttons — clicking a card adds
 * one unit to the cart. Category chips filter the grid. Sample/demo data is
 * tagged.
 */
import type { DesktopSellableItem } from "../lib/types.js";
import { fmtMoneyMinor } from "../lib/format.js";
import { IconSearch, IconPlus, IconBox } from "./icons.js";

export interface PosBrowserProps {
  items: readonly DesktopSellableItem[];
  query: string;
  onQueryChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  categories: readonly string[];
  onAdd: (item: DesktopSellableItem) => void;
  isSample: boolean;
}

export function PosBrowser({
  items,
  query,
  onQueryChange,
  category,
  onCategoryChange,
  categories,
  onAdd,
  isSample,
}: PosBrowserProps) {
  const filtered = items.filter((p) => {
    const matchesQuery =
      !query ||
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      (p.sku ?? "").toLowerCase().includes(query.toLowerCase());
    const matchesCat = !category || (p.sku ?? "").toLowerCase().includes(category.toLowerCase()) || category === "";
    return matchesQuery && matchesCat;
  });

  return (
    <section className="dsk-browser" aria-label="Product browser">
      <div className="dsk-browser__head">
        <div className="dsk-browser__search">
          <IconSearch className="dsk-browser__search-icon" />
          <input
            id="pos-product-search"
            type="search"
            className="dsk-browser__search-input"
            placeholder="Search by name or scan barcode\u2026"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search products"
            autoComplete="off"
          />
          <span className="dsk-browser__search-kbd" aria-hidden>
            <span className="dsk-browser__kbd">F2</span>
          </span>
        </div>
        <div className="dsk-browser__cats" role="group" aria-label="Filter by category">
          <button
            type="button"
            className="dsk-chip"
            aria-pressed={category === "" ? "true" : "false"}
            onClick={() => onCategoryChange("")}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className="dsk-chip"
              aria-pressed={category === cat ? "true" : "false"}
              onClick={() => onCategoryChange(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="dsk-empty" style={{ minHeight: "260px" }}>
          <div className="dsk-empty__icon" aria-hidden>
            <IconBox width={44} height={44} />
          </div>
          <div className="dsk-empty__title">No products match "{query}"</div>
          <div className="dsk-empty__text">Try a different search term or clear the category filter.</div>
        </div>
      ) : (
        <div className="dsk-browser__grid">
          {filtered.map((p) => {
            const stock = p.availableStock ?? 0;
            const outOfStock = p.trackStock && stock === 0;
            const lowStock = p.trackStock && stock > 0 && stock <= 12;
            const stockTone = outOfStock ? "dsk-product__stock--out" : lowStock ? "dsk-product__stock--low" : "";
            return (
              <button
                key={p.key}
                type="button"
                className="dsk-product"
                onClick={() => onAdd(p)}
                aria-label={`Add ${p.name} to cart`}
                disabled={outOfStock}
              >
                <div className="dsk-product__img" aria-hidden>
                  <IconBox width={22} height={22} />
                </div>
                <div className="dsk-product__name">{p.name}</div>
                <div className="dsk-product__sku">{p.sku ?? p.unitCode}</div>
                <div className="dsk-product__foot">
                  <span className="dsk-product__price tnum">{fmtMoneyMinor(p.displayPriceMinor)}</span>
                  <span className={`dsk-product__stock ${stockTone}`}>
                    {outOfStock ? "Out of stock" : p.trackStock ? `${stock} ${p.unitLabel}` : "—"}
                  </span>
                </div>
                <span className="dsk-product__add" aria-hidden>
                  <IconPlus width={14} height={14} />
                </span>
              </button>
            );
          })}
        </div>
      )}
      {isSample ? (
        <div className="dsk-banner dsk-banner--neutral" style={{ margin: "0 var(--tos-space-3) var(--tos-space-3)", borderRadius: "8px" }}>
          <div className="dsk-banner__body">
            <div className="dsk-banner__title">Demo catalog</div>
            <div className="dsk-banner__text">
              Showing sample products (DEMO MODE). Sign in to load the live catalog.
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
