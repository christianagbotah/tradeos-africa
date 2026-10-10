"use client";

import React, { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatMoneyInput, parseMoneyInput } from "@tradeos/contracts";
import { ClientApiError, clientApi, messageFrom } from "../../lib/client-api";
import {
  enqueueMutation,
  flushPendingMutations,
  getFailedMutations,
  getOrCreateClientId,
} from "../../lib/offline-sync";
import type { CatalogItem } from "../../lib/workspace-types";
import { Button } from "../ui/button";

type SheetMode = "create" | "edit" | "duplicate" | "view";
type DraftUnit = {
  code: string;
  label: string;
  canPurchase: boolean;
  canSell: boolean;
  canStock: boolean;
  price: string;
};
type DraftConversion = { fromUnitCode: string; toUnitCode: string; factor: string };

export type CatalogDraft = {
  itemId: string | null;
  expectedUpdatedAt: string | null;
  name: string;
  sku: string;
  kind: CatalogItem["kind"];
  trackStock: boolean;
  stockUnitCode: string;
  taxCategory: string;
  active: boolean;
  units: DraftUnit[];
  conversions: DraftConversion[];
  openingStock: string;
};

type Props = {
  mode: SheetMode;
  item: CatalogItem | null;
  open: boolean;
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
};

export function catalogDraftFor(mode: SheetMode, item: CatalogItem | null, currencyCode: string): CatalogDraft {
  if (!item || mode === "create") {
    return {
      itemId: null,
      expectedUpdatedAt: null,
      name: "",
      sku: "",
      kind: "PRODUCT",
      trackStock: true,
      stockUnitCode: "piece",
      taxCategory: "",
      active: true,
      units: [{ code: "piece", label: "Piece", canPurchase: true, canSell: true, canStock: true, price: "" }],
      conversions: [],
      openingStock: "",
    };
  }

  const duplicate = mode === "duplicate";
  return {
    itemId: duplicate ? null : item.id,
    expectedUpdatedAt: duplicate ? null : item.updatedAt,
    name: duplicate ? `${item.name} copy` : item.name,
    sku: duplicate ? "" : item.sku ?? "",
    kind: item.kind,
    trackStock: item.trackStock,
    stockUnitCode: item.stockUnitCode ?? "",
    taxCategory: item.taxCategory ?? "",
    active: duplicate ? true : item.active,
    units: item.units.map((unit) => ({
      code: unit.code,
      label: unit.label,
      canPurchase: unit.canPurchase,
      canSell: unit.canSell,
      canStock: unit.canStock,
      price: unit.defaultSalePriceMinor === null ? "" : formatMoneyInput(unit.defaultSalePriceMinor, currencyCode) ?? "",
    })),
    conversions: item.conversions.map((conversion) => ({
      fromUnitCode: conversion.fromUnitCode,
      toUnitCode: conversion.toUnitCode,
      factor: String(conversion.factor),
    })),
    openingStock: "",
  };
}

export function catalogSheetMessage(code: string | null | undefined, fallback = "Catalog change could not be saved."): string {
  if (code === "STALE_VERSION") return "This item changed on another device. Refresh the latest version before saving your changes.";
  if (code === "CATALOG_STRUCTURE_LOCKED") return "Business history already uses this item. Keep the historical stock and unit structure, or duplicate the item to introduce a new structure.";
  if (code === "CATALOG_ITEM_IN_USE") return "This item has business history and cannot be permanently deleted. Archive it instead.";
  if (code === "OFFLINE_STRUCTURE_EDIT") return "Stock, unit-code and conversion changes require an online connection so TradeOS can verify business history first.";
  return fallback;
}

export function CatalogItemSheet({ mode, item, open, businessId, branchId, currencyCode, role, onClose, onChanged }: Props) {
  const [draft, setDraft] = useState<CatalogDraft>(() => catalogDraftFor(mode, item, currencyCode));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const previous_active_element = useRef<HTMLElement | null>(null);
  const readOnly = mode === "view";
  const structureLocked = Boolean((item as (CatalogItem & { structureLocked?: boolean }) | null)?.structureLocked);

  useEffect(() => {
    if (!open) return;
    setDraft(catalogDraftFor(mode, item, currencyCode));
    setMessage(null);
  }, [currencyCode, item, mode, open]);

  useEffect(() => {
    if (!open) return;
    previous_active_element.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => firstInputRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previous_active_element.current?.focus();
    };
  }, [onClose, open]);

  const canSubmit = useMemo(() => {
    if (readOnly || !draft.name.trim() || draft.units.length === 0) return false;
    return draft.units.every((unit) => unit.code.trim() && unit.label.trim() && (!unit.canSell || parseMoneyInput(unit.price, currencyCode) !== null));
  }, [draft, readOnly]);

  if (!open) return null;

  const title = mode === "create" ? "Add catalog item" : mode === "duplicate" ? `Duplicate ${item?.name ?? "item"}` : mode === "view" ? item?.name ?? "Catalog item" : `Edit ${item?.name ?? "item"}`;

  const updateUnit = (index: number, patch: Partial<DraftUnit>) => {
    setDraft((current) => ({ ...current, units: current.units.map((unit, position) => position === index ? { ...unit, ...patch } : unit) }));
  };
  const updateConversion = (index: number, patch: Partial<DraftConversion>) => {
    setDraft((current) => ({ ...current, conversions: current.conversions.map((conversion, position) => position === index ? { ...conversion, ...patch } : conversion) }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const payload = draftPayload(draft, branchId, currencyCode);
      if (mode === "edit" && item && structuralChanged(item, draft)) {
        if (!navigator.onLine) {
          setMessage(catalogSheetMessage("OFFLINE_STRUCTURE_EDIT"));
          return;
        }
        await clientApi(`/api/tradeos/v1/catalog/items/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ businessId, expectedUpdatedAt: draft.expectedUpdatedAt, ...payload }),
        });
        await onChanged();
        onClose();
        return;
      }

      const clientMutationId = crypto.randomUUID();
      const mutationType = mode === "edit" ? "CATALOG_ITEM_UPDATE" : "CATALOG_ITEM_CREATE";
      enqueueMutation({
        clientId: getOrCreateClientId(),
        clientMutationId,
        businessId,
        mutationType,
        occurredAt: new Date().toISOString(),
        payload: mode === "edit"
          ? { itemId: draft.itemId, expectedUpdatedAt: draft.expectedUpdatedAt, ...payload }
          : payload,
      });

      if (!navigator.onLine) {
        setMessage("Saved offline · pending sync. This item will synchronize when the connection returns.");
        return;
      }

      const summary = await flushPendingMutations();
      const failed = getFailedMutations().find((entry) => entry.mutation.clientMutationId === clientMutationId);
      if (failed) {
        setMessage(catalogSheetMessage(failed.result.errorCode, failed.result.errorMessage ?? "Catalog change was rejected."));
        return;
      }
      if (summary.received > 0) {
        setMessage("Saved locally · synchronization is still pending.");
        return;
      }
      await onChanged();
      onClose();
    } catch (reason) {
      if (reason instanceof ClientApiError) setMessage(catalogSheetMessage(reason.code, reason.message));
      else setMessage(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="catalog-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={sheetRef} className="catalog-sheet" role="dialog" aria-modal="true" aria-labelledby="catalog-sheet-title">
        <header className="catalog-sheet-header">
          <div><span>Catalog management</span><h2 id="catalog-sheet-title">{title}</h2></div>
          <button className="catalog-sheet-close" type="button" aria-label="Close catalog item" onClick={onClose}>×</button>
        </header>

        <form className="catalog-sheet-form" onSubmit={(event) => void submit(event)}>
          <section className="catalog-form-section">
            <div className="catalog-section-heading"><strong>Basics</strong><span>Identity and item type</span></div>
            <div className="catalog-field-grid">
              <label>Name<input ref={firstInputRef} required disabled={readOnly} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>SKU / reference<input disabled={readOnly} value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} placeholder="Optional" /></label>
              <label>Type<select disabled={readOnly || structureLocked} value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as CatalogItem["kind"], ...(event.target.value === "SERVICE" ? { trackStock: false, stockUnitCode: "" } : {}) }))}><option value="PRODUCT">Product</option><option value="SERVICE">Service</option><option value="PREPARED_PRODUCT">Prepared product</option></select></label>
            </div>
          </section>

          <section className="catalog-form-section">
            <div className="catalog-section-heading"><strong>Selling</strong><span>Sale units and prices</span></div>
            <div className="catalog-unit-editor">
              {draft.units.map((unit, index) => (
                <div className="catalog-unit-row" key={`${index}-${unit.code}`}>
                  <label>Unit label<input disabled={readOnly} value={unit.label} onChange={(event) => updateUnit(index, { label: event.target.value })} /></label>
                  <label className="catalog-check"><input type="checkbox" disabled={readOnly} checked={unit.canSell} onChange={(event) => updateUnit(index, { canSell: event.target.checked })} /> Sell</label>
                  <label>Price ({currencyCode === "GHS" ? "₵" : currencyCode})<input inputMode="decimal" disabled={readOnly || !unit.canSell} value={unit.price} onChange={(event) => updateUnit(index, { price: event.target.value })} placeholder="0.00" /></label>
                </div>
              ))}
            </div>
          </section>

          <section className="catalog-form-section">
            <div className="catalog-section-heading"><strong>Buying &amp; stock</strong><span>Inventory behavior is audited separately from quantity movements</span></div>
            {structureLocked ? <p className="catalog-structure-note">Business history protects this stock and unit structure. Prices and labels can still change; duplicate the item to introduce a new stock structure.</p> : null}
            <div className="catalog-field-grid">
              <label className="catalog-check">Track stock<input type="checkbox" disabled={readOnly || structureLocked || draft.kind !== "PRODUCT"} checked={draft.trackStock} onChange={(event) => setDraft((current) => ({ ...current, trackStock: event.target.checked }))} /></label>
              <label>Stock unit<select disabled={readOnly || structureLocked || !draft.trackStock} value={draft.stockUnitCode} onChange={(event) => setDraft((current) => ({ ...current, stockUnitCode: event.target.value }))}><option value="">Choose unit</option>{draft.units.map((unit) => <option key={unit.code} value={unit.code}>{unit.label || unit.code}</option>)}</select></label>
              {mode !== "edit" && draft.trackStock ? <label>Opening stock<input inputMode="decimal" disabled={readOnly} value={draft.openingStock} onChange={(event) => setDraft((current) => ({ ...current, openingStock: event.target.value }))} placeholder="Optional" /></label> : null}
            </div>
          </section>

          <section className="catalog-form-section">
            <div className="catalog-section-heading"><strong>Units &amp; conversions</strong><span>Buying, selling and stock units</span></div>
            {draft.units.map((unit, index) => (
              <div className="catalog-structure-row" key={`structure-${index}`}>
                <label>Code<input disabled={readOnly || structureLocked} value={unit.code} onChange={(event) => updateUnit(index, { code: normalizeUnit(event.target.value) })} /></label>
                <label className="catalog-check"><input type="checkbox" disabled={readOnly} checked={unit.canPurchase} onChange={(event) => updateUnit(index, { canPurchase: event.target.checked })} /> Buy</label>
                <label className="catalog-check"><input type="checkbox" disabled={readOnly || structureLocked} checked={unit.canStock} onChange={(event) => updateUnit(index, { canStock: event.target.checked })} /> Stock</label>
                {!readOnly && !structureLocked && draft.units.length > 1 ? <button type="button" onClick={() => setDraft((current) => ({ ...current, units: current.units.filter((_, position) => position !== index) }))}>Remove</button> : null}
              </div>
            ))}
            {!readOnly && !structureLocked ? <Button variant="secondary" type="button" onClick={() => setDraft((current) => ({ ...current, units: [...current.units, { code: `unit_${current.units.length + 1}`, label: "New unit", canPurchase: false, canSell: false, canStock: false, price: "" }] }))}>Add unit</Button> : null}

            {draft.conversions.map((conversion, index) => (
              <div className="catalog-conversion-row" key={`conversion-${index}`}>
                <label>From<select disabled={readOnly || structureLocked} value={conversion.fromUnitCode} onChange={(event) => updateConversion(index, { fromUnitCode: event.target.value })}>{draft.units.map((unit) => <option key={unit.code} value={unit.code}>{unit.label}</option>)}</select></label>
                <label>To<select disabled={readOnly || structureLocked} value={conversion.toUnitCode} onChange={(event) => updateConversion(index, { toUnitCode: event.target.value })}>{draft.units.map((unit) => <option key={unit.code} value={unit.code}>{unit.label}</option>)}</select></label>
                <label>Factor<input inputMode="decimal" disabled={readOnly || structureLocked} value={conversion.factor} onChange={(event) => updateConversion(index, { factor: event.target.value })} /></label>
                {!readOnly && !structureLocked ? <button type="button" onClick={() => setDraft((current) => ({ ...current, conversions: current.conversions.filter((_, position) => position !== index) }))}>Remove</button> : null}
              </div>
            ))}
            {!readOnly && !structureLocked && draft.units.length > 1 ? <Button variant="secondary" type="button" onClick={() => setDraft((current) => ({ ...current, conversions: [...current.conversions, { fromUnitCode: current.units[0]?.code ?? "", toUnitCode: current.units[1]?.code ?? "", factor: "1" }] }))}>Add conversion</Button> : null}
          </section>

          <section className="catalog-form-section">
            <div className="catalog-section-heading"><strong>Tax &amp; configuration</strong><span>Forward-looking commercial configuration</span></div>
            <div className="catalog-field-grid"><label>Tax category<input disabled={readOnly} value={draft.taxCategory} onChange={(event) => setDraft((current) => ({ ...current, taxCategory: event.target.value }))} placeholder="Optional" /></label></div>
          </section>

          <section className="catalog-form-section">
            <div className="catalog-section-heading"><strong>Status</strong><span>{draft.active ? "Active items are available to operational workflows." : "Archived items stay in history but not new selling workflows."}</span></div>
            <p className="catalog-status-copy">{draft.active ? "Active" : "Archived"} · Archive/reactivate controls are managed separately to prevent accidental status changes while editing.</p>
          </section>

          {message ? <div className="catalog-sheet-message" role="status">{message}</div> : null}
          <footer className="catalog-sheet-footer">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            {!readOnly ? <Button type="submit" disabled={!canSubmit || busy}>{busy ? "Saving…" : mode === "edit" ? "Save changes" : mode === "duplicate" ? "Create duplicate" : "Create item"}</Button> : null}
          </footer>
        </form>
      </div>
    </div>
  );
}

function draftPayload(draft: CatalogDraft, branchId: string, currencyCode: string) {
  const units = draft.units.map((unit) => ({
    code: normalizeUnit(unit.code),
    label: unit.label.trim(),
    canPurchase: unit.canPurchase,
    canSell: unit.canSell,
    canStock: unit.canStock,
    ...(unit.canSell ? { defaultSalePriceMinor: parseMoneyInput(unit.price, currencyCode) } : {}),
  }));
  const openingStock = Number(draft.openingStock);
  return {
    name: draft.name.trim(),
    sku: draft.sku.trim() || null,
    kind: draft.kind,
    trackStock: draft.kind === "PRODUCT" ? draft.trackStock : false,
    stockUnitCode: draft.kind === "PRODUCT" && draft.trackStock ? normalizeUnit(draft.stockUnitCode) : null,
    taxCategory: draft.taxCategory.trim() || null,
    units,
    conversions: draft.conversions.map((conversion) => ({
      fromUnitCode: normalizeUnit(conversion.fromUnitCode),
      toUnitCode: normalizeUnit(conversion.toUnitCode),
      factor: Number(conversion.factor),
    })),
    ...(draft.itemId === null && draft.trackStock && Number.isFinite(openingStock) && openingStock > 0 ? { openingStock: { branchId, quantity: openingStock } } : {}),
  };
}

function structuralChanged(item: CatalogItem, draft: CatalogDraft): boolean {
  if (item.kind !== draft.kind || item.trackStock !== draft.trackStock || (item.stockUnitCode ?? "") !== draft.stockUnitCode) return true;
  const beforeUnits = item.units.map((unit) => unit.code).sort();
  const afterUnits = draft.units.map((unit) => normalizeUnit(unit.code)).sort();
  if (JSON.stringify(beforeUnits) !== JSON.stringify(afterUnits)) return true;
  const beforeConversions = item.conversions.map((conversion) => `${conversion.fromUnitCode}>${conversion.toUnitCode}:${conversion.factor}`).sort();
  const afterConversions = draft.conversions.map((conversion) => `${normalizeUnit(conversion.fromUnitCode)}>${normalizeUnit(conversion.toUnitCode)}:${Number(conversion.factor)}`).sort();
  return JSON.stringify(beforeConversions) !== JSON.stringify(afterConversions);
}


function normalizeUnit(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}
