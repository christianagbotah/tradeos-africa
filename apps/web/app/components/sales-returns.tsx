"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { SalesWorkspace } from "./sales/sales-workspace";
import { SaleDetailSheet } from "./sales/sale-detail-sheet";
import { canAccessWorkspaceRoute } from "./workspace/workspace-navigation";
import { readFeatureCache, writeFeatureCache } from "../lib/feature-cache";
import { captureSessionEpoch, isSessionEpochCurrent } from "../lib/session-lifecycle";
import {
  enqueueMutation,
  flushPendingMutations,
  getOrCreateClientId,
  mutationAppliedEvent,
  type AppliedMutationDetail,
} from "../lib/offline-sync";

type SaleSummary = {
  id: string;
  status: string;
  currencyCode: string;
  totalMinor: number;
  refundTotalMinor: number;
  completedAt: string | null;
  createdAt: string;
  customer: { name: string | null; phone: string | null } | null;
  cashierName: string | null;
  payments: Array<{ method: string; amountMinor: number; status: string }>;
};

type SaleLine = {
  id: string;
  itemId: string;
  itemName: string;
  itemKind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  quantity: number;
  quantityReturned: number;
  quantityReturnable: number;
  saleUnitCode: string;
  unitNetMinor: number;
  unitTaxMinor: number;
  lineTotalMinor: number;
};

type SaleDetail = {
  id: string;
  businessId: string;
  branchId: string;
  status: string;
  currencyCode: string;
  totalMinor: number;
  completedAt: string | null;
  createdAt: string;
  customer: { id: string; name: string | null; phone: string | null } | null;
  cashierName: string | null;
  lines: SaleLine[];
  payments: Array<{
    id: string;
    method: string;
    amountMinor: number;
    refundedMinor: number;
    status: string;
    providerReference: string | null;
  }>;
};

type ReturnMode = "RETURN_REFUND" | "REFUND_ONLY";
type RefundMethod = "ORIGINAL_METHOD" | "CASH" | "MOMO" | "CARD" | "BANK" | "CUSTOMER_CREDIT";
type Disposition = "RESTOCK" | "QUARANTINE" | "DISCARD" | "NOT_RETURNED" | "NOT_APPLICABLE";
type LineDraft = { selected: boolean; quantity: string; disposition: Disposition };

type Props = {
  businessId: string;
  branchId: string;
  currencyCode: string;
  view: "sales" | "returns";
  role: string;
};

function isSalesListCache(value: unknown): value is { sales: SaleSummary[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { sales?: unknown }).sales));
}
function isSaleDetailCache(value: unknown): value is { sale: SaleDetail } {
  const sale = value && typeof value === "object" ? (value as { sale?: unknown }).sale : null;
  return Boolean(sale && typeof sale === "object" && Array.isArray((sale as { lines?: unknown }).lines) && Array.isArray((sale as { payments?: unknown }).payments));
}

export function SalesAndReturns({ businessId, branchId, currencyCode, view, role }: Props) {
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SaleDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [mode, setMode] = useState<ReturnMode>("RETURN_REFUND");
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("ORIGINAL_METHOD");
  const [reason, setReason] = useState("Customer return");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadSales = async (search = query) => {
    const sessionEpoch = captureSessionEpoch();
    setLoading(true);
    const cacheToken = search.trim().toLowerCase() || "all";
    const cached = readFeatureCache("sales-list", businessId, branchId, cacheToken, isSalesListCache);
    if (cached) setSales(cached.sales);
    if (!navigator.onLine) {
      setMessage(cached ? "Offline: showing saved sales for this branch." : "Offline: no saved sales exist for this search on this device yet.");
      setLoading(false);
      return;
    }
    try {
      const params = new URLSearchParams({ businessId, branchId, limit: "30" });
      if (search.trim()) params.set("query", search.trim());
      const response = await clientApi<{ sales: SaleSummary[] }>(`/api/tradeos/v1/sales?${params}`);
      if (!isSessionEpochCurrent(sessionEpoch)) return;
      setSales(response.sales);
      writeFeatureCache("sales-list", businessId, branchId, response, cacheToken);
      setMessage(null);
    } catch (error) {
      if (isSessionEpochCurrent(sessionEpoch)) setMessage(cached ? `Showing saved sales. ${error instanceof Error ? error.message : "Live sales are unavailable."}` : error instanceof Error ? error.message : "Sales could not be loaded.");
    } finally {
      if (isSessionEpochCurrent(sessionEpoch)) setLoading(false);
    }
  };

  const applySaleDetail = (sale: SaleDetail) => {
    setSelected(sale);
    setDrafts(Object.fromEntries(sale.lines.map((line) => [
      line.id,
      {
        selected: false,
        quantity: line.quantityReturnable > 0 ? String(Math.min(1, line.quantityReturnable)) : "0",
        disposition: defaultDisposition(line.itemKind),
      },
    ])));
  };

  const loadDetail = async (saleId: string) => {
    const sessionEpoch = captureSessionEpoch();
    setMessage(null);
    const cached = readFeatureCache("sale-detail", businessId, branchId, saleId, isSaleDetailCache);
    if (cached) applySaleDetail(cached.sale);
    if (!navigator.onLine) {
      if (!cached) setMessage("Offline: this sale has not been opened on this device yet.");
      return;
    }
    try {
      const response = await clientApi<{ sale: SaleDetail }>(
        `/api/tradeos/v1/sales/${saleId}?businessId=${encodeURIComponent(businessId)}`,
      );
      if (!isSessionEpochCurrent(sessionEpoch)) return;
      applySaleDetail(response.sale);
      writeFeatureCache("sale-detail", businessId, branchId, response, saleId);
    } catch (error) {
      if (isSessionEpochCurrent(sessionEpoch) && !cached) setMessage(error instanceof Error ? error.message : "Sale details could not be loaded.");
    }
  };

  useEffect(() => {
    setSelected(null);
    setDrafts({});
    void loadSales("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, branchId]);

  useEffect(() => {
    const onMutationApplied = (event: Event) => {
      const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
      if (!detail || detail.businessId !== businessId || detail.branchId !== branchId) return;
      if (!["SALE_CREATE", "RETURN_CREATE", "REFUND_CREATE"].includes(detail.mutationType)) return;
      void loadSales(query);
    };

    window.addEventListener(mutationAppliedEvent, onMutationApplied);
    return () => window.removeEventListener(mutationAppliedEvent, onMutationApplied);
    // loadSales is intentionally scoped to the current search/context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, branchId, query]);

  const selectedLines = useMemo(() => {
    if (!selected) return [];
    return selected.lines.flatMap((line) => {
      const draft = drafts[line.id];
      if (!draft?.selected) return [];
      const quantity = Number(draft.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > line.quantityReturnable) return [];
      return [{ line, quantity, disposition: resolvedDisposition(line.itemKind, mode, draft.disposition) }];
    });
  }, [selected, drafts, mode]);

  const refundPreviewMinor = useMemo(
    () => selectedLines.reduce((sum, item) => sum + Math.round((item.line.unitNetMinor + item.line.unitTaxMinor) * item.quantity), 0),
    [selectedLines],
  );

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void loadSales(query);
  };

  const processReturn = async () => {
    if (!selected || selectedLines.length === 0 || busy || !reason.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      enqueueMutation({
        clientId: getOrCreateClientId(),
        clientMutationId: crypto.randomUUID(),
        businessId,
        branchId,
        mutationType: "RETURN_CREATE",
        occurredAt: new Date().toISOString(),
        payload: {
          originalSaleId: selected.id,
          reason: reason.trim(),
          refundMethod,
          lines: selectedLines.map((item) => ({
            saleLineId: item.line.id,
            quantity: item.quantity,
            disposition: item.disposition,
          })),
        },
      });

      if (!navigator.onLine) {
        setMessage("Return/refund saved safely offline. It will process when this device reconnects.");
        setSelected(null);
        return;
      }

      const summary = await flushPendingMutations();
      if (summary.rejected > 0) {
        setMessage("The return was saved but needs review before it can be applied.");
      } else if (summary.applied > 0) {
        setMessage("Return/refund applied. MoMo, card or bank reversals may remain processing until the provider confirms them.");
        await loadSales();
        await loadDetail(selected.id);
      } else {
        setMessage("Return/refund is queued for processing.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The return/refund could not be synchronized.");
    } finally {
      setBusy(false);
    }
  };

  if (view === "sales") {
    const canProcessReturns = canAccessWorkspaceRoute(role, "/returns");
    return (
      <section className="sales-page-workspace" id="sales" data-sales-view="sales">
        <SalesWorkspace
          sales={sales}
          selectedId={selected?.id ?? null}
          loading={loading}
          canProcessReturns={canProcessReturns}
          onSelect={(saleId) => void loadDetail(saleId)}
          onSearch={(search) => { setQuery(search); void loadSales(search); }}
        />
        {selected ? <SaleDetailSheet sale={selected} open canProcessReturns={canProcessReturns} onClose={() => setSelected(null)} /> : null}
        {message ? <div className="return-message" role="status">{message}</div> : null}
      </section>
    );
  }

  return (
    <section className="panel sales-return-panel" id="returns" data-sales-view="returns">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Protected reversal workflow</p>
          <h2>Returns & refunds</h2>
        </div>
        <span className="workflow-badge">Original sale required</span>
      </div>

      <form className="sales-search" onSubmit={submitSearch}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search receipt ID, customer name or phone" />
        <button className="ghost-button" type="submit">Search</button>
        <button className="text-button" type="button" onClick={() => { setQuery(""); void loadSales(""); }}>Clear</button>
      </form>

      <div className="sales-return-grid">
        <div className="sales-list" aria-busy={loading}>
          {loading ? <div className="sales-empty">Loading sales…</div> : null}
          {!loading && sales.length === 0 ? <div className="sales-empty">No completed sales found for this branch.</div> : null}
          {sales.map((sale) => (
            <button
              type="button"
              key={sale.id}
              className={selected?.id === sale.id ? "sale-row active" : "sale-row"}
              onClick={() => void loadDetail(sale.id)}
            >
              <div><strong>{shortReceipt(sale.id)}</strong><span>{formatDate(sale.completedAt ?? sale.createdAt)}</span></div>
              <div className="sale-row-right">
                <strong>{formatMoney(sale.totalMinor, sale.currencyCode)}</strong>
                <span>{sale.status.replaceAll("_", " ")}{sale.refundTotalMinor > 0 ? ` · ${formatMoney(sale.refundTotalMinor, sale.currencyCode)} refunded` : ""}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="return-detail">
          {!selected ? (
            <div className="return-placeholder">
              <strong>Select a sale</strong>
              <span>Choose an original sale to inspect returnable quantities and process a protected refund.</span>
            </div>
          ) : (
            <>
              <div className="return-detail-head">
                <div>
                  <p className="eyebrow">Receipt {shortReceipt(selected.id)}</p>
                  <h3>{formatMoney(selected.totalMinor, selected.currencyCode)}</h3>
                  <span>{formatDate(selected.completedAt ?? selected.createdAt)} · {selected.cashierName ?? "Staff"}</span>
                </div>
                <span className="sale-status">{selected.status.replaceAll("_", " ")}</span>
              </div>

              <div className="return-mode-grid compact-modes">
                <button type="button" className={mode === "RETURN_REFUND" ? "return-mode active" : "return-mode"} onClick={() => setMode("RETURN_REFUND")}>
                  <strong>Return + refund</strong><span>The item physically comes back where applicable.</span>
                </button>
                <button type="button" className={mode === "REFUND_ONLY" ? "return-mode active" : "return-mode"} onClick={() => setMode("REFUND_ONLY")}>
                  <strong>Refund only</strong><span>Customer keeps the product; stock stays unchanged.</span>
                </button>
              </div>

              <div className="returnable-lines">
                {selected.lines.map((line) => {
                  const draft = drafts[line.id];
                  const disabled = line.quantityReturnable <= 0;
                  return (
                    <div className={disabled ? "returnable-line exhausted" : "returnable-line"} key={line.id}>
                      <label className="return-check">
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={Boolean(draft?.selected)}
                          onChange={(event) => updateDraft(setDrafts, line.id, { selected: event.target.checked })}
                        />
                        <span><strong>{line.itemName}</strong><small>{line.quantityReturnable} of {line.quantity} {line.saleUnitCode} returnable</small></span>
                      </label>
                      <label>Qty<input type="number" min="0.00000001" max={line.quantityReturnable} step="any" disabled={disabled || !draft?.selected} value={draft?.quantity ?? "0"} onChange={(event) => updateDraft(setDrafts, line.id, { quantity: event.target.value })} /></label>
                      <DispositionField line={line} mode={mode} draft={draft} onChange={(disposition) => updateDraft(setDrafts, line.id, { disposition })} />
                    </div>
                  );
                })}
              </div>

              <div className="refund-controls">
                <label>Refund method
                  <select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as RefundMethod)}>
                    <option value="ORIGINAL_METHOD">Original payment method</option>
                    <option value="CASH">Cash</option>
                    <option value="MOMO">MoMo</option>
                    <option value="CARD">Card</option>
                    <option value="BANK">Bank</option>
                    <option value="CUSTOMER_CREDIT">Customer credit</option>
                  </select>
                </label>
                <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this being refunded?" /></label>
              </div>

              <div className="return-action-bar">
                <div><span>Refund preview</span><strong>{formatMoney(refundPreviewMinor, currencyCode)}</strong></div>
                <div><span>Selected lines</span><strong>{selectedLines.length}</strong></div>
                <button className="primary-button" type="button" disabled={selectedLines.length === 0 || busy || !reason.trim()} onClick={() => void processReturn()}>
                  {busy ? "Processing…" : "Process return / refund"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {message ? <div className="return-message">{message}</div> : null}
    </section>
  );
}


function DispositionField({ line, mode, draft, onChange }: { line: SaleLine; mode: ReturnMode; draft: LineDraft | undefined; onChange: (value: Disposition) => void }) {
  if (mode === "REFUND_ONLY") return <div className="stock-effect"><span>Stock</span><strong>No stock return</strong></div>;
  if (line.itemKind === "SERVICE") return <div className="stock-effect"><span>Stock</span><strong>Not applicable</strong></div>;
  if (line.itemKind === "PREPARED_PRODUCT") return <div className="stock-effect"><span>Returned item</span><strong>Discard / waste</strong></div>;

  return (
    <label>Returned stock
      <select disabled={!draft?.selected} value={draft?.disposition ?? "RESTOCK"} onChange={(event) => onChange(event.target.value as Disposition)}>
        <option value="RESTOCK">Available stock</option>
        <option value="QUARANTINE">Quarantine / inspect</option>
        <option value="DISCARD">Discard / unusable</option>
      </select>
    </label>
  );
}

function resolvedDisposition(kind: SaleLine["itemKind"], mode: ReturnMode, selected: Disposition): Disposition {
  if (kind === "SERVICE") return "NOT_APPLICABLE";
  if (mode === "REFUND_ONLY") return "NOT_RETURNED";
  if (kind === "PREPARED_PRODUCT") return "DISCARD";
  return selected;
}

function defaultDisposition(kind: SaleLine["itemKind"]): Disposition {
  if (kind === "SERVICE") return "NOT_APPLICABLE";
  if (kind === "PREPARED_PRODUCT") return "DISCARD";
  return "RESTOCK";
}

function updateDraft(
  setter: React.Dispatch<React.SetStateAction<Record<string, LineDraft>>>,
  lineId: string,
  patch: Partial<LineDraft>,
) {
  setter((current) => ({
    ...current,
    [lineId]: { ...(current[lineId] ?? { selected: false, quantity: "0", disposition: "RESTOCK" as Disposition }), ...patch },
  }));
}

async function clientApi<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) {
    const candidate = body as { message?: unknown } | null;
    throw new Error(typeof candidate?.message === "string" ? candidate.message : `Request failed (${response.status})`);
  }
  return body as T;
}

function shortReceipt(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatMoney(minor: number, currencyCode: string): string {
  if (currencyCode === "GHS") return `₵${(minor / 100).toFixed(2)}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100);
}
