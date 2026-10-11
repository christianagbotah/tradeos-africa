"use client";

import { useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconRefresh, IconReports, IconTrending, IconTrendingDown } from "../ui/icons";

interface FinancialSummary {
  flow?: {
    grossRevenueMinor: number;
    returnsRevenueMinor: number;
    netRevenueMinor: number;
    grossTaxMinor: number;
    grossCogsMinor: number;
    grossProfitMinor: number;
    expenseMinor: number;
    operatingProfitMinor: number;
    salesCount: number;
    returnCount: number;
    averageNetSaleMinor: number;
    cashInflowMinor: number;
    cashOutflowMinor: number;
    netCashMovementMinor: number;
  };
  position?: {
    cashBalanceMinor: number;
    receivablesMinor: number;
    payablesMinor: number;
    inventoryValueMinor: number;
  };
}

interface ReportsResponse {
  summary?: FinancialSummary;
}

export function FinancialReports() {
  const { session } = useWorkspace();
  const [range, setRange] = useState<"today" | "week" | "month" | "quarter">("month");

  const path = session
    ? `/v1/reports/financial-summary?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&range=${range}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<ReportsResponse>(path);

  const currencyCode = session?.currencyCode ?? "GHS";
  const flow = data?.summary?.flow;
  const position = data?.summary?.position;

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Insights</span>
          <h1 className="tos-page__title">Financial reports</h1>
          <p className="tos-page__subtitle">Profit &amp; loss, cash flow, and balance position — server-authoritative from the immutable ledger.</p>
        </div>
        <div className="tos-page__actions">
          <div className="tos-tabs">
            {(["today", "week", "month", "quarter"] as const).map((r) => (
              <button key={r} type="button" className="tos-tabs__tab" aria-selected={range === r} onClick={() => setRange(r)} style={{ textTransform: "capitalize" }}>{r}</button>
            ))}
          </div>
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => refetch()}>Refresh</Button>
        </div>
      </header>

      {loading ? (
        <div className="tos-grid-stats">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="tos-card tos-card--padded">
              <span className="tos-skeleton tos-skeleton--line-short" />
              <span className="tos-skeleton tos-skeleton--block" />
            </div>
          ))}
        </div>
      ) : error ? (
        <StatePanel variant="error" title="Could not load reports" text={error} actionLabel="Retry" onAction={() => refetch()} />
      ) : !flow ? (
        <StatePanel
          variant="empty"
          icon={<IconReports className="tos-state__icon" />}
          title="No data for this range"
          text="Complete a few sales in the selected period and the report will populate automatically."
        />
      ) : (
        <>
          <div className="tos-grid-stats">
            <StatTile label="Net revenue" minor={flow.netRevenueMinor} currencyCode={currencyCode} hint={`${flow.salesCount} sale(s)`} tone="default" />
            <StatTile label="Gross profit" minor={flow.grossProfitMinor} currencyCode={currencyCode} hint="Net revenue − COGS" tone={flow.grossProfitMinor >= 0 ? "positive" : "negative"} />
            <StatTile label="Expenses" minor={flow.expenseMinor} currencyCode={currencyCode} hint="Recorded in cashbook" tone="default" />
            <StatTile label="Operating profit" minor={flow.operatingProfitMinor} currencyCode={currencyCode} hint="Gross profit − expenses" tone={flow.operatingProfitMinor >= 0 ? "positive" : "negative"} />
          </div>

          <div className="tos-grid-two">
            <div className="tos-section">
              <div className="tos-section__head"><h2 className="tos-section__title">Profit &amp; loss</h2><span className="tos-section__sub">{range}</span></div>
              <div className="tos-section__body--padded">
                <dl className="tos-kv">
                  <div><dt className="tos-kv__key">Gross revenue</dt><dd className="tos-kv__val"><MoneyValue minor={flow.grossRevenueMinor} currencyCode={currencyCode} /></dd></div>
                  <div><dt className="tos-kv__key">Returns</dt><dd className="tos-kv__val"><MoneyValue minor={-flow.returnsRevenueMinor} currencyCode={currencyCode} tone="negative" /></dd></div>
                  <div><dt className="tos-kv__key">Net revenue</dt><dd className="tos-kv__val"><MoneyValue minor={flow.netRevenueMinor} currencyCode={currencyCode} /></dd></div>
                  <div><dt className="tos-kv__key">COGS</dt><dd className="tos-kv__val"><MoneyValue minor={-flow.grossCogsMinor} currencyCode={currencyCode} tone="negative" /></dd></div>
                  <div><dt className="tos-kv__key">Gross profit</dt><dd className="tos-kv__val"><MoneyValue minor={flow.grossProfitMinor} currencyCode={currencyCode} tone={flow.grossProfitMinor >= 0 ? "positive" : "negative"} /></dd></div>
                  <div><dt className="tos-kv__key">Expenses</dt><dd className="tos-kv__val"><MoneyValue minor={-flow.expenseMinor} currencyCode={currencyCode} tone="negative" /></dd></div>
                  <div><dt className="tos-kv__key">Tax collected</dt><dd className="tos-kv__val"><MoneyValue minor={flow.grossTaxMinor} currencyCode={currencyCode} tone="muted" /></dd></div>
                  <div><dt className="tos-kv__key">Avg. net sale</dt><dd className="tos-kv__val"><MoneyValue minor={flow.averageNetSaleMinor} currencyCode={currencyCode} tone="muted" /></dd></div>
                </dl>
              </div>
            </div>

            <div className="tos-section">
              <div className="tos-section__head"><h2 className="tos-section__title">Cash flow</h2></div>
              <div className="tos-section__body--padded">
                <dl className="tos-kv">
                  <div><dt className="tos-kv__key">Cash in</dt><dd className="tos-kv__val"><MoneyValue minor={flow.cashInflowMinor} currencyCode={currencyCode} tone="positive" /></dd></div>
                  <div><dt className="tos-kv__key">Cash out</dt><dd className="tos-kv__val"><MoneyValue minor={-flow.cashOutflowMinor} currencyCode={currencyCode} tone="negative" /></dd></div>
                  <div><dt className="tos-kv__key">Net movement</dt><dd className="tos-kv__val"><MoneyValue minor={flow.netCashMovementMinor} currencyCode={currencyCode} tone={flow.netCashMovementMinor >= 0 ? "positive" : "negative"} /></dd></div>
                </dl>
              </div>
            </div>
          </div>

          {position ? (
            <div className="tos-section">
              <div className="tos-section__head"><h2 className="tos-section__title">Position</h2><span className="tos-section__sub">Balance sheet snapshot</span></div>
              <div className="tos-section__body--padded">
                <div className="tos-grid-stats">
                  <StatTile label="Cash balance" minor={position.cashBalanceMinor} currencyCode={currencyCode} tone="default" />
                  <StatTile label="Receivables" minor={position.receivablesMinor} currencyCode={currencyCode} tone="default" />
                  <StatTile label="Payables" minor={position.payablesMinor} currencyCode={currencyCode} tone="default" />
                  <StatTile label="Inventory value" minor={position.inventoryValueMinor} currencyCode={currencyCode} tone="default" />
                </div>
              </div>
            </div>
          ) : null}

          <div className="tos-callout">
            Reports are read-only and derive from the same immutable ledger as your receipts. Export and drill-down are coming soon.
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ label, minor, currencyCode, hint, tone = "default" }: { label: string; minor: number; currencyCode: string; hint?: string; tone?: "default" | "positive" | "negative" }) {
  return (
    <div className="tos-stat">
      <span className="tos-stat__label">{tone === "positive" ? <IconTrending className="tos-stat__icon" /> : tone === "negative" ? <IconTrendingDown className="tos-stat__icon" /> : null}{label}</span>
      <span className="tos-stat__value"><MoneyValue minor={minor} currencyCode={currencyCode} size="lg" tone={tone === "positive" ? "positive" : tone === "negative" ? "negative" : "default"} /></span>
      {hint ? <span className="tos-stat__hint">{hint}</span> : null}
    </div>
  );
}
