"use client";

import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";
import { IconClose, IconPlus, IconReceipt, IconShield, IconTrash } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import type { Supplier } from "./supplier-sheet";

interface PurchaseReceiptBuilderProps {
  open: boolean;
  suppliers: readonly Supplier[];
  onClose: () => void;
  onComplete: () => void;
}

interface ReceiptLine {
  itemId: string;
  quantity: number;
  costMinor: number;
}

export function PurchaseReceiptBuilder({ open, suppliers, onClose, onComplete }: PurchaseReceiptBuilderProps) {
  const { session, role, catalog, bump } = useWorkspace();
  const [supplierId, setSupplierId] = useState<string>("");
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"].includes(role);

  useEffect(() => {
    if (open) {
      setSupplierId(suppliers[0]?.id ?? "");
      setLines([{ itemId: "", quantity: 1, costMinor: 0 }]);
      setBusy(false); setError(null);
    }
  }, [open, suppliers]);

  const activeCatalog = useMemo(() => catalog.filter((c) => c.status === "ACTIVE"), [catalog]);
  const currencyCode = session?.currencyCode ?? "GHS";

  if (!open || !session) return null;

  const totalMinor = lines.reduce((sum, l) => sum + (l.costMinor * l.quantity), 0);
  const validLineCount = lines.filter((l) => l.itemId && l.quantity > 0 && l.costMinor >= 0).length;

  const setLine = (idx: number, patch: Partial<ReceiptLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, { itemId: "", quantity: 1, costMinor: 0 }]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!supplierId || busy || !canWrite) return;
    const validLines = lines.filter((l) => l.itemId && l.quantity > 0 && l.costMinor >= 0);
    if (validLines.length === 0) {
      setError("Add at least one line with an item, quantity, and cost.");
      return;
    }
    setBusy(true); setError(null);
    try {
      const queue = getOfflineQueue();
      const mutation = queue.build({
        businessId: session.businessId,
        branchId: session.branchId,
        mutationType: "PURCHASE_RECEIVE_CREATE",
        payload: {
          supplierId,
          currencyCode,
          lines: validLines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, costMinor: l.costMinor })),
        },
      });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      bump(); onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post purchase receipt.");
    } finally { setBusy(false); }
  };

  const noSuppliers = suppliers.length === 0;

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet tos-sheet--wide" role="dialog" aria-label="Record purchase receipt">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Purchases</span>
            <h2 className="tos-sheet__title">Record purchase receipt</h2>
            <p className="tos-sheet__sub">Receives stock and updates the cashbook. Costs are server-authoritative.</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close"><IconClose style={{ width: 18, height: 18 }} /></button>
        </div>
        <div className="tos-sheet__body">
          {/* Server-authoritative framing */}
          <div className="tos-callout tos-callout--info">
            <span className="tos-callout__icon-wrap" aria-hidden="true">
              <IconShield style={{ width: 16, height: 16 }} />
            </span>
            <span className="tos-callout__body">
              Each line receives stock at the unit cost you enter. The receipt total, inventory valuation layer, and cashbook movement are all computed server-side on posting.
              <span className="tos-callout__sub"> The settlement method (cash / credit) is derived from the supplier&apos;s terms — the server chooses, not the client.</span>
            </span>
          </div>

          {/* Supplier picker */}
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="pr-supplier">Supplier<span className="tos-field__label-required">*</span></label>
            {noSuppliers ? (
              <div className="tos-banner tos-banner--warning">
                <span className="tos-banner__title">No suppliers on file.</span>
                <a className="tos-banner__action" href="/purchases">Add a supplier first →</a>
              </div>
            ) : (
              <select id="pr-supplier" className="tos-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={!canWrite}>
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>

          {/* Line items — premium receipt builder lines */}
          <div className="tos-section">
            <div className="tos-section__head">
              <h3 className="tos-section__title">Line items</h3>
              <span className="tos-section__sub">{validLineCount} of {lines.length} valid</span>
            </div>
            <div className="tos-section__body tos-stack">
              {lines.map((line, idx) => {
                const lineTotalMinor = line.costMinor * line.quantity;
                const selected = activeCatalog.find((c) => c.id === line.itemId);
                return (
                  <div key={idx} className="tos-receipt-builder-line">
                    <div className="tos-receipt-builder-line__head">
                      <span className="tos-receipt-builder-line__index">
                        <span className="tos-receipt-builder-line__index-num">{idx + 1}</span>
                        Line {idx + 1}
                      </span>
                      {lines.length > 1 ? (
                        <button
                          type="button"
                          className="tos-receipt-builder-line__remove"
                          onClick={() => removeLine(idx)}
                          aria-label={`Remove line ${idx + 1}`}
                        >
                          <IconTrash style={{ width: 14, height: 14 }} />
                        </button>
                      ) : null}
                    </div>
                    <div className="tos-public__form-row">
                      <div className="tos-field">
                        <label className="tos-field__label" htmlFor={`pr-item-${idx}`}>Item</label>
                        <select
                          id={`pr-item-${idx}`}
                          className="tos-select"
                          value={line.itemId}
                          onChange={(e) => setLine(idx, { itemId: e.target.value })}
                          disabled={!canWrite}
                        >
                          <option value="">Select…</option>
                          {activeCatalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                      <div className="tos-field">
                        <label className="tos-field__label" htmlFor={`pr-qty-${idx}`}>Quantity</label>
                        <input
                          id={`pr-qty-${idx}`}
                          type="number"
                          min={1}
                          step="any"
                          className="tos-input"
                          value={line.quantity}
                          onChange={(e) => setLine(idx, { quantity: Math.max(1, Number(e.target.value)) })}
                          disabled={!canWrite}
                        />
                      </div>
                    </div>
                    <MoneyInput
                      currencyCode={currencyCode}
                      valueMinor={line.costMinor}
                      onChange={(v) => setLine(idx, { costMinor: v ?? 0 })}
                      label="Unit cost"
                      disabled={!canWrite}
                    />
                    {selected ? (
                      <div className="tos-receipt-builder-line__preview">
                        <span className="tos-receipt-builder-line__preview-label">
                          Line {idx + 1} · {line.quantity} × {selected.saleUnitCode}
                        </span>
                        <span className="tos-receipt-builder-line__preview-val">
                          <MoneyValue minor={lineTotalMinor} currencyCode={currencyCode} />
                        </span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <Button variant="outline" size="sm" icon={<IconPlus className="tos-btn__icon" />} onClick={addLine} disabled={!canWrite}>Add line</Button>
            </div>
          </div>

          {/* Receipt total — gold-tinted summary card */}
          <div className="tos-checkout-summary">
            <span className="tos-checkout-summary__total-key">Receipt total</span>
            <span className="tos-checkout-summary__total-val"><MoneyValue minor={totalMinor} currencyCode={currencyCode} /></span>
          </div>
          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
        </div>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={!canWrite || !supplierId || noSuppliers}>
            {canWrite ? "Post receipt" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
