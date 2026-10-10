"use client";

import { FormEvent, useMemo, useState } from "react";
import { parseMoneyInput } from "@tradeos/contracts";
import { clientApi, messageFrom } from "../lib/client-api";

type StarterMode = "simple" | "bulk" | "service";

export function CatalogStarter({ businessId, branchId, currencyCode, onCreated }: { businessId: string; branchId: string; currencyCode: string; onCreated: () => void }) {
  const [mode, setMode] = useState<StarterMode>("simple");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [openingStock, setOpeningStock] = useState("");
  const [simpleUnit, setSimpleUnit] = useState("piece");
  const [purchaseUnit, setPurchaseUnit] = useState("bottle");
  const [stockUnit, setStockUnit] = useState("ml");
  const [saleUnit, setSaleUnit] = useState("glass");
  const [purchaseFactor, setPurchaseFactor] = useState("750");
  const [saleFactor, setSaleFactor] = useState("50");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const priceMinor = useMemo(() => parseMoneyInput(price, currencyCode), [price, currencyCode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      let payload: Record<string, unknown>;
      if (mode === "service") {
        payload = {
          businessId,
          name,
          kind: "SERVICE",
          units: [{ code: "service", label: "Service", canSell: true, defaultSalePriceMinor: priceMinor }],
        };
      } else if (mode === "simple") {
        const unit = normalizeUnit(simpleUnit);
        payload = {
          businessId,
          name,
          kind: "PRODUCT",
          trackStock: true,
          stockUnitCode: unit,
          units: [{ code: unit, label: titleUnit(unit), canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: priceMinor }],
          ...(positiveNumber(openingStock) ? { openingStock: { branchId, quantity: Number(openingStock) } } : {}),
        };
      } else {
        const purchase = normalizeUnit(purchaseUnit);
        const stock = normalizeUnit(stockUnit);
        const sale = normalizeUnit(saleUnit);
        payload = {
          businessId,
          name,
          kind: "PRODUCT",
          trackStock: true,
          stockUnitCode: stock,
          units: mergeUnits([
            { code: purchase, label: titleUnit(purchase), canPurchase: true },
            { code: stock, label: titleUnit(stock), canStock: true },
            { code: sale, label: titleUnit(sale), canSell: true, defaultSalePriceMinor: priceMinor },
          ]),
          conversions: [
            ...(purchase !== stock ? [{ fromUnitCode: purchase, toUnitCode: stock, factor: Number(purchaseFactor) }] : []),
            ...(sale !== stock ? [{ fromUnitCode: sale, toUnitCode: stock, factor: Number(saleFactor) }] : []),
          ],
          ...(positiveNumber(openingStock) ? { openingStock: { branchId, quantity: Number(openingStock) } } : {}),
        };
      }

      await clientApi("/api/tradeos/v1/catalog/items", { method: "POST", body: JSON.stringify(payload) });
      setName("");
      setPrice("");
      setOpeningStock("");
      setMessage("Item created. It is now available to the business.");
      onCreated();
    } catch (reason) {
      setMessage(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tradeos-card catalog-starter" id="catalog">
      <div className="tradeos-card-heading"><div><p  className="tradeos-kicker">Real catalog</p><h2>Add a product or service</h2></div><span className="tradeos-badge">Flexible units</span></div>
      <div className="starter-tabs">
        <button className={mode === "simple" ? "active" : ""} type="button" onClick={() => setMode("simple")}>Simple product</button>
        <button className={mode === "bulk" ? "active" : ""} type="button" onClick={() => setMode("bulk")}>Buy bulk · sell smaller</button>
        <button className={mode === "service" ? "active" : ""} type="button" onClick={() => setMode("service")}>Service</button>
      </div>
      <form className="catalog-form" onSubmit={(event) => void submit(event)}>
        <div className="tradeos-form-row">
          <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder={mode === "service" ? "Standard haircut" : mode === "bulk" ? "750ml Whisky" : "Malt"} /></label>
          <label>Sale price ({currencyCode === "GHS" ? "₵" : currencyCode})<input required inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="18.00" /></label>
        </div>

        {mode === "simple" ? (
          <div className="tradeos-form-row">
            <label>Unit<input required value={simpleUnit} onChange={(event) => setSimpleUnit(event.target.value)} placeholder="piece" /></label>
            <label>Opening stock (optional)<input inputMode="decimal" value={openingStock} onChange={(event) => setOpeningStock(event.target.value)} placeholder="24" /></label>
          </div>
        ) : null}

        {mode === "bulk" ? (
          <>
            <div className="tradeos-form-row triple">
              <label>Buy as<input required value={purchaseUnit} onChange={(event) => setPurchaseUnit(event.target.value)} placeholder="bottle" /></label>
              <label>Track stock as<input required value={stockUnit} onChange={(event) => setStockUnit(event.target.value)} placeholder="ml" /></label>
              <label>Sell as<input required value={saleUnit} onChange={(event) => setSaleUnit(event.target.value)} placeholder="glass" /></label>
            </div>
            <div className="tradeos-form-row triple">
              <label>1 {purchaseUnit || "purchase unit"} = how many {stockUnit || "stock units"}?<input required inputMode="decimal" value={purchaseFactor} onChange={(event) => setPurchaseFactor(event.target.value)} /></label>
              <label>1 {saleUnit || "sale unit"} = how many {stockUnit || "stock units"}?<input required inputMode="decimal" value={saleFactor} onChange={(event) => setSaleFactor(event.target.value)} /></label>
              <label>Opening stock in {stockUnit || "stock units"}<input inputMode="decimal" value={openingStock} onChange={(event) => setOpeningStock(event.target.value)} placeholder="750" /></label>
            </div>
            <p className="conversion-preview">Example: if you track whisky in ml, configure 1 bottle = 750 ml and 1 glass = 50 ml. Returning one glass will restore 50 ml—not one whole bottle.</p>
          </>
        ) : null}

        {mode === "service" ? <p className="conversion-preview">Services do not create stock themselves. Recipe/service consumables such as blades, shampoo or chemicals will be attached in the next catalog layer.</p> : null}
        {message ? <div className={message.startsWith("Item created") ? "form-success" : "form-error"}>{message}</div> : null}
        <button  className="tos-button tos-button--primary" type="submit" disabled={busy || priceMinor === null}>{busy ? "Saving…" : "Add to catalog"}</button>
      </form>
    </section>
  );
}



function positiveNumber(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function normalizeUnit(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function titleUnit(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type DraftUnit = { code: string; label: string; canPurchase?: boolean; canSell?: boolean; canStock?: boolean; defaultSalePriceMinor?: number | null };

function mergeUnits(units: DraftUnit[]): DraftUnit[] {
  const merged = new Map<string, DraftUnit>();
  for (const unit of units) {
    const prior = merged.get(unit.code);
    merged.set(unit.code, {
      code: unit.code,
      label: prior?.label ?? unit.label,
      canPurchase: Boolean(prior?.canPurchase || unit.canPurchase),
      canSell: Boolean(prior?.canSell || unit.canSell),
      canStock: Boolean(prior?.canStock || unit.canStock),
      ...(unit.defaultSalePriceMinor !== undefined && unit.defaultSalePriceMinor !== null
        ? { defaultSalePriceMinor: unit.defaultSalePriceMinor }
        : prior?.defaultSalePriceMinor !== undefined && prior.defaultSalePriceMinor !== null
          ? { defaultSalePriceMinor: prior.defaultSalePriceMinor }
          : {}),
    });
  }
  return Array.from(merged.values());
}
