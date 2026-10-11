"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";
import { IconClose } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import type { CatalogItem } from "../workspace/workspace-provider";

interface CatalogItemSheetProps {
  item: CatalogItem | null;
  open?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

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

  const isEdit = Boolean(item);
  const canWrite = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"].includes(role);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setSku(item.sku ?? "");
      setPriceMinor(item.priceMinor);
      setSaleUnitCode(item.saleUnitCode);
      setKind(item.kind);
      setTrackInventory(item.trackInventory);
    } else {
      setName(""); setSku(""); setPriceMinor(null); setSaleUnitCode("EACH"); setKind("PRODUCT"); setTrackInventory(true);
    }
    setBusy(false); setError(null);
  }, [item]);

  useEffect(() => {
    if (!item && typeof document !== "undefined") {
      // open as form sheet for create
    }
    return () => {
      if (typeof document !== "undefined") document.body.style.overflow = "";
    };
  }, [item]);

  if (!session) return null;
  if (!item && !open) return null;

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
        trackInventory,
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

  const currencyCode = session.currencyCode;

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label={isEdit ? "Edit catalog item" : "Add catalog item"}>
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Master data</span>
            <h2 className="tos-sheet__title">{isEdit ? "Edit item" : "Add catalog item"}</h2>
            {item ? <p className="tos-sheet__sub">{item.name}</p> : null}
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <form className="tos-sheet__body" onSubmit={handleSubmit}>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cat-name">Name<span className="tos-field__label-required">*</span></label>
            <input id="cat-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} disabled={!canWrite} />
          </div>
          <div className="tos-public__form-row">
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="cat-sku">SKU</label>
              <input id="cat-sku" className="tos-input" value={sku} onChange={(e) => setSku(e.target.value)} disabled={!canWrite} />
            </div>
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="cat-unit">Sale unit</label>
              <select id="cat-unit" className="tos-select" value={saleUnitCode} onChange={(e) => setSaleUnitCode(e.target.value)} disabled={!canWrite}>
                <option value="EACH">Each</option>
                <option value="KG">Kilogram</option>
                <option value="G">Gram</option>
                <option value="L">Litre</option>
                <option value="ML">Millilitre</option>
                <option value="M">Metre</option>
                <option value="CM">Centimetre</option>
                <option value="BOX">Box</option>
                <option value="PACK">Pack</option>
                <option value="BOTTLE">Bottle</option>
              </select>
            </div>
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cat-kind">Kind</label>
            <select id="cat-kind" className="tos-select" value={kind} onChange={(e) => setKind(e.target.value as CatalogItem["kind"])} disabled={!canWrite}>
              <option value="PRODUCT">Product (stocked)</option>
              <option value="PREPARED_PRODUCT">Prepared product</option>
              <option value="SERVICE">Service (no stock)</option>
            </select>
          </div>
          <MoneyInput
            currencyCode={currencyCode}
            valueMinor={priceMinor}
            onChange={setPriceMinor}
            label="Sale price"
            size="lg"
            required
            disabled={!canWrite}
          />
          <label className="tos-row" style={{ gap: "var(--tos-space-2)" }}>
            <input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} disabled={!canWrite || kind === "SERVICE"} />
            <span>Track inventory for this item</span>
          </label>
          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
          {item ? (
            <dl className="tos-kv">
              <div><dt className="tos-kv__key">Current price</dt><dd className="tos-kv__val"><MoneyValue minor={item.priceMinor} currencyCode={currencyCode} /></dd></div>
              <div><dt className="tos-kv__key">Stock available</dt><dd className="tos-kv__val">{item.inventoryAvailable ?? "—"}</dd></div>
            </dl>
          ) : null}
        </form>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" onClick={handleSubmit} loading={busy} disabled={!name.trim() || priceMinor === null || !canWrite}>
            {canWrite ? (isEdit ? "Save changes" : "Create item") : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
