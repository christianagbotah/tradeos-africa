"use client";

import React, { useEffect, useRef } from "react";
import { Button } from "../ui/button";
import { ActorReasonEvidence, PostedHistoryNote } from "../business/transaction-evidence";
import type { InventoryDetail } from "./types";

export function InventoryDetailSheet({ open, detail, onClose }: { open: boolean; detail: InventoryDetail | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previousActive = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previousActive.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", keydown);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("keydown", keydown); previousActive.current?.focus(); };
  }, [onClose, open]);
  if (!open) return null;
  return <div className="inventory-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="inventory-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="inventory-detail-title">
      <header className="inventory-detail-head"><div><span>Inventory movement history</span><h2 id="inventory-detail-title">{detail?.item.name ?? "Inventory item"}</h2>{detail?.item.sku ? <small>{detail.item.sku} · {detail.item.stockUnitCode}</small> : null}</div><button ref={closeRef} type="button" aria-label="Close inventory history" onClick={onClose}>×</button></header>
      <div className="inventory-detail-scroll">
        <PostedHistoryNote subject="Inventory movement history" correction="new inventory movement events" title="Balances are derived from posted movements." />
        {!detail ? <div className="inventory-empty-modern">Loading movement history…</div> : <>
          <div className="inventory-detail-balances">
            <Balance label="Available" value={detail.item.available} unit={detail.item.stockUnitCode} />
            <Balance label="Quarantine" value={detail.item.quarantine} unit={detail.item.stockUnitCode} />
            <Balance label="Damaged" value={detail.item.damaged} unit={detail.item.stockUnitCode} />
            <Balance label="Waste" value={detail.item.waste} unit={detail.item.stockUnitCode} />
          </div>
          <section className="inventory-movement-section">
            <div className="inventory-movement-heading"><div><strong>Recent movements</strong><span>Reason, location, source reference and staff actor</span></div><small>{detail.movements.length} shown</small></div>
            <div className="inventory-movement-list">{detail.movements.length === 0 ? <div className="inventory-empty-modern">No movement history yet.</div> : detail.movements.map((movement) => <article className="inventory-movement-row" key={movement.id}>
              <div className={movement.quantityDelta >= 0 ? "inventory-movement-quantity positive" : "inventory-movement-quantity negative"}><strong>{movement.quantityDelta > 0 ? "+" : ""}{formatQuantity(movement.quantityDelta)}</strong><span>{movement.stockUnitCode}</span></div>
              <div className="inventory-movement-main"><strong>{title(movement.reason)}</strong><span>{title(movement.location)} · {formatDate(movement.occurredAt)}</span></div>
              <ActorReasonEvidence actor={movement.actorName} reason={movement.reason} reference={`${movement.referenceType.replaceAll("_", " ")} · ${movement.referenceId.slice(0, 12)}`} />
            </article>)}</div>
          </section>
        </>}
      </div>
      <footer className="inventory-detail-footer"><Button variant="ghost" type="button" onClick={onClose}>Close</Button></footer>
    </div>
  </div>;
}

function Balance({ label, value, unit }: { label: string; value: number; unit: string }) { return <div><span>{label}</span><strong>{formatQuantity(value)} {unit}</strong></div>; }
function formatQuantity(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function title(value: string): string { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
