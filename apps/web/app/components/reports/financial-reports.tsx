"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { FinancialSummaryReport } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import {
  IconBanknote,
  IconBox,
  IconCashbook,
  IconCreditCard,
  IconPrint,
  IconReceipt,
  IconRefresh,
  IconReports,
  IconShield,
  IconSmartphone,
  IconTrending,
  IconTrendingDown,
  IconWallet,
} from "../ui/icons";

// Canonical server contract (@tradeos/contracts). No local compatibility
// model: flow/position/currencyCode/period all come from the server report.
type FinancialFlow = FinancialSummaryReport["flow"];
type FinancialPosition = FinancialSummaryReport["position"];

type RangePreset = "today" | "week" | "month" | "quarter";

type HealthStatus = "positive" | "warning" | "danger";

const HEALTH_SCORE_NUM_CLASS: Record<HealthStatus, string> = {
  positive: "tos-report-health__score-num tos-report-health__score-num--positive",
  warning: "tos-report-health__score-num tos-report-health__score-num--warning",
  danger: "tos-report-health__score-num tos-report-health__score-num--danger",
};

const HEALTH_BAR_FILL_CLASS: Record<HealthStatus, string> = {
  positive: "tos-report-health__bar-fill tos-report-health__bar-fill--positive",
  warning: "tos-report-health__bar-fill tos-report-health__bar-fill--warning",
  danger: "tos-report-health__bar-fill tos-report-health__bar-fill--danger",
};

const HEALTH_STATUS_CLASS: Record<HealthStatus, string> = {
  positive: "tos-report-health__status tos-report-health__status--positive",
  warning: "tos-report-health__status tos-report-health__status--warning",
  danger: "tos-report-health__status tos-report-health__status--danger",
};

const RANGE_PRESETS: ReadonlyArray<{ value: RangePreset; label: string; sub: string }> = [
  { value: "today", label: "Today", sub: "Day-to-date" },
  { value: "week", label: "7d", sub: "This week" },
  { value: "month", label: "30d", sub: "This month" },
  { value: "quarter", label: "90d", sub: "This quarter" },
];

function rangeLabel(range: RangePreset): string {
  return RANGE_PRESETS.find((r) => r.value === range)?.sub ?? range;
}

/** Human label for the server-authoritative report period. */
function periodLabel(period: FinancialSummaryReport["period"]): string {
  const from = new Date(period.from);
  const to = new Date(period.to);
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return from.toDateString() === to.toDateString()
    ? `${fmt.format(from)} · ${period.timezone}`
    : `${fmt.format(from)} – ${fmt.format(to)} · ${period.timezone}`;
}

/**
 * Decision-support health score (0-100). Derived for display only from
 * server-authoritative figures — NOT an authoritative balance. The score
 * is a heuristic that combines profitability, cash-flow direction, and
 * balance-sheet strength so the owner can see at a glance whether the
 * period was healthy. Every underlying number remains server-authoritative.
 */
function computeHealthScore(flow: FinancialSummaryReport["flow"], position: FinancialSummaryReport["position"]): {
  score: number;
  status: "positive" | "warning" | "danger";
  label: string;
  hint: string;
} {
  let score = 0;
  if (flow.operatingProfitMinor > 0) score += 40;
  else if (flow.operatingProfitMinor === 0) score += 20;
  if (flow.netCashMovementMinor > 0) score += 30;
  else if (flow.netCashMovementMinor === 0) score += 15;
  if (flow.grossProfitMinor > 0) score += 20;
  if (flow.netRevenueMinor > 0) score += 10;
  // Cap at 100.
  score = Math.min(100, score);

  if (score >= 70) {
    return {
      score,
      status: "positive",
      label: "Healthy",
      hint: "Profitable period with positive cash movement. Continue current operations and consider reinvesting in inventory or marketing.",
    };
  }
  if (score >= 40) {
    return {
      score,
      status: "warning",
      label: "Watch",
      hint: "Mixed signals — either margin is thin or cash is not converting. Review expenses, receivables, and inventory turn.",
    };
  }
  return {
    score,
    status: "danger",
    label: "At risk",
    hint: "Loss-making or negative cash movement this period. Review pricing, COGS, and cash collection immediately.",
  };
}

function marginPct(numeratorMinor: number, denominatorMinor: number): number | null {
  if (denominatorMinor === 0) return null;
  return (numeratorMinor / denominatorMinor) * 100;
}

function trendFor(valueMinor: number): "up" | "down" | "flat" {
  if (valueMinor > 0) return "up";
  if (valueMinor < 0) return "down";
  return "flat";
}

function TrendChip({ valueMinor, currencyCode, label }: { valueMinor: number; currencyCode: string; label: string }) {
  const trend = trendFor(valueMinor);
  const cls = trend === "up"
    ? "tos-report-trend tos-report-trend--up"
    : trend === "down"
      ? "tos-report-trend tos-report-trend--down"
      : "tos-report-trend tos-report-trend--flat";
  const icon = trend === "up"
    ? <IconTrending className="tos-report-trend__icon" />
    : trend === "down"
      ? <IconTrendingDown className="tos-report-trend__icon" />
      : null;
  return (
    <span className={cls}>
      {icon}
      {label}: <MoneyValue minor={valueMinor} currencyCode={currencyCode} signed />
    </span>
  );
}

export function FinancialReports() {
  const { session } = useWorkspace();
  const [range, setRange] = useState<RangePreset>("month");

  const path = session
    ? `/v1/reports/financial-summary?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&range=${range}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<FinancialSummaryReport>(path);

  // Server-provided metadata first; session/local fallbacks only pre-data.
  const currencyCode = data?.currencyCode ?? session?.currencyCode ?? "GHS";
  const flow = data?.flow;
  const position = data?.position;
  const period = data?.period;

  const health = useMemo(() => {
    if (!flow || !position) return null;
    return computeHealthScore(flow, position);
  }, [flow, position]);

  const grossMargin = useMemo(() => {
    if (!flow) return null;
    return marginPct(flow.grossProfitMinor, flow.netRevenueMinor);
  }, [flow]);

  const operatingMargin = useMemo(() => {
    if (!flow) return null;
    return marginPct(flow.operatingProfitMinor, flow.netRevenueMinor);
  }, [flow]);

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Insights</span>
          <h1 className="tos-page__title">Financial reports</h1>
          <p className="tos-page__subtitle">Profit &amp; loss, cash flow and balance position from your posted business activity, organized for quick decisions.</p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => refetch()}>Refresh</Button>
          <Button variant="outline" icon={<IconPrint className="tos-btn__icon" />} onClick={handlePrint} className="tos-report-print-btn" disabled={!flow}>Print</Button>
        </div>
      </header>

      {/* Date preset chips */}
      <div className="tos-report-presets" role="tablist" aria-label="Report date range">
        {RANGE_PRESETS.map((r) => (
          <button
            key={r.value}
            type="button"
            role="tab"
            className="tos-report-preset"
            aria-pressed={range === r.value}
            onClick={() => setRange(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="tos-report-print-area">
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
            text="Complete a few sales in the selected period and the report will populate automatically from your posted transactions."
          />
        ) : (
          <>
            {/* Executive summary hero — midnight gradient with prominent net revenue */}
            <div className="tos-report-exec tos-animate-fade-in-up">
              <div className="tos-report-exec__head">
                <div className="tos-report-exec__head-main">
                  <span className="tos-report-exec__eyebrow">Executive summary</span>
                  <h2 className="tos-report-exec__title">Period performance · {period ? periodLabel(period) : rangeLabel(range)}</h2>
                  <p className="tos-report-exec__sub">{flow.salesCount} sale(s) · {flow.returnCount} return(s) · {flow.averageNetSaleMinor > 0 ? "Avg sale " : ""}{flow.averageNetSaleMinor > 0 ? <MoneyValue minor={flow.averageNetSaleMinor} currencyCode={currencyCode} /> : null}</p>
                </div>
                {grossMargin !== null ? (
                  <span className="tos-report-trend tos-report-trend--up">
                    {grossMargin >= 0 ? <IconTrending className="tos-report-trend__icon" /> : <IconTrendingDown className="tos-report-trend__icon" />}
                    {grossMargin >= 0 ? "Gross margin" : "Gross loss"} {grossMargin.toFixed(1)}%
                  </span>
                ) : null}
              </div>
              <div className="tos-report-exec__hero">
                <span className="tos-report-exec__hero-label">Net revenue</span>
                <MoneyValue
                  minor={flow.netRevenueMinor}
                  currencyCode={currencyCode}
                  className={flow.netRevenueMinor >= 0 ? "tos-report-exec__hero-val" : "tos-report-exec__hero-val tos-report-exec__hero-val--negative"}
                />
                <span className="tos-report-exec__hero-currency">{currencyCode}</span>
              </div>
              <p className="tos-report-exec__sub" style={{ position: "relative", zIndex: 1 }}>
                {flow.operatingProfitMinor >= 0
                  ? `Operating profit of ${currencyCode} recorded this period — gross profit covered expenses with a surplus.`
                  : `Operating loss of ${currencyCode} recorded this period — expenses exceeded gross profit. Review cost structure.`}
              </p>
            </div>

            {/* Financial health card + KPI grid */}
            <div className="tos-ops-grid" style={{ marginTop: "var(--tos-space-5)" }}>
              {health ? (
                <div className="tos-report-health tos-animate-fade-in-up">
                  <div className="tos-report-health__head">
                    <h3 className="tos-report-health__title">Financial health</h3>
                    <div className="tos-report-health__score">
                      <span className={HEALTH_SCORE_NUM_CLASS[health.status]}>{health.score}</span>
                      <span className="tos-report-health__score-max">/ 100</span>
                    </div>
                  </div>
                  <div className="tos-report-health__bar" aria-hidden="true">
                    <div
                      className={HEALTH_BAR_FILL_CLASS[health.status]}
                      style={{ width: `${health.score}%` }}
                    />
                  </div>
                  <span className={HEALTH_STATUS_CLASS[health.status]}>{health.label}</span>
                  <p className="tos-report-health__hint">{health.hint}</p>
                  <p className="tos-report-health__hint" style={{ fontStyle: "italic" }}>
                    This health indicator combines profitability, cash-flow direction and revenue trend to give you a quick operational signal.
                  </p>
                </div>
              ) : null}

              {/* Sales trend mini-card */}
              <div className="tos-report-kpi tos-animate-fade-in-up">
                <div className="tos-report-kpi__head">
                  <span className="tos-report-kpi__label">
                    <IconTrending style={{ width: 14, height: 14 }} />Sales trend
                  </span>
                </div>
                <span className="tos-report-kpi__value">{flow.salesCount}</span>
                <TrendChip valueMinor={flow.netRevenueMinor} currencyCode={currencyCode} label="Net" />
                <span className="tos-report-kpi__hint">
                  {flow.returnCount > 0
                    ? `${flow.returnCount} return(s) this period — net of refunds.`
                    : "No returns this period."}
                </span>
              </div>
            </div>

            {/* KPI strip — 4-up desktop / 2x2 mobile */}
            <div className="tos-report-kpi-grid tos-stagger" style={{ marginTop: "var(--tos-space-5)" }}>
              <ReportKpi
                label="Gross profit"
                icon={<IconWallet style={{ width: 14, height: 14 }} />}
                value={<MoneyValue minor={flow.grossProfitMinor} currencyCode={currencyCode} size="lg" tone={flow.grossProfitMinor >= 0 ? "positive" : "negative"} />}
                hint={grossMargin !== null ? `Margin ${grossMargin.toFixed(1)}%` : "No revenue"}
                trend={trendFor(flow.grossProfitMinor)}
              />
              <ReportKpi
                label="Operating profit"
                icon={<IconReports style={{ width: 14, height: 14 }} />}
                value={<MoneyValue minor={flow.operatingProfitMinor} currencyCode={currencyCode} size="lg" tone={flow.operatingProfitMinor >= 0 ? "positive" : "negative"} />}
                hint={operatingMargin !== null ? `Op margin ${operatingMargin.toFixed(1)}%` : "No revenue"}
                trend={trendFor(flow.operatingProfitMinor)}
              />
              <ReportKpi
                label="Expenses"
                icon={<IconCashbook style={{ width: 14, height: 14 }} />}
                value={<MoneyValue minor={flow.expenseMinor} currencyCode={currencyCode} size="lg" tone="muted" />}
                hint="Recorded in cashbook"
              />
              <ReportKpi
                label="Avg. net sale"
                icon={<IconReceipt style={{ width: 14, height: 14 }} />}
                value={<MoneyValue minor={flow.averageNetSaleMinor} currencyCode={currencyCode} size="lg" />}
                hint={`${flow.salesCount} sale(s) this period`}
              />
            </div>

            {/* P&L + Cash flow two-up grid */}
            <div className="tos-reports-grid" style={{ marginTop: "var(--tos-space-5)" }}>
              {/* Profit & Loss card */}
              <section className="tos-section tos-animate-fade-in-up">
                <div className="tos-section__head">
                  <h2 className="tos-section__title">Profit &amp; loss</h2>
                  <span className="tos-section__sub">{period ? periodLabel(period) : rangeLabel(range)}</span>
                </div>
                <div className="tos-section__body">
                  <div className="tos-report-pl-row">
                    <div className="tos-report-pl-row__body">
                      <span className="tos-report-pl-row__label">Gross revenue</span>
                      <span className="tos-report-pl-row__sub">Total sales before returns</span>
                    </div>
                    <MoneyValue minor={flow.grossRevenueMinor} currencyCode={currencyCode} className="tos-report-pl-row__val" />
                  </div>
                  <div className="tos-report-pl-row">
                    <div className="tos-report-pl-row__body">
                      <span className="tos-report-pl-row__label">Returns</span>
                      <span className="tos-report-pl-row__sub">Refunded to customers</span>
                    </div>
                    <MoneyValue minor={-flow.returnsRevenueMinor} currencyCode={currencyCode} className="tos-report-pl-row__val tos-report-pl-row__val--negative" />
                  </div>
                  <div className="tos-report-pl-row tos-report-pl-row--subtotal">
                    <div className="tos-report-pl-row__body">
                      <span className="tos-report-pl-row__label">Net revenue</span>
                    </div>
                    <MoneyValue minor={flow.netRevenueMinor} currencyCode={currencyCode} className="tos-report-pl-row__val" />
                  </div>
                  <div className="tos-report-pl-row">
                    <div className="tos-report-pl-row__body">
                      <span className="tos-report-pl-row__label">COGS</span>
                      <span className="tos-report-pl-row__sub">Cost of goods sold</span>
                    </div>
                    <MoneyValue minor={-flow.grossCogsMinor} currencyCode={currencyCode} className="tos-report-pl-row__val tos-report-pl-row__val--negative" />
                  </div>
                  <div className="tos-report-pl-row tos-report-pl-row--subtotal">
                    <div className="tos-report-pl-row__body">
                      <span className="tos-report-pl-row__label">Gross profit</span>
                      <span className="tos-report-pl-row__sub">{grossMargin !== null ? `${grossMargin.toFixed(1)}% margin` : "—"}</span>
                    </div>
                    <MoneyValue
                      minor={flow.grossProfitMinor}
                      currencyCode={currencyCode}
                      className={flow.grossProfitMinor >= 0 ? "tos-report-pl-row__val tos-report-pl-row__val--positive" : "tos-report-pl-row__val tos-report-pl-row__val--negative"}
                    />
                  </div>
                  <div className="tos-report-pl-row">
                    <div className="tos-report-pl-row__body">
                      <span className="tos-report-pl-row__label">Expenses</span>
                      <span className="tos-report-pl-row__sub">Operating expenses from cashbook</span>
                    </div>
                    <MoneyValue minor={-flow.expenseMinor} currencyCode={currencyCode} className="tos-report-pl-row__val tos-report-pl-row__val--negative" />
                  </div>
                  <div className="tos-report-pl-row">
                    <div className="tos-report-pl-row__body">
                      <span className="tos-report-pl-row__label">Tax collected</span>
                      <span className="tos-report-pl-row__sub">VAT / sales tax collected</span>
                    </div>
                    <MoneyValue minor={flow.grossTaxMinor} currencyCode={currencyCode} className="tos-report-pl-row__val tos-report-pl-row__val--muted" />
                  </div>
                  <div className="tos-report-pl-row tos-report-pl-row--subtotal">
                    <div className="tos-report-pl-row__body">
                      <span className="tos-report-pl-row__label">Operating profit</span>
                      <span className="tos-report-pl-row__sub">{operatingMargin !== null ? `${operatingMargin.toFixed(1)}% op margin` : "—"}</span>
                    </div>
                    <MoneyValue
                      minor={flow.operatingProfitMinor}
                      currencyCode={currencyCode}
                      className={flow.operatingProfitMinor >= 0 ? "tos-report-pl-row__val tos-report-pl-row__val--positive" : "tos-report-pl-row__val tos-report-pl-row__val--negative"}
                    />
                  </div>
                </div>
              </section>

              {/* Cash flow card — in / out / net */}
              <section className="tos-report-flow tos-animate-fade-in-up">
                <div className="tos-report-flow__head">
                  <h2 className="tos-report-flow__title">Cash movement</h2>
                  <span className="tos-report-flow__sub">{period ? periodLabel(period) : rangeLabel(range)}</span>
                </div>
                <div className="tos-report-flow__row">
                  <span className="tos-report-flow__row-icon tos-report-flow__row-icon--in" aria-hidden="true">
                    <IconTrending style={{ width: 18, height: 18 }} />
                  </span>
                  <div className="tos-report-flow__row-body">
                    <span className="tos-report-flow__row-label">Cash in</span>
                    <span className="tos-report-flow__row-sub">Sales receipts, owner injections, transfers in</span>
                  </div>
                  <MoneyValue minor={flow.cashInflowMinor} currencyCode={currencyCode} className="tos-report-flow__row-val tos-report-flow__row-val--in" />
                </div>
                <div className="tos-report-flow__row">
                  <span className="tos-report-flow__row-icon tos-report-flow__row-icon--out" aria-hidden="true">
                    <IconTrendingDown style={{ width: 18, height: 18 }} />
                  </span>
                  <div className="tos-report-flow__row-body">
                    <span className="tos-report-flow__row-label">Cash out</span>
                    <span className="tos-report-flow__row-sub">Expenses, supplier payments, transfers out</span>
                  </div>
                  <MoneyValue minor={-flow.cashOutflowMinor} currencyCode={currencyCode} className="tos-report-flow__row-val tos-report-flow__row-val--out" />
                </div>
                <div className="tos-report-flow__net">
                  <span className="tos-report-flow__net-label">Net movement</span>
                  <MoneyValue
                    minor={flow.netCashMovementMinor}
                    currencyCode={currencyCode}
                    className={flow.netCashMovementMinor >= 0 ? "tos-report-flow__net-val tos-report-flow__net-val--positive" : "tos-report-flow__net-val tos-report-flow__net-val--negative"}
                    signed
                  />
                </div>
                <p className="tos-report-flow__sub" style={{ marginTop: "var(--tos-space-2)" }}>
                  {flow.netCashMovementMinor > 0
                    ? "Cash position grew this period — surplus available for reinvestment or owner withdrawal."
                    : flow.netCashMovementMinor < 0
                      ? "Cash position contracted this period — review outflows and collection."
                      : "Cash position unchanged this period."}
                </p>
              </section>
            </div>

            {/* Balance position summary — 4-up KPI tiles */}
            {position ? (
              <section className="tos-section tos-animate-fade-in-up" style={{ marginTop: "var(--tos-space-5)" }}>
                <div className="tos-section__head">
                  <h2 className="tos-section__title">Balance position</h2>
                  <span className="tos-section__sub">Snapshot · recorded position</span>
                </div>
                <div className="tos-section__body--padded">
                  <div className="tos-report-kpi-grid">
                    <PositionCard
                      label="Cash balance"
                      icon={<IconBanknote className="tos-position-card__icon" />}
                      minor={position.cashBalanceMinor}
                      currencyCode={currencyCode}
                      hint="Across all money accounts"
                    />
                    <PositionCard
                      label="Receivables"
                      icon={<IconWallet className="tos-position-card__icon" />}
                      minor={position.receivablesMinor}
                      currencyCode={currencyCode}
                      hint="Owed by customers"
                      tone={position.receivablesMinor > 0 ? "warning" : "default"}
                    />
                    <PositionCard
                      label="Payables"
                      icon={<IconCreditCard className="tos-position-card__icon" />}
                      minor={position.payablesMinor}
                      currencyCode={currencyCode}
                      hint="Owed to suppliers"
                      tone={position.payablesMinor > 0 ? "warning" : "default"}
                    />
                    <PositionCard
                      label="Inventory value"
                      icon={<IconBox className="tos-position-card__icon" />}
                      minor={position.inventoryValueMinor}
                      currencyCode={currencyCode}
                      hint="At weighted-average cost"
                    />
                  </div>
                </div>
              </section>
            ) : null}

            <div className="tos-callout tos-callout--info">
              <span className="tos-callout__icon-wrap" aria-hidden="true">
                <IconShield style={{ width: 16, height: 16 }} />
              </span>
              <span className="tos-callout__body">
                Reports are read-only and use the same posted transaction history as your receipts.
                <span className="tos-callout__sub"> Revenue, cost of goods, tax, cash movement and balance position come from posted transactions. The financial health score is a quick decision-support indicator, not an accounting balance. Use Print to share a snapshot.</span>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Report KPI tile (with optional trend chip) -------------------------

interface ReportKpiProps {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  hint?: string;
  trend?: "up" | "down" | "flat";
}

function ReportKpi({ label, icon, value, hint, trend }: ReportKpiProps) {
  const trendCls = trend === "up"
    ? "tos-report-trend tos-report-trend--up"
    : trend === "down"
      ? "tos-report-trend tos-report-trend--down"
      : null;
  const trendIcon = trend === "up"
    ? <IconTrending className="tos-report-trend__icon" />
    : trend === "down"
      ? <IconTrendingDown className="tos-report-trend__icon" />
      : null;
  const trendLabel = trend === "up" ? "Up" : trend === "down" ? "Down" : "";

  return (
    <div className="tos-report-kpi tos-card-hover tos-animate-fade-in-up">
      <div className="tos-report-kpi__head">
        <span className="tos-report-kpi__label">{icon}{label}</span>
        {trendCls ? (
          <span className={trendCls}>{trendIcon}{trendLabel}</span>
        ) : null}
      </div>
      {value}
      {hint ? <span className="tos-report-kpi__hint">{hint}</span> : null}
    </div>
  );
}

// --- Position card (balance sheet snapshot) -----------------------------

interface PositionCardProps {
  label: string;
  icon: ReactNode;
  minor: number;
  currencyCode: string;
  hint: string;
  tone?: "default" | "warning";
}

function PositionCard({ label, icon, minor, currencyCode, hint, tone = "default" }: PositionCardProps) {
  return (
    <div className="tos-position-card">
      <span className="tos-position-card__label">{icon}{label}</span>
      <MoneyValue
        minor={minor}
        currencyCode={currencyCode}
        className={tone === "warning" && minor > 0 ? "tos-position-card__value tos-position-card__value--negative" : "tos-position-card__value"}
      />
      <span className="tos-position-card__hint">{hint}</span>
    </div>
  );
}
