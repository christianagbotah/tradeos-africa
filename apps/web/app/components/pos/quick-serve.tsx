"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import type { SellableItem } from "../../../lib/catalog-read-model";
import { searchPosCatalog } from "../../../lib/pos-catalog-search";
import {
  quickServeStorageKey, cleanQuickServeFavourites, quickServeGroups,
} from "../../../lib/quick-serve-model";
import type { CartLine } from "./cart-panel";
import styles from "./quick-serve.module.css";

interface QuickServeProps {
  businessId: string;
  branchId: string;
  sellable: readonly SellableItem[];
  currencyCode: string;
  lines: readonly CartLine[];
  online: boolean;
  onPick: (item: SellableItem) => void;
  onInc: (key: string) => void;
  onDec: (key: string) => void;
  onClear: () => void;
  onCheckout: () => void;
}

export function QuickServe({
  businessId, branchId, sellable, currencyCode, lines, online,
  onPick, onInc, onDec, onClear, onCheckout,
}: QuickServeProps) {
  const [query, setQuery] = useState("");
  const [pins, setPins] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const storageKey = useMemo(
    () => quickServeStorageKey(businessId, branchId), [businessId, branchId],
  );
  const validKeys = useMemo(() => new Set(sellable.map((item) => item.key)), [sellable]);
  useEffect(() => {
    setReady(false);
    let saved: unknown = [];
    try {
      const json = window.localStorage.getItem(storageKey);
      if (json) saved = JSON.parse(json) as unknown;
    } catch { /* Private browsing or invalid storage: use an unpinned menu. */ }
    setPins(cleanQuickServeFavourites(saved, validKeys));
    setReady(true);
  }, [storageKey, validKeys]);

  function togglePin(key: string) {
    if (!ready || !validKeys.has(key)) return;
    const next = pins.includes(key) ? pins.filter((pin) => pin !== key) : [...pins, key].slice(-30);
    setPins(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Session-only preference. */ }
  }

  const candidates = useMemo(() => {
    const matched = query.trim() ? searchPosCatalog(sellable, query).items : sellable;
    return quickServeGroups(matched, pins).slice(0, query.trim() ? 40 : pins.length ? 30 : 24);
  }, [query, sellable, pins]);
  const totalMinor = lines.reduce((sum, line) => sum + line.sellable.priceMinor * line.quantity, 0);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  return <section className={styles.workspace} aria-label="Quick Serve point of sale">
    <div className={styles.menu}>
      <div className={styles.menuHeader}>
        <div>
          <h2 className={styles.title}>Tap to add</h2>
          <p className={styles.hint}>Choose each portion price with one tap. ☆ pins your favourites.</p>
        </div>
        <span className={styles.connection} role="status">
          {online ? "● Online" : "● Offline · saves to this device"}
        </span>
      </div>
      <input
        type="search"
        className={styles.search}
        aria-label="Find food or product"
        placeholder="Find waakye, gari, fish, egg…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {sellable.length === 0 ? (
        <div className={styles.empty}>
          <strong>Set up your menu once.</strong>
          <p>Add Waakye, Gari, Fish and Egg with their prices in Catalog. They will appear as large buttons here.</p>
          <a href="/catalog">Open Catalog</a>
        </div>
      ) : candidates.length === 0 ? (
        <p role="status" className={styles.empty}>No matching menu item. Try a different word.</p>
      ) : (
        <div className={styles.tiles} aria-label="Quick product buttons">
          {candidates.map((group) => (
            <div className={group.options.length > 1 ?
              styles.group + " " + styles.groupWide : styles.group} key={group.itemId}>
              <h3 className={styles.groupName}>{group.name}</h3>
              <div className={styles.portions} role="group"
                aria-label={group.name + " portion and price options"}>
                {group.options.map((item) => {
                  const soldOut = item.trackStock && item.availableStock !== null &&
                    item.availableStock <= 0;
                  const selectedQty = lines.find((line) => line.sellable.key === item.key)?.quantity ?? 0;
                  return <div key={item.key} className={styles.portionRow}>
                    <button
                      type="button"
                      className={styles.portion}
                      onClick={() => onPick(item)}
                      disabled={soldOut}
                      aria-label={"Add " + item.name + ", " + item.unitLabel + ", " + formatMoney(item.priceMinor, currencyCode)}
                    >
                      <strong className={styles.portionPrice}>{formatMoney(item.priceMinor, currencyCode)}</strong>
                      <small className={styles.portionLabel}>{item.unitLabel}</small>
                      {selectedQty > 0 ? <span className={styles.portionAdded}>{selectedQty} added</span> : null}
                      {soldOut ? <span className={styles.soldOut}>Sold out</span> : null}
                    </button>
                    <button
                      type="button"
                      className={styles.portionPin}
                      aria-pressed={pins.includes(item.key)}
                      aria-label={(pins.includes(item.key) ? "Unpin " : "Pin ") +
                        item.name + " " + item.unitLabel}
                      title={pins.includes(item.key) ? "Remove from favourites" : "Pin to the top"}
                      onClick={() => togglePin(item.key)}
                    >{pins.includes(item.key) ? "★" : "☆"}</button>
                  </div>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    <aside className={styles.order} data-expanded={detailsOpen}
      aria-label="Current customer's order">
      <div className={styles.orderHead}>
        <h2 className={styles.title}>Current customer</h2>
        {lines.length > 0 && (
          confirmClear ? (
            <div className={styles.clearConfirm} role="group" aria-label="Discard the current order?">
              <button type="button" onClick={() => setConfirmClear(false)}>Keep</button>
              <button type="button" onClick={() => { onClear(); setConfirmClear(false); }}>Discard</button>
            </div>
          ) : (
            <button type="button" className={styles.clear} onClick={() => setConfirmClear(true)}>
              Clear order
            </button>
          )
        )}
      </div>
      <div className={styles.orderLines}>
        {lines.length === 0 ? (
          <p className={styles.placeholder}>Tap the customer's food above. No customer registration needed.</p>
        ) : lines.map((line) => (
          <div className={styles.orderRow} key={line.sellable.key}>
            <div className={styles.orderName}>
              <strong>{line.sellable.name}</strong>
              <small>{line.sellable.unitLabel} · {formatMoney(line.sellable.priceMinor, currencyCode)}</small>
            </div>
            <div className={styles.quantity} role="group" aria-label={"Quantity for " + line.sellable.name}>
              <button type="button" aria-label={"Remove one " + line.sellable.name} onClick={() => onDec(line.sellable.key)}>−</button>
              <span aria-live="polite">{line.quantity}</span>
              <button type="button" aria-label={"Add another " + line.sellable.name} onClick={() => onInc(line.sellable.key)}>+</button>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.charge}>
        <div className={styles.total} aria-live="polite">
          <span>To collect <small>{count} item{count !== 1 ? "s" : ""}</small></span>
          <strong>{formatMoney(totalMinor, currencyCode)}</strong>
        </div>
        <button type="button" className={styles.review}
          onClick={() => setDetailsOpen((value) => !value)}
          disabled={lines.length === 0}
          aria-expanded={detailsOpen}>
          {detailsOpen ? "Hide order" : "View / edit order"} · {count} item{count !== 1 ? "s" : ""}
        </button>
        <button type="button" onClick={onCheckout} disabled={lines.length === 0} className={styles.pay}>
          Take payment <span aria-hidden="true">→</span>
        </button>
        <p className={styles.note}>Cash can be recorded in one tap. MoMo and credit require verification.</p>
      </div>
    </aside>
  </section>;
}
