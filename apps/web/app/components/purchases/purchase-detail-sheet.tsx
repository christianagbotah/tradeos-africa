"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconCalendar, IconClose, IconPurchases, IconReceipt, IconReturns, IconShield, IconWallet } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import {
  buildPurchaseReturnPayload,
  PURCHASE_RETURN_CREATE_TYPE,
  PURCHASE_RETURN_ROLES,
  roleCan,
  type CatalogRecoveryMethod,
  type WorkspaceRole,
} from "../../../lib/mutation-builders";

interface PurchaseDetailLine {
  id: string;
  itemId: string;
  itemName: string;
  purchaseUnitCode: string;
  purchaseQuantity: number;
  stockUnitCode: string;
  stockQuantity: number;
  unitCostMinor: number;
  lineCostMinor: number;
  returnedQuantity: number;
  remainingQuantity: number;
  returnedRecoveryMinor: number;
}

interface PurchaseReturnCase {
  id: string;
  recoveryMethod: string;
  supplierRecoveryMinor: number;
  inventoryValueRemovedMinor: number;
  purchasePriceVarianceMinor: number;
  occurredAt: string;
}

interface PurchaseDetail {
  purchase: {
    id: string;
    businessId: string;
    branchId: string;
    supplierId: string;
    supplierName: string;
    supplierReference: string | null;
    status: string;
    currencyCode: string;
    totalMinor: number;
    settlementMethod: string;
    receivedAt: string | null;
    receiverName: string | null;
  };
  lines: ReadonlyArray<PurchaseDetailLine>;
  returns: ReadonlyArray<PurchaseReturnCase>;
}

interface PurchaseDetailSheetProps {
  purchaseId: string | null;
  onClose: () => void;
  /** Called after a successful PURCHASE_RETURN_CREATE enqueue so the parent can refresh. */
  onMutated?: () => void;
}

type StatIconTone = "gold" | "positive" | "warning" | "midnight" | "neutral";

const STAT_TILE_CLASS: Record<StatIconTone, string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

interface RecoveryOption {
  value: CatalogRecoveryMethod;
  label: string;
  hint: string;
}

const RECOVERY_OPTIONS: ReadonlyArray<RecoveryOption> = [
  { value: "CREDIT_NOTE", label: "Credit note", hint: "Reduce supplier payable" },
  { value: "CASH", label: "Cash refund", hint: "Cash out from till" },
  { value: "MOMO", label: "Mobile money", hint: "MoMo reversal" },
  { value: "BANK", label: "Bank refund", hint: "Bank transfer back" },
  { value: "CARD", label: "Card refund", hint: "Card reversal" },
  { value: "OTHER", label: "Other", hint: "Custom recovery" },
];

/**
 * Server-authoritative purchase detail sheet.
 *
 * Fetches `GET /v1/purchases/:purchaseId?businessId=X` and renders the
 * purchase header, line items (with returned/remaining quantities), and the
 * return history. All money is shown via `MoneyValue` which uses `formatMoney`
 * from `@tradeos/contracts` — no client-side `/100` shortcuts.
 *
 * Provides a "Return to supplier" action that enqueues a
 * PURCHASE_RETURN_CREATE mutation. The return payload is built by the pure
 * `buildPurchaseReturnPayload` helper and contains only fields the server
 * reads — never any server-authoritative amount (supplier recovery, inventory
 * value removed, price variance) and never `returnedByStaffId` (server-enriched).
 */
export function PurchaseDetailSheet({ purchaseId, onClose, onMutated }: PurchaseDetailSheetProps) {
  const { session, role, bump } = useWorkspace();
  const path = purchaseId && session
    ? `/v1/purchases/${encodeURIComponent(purchaseId)}?businessId=${encodeURIComponent(session.businessId)}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<PurchaseDetail>(path);

  const [returnOpen, setReturnOpen] = useState(false);

  useEffect(() => {
    if (!purchaseId) return;
    setReturnOpen(false);
    if (typeof document !== "undefined") {
      document.body.style.overflow = "hidden";
    }
    return () => {
      if (typeof document !== "undefined") {
        document.body.style.overflow = "";
      }
    };
  }, [purchaseId]);

  if (!purchaseId) return null;

  const canReturn = roleCan(role as WorkspaceRole, PURCHASE_RETURN_ROLES);
  const currency = data?.purchase.currencyCode ?? session?.currencyCode ?? "GHS";

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet tos-sheet--wide" role="dialog" aria-label="Purchase detail">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Purchase</span>
            <h2 className="tos-sheet__title">#{purchaseId.slice(0, 8)}</h2>
            <p className="tos-sheet__sub">Server-authoritative purchase record</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close purchase detail">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div className="tos-sheet__body">
          {loading ? (
            <StatePanel inline variant="loading" title="Loading purchase…" />
          ) : error ? (
            <StatePanel
              inline
              variant="error"
              title="Could not load purchase"
              text={error}
              actionLabel="Retry"
              onAction={() => refetch()}
            />
          ) : data ? (
            <PurchaseDetailBody
              detail={data}
              currency={currency}
              canReturn={canReturn}
              returnOpen={returnOpen}
              onToggleReturn={() => setReturnOpen((v) => !v)}
              onSubmitReturn={async (payload) => {
                if (!session) return;
                const queue = getOfflineQueue();
                const mutation = queue.build({
                  businessId: session.businessId,
                  branchId: session.branchId,
                  mutationType: PURCHASE_RETURN_CREATE_TYPE,
                  payload,
                });
                await queue.enqueue(mutation);
                await queue.flushOrThrow({
                  activeBusinessId: session.businessId,
                  online: typeof navigator !== "undefined" ? navigator.onLine : true,
                });
                bump();
                onMutated?.();
                setReturnOpen(false);
                refetch();
              }}
            />
          ) : null}
        </div>

        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {data && canReturn ? (
            <Button variant="outline" icon={<IconReturns className="tos-btn__icon" />} onClick={() => setReturnOpen((v) => !v)} disabled={data.lines.length === 0}>
              {returnOpen ? "Cancel return" : "Return to supplier"}
            </Button>
          ) : null}
          {!canReturn ? (
            <span className="tos-section__sub">Returns require {PURCHASE_RETURN_ROLES.join(", ")} role.</span>
          ) : null}
        </div>
      </div>
    </>
  );
}


function PurchaseDetailBody({
  detail,
  currency,
  canReturn,
  returnOpen,
  onToggleReturn,
  onSubmitReturn,
}: {
  detail: PurchaseDetail;
  currency: string;
  canReturn: boolean;
  returnOpen: boolean;
  onToggleReturn: () => void;
  onSubmitReturn: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const { purchase, lines, returns } = detail;
  const receivedLabel = purchase.receivedAt ? new Date(purchase.receivedAt).toLocaleString() : "—";
  const totalReturnedMinor = returns.reduce((sum, r) => sum + r.supplierRecoveryMinor, 0);

  return (
    <>
      {/* Purchase hero — midnight gradient + gold accent */}
      <div className="tos-purchase-hero tos-animate-fade-in-up">
        <div className="tos-purchase-hero__head">
          <div className="tos-purchase-hero__head-main">
            <span className="tos-purchase-hero__eyebrow">Receipt #{purchase.id.slice(0, 8)}</span>
            <h3 className="tos-purchase-hero__title">{purchase.supplierName}</h3>
            <p className="tos-purchase-hero__sub">
              {purchase.supplierReference ? `Ref ${purchase.supplierReference} · ` : ""}
              {receivedLabel}
              {purchase.receiverName ? ` · ${purchase.receiverName}` : ""}
            </p>
          </div>
          <span className={`tos-badge ${purchase.status === "RECEIVED" ? "tos-badge--positive" : "tos-badge--neutral"}`}>
            <span className="tos-badge__dot" />{purchase.status}
          </span>
        </div>
        <div className="tos-purchase-hero__total-row">
          <span className="tos-purchase-hero__total-label">Receipt total</span>
          <span className="tos-purchase-hero__total">
            <MoneyValue minor={purchase.totalMinor} currencyCode={currency} />
          </span>
          <span className="tos-purchase-hero__currency">{purchase.currencyCode} · {purchase.settlementMethod}</span>
        </div>
      </div>

      {/* 3-up stats — lines / total returned / settlement */}
      <div className="tos-purchase-stats tos-animate-fade-in-up">
        <PurchaseStat
          label="Lines"
          icon={<IconReceipt className="tos-stat__icon-tile-svg" />}
          iconTone="midnight"
          value={<span className="tos-stat__value">{lines.length}</span>}
          hint="Items received"
        />
        <PurchaseStat
          label="Returned"
          icon={<IconWallet className="tos-stat__icon-tile-svg" />}
          iconTone={totalReturnedMinor > 0 ? "warning" : "positive"}
          value={<MoneyValue minor={totalReturnedMinor} currencyCode={currency} className="tos-stat__value" />}
          hint={returns.length > 0 ? `${returns.length} return case(s)` : "No returns"}
          hintTone={returns.length > 0 ? "warning" : "positive"}
        />
        <PurchaseStat
          label="Settlement"
          icon={<IconPurchases className="tos-stat__icon-tile-svg" />}
          iconTone="neutral"
          value={<span className="tos-stat__value">{purchase.settlementMethod}</span>}
          hint={purchase.receiverName ?? "No receiver"}
        />
      </div>

      {/* Purchase summary kv */}
      <div className="tos-section tos-animate-fade-in-up">
        <div className="tos-section__head">
          <h3 className="tos-section__title">Purchase summary</h3>
          <span className="tos-section__sub">{purchase.currencyCode}</span>
        </div>
        <div className="tos-section__body--padded">
          <dl className="tos-kv">
            <div><dt className="tos-kv__key">Receipt no.</dt><dd className="tos-kv__val tos-table__mono">{purchase.id}</dd></div>
            <div><dt className="tos-kv__key">Supplier</dt><dd className="tos-kv__val">{purchase.supplierName}</dd></div>
            <div><dt className="tos-kv__key">Reference</dt><dd className="tos-kv__val tos-table__mono">{purchase.supplierReference ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Settlement</dt><dd className="tos-kv__val">{purchase.settlementMethod}</dd></div>
            <div><dt className="tos-kv__key">Received</dt><dd className="tos-kv__val">{receivedLabel}</dd></div>
            <div><dt className="tos-kv__key">Receiver</dt><dd className="tos-kv__val">{purchase.receiverName ?? "—"}</dd></div>
          </dl>
        </div>
      </div>

      {/* Line items — clean bordered list with returned/remaining chips */}
      <div className="tos-section tos-animate-fade-in-up">
        <div className="tos-section__head">
          <h3 className="tos-section__title">Line items</h3>
          <span className="tos-section__sub">{lines.length} line(s)</span>
        </div>
        <div className="tos-section__body">
          {lines.length === 0 ? (
            <StatePanel inline variant="empty" title="No lines" text="This purchase has no line items." />
          ) : (
            <div className="tos-purchase-lines">
              {lines.map((line) => (
                <div key={line.id} className="tos-purchase-line">
                  <div className="tos-purchase-line__main">
                    <span className="tos-purchase-line__title">{line.itemName}</span>
                    <span className="tos-purchase-line__sub">
                      {line.purchaseQuantity} × {line.purchaseUnitCode} · stock {line.stockQuantity} {line.stockUnitCode}
                    </span>
                    <div className="tos-purchase-line__chips">
                      {line.returnedQuantity > 0 ? (
                        <span className="tos-purchase-line__chip tos-purchase-line__chip--returned">
                          {line.returnedQuantity} returned
                        </span>
                      ) : null}
                      <span className="tos-purchase-line__chip tos-purchase-line__chip--remaining">
                        {line.remainingQuantity} remaining
                      </span>
                    </div>
                  </div>
                  <div className="tos-purchase-line__cost">
                    <MoneyValue minor={line.lineCostMinor} currencyCode={currency} className="tos-purchase-line__line-cost" />
                    <span className="tos-purchase-line__unit-cost">
                      @ <MoneyValue minor={line.unitCostMinor} currencyCode={currency} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Return history — server-authoritative recovery / inventory / variance */}
      <div className="tos-section tos-animate-fade-in-up">
        <div className="tos-section__head">
          <h3 className="tos-section__title">Return history</h3>
          <span className="tos-section__sub">{returns.length} case(s) · server-authoritative</span>
        </div>
        <div className="tos-section__body">
          {returns.length === 0 ? (
            <StatePanel inline variant="empty" title="No returns" text="This purchase has not had any returns posted." />
          ) : (
            <div className="tos-purchase-lines">
              {returns.map((r) => (
                <div key={r.id} className="tos-return-case">
                  <div className="tos-return-case__main">
                    <div className="tos-return-case__head">
                      <span className="tos-badge tos-badge--neutral"><span className="tos-badge__dot" />{r.recoveryMethod}</span>
                      <span className="tos-return-case__date">{new Date(r.occurredAt).toLocaleString()}</span>
                    </div>
                    <div className="tos-return-case__impacts">
                      <div className="tos-return-case__impact">
                        <span className="tos-return-case__impact-label">Supplier recovery</span>
                        <span className="tos-return-case__impact-val tos-return-case__impact-val--positive">
                          +<MoneyValue minor={r.supplierRecoveryMinor} currencyCode={currency} />
                        </span>
                      </div>
                      <div className="tos-return-case__impact">
                        <span className="tos-return-case__impact-label">Inventory value removed</span>
                        <span className="tos-return-case__impact-val tos-return-case__impact-val--negative">
                          −<MoneyValue minor={r.inventoryValueRemovedMinor} currencyCode={currency} />
                        </span>
                      </div>
                      <div className="tos-return-case__impact">
                        <span className="tos-return-case__impact-label">Purchase-price variance</span>
                        <span className={
                          r.purchasePriceVarianceMinor < 0
                            ? "tos-return-case__impact-val tos-return-case__impact-val--negative"
                            : "tos-return-case__impact-val tos-return-case__impact-val--muted"
                        }>
                          <MoneyValue minor={r.purchasePriceVarianceMinor} currencyCode={currency} />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Immutable-evidence callout */}
      <div className="tos-callout tos-callout--info">
        <span className="tos-callout__icon-wrap" aria-hidden="true">
          <IconShield style={{ width: 16, height: 16 }} />
        </span>
        <span className="tos-callout__body">
          Posted purchases are immutable business evidence. Corrections are made via returns to supplier — never by editing the original receipt.
          <span className="tos-callout__sub"> The supplier recovery, inventory value removed, and purchase-price variance are computed server-side from the purchase line costs and the inventory valuation layer.</span>
        </span>
      </div>

      <div className="tos-callout">
        <span style={{ display: "flex", alignItems: "center", gap: "var(--tos-space-2)" }}>
          <IconCalendar style={{ width: 14, height: 14 }} />
          Received {receivedLabel}
        </span>
      </div>

      {returnOpen && canReturn ? (
        <PurchaseReturnForm
          purchase={purchase}
          lines={lines}
          currencyCode={currency}
          onCancel={onToggleReturn}
          onSubmit={onSubmitReturn}
        />
      ) : null}
    </>
  );
}

// --- Purchase return form (PURCHASE_RETURN_CREATE) ----------------------

interface PurchaseReturnFormProps {
  purchase: PurchaseDetail["purchase"];
  lines: ReadonlyArray<PurchaseDetailLine>;
  currencyCode: string;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

function PurchaseReturnForm({ purchase, lines, currencyCode, onCancel, onSubmit }: PurchaseReturnFormProps) {
  const returnableLines = useMemo(() => lines.filter((l) => l.remainingQuantity > 0), [lines]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [sourceLocation, setSourceLocation] = useState<Record<string, "AVAILABLE" | "QUARANTINE">>({});
  const [recoveryMethod, setRecoveryMethod] = useState<CatalogRecoveryMethod>("CREDIT_NOTE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initQty: Record<string, number> = {};
    const initLoc: Record<string, "AVAILABLE" | "QUARANTINE"> = {};
    for (const line of returnableLines) {
      initQty[line.id] = 0;
      initLoc[line.id] = "AVAILABLE";
    }
    setQuantities(initQty);
    setSourceLocation(initLoc);
  }, [returnableLines]);

  const selectedLines = returnableLines
    .map((l) => ({
      purchaseLineId: l.id,
      quantity: quantities[l.id] ?? 0,
      sourceLocation: sourceLocation[l.id] ?? "AVAILABLE",
    }))
    .filter((l) => l.quantity > 0);

  const canSubmit = selectedLines.length > 0 && !busy;
  const selectedQtyTotal = selectedLines.reduce((sum, l) => sum + l.quantity, 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const payload = buildPurchaseReturnPayload({
        originalPurchaseId: purchase.id,
        supplierId: purchase.supplierId,
        recoveryMethod,
        lines: selectedLines,
      });
      // Note field — the server does not currently read a note on
      // PURCHASE_RETURN_CREATE, so we do NOT include it (server-expected
      // fields only). The recoveryMethod + selected lines drive the audit.
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enqueue purchase return.");
    } finally {
      setBusy(false);
    }
  };

  if (returnableLines.length === 0) {
    return (
      <div className="tos-callout tos-callout--warning">
        <strong>Nothing to return.</strong> All lines have been fully returned.
      </div>
    );
  }

  const activeRecovery = RECOVERY_OPTIONS.find((r) => r.value === recoveryMethod);

  return (
    <section className="tos-section">
      <div className="tos-section__head">
        <h3 className="tos-section__title">Return to supplier</h3>
        <span className="tos-section__sub">Server-authoritative</span>
      </div>
      <div className="tos-section__body--padded tos-stack">
        {/* Recovery method — visual chip grid */}
        <div className="tos-field">
          <label className="tos-field__label">Recovery method<span className="tos-field__label-required">*</span></label>
          <div className="tos-recovery-grid" role="radiogroup" aria-label="Recovery method">
            {RECOVERY_OPTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                className="tos-recovery-chip"
                aria-pressed={recoveryMethod === r.value}
                role="radio"
                aria-checked={recoveryMethod === r.value}
                onClick={() => setRecoveryMethod(r.value)}
                disabled={busy}
              >
                <span className="tos-recovery-chip__label">{r.label}</span>
                <span className="tos-recovery-chip__hint">{r.hint}</span>
              </button>
            ))}
          </div>
          <span className="tos-field__hint">{activeRecovery ? activeRecovery.hint : ""}</span>
        </div>

        {/* Returnable lines — premium bordered rows with qty input */}
        <div className="tos-purchase-lines">
          {returnableLines.map((line) => {
            const qty = quantities[line.id] ?? 0;
            return (
              <div key={line.id} className="tos-purchase-return-line">
                <div className="tos-purchase-return-line__main">
                  <span className="tos-purchase-return-line__title">{line.itemName}</span>
                  <span className="tos-purchase-return-line__sub">
                    {line.purchaseUnitCode} · stock {line.stockUnitCode} · {line.remainingQuantity} returnable
                  </span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={line.remainingQuantity}
                  step="any"
                  className="tos-input tos-purchase-return-line__qty-input"
                  value={qty}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(line.remainingQuantity, Number(e.target.value)));
                    setQuantities((p) => ({ ...p, [line.id]: v }));
                  }}
                  disabled={busy}
                  aria-label={`Return quantity for ${line.itemName}`}
                />
                <div className="tos-purchase-return-line__loc">
                  <select
                    className="tos-select"
                    style={{ width: "auto", height: 36 }}
                    value={sourceLocation[line.id] ?? "AVAILABLE"}
                    onChange={(e) => setSourceLocation((p) => ({ ...p, [line.id]: e.target.value as "AVAILABLE" | "QUARANTINE" }))}
                    disabled={busy}
                    aria-label={`Source location for ${line.itemName}`}
                  >
                    <option value="AVAILABLE">Available</option>
                    <option value="QUARANTINE">Quarantine</option>
                  </select>
                </div>
              </div>
            );
          })}
        </div>

        {/* Server-authoritative framing */}
        <div className="tos-callout tos-callout--info">
          <span className="tos-callout__icon-wrap" aria-hidden="true">
            <IconShield style={{ width: 16, height: 16 }} />
          </span>
          <span className="tos-callout__body">
            The supplier recovery amount, inventory value removed and purchase-price variance are computed by the server from the purchase line costs and the inventory valuation layer. They are never sent by the client.
            <span className="tos-callout__sub"> Choose &quot;Available&quot; or &quot;Quarantine&quot; to tell the server which stock location to remove the units from.</span>
          </span>
        </div>

        <div className="tos-field">
          <label className="tos-field__label" htmlFor="pr-note">Note (optional, not persisted)</label>
          <textarea id="pr-note" className="tos-textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          <span className="tos-field__hint">The server does not currently persist a note on PURCHASE_RETURN_CREATE; it is not sent.</span>
        </div>

        {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}

        <div className="tos-row tos-row--between">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={!canSubmit}>
            Queue return ({selectedLines.length} line{selectedLines.length === 1 ? "" : "s"} · {selectedQtyTotal} unit{selectedQtyTotal === 1 ? "" : "s"})
          </Button>
        </div>
      </div>
    </section>
  );
}

// --- Purchase stat card (reuses tos-stat + tos-stat__icon-tile) ----------

interface PurchaseStatProps {
  label: string;
  icon: ReactNode;
  iconTone: StatIconTone;
  value: ReactNode;
  hint?: string;
  hintTone?: "default" | "warning" | "positive";
}

function PurchaseStat({ label, icon, iconTone, value, hint, hintTone = "default" }: PurchaseStatProps) {
  const hintCls = hintTone === "warning"
    ? "tos-stat__hint tos-stat__hint--warning"
    : hintTone === "positive"
      ? "tos-stat__hint tos-stat__hint--positive"
      : "tos-stat__hint";
  return (
    <div className="tos-stat tos-card-hover">
      <div className="tos-stat__head">
        <span className={STAT_TILE_CLASS[iconTone]} aria-hidden="true">
          {icon}
        </span>
        <span className="tos-stat__label">{label}</span>
      </div>
      {value}
      {hint ? <span className={hintCls}>{hint}</span> : null}
    </div>
  );
}
