"use client";

import { useEffect, useMemo, useState } from "react";
import { SalesWorkspace } from "./sales/sales-workspace";
import { SaleDetailSheet } from "./sales/sale-detail-sheet";
import type { SaleDetail, SaleLine, SaleSummary } from "./sales/types";
import { ReturnRefundWorkspace } from "./returns/return-refund-workspace";
import { ReturnRefundSheet, returnSyncMessage, type RefundMethod, type ReturnDisposition as Disposition, type ReturnLineDraft as LineDraft, type ReturnMode } from "./returns/return-refund-sheet";
import { ExchangeSheet } from "./returns/exchange-sheet";
import type { PosSellableItem } from "./pos/pos-model";
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

type Props = {
  businessId: string;
  branchId: string;
  currencyCode: string;
  view: "sales" | "returns";
  role: string;
  sellableItems: PosSellableItem[];
};

function isSalesListCache(value: unknown): value is { sales: SaleSummary[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { sales?: unknown }).sales));
}
function isSaleDetailCache(value: unknown): value is { sale: SaleDetail } {
  const sale = value && typeof value === "object" ? (value as { sale?: unknown }).sale : null;
  return Boolean(sale && typeof sale === "object" && Array.isArray((sale as { lines?: unknown }).lines) && Array.isArray((sale as { payments?: unknown }).payments));
}

export function SalesAndReturns({ businessId, branchId, currencyCode, view, role, sellableItems }: Props) {
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
    if (view !== "returns" || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const saleId = params.get("saleId");
    if (params.get("mode") === "exchange") setMode("EXCHANGE");
    if (saleId) void loadDetail(saleId);
    // loadDetail intentionally follows the current business/branch context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, branchId, view]);

  useEffect(() => {
    const onMutationApplied = (event: Event) => {
      const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
      if (!detail || detail.businessId !== businessId || detail.branchId !== branchId) return;
      if (!["SALE_CREATE", "RETURN_CREATE", "REFUND_CREATE", "EXCHANGE_CREATE"].includes(detail.mutationType)) return;
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
      setMessage(returnSyncMessage(summary));
      if (summary.applied > 0) {
        await loadSales();
        await loadDetail(selected.id);
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
    <section className="returns-page-workspace" id="returns" data-sales-view="returns">
      <ReturnRefundWorkspace
        sales={sales}
        selectedId={selected?.id ?? null}
        loading={loading}
        onSelect={(saleId) => void loadDetail(saleId)}
        onSearch={(search) => { setQuery(search); void loadSales(search); }}
      />
      {selected && mode === "EXCHANGE" ? <ExchangeSheet open sale={selected} catalog={sellableItems} businessId={businessId} branchId={branchId} onClose={() => { setSelected(null); setMode("RETURN_REFUND"); }} onMessage={setMessage} /> : selected ? (
        <ReturnRefundSheet
          sale={selected}
          open
          drafts={drafts}
          mode={mode}
          refundMethod={refundMethod}
          reason={reason}
          busy={busy}
          refundPreviewMinor={refundPreviewMinor}
          selectedLineCount={selectedLines.length}
          onClose={() => setSelected(null)}
          onModeChange={setMode}
          onRefundMethodChange={setRefundMethod}
          onReasonChange={setReason}
          onDraftChange={(lineId, patch) => updateDraft(setDrafts, lineId, patch)}
          onSubmit={() => void processReturn()}
        />
      ) : null}
      {message ? <div className="return-message" role="status">{message}</div> : null}
    </section>
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
