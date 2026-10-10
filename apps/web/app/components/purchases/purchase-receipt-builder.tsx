"use client";

import React, { useEffect, useMemo, useState } from "react";
import { formatMoney, formatMoneyInput, parseMoneyInput } from "@tradeos/contracts";
import { enqueueMutation, flushPendingMutations, getOrCreateClientId } from "../../lib/offline-sync";
import { messageFrom } from "../../lib/client-api";
import { Button } from "../ui/button";
import { MoneyInput } from "../ui/money-input";
import type { Supplier } from "../suppliers/supplier-types";
import type { MoneyAccount } from "../treasury/types";
import type { PurchaseCatalogItem, ReceiptLine } from "./types";

type LinePatch = Partial<Pick<ReceiptLine, "quantity" | "unitCostMinor" | "purchaseUnitCode" | "purchaseUnitLabel" | "estimatedStockQuantity">>;

export function updateReceiptLine(lines: ReceiptLine[], key: string, patch: LinePatch): ReceiptLine[] {
  return lines.map((line) => line.key === key ? { ...line, ...patch } : line);
}

export function receiptTotalMinor(lines: ReceiptLine[]): number {
  return lines.reduce((sum, line) => sum + Math.round(line.unitCostMinor * line.quantity), 0);
}

export function ReceiptLineEditor({ lines, currencyCode, unitsForItem, onChange, onRemove }: {
  lines: ReceiptLine[];
  currencyCode: string;
  unitsForItem: (itemId: string) => Array<{ code: string; label: string }>;
  onChange: (key: string, patch: LinePatch) => void;
  onRemove: (key: string) => void;
}) {
  if (lines.length === 0) return <div className="purchase-builder-empty">No purchase lines yet. Add a product to begin the receipt.</div>;
  return <div className="purchase-line-editor">
    {lines.map((line) => <article className="purchase-line-edit-row" key={line.key}>
      <div className="purchase-line-identity"><strong>{line.itemName}</strong><span>Draft line · server validates final stock posting</span></div>
      <label>Quantity<input inputMode="decimal" aria-label={`Quantity for ${line.itemName}`} value={formatEditable(line.quantity)} onChange={(event) => {
        const quantity = Number(event.target.value);
        if (Number.isFinite(quantity) && quantity >= 0) onChange(line.key, { quantity });
      }} /></label>
      <label>Purchase unit<select aria-label={`Purchase unit for ${line.itemName}`} value={line.purchaseUnitCode} onChange={(event) => {
        const unit = unitsForItem(line.itemId).find((candidate) => candidate.code === event.target.value);
        onChange(line.key, { purchaseUnitCode: event.target.value, purchaseUnitLabel: unit?.label ?? event.target.value });
      }}>{unitsForItem(line.itemId).map((unit) => <option key={unit.code} value={unit.code}>{unit.label}</option>)}</select></label>
      <label>Unit cost<MoneyInput currencyCode={currencyCode} aria-label={`Unit cost for ${line.itemName}`} value={formatMoneyInput(line.unitCostMinor, currencyCode) ?? ""} onChange={(event) => {
        const minor = parseMoneyInput(event.target.value, currencyCode) ?? -1;
        if (minor >= 0) onChange(line.key, { unitCostMinor: minor });
      }} /></label>
      <div className="purchase-line-stock-preview"><span>Stock preview</span><strong>{line.estimatedStockQuantity === null ? "Server will convert" : `+${formatQuantity(line.estimatedStockQuantity)} ${line.stockUnitCode ?? "stock units"}`}</strong></div>
      <div className="purchase-line-total"><span>Line total</span><strong>{formatMoney(Math.round(line.unitCostMinor * line.quantity), currencyCode)}</strong></div>
      <Button variant="ghost" type="button" onClick={() => onRemove(line.key)}>Remove</Button>
    </article>)}
  </div>;
}

export function PurchaseReceiptBuilder({ businessId, branchId, currencyCode, suppliers, catalog, accounts, onMessage }: {
  businessId: string;
  branchId: string;
  currencyCode: string;
  suppliers: Supplier[];
  catalog: PurchaseCatalogItem[];
  accounts: MoneyAccount[];
  onMessage: (message: string | null) => void;
}) {
  const purchasable = useMemo(() => catalog.filter((item) => item.active && item.kind === "PRODUCT" && item.trackStock && item.stockUnitCode && item.units.some((unit) => unit.canPurchase)), [catalog]);
  const [supplierId, setSupplierId] = useState("");
  const [settlementMethod, setSettlementMethod] = useState("CASH");
  const [moneyAccountId, setMoneyAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [itemId, setItemId] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [busy, setBusy] = useState(false);

  const selectedItem = purchasable.find((item) => item.id === itemId) ?? null;
  const purchaseUnits = selectedItem?.units.filter((unit) => unit.canPurchase) ?? [];
  const totalMinor = receiptTotalMinor(lines);
  const eligibleAccounts = settlementMethod === "SUPPLIER_CREDIT" ? [] : accounts.filter((account) => account.active && account.method === settlementMethod && (account.branchId === null || account.branchId === branchId));

  useEffect(() => { if (!supplierId && suppliers[0]) setSupplierId(suppliers[0].id); }, [supplierId, suppliers]);
  useEffect(() => { if (!itemId && purchasable[0]) setItemId(purchasable[0].id); }, [itemId, purchasable]);
  useEffect(() => {
    const item = purchasable.find((candidate) => candidate.id === itemId);
    setUnitCode(item?.units.find((unit) => unit.canPurchase)?.code ?? "");
  }, [itemId, purchasable]);
  useEffect(() => {
    if (settlementMethod === "SUPPLIER_CREDIT" || !eligibleAccounts.some((account) => account.id === moneyAccountId)) setMoneyAccountId("");
  }, [eligibleAccounts, moneyAccountId, settlementMethod]);

  const unitsForItem = (targetItemId: string) => catalog.find((item) => item.id === targetItemId)?.units.filter((unit) => unit.canPurchase).map(({ code, label }) => ({ code, label })) ?? [];

  const recalculateLine = (line: ReceiptLine, patch: LinePatch): LinePatch => {
    const item = catalog.find((candidate) => candidate.id === line.itemId);
    const nextQuantity = patch.quantity ?? line.quantity;
    const nextUnit = patch.purchaseUnitCode ?? line.purchaseUnitCode;
    const unit = item?.units.find((candidate) => candidate.code === nextUnit);
    return {
      ...patch,
      ...(patch.purchaseUnitCode ? { purchaseUnitLabel: unit?.label ?? nextUnit } : {}),
      estimatedStockQuantity: item?.stockUnitCode ? convertQuantity(item, nextUnit, item.stockUnitCode, nextQuantity) : null,
    };
  };

  const addLine = () => {
    if (!selectedItem || !unitCode) return;
    const parsedQuantity = Number(quantity);
    const unitCostMinor = parseMoneyInput(unitCost, currencyCode) ?? -1;
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || unitCostMinor < 0 || !unitCost.trim()) {
      onMessage("Enter a positive purchase quantity and a valid unit cost.");
      return;
    }
    const unit = purchaseUnits.find((candidate) => candidate.code === unitCode);
    setLines((current) => [...current, {
      key: crypto.randomUUID(), itemId: selectedItem.id, itemName: selectedItem.name, purchaseUnitCode: unitCode,
      purchaseUnitLabel: unit?.label ?? unitCode, quantity: parsedQuantity, unitCostMinor,
      estimatedStockQuantity: convertQuantity(selectedItem, unitCode, selectedItem.stockUnitCode!, parsedQuantity), stockUnitCode: selectedItem.stockUnitCode,
    }]);
    setQuantity(""); setUnitCost(""); onMessage(null);
  };

  const receive = async () => {
    if (!supplierId || lines.length === 0 || busy || lines.some((line) => line.quantity <= 0 || line.unitCostMinor < 0)) return;
    setBusy(true); onMessage(null);
    try {
      enqueueMutation({
        clientId: getOrCreateClientId(), clientMutationId: crypto.randomUUID(), businessId, branchId,
        mutationType: "PURCHASE_RECEIVE_CREATE", occurredAt: new Date().toISOString(),
        payload: {
          supplierId, settlementMethod,
          ...(settlementMethod !== "SUPPLIER_CREDIT" && moneyAccountId ? { moneyAccountId } : {}),
          ...(reference.trim() ? { supplierReference: reference.trim() } : {}),
          lines: lines.map((line) => ({ itemId: line.itemId, purchaseUnitCode: line.purchaseUnitCode, quantity: line.quantity, unitCostMinor: line.unitCostMinor })),
        },
      });
      setLines([]); setReference("");
      if (!navigator.onLine) { onMessage("Purchase receipt saved offline. Stock will post when this device reconnects."); return; }
      const summary = await flushPendingMutations();
      if (summary.rejected > 0) onMessage("Receipt is saved but needs review before stock can post.");
      else if (summary.applied > 0) onMessage("Purchase received and stock updated.");
      else onMessage("Purchase receipt queued for synchronization.");
    } catch (error) { onMessage(messageFrom(error)); }
    finally { setBusy(false); }
  };

  return <section className="purchase-builder">
    <header className="purchase-builder-head"><div><span>Purchase receiving</span><h3>Build receipt</h3><p>Draft quantities, units and costs here. TradeOS validates conversions, stock and accounting when the receipt posts.</p></div><strong>{formatMoney(totalMinor, currencyCode)}</strong></header>
    {suppliers.length === 0 ? <div className="purchase-readonly-note">Add an active supplier before receiving stock.</div> : purchasable.length === 0 ? <div className="purchase-readonly-note">Configure a tracked product with a purchase unit first.</div> : <>
      <div className="purchase-builder-context">
        <label>Supplier<select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label>Settlement<select value={settlementMethod} onChange={(event) => setSettlementMethod(event.target.value)}>{["CASH","MOMO","CARD","BANK","OTHER","SUPPLIER_CREDIT"].map((method) => <option key={method} value={method}>{method === "SUPPLIER_CREDIT" ? "Supplier credit (pay later)" : method}</option>)}</select></label>
        {settlementMethod !== "SUPPLIER_CREDIT" ? <label>Money account<select value={moneyAccountId} onChange={(event) => setMoneyAccountId(event.target.value)}><option value="">Use configured default</option>{eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label> : <div className="purchase-credit-context"><span>Money account</span><strong>Not used for supplier credit</strong></div>}
        <label>Supplier invoice/reference<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Optional invoice or GRN reference" /></label>
      </div>
      <div className="purchase-add-line">
        <label>Product<select value={itemId} onChange={(event) => setItemId(event.target.value)}>{purchasable.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Purchase unit<select value={unitCode} onChange={(event) => setUnitCode(event.target.value)}>{purchaseUnits.map((unit) => <option key={unit.code} value={unit.code}>{unit.label}</option>)}</select></label>
        <label>Quantity<input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0" /></label>
        <label>Unit cost<MoneyInput currencyCode={currencyCode} value={unitCost} onChange={(event) => setUnitCost(event.target.value)} placeholder="0.00" /></label>
        <Button variant="secondary" type="button" onClick={addLine}>Add line</Button>
      </div>
      <ReceiptLineEditor lines={lines} currencyCode={currencyCode} unitsForItem={unitsForItem} onChange={(key, patch) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...recalculateLine(line, patch) } : line))} onRemove={(key) => setLines((current) => current.filter((line) => line.key !== key))} />
      <footer className="purchase-builder-footer"><div><span>Receipt total</span><strong>{formatMoney(totalMinor, currencyCode)}</strong></div><Button type="button" disabled={busy || lines.length === 0 || !supplierId} onClick={() => void receive()}>{busy ? "Receiving…" : "Receive stock"}</Button></footer>
    </>}
  </section>;
}

function convertQuantity(item: PurchaseCatalogItem, from: string, to: string, quantity: number): number | null {
  if (from === to) return quantity;
  const edges = new Map<string, Array<{ to: string; factor: number }>>();
  for (const conversion of item.conversions) {
    const forward = edges.get(conversion.fromUnitCode) ?? []; forward.push({ to: conversion.toUnitCode, factor: conversion.factor }); edges.set(conversion.fromUnitCode, forward);
    const reverse = edges.get(conversion.toUnitCode) ?? []; reverse.push({ to: conversion.fromUnitCode, factor: 1 / conversion.factor }); edges.set(conversion.toUnitCode, reverse);
  }
  const queue: Array<{ unit: string; value: number }> = [{ unit: from, value: quantity }]; const seen = new Set([from]);
  while (queue.length) { const current = queue.shift()!; for (const edge of edges.get(current.unit) ?? []) { if (seen.has(edge.to)) continue; const value = current.value * edge.factor; if (edge.to === to) return value; seen.add(edge.to); queue.push({ unit: edge.to, value }); } }
  return null;
}

function formatQuantity(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value); }
function formatEditable(value: number): string { return Number.isInteger(value) ? String(value) : String(value); }
