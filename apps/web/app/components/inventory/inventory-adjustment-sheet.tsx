"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { Button } from "../ui/button";
import { IconClose, IconShield } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import {
  buildInventoryAdjustmentPayload,
  INVENTORY_ADJUSTMENT_CREATE_TYPE,
  type InventoryAdjustmentReasonCode,
} from "../../../lib/mutation-builders";
import type { TrackedRowLike } from "./inventory-adjustment-target";

interface InventoryAdjustmentSheetProps {
  row: TrackedRowLike | null;
  onClose: () => void;
  onSaved: () => void;
}

type ReasonOption = {
  value: InventoryAdjustmentReasonCode;
  label: string;
  hint: string;
};

/**
 * Reason chips map 1:1 onto the server's reason codes and location rules:
 *  - COUNT_CORRECTION reconciles to a physical count (adds or removes stock)
 *  - QUARANTINE / DAMAGE / WASTE reclassify AVAILABLE stock into that bucket
 *  - OTHER removes stock with an explanatory note
 */
const ADJUSTMENT_REASONS: ReadonlyArray<ReasonOption> = [
  { value: "COUNT_CORRECTION", label: "Stock count", hint: "Reconcile to a physical count" },
  { value: "QUARANTINE", label: "Move to quarantine", hint: "Set aside pending review" },
  { value: "DAMAGE", label: "Damaged / spoiled", hint: "Unsellable, written off" },
  { value: "WASTE", label: "Waste / spillage", hint: "Consumed or lost" },
  { value: "OTHER", label: "Other removal", hint: "Explain in the note" },
];

type StatIconTone = "gold" | "positive" | "warning" | "midnight" | "neutral";

const STAT_TILE_CLASS: Record<StatIconTone, string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

export function InventoryAdjustmentSheet({ row, onClose, onSaved }: InventoryAdjustmentSheetProps) {
  const { session, role, refreshInventory } = useWorkspace();
  const [reason, setReason] = useState<InventoryAdjustmentReasonCode>("COUNT_CORRECTION");
  const [countedQuantity, setCountedQuantity] = useState<number | null>(null);
  const [moveQuantity, setMoveQuantity] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"].includes(role);

  useEffect(() => {
    if (row) {
      setReason("COUNT_CORRECTION");
      setCountedQuantity(row.available);
      setMoveQuantity(null);
      setNote("");
      setBusy(false);
      setError(null);
    }
  }, [row]);

  // Lock body scroll while mounted.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const unitCode = row?.item.stockUnitCode ?? "units";

  const countDelta = useMemo(() => {
    if (reason !== "COUNT_CORRECTION" || countedQuantity === null) return null;
    return countedQuantity - row!.available;
  }, [reason, countedQuantity, row]);

  const moveQty = reason === "COUNT_CORRECTION"
    ? (countDelta !== null ? Math.abs(countDelta) : 0)
    : (moveQuantity ?? 0);

  const payload = useMemo(() => {
    if (!row) return null;
    if (moveQty <= 0 || !Number.isFinite(moveQty)) return null;
    if (reason === "COUNT_CORRECTION") {
      // Count correction must either add or remove stock — the delta decides.
      if (countDelta === null || countDelta === 0) return null;
      return countDelta > 0
        ? { itemId: row.item.id, quantity: countDelta, reasonCode: reason, destinationLocation: "AVAILABLE" as const, note: note.trim() || null }
        : { itemId: row.item.id, quantity: Math.abs(countDelta), reasonCode: reason, sourceLocation: "AVAILABLE" as const, note: note.trim() || null };
    }
    if (reason === "OTHER") {
      return { itemId: row.item.id, quantity: moveQty, reasonCode: reason, sourceLocation: "AVAILABLE" as const, note: note.trim() || null };
    }
    // QUARANTINE / DAMAGE / WASTE reclassify AVAILABLE stock.
    const destination = reason === "QUARANTINE"
      ? "QUARANTINE" as const
      : reason === "DAMAGE"
        ? "DAMAGED" as const
        : "WASTE" as const;
    return { itemId: row.item.id, quantity: moveQty, reasonCode: reason, sourceLocation: "AVAILABLE" as const, destinationLocation: destination, note: note.trim() || null };
  }, [row, reason, moveQty, countDelta, note]);

  const delta = countDelta;
  const deltaClass = delta !== null && delta > 0
    ? "tos-stock-delta tos-stock-delta--positive"
    : delta !== null && delta < 0
      ? "tos-stock-delta tos-stock-delta--negative"
      : "tos-stock-delta tos-stock-delta--zero";
  const deltaLabel = delta === null ? `0 ${unitCode}` : delta > 0 ? `+${delta} ${unitCode}` : `${delta} ${unitCode}`;

  const reasonHint = useMemo(() => {
    const found = ADJUSTMENT_REASONS.find((r) => r.value === reason);
    return found ? found.hint : "";
  }, [reason]);

  if (!row || !session) return null;

  const available = row.available;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payload || busy || !canWrite) return;
    setBusy(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      const mutation = queue.build({
        businessId: session.businessId,
        branchId: session.branchId,
        mutationType: INVENTORY_ADJUSTMENT_CREATE_TYPE,
        payload: buildInventoryAdjustmentPayload(payload),
      });
      await queue.enqueue(mutation);
      await queue.flushOrThrow({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      await refreshInventory();
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
            <p className="tos-sheet__sub">{row.item.name}</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <form className="tos-sheet__body" onSubmit={handleSubmit}>
          {/* Midnight hero — current available prominent */}
          <div className="tos-stock-hero tos-animate-fade-in-up">
            <div className="tos-stock-hero__head">
              <div className="tos-stock-hero__head-main">
                <span className="tos-stock-hero__eyebrow">Available now (last known)</span>
                <h3 className="tos-stock-hero__title">{row.item.name}</h3>
                <p className="tos-stock-hero__sub">
                  {row.item.sku ? `SKU ${row.item.sku}` : "No SKU"} · counted in {unitCode}
                </p>
              </div>
              <span className={`tos-badge ${available <= 0 ? "tos-badge--danger" : available <= 5 ? "tos-badge--warning" : "tos-badge--positive"}`}>
                <span className="tos-badge__dot" />{available <= 0 ? "Out" : available <= 5 ? "Low" : "OK"}
              </span>
            </div>
            <div className="tos-stock-hero__qty-row">
              <span className="tos-stock-hero__qty-label">Available</span>
              <span className="tos-stock-hero__qty">{available}</span>
              <span className="tos-stock-hero__qty-unit">{unitCode}</span>
            </div>
          </div>

          {/* 3-up stats — available / quarantine / damaged+waste */}
          <div className="tos-stock-stats tos-animate-fade-in-up">
            <StockStat
              label="Available"
              iconTone="midnight"
              value={<span className="tos-stat__value">{available}</span>}
              hint={`${unitCode} · sellable now`}
            />
            <StockStat
              label="Quarantine"
              iconTone="neutral"
              value={<span className="tos-stat__value">{row.stock?.quarantine ?? 0}</span>}
              hint={`${unitCode} · pending review`}
            />
            <StockStat
              label="Damaged + waste"
              iconTone={((row.stock?.damaged ?? 0) + (row.stock?.waste ?? 0)) > 0 ? "warning" : "neutral"}
              value={<span className="tos-stat__value">{(row.stock?.damaged ?? 0) + (row.stock?.waste ?? 0)}</span>}
              hint={`${unitCode} · written off`}
            />
          </div>

          {/* Reason — visual chip grid (accessible, aria-pressed) */}
          <div className="tos-field">
            <label className="tos-field__label">Adjustment type<span className="tos-field__label-required">*</span></label>
            <div className="tos-reason-grid" role="radiogroup" aria-label="Adjustment type">
              {ADJUSTMENT_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className="tos-reason-chip"
                  aria-pressed={reason === r.value}
                  role="radio"
                  aria-checked={reason === r.value}
                  onClick={() => setReason(r.value)}
                  disabled={!canWrite || busy}
                >
                  <span className="tos-reason-chip__label">{r.label}</span>
                  <span className="tos-reason-chip__hint">{r.hint}</span>
                </button>
              ))}
            </div>
            <span className="tos-field__hint">{reasonHint}</span>
          </div>

          {reason === "COUNT_CORRECTION" ? (
            <>
              {/* Live delta display */}
              <div className="tos-callout tos-callout--info">
                <span className="tos-callout__icon-wrap" aria-hidden="true">
                  <IconShield style={{ width: 16, height: 16 }} />
                </span>
                <span className="tos-callout__body">
                  <span className="tos-row tos-row--between" style={{ flexWrap: "wrap", gap: "var(--tos-space-2)" }}>
                    <span>Adjustment delta</span>
                    <span className={deltaClass}>{deltaLabel}</span>
                  </span>
                  <span className="tos-callout__sub">
                    {delta === null || delta === 0
                      ? "No change — enter the physical count to record a movement."
                      : delta > 0
                        ? `Adds ${delta} ${unitCode} to available stock. A positive movement will be created.`
                        : `Removes ${Math.abs(delta)} ${unitCode} from available stock. A negative movement will be created.`}
                  </span>
                </span>
              </div>

              {/* New counted quantity */}
              <div className="tos-field">
                <label className="tos-field__label" htmlFor="adj-qty">Physical count<span className="tos-field__label-required">*</span></label>
                <input
                  id="adj-qty"
                  type="number"
                  className="tos-input tos-input--lg"
                  value={countedQuantity ?? ""}
                  onChange={(e) => setCountedQuantity(e.target.value === "" ? null : Number(e.target.value))}
                  min={0}
                  step="any"
                  required
                  disabled={!canWrite || busy}
                />
                <span className="tos-field__hint">Enter the physical count in {unitCode}. The movement is derived from the difference vs. the last-known available balance.</span>
              </div>
            </>
          ) : (
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="adj-move-qty">Quantity<span className="tos-field__label-required">*</span></label>
              <input
                id="adj-move-qty"
                type="number"
                className="tos-input tos-input--lg"
                value={moveQuantity ?? ""}
                onChange={(e) => setMoveQuantity(e.target.value === "" ? null : Number(e.target.value))}
                min={0}
                step="any"
                required
                disabled={!canWrite || busy}
              />
              <span className="tos-field__hint">
                {reason === "OTHER"
                  ? `Units of ${unitCode} to remove from available stock.`
                  : `Units of ${unitCode} to move from available into ${reason === "QUARANTINE" ? "quarantine" : reason === "DAMAGE" ? "damaged stock" : "waste"}.`}
              </span>
            </div>
          )}

          {/* Note */}
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="adj-note">Note (optional)</label>
            <textarea
              id="adj-note"
              className="tos-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!canWrite || busy}
              placeholder="Add context for this adjustment — e.g. 'Cycle count, week 12' or 'Spillage in storage'."
              rows={3}
            />
          </div>

          {/* Server-authoritative framing */}
          <div className="tos-callout tos-callout--warning">
            <span className="tos-callout__icon-wrap" aria-hidden="true">
              <IconShield style={{ width: 16, height: 16 }} />
            </span>
            <span className="tos-callout__body">
              The stock balance is derived from movements — it is never overwritten directly.
              <span className="tos-callout__sub"> This adjustment creates an evidence-grade movement that reconciles to the cashbook (for damage, theft, giveaway). The new balances are computed server-side from the running movement ledger.</span>
            </span>
          </div>

          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
        </form>

        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={!payload || !canWrite || busy}>
            {canWrite ? "Record adjustment" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}

interface StockStatProps {
  label: string;
  icon?: ReactNode;
  iconTone: StatIconTone;
  value: ReactNode;
  hint?: string;
}

function StockStat({ label, icon, iconTone, value, hint }: StockStatProps) {
  return (
    <div className="tos-stat tos-card-hover">
      <div className="tos-stat__head">
        <span className={STAT_TILE_CLASS[iconTone]} aria-hidden="true">
          {icon ?? <IconShield className="tos-stat__icon-tile-svg" />}
        </span>
        <span className="tos-stat__label">{label}</span>
      </div>
      {value}
      {hint ? <span className="tos-stat__hint">{hint}</span> : null}
    </div>
  );
}
