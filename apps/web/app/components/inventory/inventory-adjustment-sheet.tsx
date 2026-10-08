"use client";

import React, { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { InventoryAdjustmentInput, InventoryAdjustmentLocation } from "@tradeos/contracts";
import { messageFrom } from "../../lib/client-api";
import { enqueueMutation, flushPendingMutations, getOrCreateClientId } from "../../lib/offline-sync";
import { Button } from "../ui/button";
import type { InventoryItem } from "./types";

export type InventoryAdjustmentAction = "COUNT_CORRECTION" | "QUARANTINE" | "DAMAGE" | "WASTE";
export type InventoryAdjustmentDraft = {
  action: InventoryAdjustmentAction;
  direction: "ADD" | "REMOVE";
  sourceLocation: InventoryAdjustmentLocation;
  countLocation: InventoryAdjustmentLocation;
  quantity: string;
  note: string;
};

type Props = {
  open: boolean;
  item: InventoryItem | null;
  businessId: string;
  branchId: string;
  role: string;
  onClose: () => void;
  onQueued: (message: string) => void | Promise<void>;
};

const writeRoles = new Set(["OWNER", "ADMIN", "MANAGER", "INVENTORY"]);
const allLocations: readonly InventoryAdjustmentLocation[] = ["AVAILABLE", "QUARANTINE", "DAMAGED", "WASTE"];

export function inventoryAdjustmentPayload(itemId: string, draft: InventoryAdjustmentDraft): InventoryAdjustmentInput | null {
  const quantity = Number(draft.quantity);
  const note = draft.note.trim();
  if (!Number.isFinite(quantity) || quantity <= 0 || !note) return null;
  if (draft.action === "COUNT_CORRECTION") {
    return draft.direction === "ADD"
      ? { itemId, destinationLocation: draft.countLocation, quantity, reasonCode: "COUNT_CORRECTION", note }
      : { itemId, sourceLocation: draft.countLocation, quantity, reasonCode: "COUNT_CORRECTION", note };
  }
  if (draft.action === "QUARANTINE") {
    return { itemId, sourceLocation: draft.sourceLocation, destinationLocation: "QUARANTINE", quantity, reasonCode: "QUARANTINE", note };
  }
  if (draft.action === "DAMAGE") {
    return { itemId, sourceLocation: draft.sourceLocation, destinationLocation: "DAMAGED", quantity, reasonCode: "DAMAGE", note };
  }
  return { itemId, sourceLocation: draft.sourceLocation, destinationLocation: "WASTE", quantity, reasonCode: "WASTE", note };
}

export function inventoryAdjustmentMessage(code: string | null | undefined, fallback = "Inventory adjustment could not be applied."): string {
  if (code === "INVENTORY_INSUFFICIENT_STOCK") return "Available stock changed before this adjustment applied. Refresh inventory and review the quantity before retrying.";
  if (code === "INVENTORY_ITEM_NOT_FOUND") return "This inventory item is no longer available for adjustment. Refresh inventory before trying again.";
  if (code === "INVENTORY_BRANCH_NOT_FOUND") return "This branch is no longer available for inventory changes. Refresh the workspace.";
  if (code === "INVENTORY_ITEM_NOT_TRACKED") return "This item is not configured for tracked stock, so no inventory adjustment can be posted.";
  return fallback;
}

export function InventoryAdjustmentSheet({ open, item, businessId, branchId, role, onClose, onQueued }: Props) {
  const [draft, setDraft] = useState<InventoryAdjustmentDraft>(() => defaultDraft());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const quantityRef = useRef<HTMLInputElement | null>(null);
  const previousActive = useRef<HTMLElement | null>(null);
  const canAdjust = writeRoles.has(role);

  useEffect(() => {
    if (!open) return;
    setDraft(defaultDraft());
    setMessage(null);
    previousActive.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => quantityRef.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      previousActive.current?.focus();
    };
  }, [onClose, open]);

  const payload = useMemo(() => item ? inventoryAdjustmentPayload(item.id, draft) : null, [draft, item]);
  const preview = useMemo(() => item ? previewText(item, draft) : "", [draft, item]);
  if (!open || !item || !canAdjust) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!payload || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      enqueueMutation({
        clientId: getOrCreateClientId(),
        clientMutationId: crypto.randomUUID(),
        businessId,
        branchId,
        mutationType: "INVENTORY_ADJUSTMENT_CREATE",
        occurredAt: new Date().toISOString(),
        payload,
      });
      if (!navigator.onLine) {
        await onQueued("Inventory adjustment saved offline and pending synchronization.");
        onClose();
        return;
      }
      const summary = await flushPendingMutations();
      if (summary.rejected > 0) {
        await onQueued("Inventory adjustment needs review before it can be applied.");
        onClose();
        return;
      }
      if (summary.received > 0 || summary.applied === 0) {
        await onQueued("Inventory adjustment is saved and pending synchronization.");
        onClose();
        return;
      }
      await onQueued("Inventory adjustment posted. Stock balances were recalculated from movement history.");
      onClose();
    } catch (reason) {
      setMessage(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  const sourceOptions = draft.action === "QUARANTINE"
    ? (["AVAILABLE", "DAMAGED"] as const)
    : draft.action === "DAMAGE"
      ? (["AVAILABLE", "QUARANTINE"] as const)
      : (["AVAILABLE", "QUARANTINE", "DAMAGED"] as const);

  return <div className="inventory-adjustment-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={sheetRef} className="inventory-adjustment-sheet" role="dialog" aria-modal="true" aria-labelledby="inventory-adjustment-title">
      <header className="inventory-adjustment-head">
        <div><span>Inventory correction event</span><h2 id="inventory-adjustment-title">Adjust stock · {item.name}</h2><small>{item.stockUnitCode} · balances remain movement-derived</small></div>
        <button type="button" aria-label="Close adjustment" onClick={onClose}>×</button>
      </header>
      <form className="inventory-adjustment-body" onSubmit={(event) => void submit(event)}>
        <section>
          <div className="inventory-adjustment-section-heading"><strong>Action</strong><span>Choose what physically happened to this stock.</span></div>
          <div className="inventory-adjustment-actions" role="radiogroup" aria-label="Adjustment action">
            {([ ["COUNT_CORRECTION", "Count correction"], ["QUARANTINE", "Quarantine"], ["DAMAGE", "Damage"], ["WASTE", "Waste"] ] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={draft.action === value} className={draft.action === value ? "active" : undefined} onClick={() => setDraft((current) => ({ ...current, action: value, sourceLocation: "AVAILABLE" }))}>{label}</button>)}
          </div>
        </section>

        <section className="inventory-adjustment-fields">
          {draft.action === "COUNT_CORRECTION" ? <>
            <label>Correction direction<select value={draft.direction} onChange={(event) => setDraft((current) => ({ ...current, direction: event.target.value as "ADD" | "REMOVE" }))}><option value="ADD">Add stock found</option><option value="REMOVE">Remove stock missing</option></select></label>
            <label>Location<select value={draft.countLocation} onChange={(event) => setDraft((current) => ({ ...current, countLocation: event.target.value as InventoryAdjustmentLocation }))}>{allLocations.map((location) => <option key={location} value={location}>{title(location)}</option>)}</select></label>
          </> : <label>Move from<select value={draft.sourceLocation} onChange={(event) => setDraft((current) => ({ ...current, sourceLocation: event.target.value as InventoryAdjustmentLocation }))}>{sourceOptions.map((location) => <option key={location} value={location}>{title(location)}</option>)}</select></label>}
          <label>Quantity<input ref={quantityRef} required inputMode="decimal" value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))} placeholder="0" /></label>
          <label className="inventory-adjustment-explanation">Explanation <span>Required</span><textarea required maxLength={1000} value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Why is this stock changing?" /></label>
        </section>

        <section className="inventory-adjustment-preview">
          <div className="inventory-adjustment-section-heading"><strong>Preview</strong><span>New movement evidence only; posted history is not edited.</span></div>
          <p>{preview}</p>
          <small>TradeOS calculates valuation from current server stock when this adjustment synchronizes.</small>
        </section>

        {message ? <div className="inventory-adjustment-message" role="status">{message}</div> : null}
        <footer className="inventory-adjustment-footer"><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !payload}>{busy ? "Saving…" : "Save adjustment"}</Button></footer>
      </form>
    </div>
  </div>;
}

function defaultDraft(): InventoryAdjustmentDraft {
  return { action: "COUNT_CORRECTION", direction: "ADD", sourceLocation: "AVAILABLE", countLocation: "AVAILABLE", quantity: "", note: "" };
}

function previewText(item: InventoryItem, draft: InventoryAdjustmentDraft): string {
  const quantity = Number(draft.quantity);
  const value = Number.isFinite(quantity) && quantity > 0 ? `${formatQuantity(quantity)} ${item.stockUnitCode}` : `the entered ${item.stockUnitCode} quantity`;
  if (draft.action === "COUNT_CORRECTION") return draft.direction === "ADD" ? `Add ${value} to ${title(draft.countLocation)} after a physical count.` : `Remove ${value} from ${title(draft.countLocation)} after a physical count.`;
  return `Move ${value} from ${title(draft.sourceLocation)} to ${title(draft.action === "QUARANTINE" ? "QUARANTINE" : draft.action === "DAMAGE" ? "DAMAGED" : "WASTE")}.`;
}
function title(value: string): string { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatQuantity(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value); }
