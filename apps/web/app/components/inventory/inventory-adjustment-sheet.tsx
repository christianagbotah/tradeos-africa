"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { Button } from "../ui/button";
import { IconClose, IconShield } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import type { CatalogItem } from "../workspace/workspace-provider";

interface InventoryAdjustmentSheetProps {
  item: CatalogItem | null;
  onClose: () => void;
  onSaved: () => void;
}

type ReasonValue =
  | "STOCK_COUNT"
  | "DAMAGE"
  | "THEFT"
  | "GIVEAWAY"
  | "SUPPLIER_RETURN"
  | "OTHER";

interface ReasonOption {
  value: ReasonValue;
  label: string;
  hint: string;
}

const ADJUSTMENT_REASONS: ReadonlyArray<ReasonOption> = [
  { value: "STOCK_COUNT", label: "Stock count", hint: "Reconcile to a physical count" },
  { value: "DAMAGE", label: "Damaged / spoiled", hint: "Unsellable, written off" },
  { value: "THEFT", label: "Theft / loss", hint: "Unexplained shortage" },
  { value: "GIVEAWAY", label: "Giveaway / sample", hint: "Used without a sale" },
  { value: "SUPPLIER_RETURN", label: "Returned to supplier", hint: "Sent back, not sold" },
  { value: "OTHER", label: "Other", hint: "Explain in the note" },
];

type StatIconTone = "gold" | "positive" | "warning" | "midnight" | "neutral";

const STAT_TILE_CLASS: Record<StatIconTone, string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

export function InventoryAdjustmentSheet({ item, onClose, onSaved }: InventoryAdjustmentSheetProps) {
  const { session, role, refreshCatalog } = useWorkspace();
  const [newQuantity, setNewQuantity] = useState<number | null>(null);
  const [reason, setReason] = useState<ReasonValue>("STOCK_COUNT");
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

  // Lock body scroll while mounted.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  if (!item || !session) return null;

  const onHand = item.inventoryOnHand ?? 0;
  const available = item.inventoryAvailable ?? 0;
  const reserved = Math.max(0, onHand - available);
  const delta = newQuantity !== null ? newQuantity - onHand : 0;
  const unitCode = item.saleUnitCode;
  const unitName = item.saleUnitName;

  const deltaClass = delta > 0
    ? "tos-stock-delta tos-stock-delta--positive"
    : delta < 0
      ? "tos-stock-delta tos-stock-delta--negative"
      : "tos-stock-delta tos-stock-delta--zero";
  const deltaLabel = delta > 0 ? `+${delta} ${unitCode}` : delta < 0 ? `${delta} ${unitCode}` : `0 ${unitCode}`;

  const reasonHint = useMemo(() => {
    const found = ADJUSTMENT_REASONS.find((r) => r.value === reason);
    return found ? found.hint : "";
  }, [reason]);

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
          {/* Midnight hero — current on-hand prominent */}
          <div className="tos-stock-hero tos-animate-fade-in-up">
            <div className="tos-stock-hero__head">
              <div className="tos-stock-hero__head-main">
                <span className="tos-stock-hero__eyebrow">Current on-hand</span>
                <h3 className="tos-stock-hero__title">{item.name}</h3>
                <p className="tos-stock-hero__sub">
                  {item.sku ? `SKU ${item.sku}` : "No SKU"} · sold per {unitName}
                </p>
              </div>
              <span className={`tos-badge ${available <= 0 ? "tos-badge--danger" : available <= 5 ? "tos-badge--warning" : "tos-badge--positive"}`}>
                <span className="tos-badge__dot" />{available <= 0 ? "Out" : available <= 5 ? "Low" : "OK"}
              </span>
            </div>
            <div className="tos-stock-hero__qty-row">
              <span className="tos-stock-hero__qty-label">On-hand</span>
              <span className="tos-stock-hero__qty">{onHand}</span>
              <span className="tos-stock-hero__qty-unit">{unitCode}</span>
            </div>
          </div>

          {/* 3-up stats — on-hand / available / reserved */}
          <div className="tos-stock-stats tos-animate-fade-in-up">
            <StockStat
              label="On-hand"
              iconTone="midnight"
              value={<span className="tos-stat__value">{onHand}</span>}
              hint={`${unitCode} · physical count`}
            />
            <StockStat
              label="Available"
              iconTone={available <= 0 ? "warning" : "positive"}
              value={<span className="tos-stat__value">{available}</span>}
              hint={`${unitCode} · sellable now`}
            />
            <StockStat
              label="Reserved"
              iconTone="neutral"
              value={<span className="tos-stat__value">{reserved}</span>}
              hint={`${unitCode} · on hold`}
            />
          </div>

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
                {delta === 0
                  ? "No change — set a new quantity to record a movement."
                  : delta > 0
                    ? `Adds ${delta} ${unitCode} to on-hand. A positive movement will be created.`
                    : `Removes ${Math.abs(delta)} ${unitCode} from on-hand. A negative movement will be created.`}
              </span>
            </span>
          </div>

          {/* New counted quantity */}
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="adj-qty">New counted quantity<span className="tos-field__label-required">*</span></label>
            <input
              id="adj-qty"
              type="number"
              className="tos-input tos-input--lg"
              value={newQuantity ?? ""}
              onChange={(e) => setNewQuantity(e.target.value === "" ? null : Number(e.target.value))}
              min={0}
              step="any"
              required
              disabled={!canWrite || busy}
            />
            <span className="tos-field__hint">Enter the physical count in {unitName} ({unitCode}). The movement is derived from the difference vs. on-hand.</span>
          </div>

          {/* Reason — visual chip grid (accessible, aria-pressed) */}
          <div className="tos-field">
            <label className="tos-field__label">Reason<span className="tos-field__label-required">*</span></label>
            <div className="tos-reason-grid" role="radiogroup" aria-label="Adjustment reason">
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
              <span className="tos-callout__sub"> This adjustment creates an evidence-grade movement that reconciles to the cashbook (for damage, theft, giveaway). The new on-hand is computed server-side from the running movement ledger.</span>
            </span>
          </div>

          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
        </form>

        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={newQuantity === null || !canWrite || busy}>
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
