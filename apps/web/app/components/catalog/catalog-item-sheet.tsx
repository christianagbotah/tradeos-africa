"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";
import {
  IconBox,
  IconClose,
  IconInventory,
  IconPackage,
  IconPackageOpen,
  IconPlus,
  IconReceipt,
  IconShield,
  IconTrash,
} from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import {
  buildCatalogItemCreatePayload,
  buildCatalogItemUpdatePayload,
  buildCatalogLifecyclePayload,
  CATALOG_ITEM_ARCHIVE_TYPE,
  CATALOG_ITEM_REACTIVATE_TYPE,
  CATALOG_WRITE_ROLES,
  roleCan,
  type CatalogConversionInput,
  type CatalogUnitInput,
  type WorkspaceRole,
} from "../../../lib/mutation-builders";
import type { CatalogItem, CatalogUnit } from "../../../lib/catalog-read-model";

interface CatalogItemSheetProps {
  item: CatalogItem | null;
  open?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const COMMON_UNITS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "each", label: "Each (piece)" },
  { code: "kg", label: "Kilogram" },
  { code: "g", label: "Gram" },
  { code: "l", label: "Litre" },
  { code: "ml", label: "Millilitre" },
  { code: "m", label: "Metre" },
  { code: "cm", label: "Centimetre" },
  { code: "box", label: "Box" },
  { code: "pack", label: "Pack" },
  { code: "bottle", label: "Bottle" },
  { code: "crate", label: "Crate" },
  { code: "sack", label: "Sack" },
  { code: "bag", label: "Bag" },
  { code: "coil", label: "Coil" },
  { code: "glass", label: "Glass" },
  { code: "shot", label: "Shot" },
  { code: "bowl", label: "Bowl" },
  { code: "portion", label: "Portion" },
  { code: "piece", label: "Piece" },
  { code: "service", label: "Service" },
];

const KIND_OPTIONS: ReadonlyArray<{
  value: CatalogItem["kind"];
  label: string;
  desc: string;
}> = [
  { value: "PRODUCT", label: "Product", desc: "Stocked item — tracks inventory" },
  { value: "PREPARED_PRODUCT", label: "Prepared product", desc: "Made to order — tracks inventory" },
  { value: "SERVICE", label: "Service", desc: "No stock tracked" },
];

const KIND_TILE_CLASS: Record<CatalogItem["kind"], string> = {
  PRODUCT: "tos-kind-tile tos-kind-tile--product",
  PREPARED_PRODUCT: "tos-kind-tile tos-kind-tile--prepared",
  SERVICE: "tos-kind-tile tos-kind-tile--service",
};

const KIND_ICON: Record<CatalogItem["kind"], ReactNode> = {
  PRODUCT: <IconPackage className="tos-kind-tile__svg" />,
  PREPARED_PRODUCT: <IconPackageOpen className="tos-kind-tile__svg" />,
  SERVICE: <IconReceipt className="tos-kind-tile__svg" />,
};

const KIND_LABEL: Record<CatalogItem["kind"], string> = {
  PRODUCT: "Product",
  PREPARED_PRODUCT: "Prepared",
  SERVICE: "Service",
};

/** Local editable unit row — mirrors the server's CatalogUnitInput. */
interface UnitRow {
  code: string;
  label: string;
  canPurchase: boolean;
  canSell: boolean;
  canStock: boolean;
  priceMinor: number | null;
}

/** Local editable conversion row — mirrors the server's ConversionInput. */
interface ConversionRow {
  fromUnitCode: string;
  toUnitCode: string;
  factor: string;
}

function normalizeUnitCode(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function unitRowFrom(unit: CatalogUnit): UnitRow {
  return {
    code: unit.code,
    label: unit.label,
    canPurchase: unit.canPurchase,
    canSell: unit.canSell,
    canStock: unit.canStock,
    priceMinor: unit.defaultSalePriceMinor,
  };
}

export function CatalogItemSheet({ item, open = false, onClose, onSaved }: CatalogItemSheetProps) {
  const { session, role, refreshCatalog } = useWorkspace();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [kind, setKind] = useState<CatalogItem["kind"]>("PRODUCT");
  const [trackStock, setTrackStock] = useState(true);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [conversions, setConversions] = useState<ConversionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  const isEdit = Boolean(item);
  const canWrite = roleCan(role as WorkspaceRole, CATALOG_WRITE_ROLES);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setSku(item.sku ?? "");
      setKind(item.kind);
      setTrackStock(item.trackStock);
      setUnits(item.units.map(unitRowFrom));
      setConversions(item.conversions.map((c) => ({
        fromUnitCode: c.fromUnitCode,
        toUnitCode: c.toUnitCode,
        factor: String(c.factor),
      })));
    } else {
      setName("");
      setSku("");
      setKind("PRODUCT");
      setTrackStock(true);
      // Every item needs at least one unit; start from a sensible default.
      setUnits([{ code: "each", label: "Each (piece)", canPurchase: true, canSell: true, canStock: true, priceMinor: null }]);
      setConversions([]);
    }
    setBusy(false);
    setError(null);
    setLifecycleBusy(false);
    setLifecycleError(null);
  }, [item]);

  // Lock body scroll while the sheet is mounted.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const effectiveTrackStock = kind === "SERVICE" ? false : trackStock;
  const sellableUnits = units.filter((u) => u.canSell && u.code.trim());
  const stockableUnitCodes = units.filter((u) => u.canStock && u.code.trim()).map((u) => normalizeUnitCode(u.code));
  const primary = sellableUnits[0] ?? null;

  // Client-side validation mirrors the server's validateCatalogInput basics.
  // Conversion-path reachability stays system-managed — its error is
  // surfaced verbatim when the server rejects the mutation.
  const validationError = useMemo(() => {
    if (units.length === 0) return "Add at least one purchase/sale/stock unit.";
    const seen = new Set<string>();
    for (const unit of units) {
      const code = normalizeUnitCode(unit.code);
      if (!code) return "Every unit needs a code.";
      if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(code)) {
        return `Unit code "${code}" may contain lowercase letters, numbers, hyphens and underscores only.`;
      }
      if (seen.has(code)) return `Duplicate unit code ${code}.`;
      seen.add(code);
      if (!unit.label.trim()) return `Unit ${code} needs a label.`;
      if (unit.canSell && unit.priceMinor === null) {
        return `Sellable unit ${code} needs a sale price.`;
      }
    }
    if (!units.some((u) => u.canPurchase || u.canSell || u.canStock)) {
      return "At least one unit must be usable for purchase, sale or stock.";
    }
    if (effectiveTrackStock) {
      if (kind !== "PRODUCT") return "Only products can directly track stock.";
      const stockCode = units.find((u) => normalizeUnitCode(u.code) === (item?.stockUnitCode ?? ""))?.code;
      const chosen = stockCode ?? stockableUnitCodes[0];
      if (!chosen) return "Tracked products need a stock unit — mark a unit as 'stock'.";
    }
    for (const conversion of conversions) {
      const from = normalizeUnitCode(conversion.fromUnitCode);
      const to = normalizeUnitCode(conversion.toUnitCode);
      if (!seen.has(from) || !seen.has(to)) return "Conversions must reference configured units.";
      if (from === to) return "Conversion units must differ.";
      const factor = Number(conversion.factor);
      if (!Number.isFinite(factor) || factor <= 0) return "Conversion factor must be a positive number.";
    }
    return null;
  }, [units, conversions, effectiveTrackStock, kind, item, stockableUnitCodes]);

  if (!session) return null;
  if (!item && !open) return null;

  const currencyCode = session.currencyCode;
  const isArchived = item ? !item.active : false;

  const setUnit = (idx: number, patch: Partial<UnitRow>) => {
    setUnits((prev) => prev.map((u, i) => (i === idx ? { ...u, ...patch } : u)));
  };
  const addUnit = () => {
    setUnits((prev) => [...prev, { code: "", label: "", canPurchase: false, canSell: true, canStock: false, priceMinor: null }]);
  };
  const removeUnit = (idx: number) => {
    setUnits((prev) => prev.filter((_, i) => i !== idx));
  };
  const setConversion = (idx: number, patch: Partial<ConversionRow>) => {
    setConversions((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };
  const addConversion = () => {
    setConversions((prev) => [...prev, { fromUnitCode: "", toUnitCode: "", factor: "1" }]);
  };
  const removeConversion = (idx: number) => {
    setConversions((prev) => prev.filter((_, i) => i !== idx));
  };

  const stockUnitCode = effectiveTrackStock
    ? normalizeUnitCode(
        units.find((u) => normalizeUnitCode(u.code) === (item?.stockUnitCode ?? ""))?.code
          ?? stockableUnitCodes[0]
          ?? "",
      ) || null
    : null;

  const toPayloadUnits = (): CatalogUnitInput[] =>
    units.map((unit) => ({
      code: normalizeUnitCode(unit.code),
      label: unit.label.trim(),
      canPurchase: unit.canPurchase,
      canSell: unit.canSell,
      canStock: unit.canStock,
      defaultSalePriceMinor: unit.priceMinor,
    }));

  const toPayloadConversions = (): CatalogConversionInput[] =>
    conversions.map((conversion) => ({
      fromUnitCode: normalizeUnitCode(conversion.fromUnitCode),
      toUnitCode: normalizeUnitCode(conversion.toUnitCode),
      factor: Number(conversion.factor),
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy || !canWrite) return;
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      const base = {
        name: name.trim(),
        sku: sku.trim() || null,
        kind,
        trackStock: effectiveTrackStock,
        stockUnitCode,
        units: toPayloadUnits(),
        conversions: toPayloadConversions(),
      };
      const payload = isEdit && item
        ? buildCatalogItemUpdatePayload({ ...base, itemId: item.id, expectedUpdatedAt: item.updatedAt })
        : buildCatalogItemCreatePayload(base);
      const mutation = queue.build({
        businessId: session.businessId,
        mutationType: isEdit && item ? "CATALOG_ITEM_UPDATE" : "CATALOG_ITEM_CREATE",
        payload,
      });
      await queue.enqueue(mutation);
      await queue.flushOrThrow({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      await refreshCatalog();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save item.");
    } finally {
      setBusy(false);
    }
  };

  /** Enqueues CATALOG_ITEM_ARCHIVE or CATALOG_ITEM_REACTIVATE. Payload is `{ itemId, expectedUpdatedAt }`. */
  const handleLifecycle = async (mutationType: "CATALOG_ITEM_ARCHIVE" | "CATALOG_ITEM_REACTIVATE") => {
    if (!item || !canWrite || lifecycleBusy) return;
    setLifecycleBusy(true);
    setLifecycleError(null);
    try {
      const queue = getOfflineQueue();
      const payload = buildCatalogLifecyclePayload(mutationType, {
        itemId: item.id,
        expectedUpdatedAt: item.updatedAt,
      });
      const mutation = queue.build({
        businessId: session.businessId,
        mutationType,
        payload,
      });
      await queue.enqueue(mutation);
      await queue.flushOrThrow({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      await refreshCatalog();
      onSaved();
    } catch (err) {
      setLifecycleError(err instanceof Error ? err.message : "Could not change item status.");
    } finally {
      setLifecycleBusy(false);
    }
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label={isEdit ? "Edit catalog item" : "Add catalog item"}>
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Master data</span>
            <h2 className="tos-sheet__title">{isEdit ? "Edit item" : "Add catalog item"}</h2>
            {item ? <p className="tos-sheet__sub">{item.name}</p> : <p className="tos-sheet__sub">Server-authoritative prices and stock</p>}
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <form className="tos-sheet__body" onSubmit={handleSubmit}>
          {/* Gold hero — item identity with kind + primary sellable price */}
          <div className="tos-catalog-hero tos-animate-fade-in-up">
            <div className="tos-catalog-hero__head">
              <div className="tos-catalog-hero__head-main">
                <span className="tos-catalog-hero__eyebrow">{KIND_LABEL[kind]}</span>
                <h3 className="tos-catalog-hero__title">{name.trim() || (isEdit ? item?.name ?? "Untitled item" : "New catalog item")}</h3>
                <p className="tos-catalog-hero__sub">
                  {sku.trim() ? `SKU ${sku.trim()}` : "No SKU"}
                  {primary ? ` · Sold per ${primary.label || primary.code}` : " · No sellable unit yet"}
                  {sellableUnits.length > 1 ? ` · ${sellableUnits.length} sellable units` : ""}
                </p>
              </div>
              <span className={KIND_TILE_CLASS[kind]} aria-hidden="true">
                {KIND_ICON[kind]}
              </span>
            </div>
            {primary ? (
              <div className="tos-catalog-hero__price-row">
                <span className="tos-catalog-hero__price-label">Sale price</span>
                <MoneyValue
                  minor={primary.priceMinor ?? 0}
                  currencyCode={currencyCode}
                  className="tos-catalog-hero__price"
                />
              </div>
            ) : null}
            <p className="tos-catalog-hero__unit">
              Set the selling price for each unit you offer. TradeOS applies the selected unit price automatically at checkout.
            </p>
          </div>

          {/* 3-up stats — only meaningful in edit mode (current saved state) */}
          {item ? (
            <div className="tos-catalog-stats tos-animate-fade-in-up">
              <CatalogStat
                label="Sellable units"
                icon={<IconBox className="tos-stat__icon-tile-svg" />}
                iconTone="midnight"
                value={<span className="tos-stat__value">{item.units.filter((u) => u.canSell).length}</span>}
                hint={item.units.map((u) => u.code).join(", ") || "No units"}
              />
              <CatalogStat
                label="Stock tracking"
                icon={<IconInventory className="tos-stat__icon-tile-svg" />}
                iconTone={item.trackStock ? "positive" : "neutral"}
                value={
                  <span className="tos-stat__value">
                    {item.trackStock ? `Tracked · ${item.stockUnitCode ?? "?"}` : "Off"}
                  </span>
                }
                hint={item.trackStock ? "Stock counted in the stock unit" : "No stock recorded"}
              />
              <CatalogStat
                label="Status"
                icon={<IconShield className="tos-stat__icon-tile-svg" />}
                iconTone={item.active ? "positive" : "neutral"}
                value={
                  <span className="tos-stat__value">
                    {item.active ? "Active" : "Archived"}
                  </span>
                }
                hint={item.active ? "Visible in POS" : "Hidden from POS"}
              />
            </div>
          ) : null}

          {/* Form fields */}
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cat-name">Name<span className="tos-field__label-required">*</span></label>
            <input id="cat-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} disabled={!canWrite || busy} />
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cat-sku">SKU</label>
            <input id="cat-sku" className="tos-input" value={sku} onChange={(e) => setSku(e.target.value)} disabled={!canWrite || busy} placeholder="Optional" />
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cat-kind">Kind</label>
            <select id="cat-kind" className="tos-select" value={kind} onChange={(e) => setKind(e.target.value as CatalogItem["kind"])} disabled={!canWrite || busy}>
              {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label} — {k.desc}</option>)}
            </select>
          </div>

          {/* Units — the canonical multi-unit contract */}
          <div className="tos-section">
            <div className="tos-section__head">
              <h3 className="tos-section__title">Units<span className="tos-field__label-required">*</span></h3>
              <span className="tos-section__sub">Buy, sell and count in different units — crate → bottle → glass.</span>
            </div>
            <div className="tos-section__body tos-stack">
              {units.map((unit, idx) => {
                const code = normalizeUnitCode(unit.code);
                const isStockUnit = effectiveTrackStock && stockUnitCode === code && code !== "";
                return (
                  <div key={idx} className="tos-receipt-builder-line">
                    <div className="tos-receipt-builder-line__head">
                      <span className="tos-receipt-builder-line__index">
                        <span className="tos-receipt-builder-line__index-num">{idx + 1}</span>
                        Unit {idx + 1}{isStockUnit ? " · stock unit" : ""}
                      </span>
                      {units.length > 1 ? (
                        <button
                          type="button"
                          className="tos-receipt-builder-line__remove"
                          onClick={() => removeUnit(idx)}
                          aria-label={`Remove unit ${idx + 1}`}
                          disabled={!canWrite || busy}
                        >
                          <IconTrash style={{ width: 14, height: 14 }} />
                        </button>
                      ) : null}
                    </div>
                    <div className="tos-form-grid tos-form-grid--3 tos-catalog-unit-grid">
                      <div className="tos-field">
                        <label className="tos-field__label" htmlFor={`cat-unit-code-${idx}`}>Unit code</label>
                        <input
                          id={`cat-unit-code-${idx}`}
                          className="tos-input"
                          list="cat-common-units"
                          value={unit.code}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setUnit(idx, { code: raw });
                            const known = COMMON_UNITS.find((u) => u.code === normalizeUnitCode(raw));
                            setUnit(idx, { code: raw, label: unit.label || known?.label || "" });
                          }}
                          placeholder="e.g. crate"
                          maxLength={32}
                          disabled={!canWrite || busy}
                        />
                      </div>
                      <div className="tos-field">
                        <label className="tos-field__label" htmlFor={`cat-unit-label-${idx}`}>Label</label>
                        <input
                          id={`cat-unit-label-${idx}`}
                          className="tos-input"
                          value={unit.label}
                          onChange={(e) => setUnit(idx, { label: e.target.value })}
                          placeholder="e.g. Crate of 24"
                          maxLength={120}
                          disabled={!canWrite || busy}
                        />
                      </div>
                      {unit.canSell ? (
                        <MoneyInput
                          currencyCode={currencyCode}
                          valueMinor={unit.priceMinor}
                          onChange={(v) => setUnit(idx, { priceMinor: v })}
                          label={`Sale price per ${normalizeUnitCode(unit.code) || "unit"}`}
                          required
                          disabled={!canWrite || busy}
                        />
                      ) : <div aria-hidden="true" />}
                    </div>
                    <div className="tos-check-grid" role="group" aria-label={`Capabilities of unit ${idx + 1}`}>
                      <label className="tos-check-pill">
                        <input type="checkbox" checked={unit.canPurchase} onChange={(e) => setUnit(idx, { canPurchase: e.target.checked })} disabled={!canWrite || busy} />
                        <span>Purchasable</span>
                      </label>
                      <label className="tos-check-pill">
                        <input type="checkbox" checked={unit.canSell} onChange={(e) => setUnit(idx, { canSell: e.target.checked })} disabled={!canWrite || busy} />
                        <span>Sellable</span>
                      </label>
                      <label className="tos-check-pill">
                        <input type="checkbox" checked={unit.canStock} onChange={(e) => setUnit(idx, { canStock: e.target.checked })} disabled={!canWrite || busy} />
                        <span>Stockable</span>
                      </label>
                    </div>
                  </div>
                );
              })}
              <datalist id="cat-common-units">
                {COMMON_UNITS.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
              </datalist>
              <Button type="button" variant="outline" size="sm" icon={<IconPlus className="tos-btn__icon" />} onClick={addUnit} disabled={!canWrite || busy}>
                Add unit
              </Button>
            </div>
          </div>

          {/* Conversions — how units relate (crate of 24 bottles) */}
          <div className="tos-section">
            <div className="tos-section__head">
              <h3 className="tos-section__title">Conversions</h3>
              <span className="tos-section__sub">How many of the "to" unit equal one "from" unit — e.g. 1 crate = 24 bottles.</span>
            </div>
            <div className="tos-section__body tos-stack">
              {conversions.length === 0 ? (
                <p className="tos-section__sub tos-catalog-empty-hint">No conversions yet. Add one if this item sells or stocks in more than one unit.</p>
              ) : null}
              {conversions.map((conversion, idx) => (
                <div key={idx} className="tos-catalog-conversion-grid">
                  <div className="tos-field">
                    <label className="tos-field__label" htmlFor={`cat-conv-from-${idx}`}>From</label>
                    <select
                      id={`cat-conv-from-${idx}`}
                      className="tos-select"
                      value={conversion.fromUnitCode}
                      onChange={(e) => setConversion(idx, { fromUnitCode: e.target.value })}
                      disabled={!canWrite || busy}
                    >
                      <option value="">Unit…</option>
                      {units.filter((u) => u.code.trim()).map((u) => (
                        <option key={normalizeUnitCode(u.code)} value={normalizeUnitCode(u.code)}>{u.label || u.code}</option>
                      ))}
                    </select>
                  </div>
                  <div className="tos-field">
                    <label className="tos-field__label" htmlFor={`cat-conv-to-${idx}`}>To</label>
                    <select
                      id={`cat-conv-to-${idx}`}
                      className="tos-select"
                      value={conversion.toUnitCode}
                      onChange={(e) => setConversion(idx, { toUnitCode: e.target.value })}
                      disabled={!canWrite || busy}
                    >
                      <option value="">Unit…</option>
                      {units.filter((u) => u.code.trim()).map((u) => (
                        <option key={normalizeUnitCode(u.code)} value={normalizeUnitCode(u.code)}>{u.label || u.code}</option>
                      ))}
                    </select>
                  </div>
                  <div className="tos-field">
                    <label className="tos-field__label" htmlFor={`cat-conv-factor-${idx}`}>Factor</label>
                    <input
                      id={`cat-conv-factor-${idx}`}
                      type="number"
                      className="tos-input"
                      value={conversion.factor}
                      onChange={(e) => setConversion(idx, { factor: e.target.value })}
                      min={0}
                      step="any"
                      disabled={!canWrite || busy}
                    />
                  </div>
                  <button
                    type="button"
                    className="tos-receipt-builder-line__remove"
                    onClick={() => removeConversion(idx)}
                    aria-label={`Remove conversion ${idx + 1}`}
                    disabled={!canWrite || busy}
                    style={{ marginBottom: "var(--tos-space-2)" }}
                  >
                    <IconTrash style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" icon={<IconPlus className="tos-btn__icon" />} onClick={addConversion} disabled={!canWrite || busy || units.filter((u) => u.code.trim()).length < 2}>
                Add conversion
              </Button>
            </div>
          </div>

          <label className="tos-row tos-row--between" style={{ gap: "var(--tos-space-2)", minHeight: "var(--tos-touch-mobile, 48px)", padding: "var(--tos-space-2) 0" }}>
            <span>
              <span style={{ display: "block", fontWeight: 700, color: "var(--tos-text-strong)" }}>Track inventory for this item</span>
              <span className="tos-section__sub">Count on-hand and available stock in the item&apos;s stock unit.</span>
            </span>
            <input
              type="checkbox"
              checked={effectiveTrackStock}
              onChange={(e) => setTrackStock(e.target.checked)}
              disabled={!canWrite || busy || kind === "SERVICE"}
              aria-label="Track inventory"
            />
          </label>
          {kind === "SERVICE" ? (
            <div className="tos-callout tos-callout--info">
              <span className="tos-callout__body">
                Services are never stocked — inventory tracking is disabled automatically.
              </span>
            </div>
          ) : null}

          {/* Catalog integrity guidance */}
          <div className="tos-callout tos-callout--info">
            <span className="tos-callout__icon-wrap" aria-hidden="true">
              <IconShield style={{ width: 16, height: 16 }} />
            </span>
            <span className="tos-callout__body">
              TradeOS keeps prices, stock levels and valuation in sync with the transactions you record.
              <span className="tos-callout__sub"> Changes made while offline are saved and synced when the connection returns. Items with sales history keep their established unit structure to protect past receipts and stock records.</span>
            </span>
          </div>

          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}

          {/* Lifecycle — archive / reactivate (edit mode only) */}
          {item && canWrite ? (
            <div className="tos-callout tos-callout--warning">
              <div className="tos-row tos-row--between" style={{ flexWrap: "wrap", gap: "var(--tos-space-2)" }}>
                <div>
                  <strong>{isArchived ? "Reactivate item" : "Archive item"}</strong>
                  <div className="tos-section__sub">
                    {isArchived
                      ? "Bring this item back into active use at the POS."
                      : "Archived items are hidden from the POS and inventory but kept for historical evidence."}
                  </div>
                </div>
                <Button
                  type="button"
                  variant={isArchived ? "positive" : "outline"}
                  onClick={() => handleLifecycle(isArchived ? CATALOG_ITEM_REACTIVATE_TYPE : CATALOG_ITEM_ARCHIVE_TYPE)}
                  loading={lifecycleBusy}
                  disabled={lifecycleBusy || busy}
                >
                  {isArchived ? "Reactivate" : "Archive"}
                </Button>
              </div>
              {lifecycleError ? <div className="tos-banner tos-banner--danger" style={{ marginTop: "var(--tos-space-2)" }}><span className="tos-banner__title">{lifecycleError}</span></div> : null}
            </div>
          ) : null}
        </form>

        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            onClick={handleSubmit}
            loading={busy}
            disabled={!name.trim() || !canWrite || busy || Boolean(validationError)}
          >
            {canWrite ? (isEdit ? "Save changes" : "Create item") : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}

interface CatalogStatProps {
  label: string;
  icon: ReactNode;
  iconTone: "gold" | "positive" | "warning" | "midnight" | "neutral";
  value: ReactNode;
  hint?: string;
}

const CATALOG_STAT_TILE: Record<CatalogStatProps["iconTone"], string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

function CatalogStat({ label, icon, iconTone, value, hint }: CatalogStatProps) {
  return (
    <div className="tos-stat tos-card-hover">
      <div className="tos-stat__head">
        <span className={CATALOG_STAT_TILE[iconTone]} aria-hidden="true">
          {icon}
        </span>
        <span className="tos-stat__label">{label}</span>
      </div>
      {value}
      {hint ? <span className="tos-stat__hint">{hint}</span> : null}
    </div>
  );
}
