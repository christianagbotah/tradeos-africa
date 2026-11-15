"use client";

import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";
import { IconClose, IconPlus, IconShield, IconTrash } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { purchasableUnits } from "../../../lib/catalog-read-model";
import { useApiFetch } from "../../../lib/use-api-fetch";
import {
  filterEligibleAccounts,
  isSelectionValid,
  resolveDefaultAccountId,
  type MoneyAccount as PaymentAccount,
  type MoneyAccountDefault,
} from "../../../lib/payment-account-selection";
import type { Supplier } from "./supplier-sheet";

interface PurchaseReceiptBuilderProps {
  open: boolean;
  suppliers: readonly Supplier[];
  /** When supplied, receive only outstanding lines against this issued PO. */
  purchaseOrderId?: string;
  onClose: () => void;
  onComplete: () => void;
}

type SettlementMethod = "SUPPLIER_CREDIT" | "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";

const SETTLEMENT_METHODS: ReadonlyArray<{ value: SettlementMethod; label: string }> = [
  { value: "SUPPLIER_CREDIT", label: "Supplier credit (pay later)" },
  { value: "CASH", label: "Cash" },
  { value: "MOMO", label: "Mobile money" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

interface ReceiptLine {
  itemId: string;
  purchaseUnitCode: string;
  purchaseOrderLineId?: string;
  remainingQuantity?: number;
  quantity: number;
  unitCostMinor: number;
}

const EMPTY_LINE: ReceiptLine = {
  itemId: "",
  purchaseUnitCode: "",
  quantity: 1,
  unitCostMinor: 0,
};

interface PurchaseOrderReadModel {
  order: {
    id:string;supplierId:string;orderNumber:string;status:string;canReceive:boolean;
    lines:Array<{id:string;itemId:string;purchaseUnitCode:string;
      unitCostMinor:number;remainingQuantity:number}>;
  };
}
export function PurchaseReceiptBuilder({ open, suppliers, purchaseOrderId, onClose, onComplete }: PurchaseReceiptBuilderProps) {
  const { session, role, catalog, bump } = useWorkspace();
  const [supplierId, setSupplierId] = useState<string>("");
  const [settlementMethod, setSettlementMethod] = useState<SettlementMethod>("SUPPLIER_CREDIT");
  const [moneyAccountId, setMoneyAccountId] = useState<string | null>(null);
  const [supplierReference, setSupplierReference] = useState("");
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"].includes(role);
  const currencyCode = session?.currencyCode ?? "GHS";
  const immediatePayment = settlementMethod !== "SUPPLIER_CREDIT";

  const accountsPath = open && session
    ? `/v1/money-accounts?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}`
    : null;
  const defaultsPath = open && session
    ? `/v1/money-account-defaults?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}`
    : null;
  const { data: accountsData, loading: accountsLoading } = useApiFetch<{ accounts: PaymentAccount[] }>(accountsPath);
  const { data: defaultsData } = useApiFetch<{ defaults: MoneyAccountDefault[] }>(defaultsPath);
  const poPath=open && session && purchaseOrderId
    ? `/v1/purchase-orders/${encodeURIComponent(purchaseOrderId)}?businessId=${encodeURIComponent(session.businessId)}`
    : null;
  const {data:poData,loading:poLoading,error:poError}=
    useApiFetch<PurchaseOrderReadModel>(poPath);
  const linkedOrder=poData?.order;

  const allAccounts = accountsData?.accounts ?? [];
  const defaults = defaultsData?.defaults ?? [];
  const eligibleAccounts = immediatePayment
    ? filterEligibleAccounts(allAccounts, settlementMethod, currencyCode)
    : [];
  const eligibleAccountKey = eligibleAccounts.map((account) => account.id).join("|");
  const defaultsKey = defaults.map((entry) => `${entry.method}:${entry.moneyAccountId}`).join("|");

  useEffect(() => {
    if (!open) return;
    setSupplierId(suppliers[0]?.id ?? "");
    setSettlementMethod("SUPPLIER_CREDIT");
    setMoneyAccountId(null);
    setSupplierReference("");
    setLines([{ ...EMPTY_LINE }]);
    setBusy(false);
    setError(null);
  }, [open, suppliers]);

  useEffect(() => {
    if (!open || !purchaseOrderId || !linkedOrder) return;
    setSupplierId(linkedOrder.supplierId);
    setLines(linkedOrder.lines.filter(line=>line.remainingQuantity>0).map(line=>({
      itemId:line.itemId,
      purchaseUnitCode:line.purchaseUnitCode,
      purchaseOrderLineId:line.id,
      remainingQuantity:line.remainingQuantity,
      quantity:0, // Explicit actual goods entry, never auto-post ordered quantity
      unitCostMinor:line.unitCostMinor,
    })));
  },[open,purchaseOrderId,linkedOrder]);

  useEffect(() => {
    if (!open) return;
    if (!immediatePayment) {
      if (moneyAccountId !== null) setMoneyAccountId(null);
      return;
    }
    if (accountsLoading) return;
    if (isSelectionValid(moneyAccountId, eligibleAccounts)) return;
    setMoneyAccountId(resolveDefaultAccountId(eligibleAccounts, defaults, settlementMethod));
  }, [
    open,
    immediatePayment,
    settlementMethod,
    accountsLoading,
    eligibleAccountKey,
    defaultsKey,
    moneyAccountId,
  ]); // eligible/default identities are intentionally represented by stable keys above.

  // Purchase receiving is inventory-only. Services and prepared products use
  // their own production/service workflows rather than creating stock receipts.
  const activeCatalog = useMemo(
    () => catalog.filter((item) => (
      item.active
      && item.kind === "PRODUCT"
      && item.trackStock
      && Boolean(item.stockUnitCode)
      && purchasableUnits(item).length > 0
    )),
    [catalog],
  );

  if (!open || !session) return null;

  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId) ?? null;
  const noMatchingAccount = immediatePayment && !accountsLoading && eligibleAccounts.length === 0;
  const poUnavailable=Boolean(purchaseOrderId)&&(poLoading || !linkedOrder ||
    !linkedOrder.canReceive || poError!==null);
  const poVariance=Boolean(purchaseOrderId)&&lines.some(line=>{
    const original=linkedOrder?.lines.find(l=>l.id===line.purchaseOrderLineId);
    return original&&line.quantity>0&&line.unitCostMinor!==original.unitCostMinor;
  });
  const totalMinor = lines.reduce((sum, line) => sum + (line.unitCostMinor * line.quantity), 0);
  const validLineCount = lines.filter((line) => (
    line.itemId
    && line.purchaseUnitCode
    && line.quantity > 0
    && line.unitCostMinor >= 0
  )).length;

  const setLine = (idx: number, patch: Partial<ReceiptLine>) => {
    setLines((prev) => prev.map((line, i) => (i === idx ? { ...line, ...patch } : line)));
  };

  const selectItem = (idx: number, itemId: string) => {
    const selected = activeCatalog.find((item) => item.id === itemId);
    const purchaseUnitCode = selected ? (purchasableUnits(selected)[0]?.code ?? "") : "";
    setLine(idx, { itemId, purchaseUnitCode });
  };

  const addLine = () => setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (!supplierId || busy || !canWrite || poUnavailable) return;
    const validLines = lines.filter((line) => (
      line.itemId
      && line.purchaseUnitCode
      && line.quantity > 0
      && line.unitCostMinor >= 0
      && (!purchaseOrderId || (Boolean(line.purchaseOrderLineId) &&
          line.quantity <= (line.remainingQuantity??0)))
    ));
    if (purchaseOrderId && lines.some(line=>line.quantity>(line.remainingQuantity??0))) {
      setError("Received quantity exceeds the outstanding amount on this purchase order.");
      return;
    }
    if (validLines.length === 0) {
      setError("Add at least one line with an item, purchase unit, quantity, and unit cost.");
      return;
    }
    if (immediatePayment && !moneyAccountId) {
      setError("Choose a money account for this payment method before posting the receipt.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      const mutation = queue.build({
        businessId: session.businessId,
        branchId: session.branchId,
        mutationType: "PURCHASE_RECEIVE_CREATE",
        payload: {
          supplierId,
          ...(purchaseOrderId ? {purchaseOrderId}:{}),
          settlementMethod,
          ...(immediatePayment && moneyAccountId ? { moneyAccountId } : {}),
          ...(supplierReference.trim() ? { supplierReference: supplierReference.trim() } : {}),
          lines: validLines.map((line) => ({
            itemId: line.itemId,
            purchaseUnitCode: line.purchaseUnitCode,
            ...(purchaseOrderId && line.purchaseOrderLineId?
              {purchaseOrderLineId:line.purchaseOrderLineId}:{}),
            quantity: line.quantity,
            unitCostMinor: line.unitCostMinor,
          })),
        },
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
      <div className="tos-sheet tos-sheet--wide tos-sheet--purchase" role="dialog" aria-label="Record purchase receipt">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Purchases</span>
            <h2 className="tos-sheet__title">{purchaseOrderId?"Receive purchase order":"Record purchase receipt"}</h2>
            <p className="tos-sheet__sub">{purchaseOrderId
              ? `Record quantities actually delivered against ${linkedOrder?.orderNumber??"this purchase order"}.`
              : "Receive stock and record either supplier credit or the money account used to pay."}</p>
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
              Choose the supplier, purchase unit and payment method. TradeOS converts received quantities into the stock unit, values inventory and records either the supplier payable or the selected money account.
              <span className="tos-callout__sub"> Supplier credit is the safe default so recording a receipt never silently removes cash.</span>
            </span>
          </div>

          {purchaseOrderId ? <div className="tos-callout tos-callout--info">
            <span className="tos-callout__body">
              {linkedOrder?.orderNumber??"Purchase order"}: enter only goods physically received.
              Leave quantity 0 for undelivered lines. Any later delivery can be received separately.
              Expected order prices are prefilled; changes are reported as a variance.
            </span>
          </div> : null}
          {poError ? <div className="tos-banner tos-banner--danger" role="alert">
            <span className="tos-banner__title">{poError}</span>
          </div> : null}
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="pr-supplier">
              Supplier<span className="tos-field__label-required">*</span>
            </label>
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
                onChange={(event) => setSupplierId(event.target.value)}
                disabled={!canWrite || Boolean(purchaseOrderId)}
              >
                <option value="">Select supplier…</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            )}
          </div>

          <div className="tos-section">
            <div className="tos-section__head">
              <h3 className="tos-section__title">Settlement</h3>
              <span className="tos-section__sub">{immediatePayment ? "Pay now" : "Pay later"}</span>
            </div>
            <div className="tos-section__body--padded tos-stack">
              <div className="tos-field">
                <label className="tos-field__label" htmlFor="pr-settlement">Payment method</label>
                <select
                  id="pr-settlement"
                  className="tos-select"
                  value={settlementMethod}
                  onChange={(event) => setSettlementMethod(event.target.value as SettlementMethod)}
                  disabled={!canWrite}
                >
                  {SETTLEMENT_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>{method.label}</option>
                  ))}
                </select>
              </div>

              {settlementMethod === "SUPPLIER_CREDIT" ? (
                <div className="tos-callout tos-callout--info">
                  <span>
                    This receipt will increase the supplier payable.
                    {selectedSupplier?.paymentTermsDays !== null && selectedSupplier?.paymentTermsDays !== undefined
                      ? ` Payment terms: ${selectedSupplier.paymentTermsDays} days.`
                      : " No payment terms are configured for this supplier yet."}
                  </span>
                </div>
              ) : (
                <div className="tos-field">
                  <label className="tos-field__label" htmlFor="pr-money-account">
                    Money account<span className="tos-field__label-required">*</span>
                  </label>
                  {accountsLoading ? (
                    <div className="tos-input tos-input--readonly">Loading accounts…</div>
                  ) : eligibleAccounts.length > 1 ? (
                    <select
                      id="pr-money-account"
                      className="tos-select"
                      value={moneyAccountId ?? ""}
                      onChange={(event) => setMoneyAccountId(event.target.value || null)}
                    >
                      <option value="">Select account…</option>
                      {eligibleAccounts.map((account) => (
                        <option key={account.id} value={account.id}>{account.name}</option>
                      ))}
                    </select>
                  ) : eligibleAccounts.length === 1 ? (
                    <div className="tos-input tos-input--readonly">{eligibleAccounts[0]!.name}</div>
                  ) : (
                    <div className="tos-banner tos-banner--warning">
                      <span className="tos-banner__title">
                        No active {SETTLEMENT_METHODS.find((method) => method.value === settlementMethod)?.label ?? settlementMethod} account is configured for this branch.
                      </span>
                      <a className="tos-banner__action" href="/cashbook">Configure in Cashbook →</a>
                    </div>
                  )}
                </div>
              )}

              <div className="tos-field">
                <label className="tos-field__label" htmlFor="pr-reference">Supplier invoice / reference</label>
                <input
                  id="pr-reference"
                  className="tos-input"
                  value={supplierReference}
                  maxLength={160}
                  onChange={(event) => setSupplierReference(event.target.value)}
                  placeholder="Optional invoice, receipt or delivery note number"
                  disabled={!canWrite}
                />
              </div>
            </div>
          </div>

          <div className="tos-section">
            <div className="tos-section__head">
              <h3 className="tos-section__title">Line items</h3>
              <span className="tos-section__sub">{validLineCount} of {lines.length} valid</span>
            </div>
            <div className="tos-section__body tos-stack">
              <p className="tos-receipt-scroll-hint">Scroll sideways to view all purchase fields. Each item stays on one row.</p>
              <div className="tos-receipt-lines-viewport" tabIndex={0} role="region" aria-label="Purchase items — scroll sideways to see all columns">
              <div className="tos-receipt-lines-grid">
              {lines.map((line, idx) => {
                const selected = activeCatalog.find((item) => item.id === line.itemId);
                const purchaseUnits = selected ? purchasableUnits(selected) : [];
                const selectedUnit = purchaseUnits.find((unit) => unit.code === line.purchaseUnitCode);
                const lineTotalMinor = line.unitCostMinor * line.quantity;
                return (
                  <div key={idx} className="tos-receipt-line">
                    <span className="tos-receipt-line__num" aria-hidden="true">{idx + 1}</span>
                    <div className="tos-receipt-line__item">
                      <select
                        id={`pr-item-${idx}`}
                        className="tos-select"
                        value={line.itemId}
                        onChange={(event) => selectItem(idx, event.target.value)}
                        disabled={!canWrite || Boolean(purchaseOrderId)}
                        aria-label={`Line ${idx + 1} item`}
                      >
                        <option value="">Select item…</option>
                        {activeCatalog.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="tos-receipt-line__unit">
                      <select
                        id={`pr-unit-${idx}`}
                        className="tos-select"
                        value={selected ? line.purchaseUnitCode : ""}
                        onChange={(event) => setLine(idx, { purchaseUnitCode: event.target.value })}
                        disabled={!canWrite || !selected || Boolean(purchaseOrderId)}
                        aria-label={`Line ${idx + 1} purchase unit`}
                      >
                        {!selected ? <option value="">Select item first</option> : null}
                        {purchaseUnits.map((unit) => (
                          <option key={unit.code} value={unit.code}>{unit.label || unit.code}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      id={`pr-qty-${idx}`}
                      className="tos-input tos-receipt-line__qty"
                      type="number"
                      min="0.000001"
                      step="any"
                      inputMode="decimal"
                      value={line.quantity}
                      max={purchaseOrderId ? line.remainingQuantity : undefined}
                      onChange={(event) => setLine(idx, {
                        quantity: Math.max(0, Number(event.target.value)) })}
                      disabled={!canWrite}
                      aria-label={`Line ${idx + 1} quantity`}
                    />
                    <div className="tos-receipt-line__cost">
                      <MoneyInput
                        currencyCode={currencyCode}
                        valueMinor={line.unitCostMinor}
                        onChange={(value) => setLine(idx, { unitCostMinor: value ?? 0 })}
                        disabled={!canWrite}
                        id={`pr-cost-${idx}`}
                        aria-label={`Line ${idx + 1} unit cost`}
                      />
                    </div>
                    <span
                      className="tos-receipt-line__total"
                      title={selectedUnit ? `${line.quantity} × ${selectedUnit.label || selectedUnit.code}` : undefined}
                    >
                      <MoneyValue minor={lineTotalMinor} currencyCode={currencyCode} />
                      {selectedUnit ? (
                        <span className="tos-receipt-line__total-sub">
                          {line.quantity} × {selectedUnit.label || selectedUnit.code}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="tos-receipt-line__remove"
                      onClick={() => removeLine(idx)}
                      aria-label={`Remove line ${idx + 1}`}
                      disabled={lines.length === 1 || !canWrite || Boolean(purchaseOrderId)}
                    >
                      <IconTrash style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                );
              })}
              </div>
              </div>
              {!purchaseOrderId ? <div className="tos-receipt-add">
                <Button
                  variant="outline"
                  size="sm"
                  icon={<IconPlus className="tos-btn__icon" />}
                  onClick={addLine}
                  disabled={!canWrite}
                >
                  Add line
                </Button>
              </div> : null}
            </div>
          </div>

          <div className="tos-checkout-summary">
            <span className="tos-checkout-summary__total-key">Receipt total</span>
            <span className="tos-checkout-summary__total-val">
              <MoneyValue minor={totalMinor} currencyCode={currencyCode} />
            </span>
          </div>

          {poVariance ? <div className="tos-banner tos-banner--warning" role="status">
            <span className="tos-banner__title">A delivered item's unit cost differs
              from the issued purchase order. Confirm the supplier's invoice and record
              its reference; the difference will appear in the PO's receiving summary.</span>
          </div> : null}
          {noMatchingAccount ? (
            <div className="tos-banner tos-banner--warning" role="status">
              <span className="tos-banner__title">Configure a matching money account before posting an immediate-payment receipt.</span>
            </div>
          ) : null}
          {error ? (
            <div className="tos-banner tos-banner--danger" role="alert">
              <span className="tos-banner__title">{error}</span>
            </div>
          ) : null}
        </div>

        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={busy}
            disabled={
              !canWrite
              || !supplierId
              || poUnavailable
              || validLineCount===0
              || lines.some(line=>Boolean(purchaseOrderId)&&line.quantity>(line.remainingQuantity??0))
              || noSuppliers
              || (immediatePayment && (accountsLoading || !moneyAccountId))
            }
          >
            {canWrite ? "Post receipt" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
