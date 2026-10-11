"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { Button } from "../ui/button";
import { IconClose } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import type { CatalogItem } from "../workspace/workspace-provider";

interface InventoryAdjustmentSheetProps {
  item: CatalogItem | null;
  onClose: () => void;
  onSaved: () => void;
}

const ADJUSTMENT_REASONS = [
  { value: "STOCK_COUNT", label: "Stock count correction" },
  { value: "DAMAGE", label: "Damaged / spoiled" },
  { value: "THEFT", label: "Theft / loss" },
  { value: "GIVEAWAY", label: "Giveaway / sample" },
  { value: "SUPPLIER_RETURN", label: "Returned to supplier" },
  { value: "OTHER", label: "Other" },
] as const;

export function InventoryAdjustmentSheet({ item, onClose, onSaved }: InventoryAdjustmentSheetProps) {
  const { session, role, refreshCatalog } = useWorkspace();
  const [newQuantity, setNewQuantity] = useState<number | null>(null);
  const [reason, setReason] = useState<typeof ADJUSTMENT_REASONS[number]["value"]>("STOCK_COUNT");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"].includes(role);

  useEffect(() => {
    if (item) {
      setNewQuantity(item.inventoryOnHand ?? 0);
      setReason("STOCK_COUNT");
      setNote("");
      setBusy(false);
      setError(null);
    }
  }, [item]);

  if (!item || !session) return null;

  const delta = newQuantity !== null ? newQuantity - (item.inventoryOnHand ?? 0) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newQuantity === null || busy || !canWrite) return;
    setBusy(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      const mutation = queue.build({
        businessId: session.businessId,
        branchId: session.branchId,
        mutationType: "INVENTORY_ADJUSTMENT_CREATE",
        payload: {
          itemId: item.id,
          newQuantity,
          reason,
          note: note.trim() || null,
        },
      });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      await refreshCatalog();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post adjustment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Inventory adjustment">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Inventory</span>
            <h2 className="tos-sheet__title">Adjust stock</h2>
            <p className="tos-sheet__sub">{item.name}</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <form className="tos-sheet__body" onSubmit={handleSubmit}>
          <dl className="tos-kv">
            <div><dt className="tos-kv__key">Current on-hand</dt><dd className="tos-kv__val">{item.inventoryOnHand ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Available</dt><dd className="tos-kv__val">{item.inventoryAvailable ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Delta</dt><dd className="tos-kv__val" style={{ color: delta > 0 ? "var(--tos-positive)" : delta < 0 ? "var(--tos-danger)" : undefined }}>{delta > 0 ? `+${delta}` : delta}</dd></div>
          </dl>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="adj-qty">New counted quantity<span className="tos-field__label-required">*</span></label>
            <input
              id="adj-qty"
              type="number"
              className="tos-input"
              value={newQuantity ?? ""}
              onChange={(e) => setNewQuantity(e.target.value === "" ? null : Number(e.target.value))}
              min={0}
              step="any"
              required
              disabled={!canWrite}
            />
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="adj-reason">Reason<span className="tos-field__label-required">*</span></label>
            <select id="adj-reason" className="tos-select" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} disabled={!canWrite}>
              {ADJUSTMENT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="adj-note">Note (optional)</label>
            <textarea id="adj-note" className="tos-textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={!canWrite} />
          </div>
          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
        </form>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={newQuantity === null || !canWrite}>
            {canWrite ? "Post adjustment" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
