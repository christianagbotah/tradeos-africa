"use client";

import { useEffect, useState } from "react";
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
  IconReceipt,
  IconShield,
} from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import {
  buildCatalogLifecyclePayload,
  CATALOG_ITEM_ARCHIVE_TYPE,
  CATALOG_ITEM_REACTIVATE_TYPE,
  CATALOG_WRITE_ROLES,
  roleCan,
  type WorkspaceRole,
} from "../../../lib/mutation-builders";
import type { CatalogItem } from "../workspace/workspace-provider";

interface CatalogItemSheetProps {
  item: CatalogItem | null;
  open?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const SALE_UNITS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "EACH", label: "Each — piece" },
  { value: "KG", label: "Kilogram (kg)" },
  { value: "G", label: "Gram (g)" },
  { value: "L", label: "Litre (L)" },
  { value: "ML", label: "Millilitre (ml)" },
  { value: "M", label: "Metre (m)" },
  { value: "CM", label: "Centimetre (cm)" },
  { value: "BOX", label: "Box" },
  { value: "PACK", label: "Pack" },
  { value: "BOTTLE", label: "Bottle" },
  { value: "CRATE", label: "Crate" },
  { value: "SACK", label: "Sack" },
  { value: "COIL", label: "Coil" },
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

export function CatalogItemSheet({ item, open = false, onClose, onSaved }: CatalogItemSheetProps) {
  const { session, role, refreshCatalog } = useWorkspace();
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [priceMinor, setPriceMinor] = useState<number | null>(null);
  const [saleUnitCode, setSaleUnitCode] = useState("EACH");
  const [kind, setKind] = useState<CatalogItem["kind"]>("PRODUCT");
  const [trackInventory, setTrackInventory] = useState(true);
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
      setPriceMinor(item.priceMinor);
      setSaleUnitCode(item.saleUnitCode);
      setKind(item.kind);
      setTrackInventory(item.trackInventory);
    } else {
      setName("");
      setSku("");
      setPriceMinor(null);
      setSaleUnitCode("EACH");
      setKind("PRODUCT");
      setTrackInventory(true);
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

  if (!session) return null;
  if (!item && !open) return null;

  const currencyCode = session.currencyCode;
  const isArchived = item?.status === "ARCHIVED";
  const effectiveTrack = kind === "SERVICE" ? false : trackInventory;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || priceMinor === null || busy || !canWrite) return;
    setBusy(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      const payload: Record<string, unknown> = {
        name: name.trim(),
        sku: sku.trim() || null,
        saleUnitCode,
        kind,
        priceMinor,
        trackInventory: effectiveTrack,
      };
      const mutation = queue.build({
        businessId: session.businessId,
        mutationType: isEdit && item ? "CATALOG_ITEM_UPDATE" : "CATALOG_ITEM_CREATE",
        payload: isEdit && item ? { ...payload, itemId: item.id, expectedUpdatedAt: item.updatedAt } : payload,
      });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
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
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
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
          {/* Gold hero — shows the item identity (or "New item") with kind + price + unit */}
          <div className="tos-catalog-hero tos-animate-fade-in-up">
            <div className="tos-catalog-hero__head">
              <div className="tos-catalog-hero__head-main">
                <span className="tos-catalog-hero__eyebrow">{KIND_LABEL[kind]}</span>
                <h3 className="tos-catalog-hero__title">{name.trim() || (isEdit ? item?.name ?? "Untitled item" : "New catalog item")}</h3>
                <p className="tos-catalog-hero__sub">
                  {sku.trim() ? `SKU ${sku.trim()}` : "No SKU"} · Sold per {saleUnitCode}
                </p>
              </div>
              <span className={KIND_TILE_CLASS[kind]} aria-hidden="true">
                {KIND_ICON[kind]}
              </span>
            </div>
            <div className="tos-catalog-hero__price-row">
              <span className="tos-catalog-hero__price-label">Sale price</span>
              <MoneyValue
                minor={priceMinor ?? 0}
                currencyCode={currencyCode}
                className="tos-catalog-hero__price"
              />
            </div>
            <p className="tos-catalog-hero__unit">
              Priced per {saleUnitCode}. The server derives line totals, taxes and COGS from this — never the client.
            </p>
          </div>

          {/* 3-up stats — only meaningful in edit mode (current saved state) */}
          {item ? (
            <div className="tos-catalog-stats tos-animate-fade-in-up">
              <CatalogStat
                label="Sale unit"
                icon={<IconBox className="tos-stat__icon-tile-svg" />}
                iconTone="midnight"
                value={<span className="tos-stat__value">{item.saleUnitCode}</span>}
                hint={item.saleUnitName}
              />
              <CatalogStat
                label="Stock tracking"
                icon={<IconInventory className="tos-stat__icon-tile-svg" />}
                iconTone={item.trackInventory ? "positive" : "neutral"}
                value={
                  <span className="tos-stat__value">
                    {item.trackInventory ? "Tracked" : "Off"}
                  </span>
                }
                hint={
                  item.trackInventory
                    ? item.inventoryAvailable === null
                      ? "No count yet"
                      : `${item.inventoryAvailable} ${item.saleUnitName} available`
                    : "No stock recorded"
                }
              />
              <CatalogStat
                label="Status"
                icon={<IconShield className="tos-stat__icon-tile-svg" />}
                iconTone={item.status === "ACTIVE" ? "positive" : "neutral"}
                value={
                  <span className="tos-stat__value">
                    {item.status === "ACTIVE" ? "Active" : "Archived"}
                  </span>
                }
                hint={item.status === "ACTIVE" ? "Visible in POS" : "Hidden from POS"}
              />
            </div>
          ) : null}

          {/* Form fields */}
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cat-name">Name<span className="tos-field__label-required">*</span></label>
            <input id="cat-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} disabled={!canWrite || busy} />
          </div>
          <div className="tos-public__form-row">
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="cat-sku">SKU</label>
              <input id="cat-sku" className="tos-input" value={sku} onChange={(e) => setSku(e.target.value)} disabled={!canWrite || busy} placeholder="Optional" />
            </div>
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="cat-unit">Sale unit</label>
              <select id="cat-unit" className="tos-select" value={saleUnitCode} onChange={(e) => setSaleUnitCode(e.target.value)} disabled={!canWrite || busy}>
                {SALE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cat-kind">Kind</label>
            <select id="cat-kind" className="tos-select" value={kind} onChange={(e) => setKind(e.target.value as CatalogItem["kind"])} disabled={!canWrite || busy}>
              {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label} — {k.desc}</option>)}
            </select>
          </div>
          <MoneyInput
            currencyCode={currencyCode}
            valueMinor={priceMinor}
            onChange={setPriceMinor}
            label="Sale price (per unit)"
            size="lg"
            required
            disabled={!canWrite || busy}
          />
          <label className="tos-row tos-row--between" style={{ gap: "var(--tos-space-2)", minHeight: "var(--tos-touch-mobile, 48px)", padding: "var(--tos-space-2) 0" }}>
            <span>
              <span style={{ display: "block", fontWeight: 700, color: "var(--tos-text-strong)" }}>Track inventory for this item</span>
              <span className="tos-section__sub">Count on-hand and available stock in the sale unit.</span>
            </span>
            <input
              type="checkbox"
              checked={effectiveTrack}
              onChange={(e) => setTrackInventory(e.target.checked)}
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

          {/* Server-authoritative framing */}
          <div className="tos-callout tos-callout--info">
            <span className="tos-callout__icon-wrap" aria-hidden="true">
              <IconShield style={{ width: 16, height: 16 }} />
            </span>
            <span className="tos-callout__body">
              Prices, stock levels and valuations are server-authoritative.
              <span className="tos-callout__sub"> This change is queued locally and reconciled on sync — the client never writes a balance or total directly.</span>
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
          <Button type="submit" variant="primary" onClick={handleSubmit} loading={busy} disabled={!name.trim() || priceMinor === null || !canWrite || busy}>
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
