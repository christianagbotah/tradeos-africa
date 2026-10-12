"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import {
  IconBanknote,
  IconCalendar,
  IconClose,
  IconCreditCard,
  IconPrint,
  IconReceipt,
  IconShare,
  IconSmartphone,
  IconReturns,
  IconWallet,
} from "../ui/icons";

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
            <h2 className="tos-sheet__title">#{saleId.slice(0, 8)}</h2>
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
          <Button variant="gold" icon={<IconReturns className="tos-btn__icon" />} onClick={() => { window.location.href = "/returns"; }}>Process return</Button>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </>
  );
}

function SaleDetailBody({ detail }: { detail: SaleDetail }) {
  const sale = detail.sale;
  const customerName = sale.customer?.name ?? sale.customer?.phone ?? "Walk-in";
  const completedLabel = sale.completedAt
    ? new Date(sale.completedAt).toLocaleString()
    : "Pending";
  const refundedTotal = sale.payments.reduce((sum, p) => sum + p.refundedMinor, 0);

  return (
    <>
      {/* Receipt hero — midnight gradient + gold accent. Customer, date,
          status, total all visible in one glance. */}
      <div className="tos-receipt-hero tos-animate-fade-in-up">
        <div className="tos-receipt-hero__head">
          <div className="tos-receipt-hero__head-main">
            <span className="tos-receipt-hero__eyebrow">Receipt #{sale.id.slice(0, 8)}</span>
            <h3 className="tos-receipt-hero__title">{customerName}</h3>
            <p className="tos-receipt-hero__sub">
              {completedLabel}{sale.cashierName ? ` · ${sale.cashierName}` : ""}
            </p>
          </div>
          <SaleStatusBadge status={sale.status} />
        </div>
        <div className="tos-receipt-hero__total-row">
          <span className="tos-receipt-hero__total-label">Total</span>
          <MoneyValue minor={sale.totalMinor} currencyCode={sale.currencyCode} className="tos-receipt-hero__total" />
        </div>
      </div>

      {/* Sale summary — kv pairs for receipt no, customer, cashier, completed */}
      <div className="tos-section tos-animate-fade-in-up">
        <div className="tos-section__head">
          <h3 className="tos-section__title">Sale summary</h3>
          <span className="tos-section__sub">{sale.currencyCode}</span>
        </div>
        <div className="tos-section__body--padded">
          <dl className="tos-kv">
            <div><dt className="tos-kv__key">Receipt no.</dt><dd className="tos-kv__val tos-table__mono">{sale.id}</dd></div>
            <div><dt className="tos-kv__key">Customer</dt><dd className="tos-kv__val">{customerName}</dd></div>
            <div><dt className="tos-kv__key">Cashier</dt><dd className="tos-kv__val">{sale.cashierName ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Completed</dt><dd className="tos-kv__val">{completedLabel}</dd></div>
          </dl>
        </div>
      </div>

      {/* Line items — clean readable rows with qty + line total */}
      <div className="tos-section tos-animate-fade-in-up">
        <div className="tos-section__head">
          <h3 className="tos-section__title">Line items</h3>
          <span className="tos-section__sub">{sale.lines.length} line(s)</span>
        </div>
        <div className="tos-section__body">
          <div className="tos-receipt-lines">
            {sale.lines.map((line) => (
              <div key={line.id} className="tos-receipt-line">
                <div className="tos-receipt-line__main">
                  <span className="tos-receipt-line__title">{line.itemName}</span>
                  <span className="tos-receipt-line__qty">
                    {line.quantity} × {line.saleUnitCode}
                  </span>
                  {line.quantityReturned > 0 ? (
                    <span className="tos-receipt-line__returned">
                      {line.quantityReturned} returned
                    </span>
                  ) : null}
                </div>
                <MoneyValue minor={line.lineTotalMinor} currencyCode={sale.currencyCode} className="tos-receipt-line__total" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Payment breakdown — one row per payment method */}
      <div className="tos-section tos-animate-fade-in-up">
        <div className="tos-section__head">
          <h3 className="tos-section__title">Payment breakdown</h3>
          <span className="tos-section__sub">{sale.payments.length} payment(s)</span>
        </div>
        <div className="tos-section__body--padded tos-stack">
          {sale.payments.length === 0 ? (
            <div className="tos-callout">
              No payments recorded against this sale. The total is outstanding.
            </div>
          ) : (
            sale.payments.map((p) => (
              <div key={p.id} className="tos-receipt-payment">
                <div className="tos-receipt-payment__main">
                  <span className="tos-receipt-payment__icon" aria-hidden="true">
                    {paymentMethodIcon(p.method)}
                  </span>
                  <div className="tos-receipt-payment__body">
                    <span className="tos-receipt-payment__label">{paymentMethodLabel(p.method)}</span>
                    <span className="tos-receipt-payment__sub">
                      {p.status}
                      {p.providerReference ? ` · ${p.providerReference}` : ""}
                      {p.refundedMinor > 0 ? ` · ${p.refundedMinor} refunded` : ""}
                    </span>
                  </div>
                </div>
                <MoneyValue minor={p.amountMinor} currencyCode={sale.currencyCode} className="tos-receipt-payment__amount" />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Totals + immutable-evidence callout */}
      <TotalsCard
        currencyCode={sale.currencyCode}
        totalMinor={sale.totalMinor}
        paidMinor={sale.payments.reduce((sum, p) => sum + p.amountMinor, 0)}
        refundedMinor={refundedTotal}
      />

      <div className="tos-callout tos-callout--info">
        Posted sales are immutable business evidence. Corrections are made via returns or refunds — never by editing the original receipt.
      </div>

      <div className="tos-callout">
        <span style={{ display: "flex", alignItems: "center", gap: "var(--tos-space-2)" }}>
          <IconCalendar style={{ width: 14, height: 14 }} />
          Created {new Date(sale.createdAt).toLocaleString()}
        </span>
      </div>
    </>
  );
}

function TotalsCard({
  currencyCode,
  totalMinor,
  paidMinor,
  refundedMinor,
}: {
  currencyCode: string;
  totalMinor: number;
  paidMinor: number;
  refundedMinor: number;
}) {
  const dueMinor = totalMinor - paidMinor + refundedMinor;
  return (
    <div className="tos-section tos-animate-fade-in-up">
      <div className="tos-section__head">
        <h3 className="tos-section__title">Totals</h3>
        <span className="tos-section__sub">{currencyCode}</span>
      </div>
      <div className="tos-section__body--padded">
        <dl className="tos-kv">
          <div>
            <dt className="tos-kv__key">Sale total</dt>
            <dd className="tos-kv__val"><MoneyValue minor={totalMinor} currencyCode={currencyCode} /></dd>
          </div>
          <div>
            <dt className="tos-kv__key">Paid</dt>
            <dd className="tos-kv__val"><MoneyValue minor={paidMinor} currencyCode={currencyCode} tone="positive" /></dd>
          </div>
          {refundedMinor > 0 ? (
            <div>
              <dt className="tos-kv__key">Refunded</dt>
              <dd className="tos-kv__val"><MoneyValue minor={refundedMinor} currencyCode={currencyCode} tone="negative" /></dd>
            </div>
          ) : null}
          {dueMinor !== 0 ? (
            <div>
              <dt className="tos-kv__key">{dueMinor > 0 ? "Outstanding" : "Change due"}</dt>
              <dd className="tos-kv__val tos-table__strong">
                <MoneyValue minor={Math.abs(dueMinor)} currencyCode={currencyCode} tone={dueMinor > 0 ? "negative" : "positive"} />
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}

function SaleStatusBadge({ status }: { status: string }) {
  const variant =
    status === "COMPLETED" ? "tos-badge--positive" :
    status === "VOID" ? "tos-badge--danger" :
    status === "REFUNDED" ? "tos-badge--warning" :
    status === "PENDING" ? "tos-badge--pending" :
    "tos-badge--neutral";
  return (
    <span className={`tos-badge ${variant}`}>
      <span className="tos-badge__dot" />{status}
    </span>
  );
}

function paymentMethodLabel(method: string): string {
  switch (method) {
    case "CASH": return "Cash";
    case "MOMO": return "Mobile money";
    case "CARD": return "Card";
    case "BANK": return "Bank transfer";
    case "OTHER": return "Other";
    default: return method.charAt(0) + method.slice(1).toLowerCase();
  }
}

function paymentMethodIcon(method: string): ReactNode {
  switch (method) {
    case "CASH": return <IconBanknote style={{ width: 18, height: 18 }} />;
    case "MOMO": return <IconSmartphone style={{ width: 18, height: 18 }} />;
    case "CARD": return <IconCreditCard style={{ width: 18, height: 18 }} />;
    case "BANK": return <IconWallet style={{ width: 18, height: 18 }} />;
    default: return <IconReceipt style={{ width: 18, height: 18 }} />;
  }
}
