"use client";

import { useEffect, useMemo, useState } from "react";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconClose } from "../ui/icons";
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
            <h2 className="tos-sheet__title">{purchaseId.slice(0, 8)}</h2>
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
            <>
              <section className="tos-section">
                <div className="tos-section__head">
                  <h3 className="tos-section__title">Purchase summary</h3>
                  <span className={`tos-badge ${data.purchase.status === "RECEIVED" ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                    <span className="tos-badge__dot" />{data.purchase.status}
                  </span>
                </div>
                <div className="tos-section__body--padded">
                  <dl className="tos-kv">
                    <div><dt className="tos-kv__key">Supplier</dt><dd className="tos-kv__val">{data.purchase.supplierName}</dd></div>
                    <div><dt className="tos-kv__key">Reference</dt><dd className="tos-kv__val tos-table__mono">{data.purchase.supplierReference ?? "—"}</dd></div>
                    <div><dt className="tos-kv__key">Settlement</dt><dd className="tos-kv__val">{data.purchase.settlementMethod}</dd></div>
                    <div><dt className="tos-kv__key">Currency</dt><dd className="tos-kv__val">{data.purchase.currencyCode}</dd></div>
                    <div><dt className="tos-kv__key">Received</dt><dd className="tos-kv__val">{data.purchase.receivedAt ? new Date(data.purchase.receivedAt).toLocaleString() : "—"}</dd></div>
                    <div><dt className="tos-kv__key">Receiver</dt><dd className="tos-kv__val">{data.purchase.receiverName ?? "—"}</dd></div>
                    <div><dt className="tos-kv__key">Total</dt><dd className="tos-kv__val"><MoneyValue minor={data.purchase.totalMinor} currencyCode={currency} size="lg" /></dd></div>
                  </dl>
                </div>
              </section>

              <section className="tos-section">
                <div className="tos-section__head">
                  <h3 className="tos-section__title">Line items</h3>
                  <span className="tos-section__sub">{data.lines.length} line(s)</span>
                </div>
                <div className="tos-section__body">
                  {data.lines.length === 0 ? (
                    <StatePanel inline variant="empty" title="No lines" text="This purchase has no line items." />
                  ) : (
                    <div className="tos-table-wrap">
                      <div className="tos-table-scroll">
                        <table className="tos-table">
                          <thead>
                            <tr>
                              <th>Item</th>
                              <th>Unit</th>
                              <th data-align="right">Qty</th>
                              <th data-align="right">Unit cost</th>
                              <th data-align="right">Line cost</th>
                              <th data-align="right">Returned</th>
                              <th data-align="right">Remaining</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.lines.map((line) => (
                              <tr key={line.id}>
                                <td>
                                  <div className="tos-table__cell-main">
                                    <span className="tos-table__cell-title">{line.itemName}</span>
                                  </div>
                                </td>
                                <td className="tos-table__muted">{line.purchaseUnitCode}</td>
                                <td data-align="right" className="tos-table__num">{line.purchaseQuantity}</td>
                                <td data-align="right" className="tos-table__num">
                                  <MoneyValue minor={line.unitCostMinor} currencyCode={currency} tone="muted" />
                                </td>
                                <td data-align="right" className="tos-table__num">
                                  <MoneyValue minor={line.lineCostMinor} currencyCode={currency} />
                                </td>
                                <td data-align="right" className="tos-table__muted">{line.returnedQuantity}</td>
                                <td data-align="right" className="tos-table__num">{line.remainingQuantity}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section className="tos-section">
                <div className="tos-section__head">
                  <h3 className="tos-section__title">Return history</h3>
                  <span className="tos-section__sub">{data.returns.length} case(s)</span>
                </div>
                <div className="tos-section__body">
                  {data.returns.length === 0 ? (
                    <StatePanel inline variant="empty" title="No returns" text="This purchase has not had any returns posted." />
                  ) : (
                    <div className="tos-table-wrap">
                      <div className="tos-table-scroll">
                        <table className="tos-table">
                          <thead>
                            <tr>
                              <th>Recovery</th>
                              <th data-align="right">Supplier recovery</th>
                              <th data-align="right">Inventory value removed</th>
                              <th data-align="right">Price variance</th>
                              <th>Date</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.returns.map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <span className="tos-badge tos-badge--neutral"><span className="tos-badge__dot" />{r.recoveryMethod}</span>
                                </td>
                                <td data-align="right" className="tos-table__num">
                                  <MoneyValue minor={r.supplierRecoveryMinor} currencyCode={currency} tone="positive" />
                                </td>
                                <td data-align="right" className="tos-table__num">
                                  <MoneyValue minor={r.inventoryValueRemovedMinor} currencyCode={currency} tone="negative" />
                                </td>
                                <td data-align="right" className="tos-table__num">
                                  <MoneyValue minor={r.purchasePriceVarianceMinor} currencyCode={currency} tone={r.purchasePriceVarianceMinor < 0 ? "negative" : "muted"} />
                                </td>
                                <td className="tos-table__muted">{new Date(r.occurredAt).toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {returnOpen && session ? (
                <PurchaseReturnForm
                  purchase={data.purchase}
                  lines={data.lines}
                  currencyCode={currency}
                  onCancel={() => setReturnOpen(false)}
                  onSubmit={async (payload) => {
                    const queue = getOfflineQueue();
                    const mutation = queue.build({
                      businessId: session.businessId,
                      branchId: session.branchId,
                      mutationType: PURCHASE_RETURN_CREATE_TYPE,
                      payload,
                    });
                    await queue.enqueue(mutation);
                    await queue.flush({
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
            </>
          ) : null}
        </div>

        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {data && canReturn ? (
            <Button variant="outline" onClick={() => setReturnOpen((v) => !v)} disabled={data.lines.length === 0}>
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

  return (
    <section className="tos-section">
      <div className="tos-section__head">
        <h3 className="tos-section__title">Return to supplier</h3>
        <span className="tos-section__sub">Server-authoritative</span>
      </div>
      <div className="tos-section__body--padded tos-stack">
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="pr-recovery">Recovery method</label>
          <select
            id="pr-recovery"
            className="tos-select"
            value={recoveryMethod}
            onChange={(e) => setRecoveryMethod(e.target.value as CatalogRecoveryMethod)}
          >
            <option value="CREDIT_NOTE">Credit note (reduce payable)</option>
            <option value="CASH">Cash refund</option>
            <option value="MOMO">Mobile money refund</option>
            <option value="BANK">Bank refund</option>
            <option value="CARD">Card refund</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div className="tos-table-wrap">
          <div className="tos-table-scroll">
            <table className="tos-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th data-align="right">Returnable</th>
                  <th data-align="right">Return qty</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {returnableLines.map((line) => {
                  const qty = quantities[line.id] ?? 0;
                  return (
                    <tr key={line.id}>
                      <td>
                        <div className="tos-table__cell-main">
                          <span className="tos-table__cell-title">{line.itemName}</span>
                          <span className="tos-table__cell-sub">{line.purchaseUnitCode} · stock {line.stockUnitCode}</span>
                        </div>
                      </td>
                      <td data-align="right" className="tos-table__muted">{line.remainingQuantity}</td>
                      <td data-align="right">
                        <input
                          type="number"
                          min={0}
                          max={line.remainingQuantity}
                          step="any"
                          className="tos-input"
                          style={{ width: 96, textAlign: "right" }}
                          value={qty}
                          onChange={(e) => {
                            const v = Math.max(0, Math.min(line.remainingQuantity, Number(e.target.value)));
                            setQuantities((p) => ({ ...p, [line.id]: v }));
                          }}
                        />
                      </td>
                      <td>
                        <select
                          className="tos-select"
                          style={{ width: "auto", height: 36 }}
                          value={sourceLocation[line.id] ?? "AVAILABLE"}
                          onChange={(e) => setSourceLocation((p) => ({ ...p, [line.id]: e.target.value as "AVAILABLE" | "QUARANTINE" }))}
                        >
                          <option value="AVAILABLE">Available</option>
                          <option value="QUARANTINE">Quarantine</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="tos-callout tos-callout--info">
          The supplier recovery amount, inventory value removed and purchase-price variance are computed by the server from the purchase line costs and the inventory valuation layer. They are never sent by the client.
        </div>

        {note ? <span className="tos-field__hint">Note: the server does not currently persist a note on PURCHASE_RETURN_CREATE; it is not sent.</span> : null}
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="pr-note">Note (optional, not persisted)</label>
          <textarea id="pr-note" className="tos-textarea" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}

        <div className="tos-row tos-row--between">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={!canSubmit}>
            Queue return ({selectedLines.length} line{selectedLines.length === 1 ? "" : "s"})
          </Button>
        </div>
      </div>
    </section>
  );
}
