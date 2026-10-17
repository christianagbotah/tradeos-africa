"use client";

import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";
import { IconClose, IconPlus, IconShield, IconTrash } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { purchasableUnits } from "../../../lib/catalog-read-model";
import {
  buildPurchaseReceivePayload,
  PURCHASE_RECEIVE_CREATE_TYPE,
  type PurchaseSettlementMethod,
} from "../../../lib/purchase-receipt-mutation";
import type { Supplier } from "./supplier-sheet";

interface PurchaseReceiptBuilderProps {
  open: boolean;
  suppliers: readonly Supplier[];
  onClose: () => void;
  onComplete: () => void;
}

interface ReceiptLine {
  itemId: string;
  purchaseUnitCode: string;
  quantity: number;
  costMinor: number;
}

const SETTLEMENT_METHODS: ReadonlyArray<{ value: PurchaseSettlementMethod; label: string }> = [
  { value: "SUPPLIER_CREDIT", label: "Supplier credit" },
  { value: "CASH", label: "Cash" },
  { value: "MOMO", label: "Mobile money" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

function preferredSettlementForSupplier(supplier: Supplier | undefined): PurchaseSettlementMethod {
  return (supplier?.paymentTermsDays ?? 0) > 0 ? "SUPPLIER_CREDIT" : "CASH";
}

export function PurchaseReceiptBuilder({ open, suppliers, onClose, onComplete }: PurchaseReceiptBuilderProps) {
  const { session, role, catalog, bump } = useWorkspace();
  const [supplierId, setSupplierId] = useState<string>("");
  const [settlementMethod, setSettlementMethod] = useState<PurchaseSettlementMethod>("CASH");
  const [supplierReference, setSupplierReference] = useState("");
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"].includes(role);

  useEffect(() => {
    if (open) {
      const initialSupplier = suppliers[0];
      setSupplierId(initialSupplier?.id ?? "");
      setSettlementMethod(preferredSettlementForSupplier(initialSupplier));
      setSupplierReference("");
      setLines([{ itemId: "", purchaseUnitCode: "", quantity: 1, costMinor: 0 }]);
      setBusy(false);
      setError(null);
    }
  }, [open, suppliers]);

  const activeCatalog = useMemo(
    () => catalog.filter((item) =>
      item.active
      && (item.kind === "PRODUCT" || item.kind === "PREPARED_PRODUCT")
      && purchasableUnits(item).length > 0,
    ),
    [catalog],
  );
  const currencyCode = session?.currencyCode ?? "GHS";

  if (!open || !session) return null;

  const totalMinor = lines.reduce((sum, line) => sum + (line.costMinor * line.quantity), 0);
  const validLineCount = lines.filter((line) =>
    line.itemId
    && line.purchaseUnitCode
    && line.quantity > 0
    && line.costMinor >= 0,
  ).length;

  const setLine = (idx: number, patch: Partial<ReceiptLine>) => {
    setLines((prev) => prev.map((line, i) => (i === idx ? { ...line, ...patch } : line)));
  };
  const addLine = () => setLines((prev) => [
    ...prev,
    { itemId: "", purchaseUnitCode: "", quantity: 1, costMinor: 0 },
  ]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const selectSupplier = (nextSupplierId: string) => {
    setSupplierId(nextSupplierId);
    setSettlementMethod(preferredSettlementForSupplier(suppliers.find((supplier) => supplier.id === nextSupplierId)));
  };

  const selectItem = (idx: number, itemId: string) => {
    const selected = activeCatalog.find((item) => item.id === itemId);
    setLine(idx, {
      itemId,
      purchaseUnitCode: selected ? (purchasableUnits(selected)[0]?.code ?? "") : "",
      costMinor: 0,
    });
  };

  const handleSubmit = async () => {
    if (!supplierId || busy || !canWrite) return;
    const validLines = lines.filter((line) =>
      line.itemId
      && line.purchaseUnitCode
      && line.quantity > 0
      && line.costMinor >= 0,
    );
    if (validLines.length === 0) {
      setError("Add at least one line with an item, purchase unit, quantity, and unit cost.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      const mutation = queue.build({
        businessId: session.businessId,
        branchId: session.branchId,
        mutationType: PURCHASE_RECEIVE_CREATE_TYPE,
        payload: buildPurchaseReceivePayload({
          supplierId,
          settlementMethod,
          supplierReference,
          lines: validLines.map((line) => ({
            itemId: line.itemId,
            purchaseUnitCode: line.purchaseUnitCode,
            quantity: line.quantity,
            unitCostMinor: line.costMinor,
          })),
        }),
      });
      await queue.enqueue(mutation);
      await queue.flushOrThrow({
        activeBusinessId: session.businessId,
        online: typeof navigator !== "undefined" ? navigator.onLine : true,
      });
      bump();
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post purchase receipt.");
    } finally {
      setBusy(false);
    }
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
            <p className="tos-sheet__sub">Receive stock and settle the supplier correctly in one guided step.</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <div className="tos-sheet__body">
          <div className="tos-callout tos-callout--info">
            <span className="tos-callout__icon-wrap" aria-hidden="true">
              <IconShield style={{ width: 16, height: 16 }} />
            </span>
            <span className="tos-callout__body">
              Choose how this receipt is settled and the unit actually purchased. TradeOS converts purchase units into stock units, updates valuation, supplier balance and cashbook automatically.
            </span>
          </div>

          <div className="tos-field">
            <label className="tos-field__label" htmlFor="pr-supplier">Supplier<span className="tos-field__label-required">*</span></label>
            {noSuppliers ? (
              <div className="tos-banner tos-banner--warning">
                <span className="tos-banner__title">No suppliers on file.</span>
                <a className="tos-banner__action" href="/purchases">Add a supplier first →</a>
              </div>
            ) : (
              <select
                id="pr-supplier"
                className="tos-select"
                value={supplierId}
                onChange={(event) => selectSupplier(event.target.value)}
                disabled={!canWrite}
              >
                <option value="">Select supplier…</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            )}
          </div>

          <div className="tos-field">
            <label className="tos-field__label" htmlFor="pr-settlement">Settlement method<span className="tos-field__label-required">*</span></label>
            <select
              id="pr-settlement"
              className="tos-select"
              value={settlementMethod}
              onChange={(event) => setSettlementMethod(event.target.value as PurchaseSettlementMethod)}
              disabled={!canWrite}
            >
              {SETTLEMENT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>{method.label}</option>
              ))}
            </select>
            <span className="tos-field__help">
              Supplier credit increases the amount payable. Cash and electronic methods use the branch&apos;s configured default money account.
            </span>
          </div>

          <div className="tos-field">
            <label className="tos-field__label" htmlFor="pr-reference">Supplier invoice / reference</label>
            <input
              id="pr-reference"
              className="tos-input"
              value={supplierReference}
              onChange={(event) => setSupplierReference(event.target.value)}
              placeholder="Optional invoice, receipt or delivery-note number"
              maxLength={500}
              disabled={!canWrite}
            />
          </div>

          <div className="tos-section">
            <div className="tos-section__head">
              <h3 className="tos-section__title">Line items</h3>
              <span className="tos-section__sub">{validLineCount} of {lines.length} valid</span>
            </div>
            <div className="tos-section__body tos-stack">
              {lines.map((line, idx) => {
                const lineTotalMinor = line.costMinor * line.quantity;
                const selected = activeCatalog.find((item) => item.id === line.itemId);
                const selectedUnit = selected?.units.find((unit) => unit.code === line.purchaseUnitCode);
                return (
                  <div key={idx} className="tos-receipt-line">
                    <span className="tos-receipt-line__num" aria-hidden="true">{idx + 1}</span>
                    <div className="tos-receipt-line__item tos-stack">
                      <select
                        id={`pr-item-${idx}`}
                        className="tos-select"
                        value={line.itemId}
                        onChange={(event) => selectItem(idx, event.target.value)}
                        disabled={!canWrite}
                        aria-label={`Line ${idx + 1} item`}
                      >
                        <option value="">Select item…</option>
                        {activeCatalog.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                      {selected ? (
                        <select
                          id={`pr-unit-${idx}`}
                          className="tos-select"
                          value={line.purchaseUnitCode}
                          onChange={(event) => setLine(idx, { purchaseUnitCode: event.target.value })}
                          disabled={!canWrite}
                          aria-label={`Line ${idx + 1} purchase unit`}
                        >
                          <option value="">Select purchase unit…</option>
                          {purchasableUnits(selected).map((unit) => (
                            <option key={unit.code} value={unit.code}>{unit.label} ({unit.code})</option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                    <input
                      id={`pr-qty-${idx}`}
                      className="tos-input tos-receipt-line__qty"
                      type="number"
                      min={0.000001}
                      step="any"
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) => setLine(idx, { quantity: Math.max(0, Number(event.target.value)) })}
                      disabled={!canWrite}
                      aria-label={`Line ${idx + 1} quantity`}
                    />
                    <div className="tos-receipt-line__cost">
                      <MoneyInput
                        currencyCode={currencyCode}
                        valueMinor={line.costMinor}
                        onChange={(value) => setLine(idx, { costMinor: value ?? 0 })}
                        disabled={!canWrite}
                        id={`pr-cost-${idx}`}
                        aria-label={`Line ${idx + 1} unit cost`}
                      />
                    </div>
                    <span
                      className="tos-receipt-line__total"
                      title={selectedUnit ? `${line.quantity} × ${selectedUnit.label}` : undefined}
                    >
                      <MoneyValue minor={lineTotalMinor} currencyCode={currencyCode} />
                      {selectedUnit ? (
                        <span className="tos-receipt-line__total-sub">{line.quantity} × {selectedUnit.label}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="tos-receipt-line__remove"
                      onClick={() => removeLine(idx)}
                      aria-label={`Remove line ${idx + 1}`}
                      disabled={lines.length === 1 || !canWrite}
                    >
                      <IconTrash style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                );
              })}
              <div className="tos-receipt-add">
                <Button
                  variant="outline"
                  size="sm"
                  icon={<IconPlus className="tos-btn__icon" />}
                  onClick={addLine}
                  disabled={!canWrite}
                >
                  Add line
                </Button>
              </div>
            </div>
          </div>

          <div className="tos-checkout-summary">
            <span className="tos-checkout-summary__total-key">Receipt total</span>
            <span className="tos-checkout-summary__total-val"><MoneyValue minor={totalMinor} currencyCode={currencyCode} /></span>
          </div>
          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
        </div>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={busy}
            disabled={!canWrite || !supplierId || noSuppliers || validLineCount === 0}
          >
            {canWrite ? "Post receipt" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
