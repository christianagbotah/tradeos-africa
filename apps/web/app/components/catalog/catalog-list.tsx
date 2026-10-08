import React from "react";
import { MoneyValue } from "../business/money-value";
import { StatusBadge } from "../ui/status-badge";
import type { CatalogItem } from "../../lib/workspace-types";
import type { CatalogCapabilities } from "../../lib/lifecycle-capabilities";
import { CatalogActions } from "./catalog-actions";

export function CatalogList({
  items,
  currencyCode,
  capabilities,
  businessId,
  role,
  onOpenItem,
  onDuplicateItem,
  onChanged,
}: {
  items: CatalogItem[];
  currencyCode: string;
  capabilities: CatalogCapabilities;
  businessId: string;
  role: string;
  onOpenItem?: (item: CatalogItem) => void;
  onDuplicateItem?: (item: CatalogItem) => void;
  onChanged: () => Promise<void> | void;
}) {
  if (items.length === 0) {
    return (
      <div className="catalog-empty-state">
        <strong>No matching catalog items</strong>
        <span>Try another search or filter. Archived items stay out of normal selling until reactivated.</span>
      </div>
    );
  }

  return (
    <div className="catalog-list" role="list">
      {items.map((item) => {
        const sellUnit = item.units.find((unit) => unit.canSell && unit.defaultSalePriceMinor !== null) ?? null;
        return (
          <article className={`catalog-row${item.active ? "" : " catalog-row--archived"}`} key={item.id} role="listitem">
            <div className="catalog-row-main">
              <div className="catalog-item-icon" aria-hidden="true">{item.kind === "SERVICE" ? "S" : "P"}</div>
              <div className="catalog-item-copy">
                <div className="catalog-item-name-line">
                  <strong>{item.name}</strong>
                  {item.sku ? <span className="catalog-sku">{item.sku}</span> : null}
                </div>
                <span>{item.kind === "SERVICE" ? "Service" : item.kind === "PREPARED_PRODUCT" ? "Prepared product" : "Product"}</span>
              </div>
            </div>

            <div className="catalog-row-fact">
              <span>Selling</span>
              {sellUnit ? (
                <strong>{sellUnit.label} · <MoneyValue minor={sellUnit.defaultSalePriceMinor!} currencyCode={currencyCode} emphasis="strong" /></strong>
              ) : <strong>Not for sale</strong>}
            </div>

            <div className="catalog-row-fact">
              <span>Stock</span>
              <strong>{item.trackStock ? `Tracked in ${item.stockUnitCode ?? "stock unit"}` : item.kind === "SERVICE" ? "Service · no stock" : "Not tracked"}</strong>
            </div>

            <div className="catalog-row-status">
              <StatusBadge tone={item.active ? "positive" : "neutral"}>{item.active ? "Active" : "Archived"}</StatusBadge>
            </div>

            {capabilities.canEdit ? (
              <div className="catalog-row-action">
                <CatalogActions
                  item={item}
                  businessId={businessId}
                  role={role}
                  onEdit={() => onOpenItem?.(item)}
                  onDuplicate={() => onDuplicateItem?.(item)}
                  onChanged={onChanged}
                />
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
