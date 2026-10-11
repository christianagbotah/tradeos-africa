"use client";

import { useEffect, useState } from "react";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { TransactionEvidence } from "../business/transaction-evidence";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconClose, IconPrint, IconShare } from "../ui/icons";

interface SaleDetail {
  sale: {
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
    lines: ReadonlyArray<{
      id: string;
      itemId: string;
      itemName: string;
      itemKind: string;
      quantity: number;
      quantityReturned: number;
      saleUnitCode: string;
      unitNetMinor: number;
      unitTaxMinor: number;
      lineTotalMinor: number;
    }>;
    payments: ReadonlyArray<{
      id: string;
      method: string;
      amountMinor: number;
      refundedMinor: number;
      status: string;
      providerReference: string | null;
    }>;
  };
}

interface SaleDetailSheetProps {
  saleId: string | null;
  onClose: () => void;
}

export function SaleDetailSheet({ saleId, onClose }: SaleDetailSheetProps) {
  const { session } = useWorkspace();
  const path = saleId && session
    ? `/v1/sales/${encodeURIComponent(saleId)}?businessId=${encodeURIComponent(session.businessId)}`
    : null;
  const { data, loading, error } = useApiFetch<SaleDetail>(path);

  useEffect(() => {
    if (!saleId) return;
    if (typeof document !== "undefined") {
      document.body.style.overflow = "hidden";
    }
    return () => {
      if (typeof document !== "undefined") {
        document.body.style.overflow = "";
      }
    };
  }, [saleId]);

  if (!saleId) return null;

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet tos-sheet--wide" role="dialog" aria-label="Sale detail">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Receipt</span>
            <h2 className="tos-sheet__title">{saleId.slice(0, 8)}</h2>
            <p className="tos-sheet__sub">Server-authoritative sale record</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close sale detail">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div className="tos-sheet__body">
          {loading ? (
            <StatePanel inline variant="loading" title="Loading receipt…" />
          ) : error ? (
            <StatePanel inline variant="error" title="Could not load receipt" text={error} />
          ) : data ? (
            <SaleDetailBody detail={data} />
          ) : null}
        </div>

        <div className="tos-sheet__foot">
          <Button variant="ghost" icon={<IconPrint className="tos-btn__icon" />} onClick={() => window.print()}>Print</Button>
          <Button variant="outline" icon={<IconShare className="tos-btn__icon" />} onClick={async () => {
            if (typeof navigator !== "undefined" && navigator.share) {
              try { await navigator.share({ title: "TradeOS receipt", text: `Receipt ${saleId}` }); } catch { /* cancelled */ }
            }
          }}>Share</Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </>
  );
}

function SaleDetailBody({ detail }: { detail: SaleDetail }) {
  const sale = detail.sale;
  return (
    <>
      <div className="tos-section">
        <div className="tos-section__head">
          <h3 className="tos-section__title">Sale summary</h3>
          <span className={`tos-badge ${sale.status === "COMPLETED" ? "tos-badge--positive" : sale.status === "VOID" ? "tos-badge--danger" : "tos-badge--neutral"}`}>
            <span className="tos-badge__dot" />{sale.status}
          </span>
        </div>
        <div className="tos-section__body--padded">
          <dl className="tos-kv">
            <div><dt className="tos-kv__key">Receipt no.</dt><dd className="tos-kv__val tos-table__mono">{sale.id}</dd></div>
            <div><dt className="tos-kv__key">Customer</dt><dd className="tos-kv__val">{sale.customer?.name ?? sale.customer?.phone ?? "Walk-in"}</dd></div>
            <div><dt className="tos-kv__key">Cashier</dt><dd className="tos-kv__val">{sale.cashierName ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Completed</dt><dd className="tos-kv__val">{sale.completedAt ? new Date(sale.completedAt).toLocaleString() : "Pending"}</dd></div>
          </dl>
        </div>
      </div>

      <div className="tos-section">
        <div className="tos-section__head">
          <h3 className="tos-section__title">Line items</h3>
          <span className="tos-section__sub">{sale.lines.length} line(s)</span>
        </div>
        <div className="tos-section__body">
          <ul className="tos-list" style={{ borderRadius: 0, border: "none", boxShadow: "none" }}>
            {sale.lines.map((line) => (
              <li key={line.id} className="tos-list__row" style={{ borderBottom: "1px solid var(--tos-border)" }}>
                <div className="tos-list__row-main">
                  <span className="tos-list__row-title">{line.itemName}</span>
                  <span className="tos-list__row-sub">{line.quantity} × {line.saleUnitCode}</span>
                </div>
                <div className="tos-list__row-meta">
                  <span className="tos-list__row-amount">
                    <MoneyValue minor={line.lineTotalMinor} currencyCode={sale.currencyCode} />
                  </span>
                  {line.quantityReturned > 0 ? (
                    <span className="tos-list__row-pending">{line.quantityReturned} returned</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <TransactionEvidence
        currencyCode={sale.currencyCode}
        lines={[
          { label: "Subtotal", minor: sale.totalMinor, tone: "default" },
          ...(sale.payments.length > 0
            ? sale.payments.map((p) => ({
                label: `Payment (${p.method})`,
                minor: p.amountMinor,
                tone: "positive" as const,
              }))
            : [{ label: "Total due", minor: sale.totalMinor, tone: "default" as const }]),
        ]}
        totalLabel="Total"
        totalMinor={sale.totalMinor}
        footnote="Posted sales are immutable business evidence. Corrections are made via returns or refunds, never by editing the original."
      />
    </>
  );
}
