/**
 * Reports — read-only report summary.
 *
 * Four report-category cards (Sales, Profitability, Inventory, Cashflow) with
 * summary metrics. Each card links to a detail view; for now the detail opens
 * an "open in web" notice since the desktop report renderer is staged (the
 * web app owns the canonical report viewer).
 *
 * State handling:
 *   - DEMO MODE: renders sample report figures with a DemoBanner.
 *   - SIGNED OUT: renders an AccessState.
 *   - READY: loads report summary from the API; on failure renders an AccessState.
 */
import { useEffect, useState } from "react";
import type { ScreenId } from "../lib/types.js";
import { SAMPLE_REPORT_SUMMARY } from "../lib/sample-data.js";
import type { DesktopReportSummary } from "../lib/desktop-api-client.js";
import type { DesktopRuntime, DesktopReadyState } from "../lib/desktop-runtime.js";
import { fmtMoneyMinor } from "../lib/format.js";
import { AccessState } from "../components/AccessState.js";
import { DemoBanner } from "../components/DemoBanner.js";
import {
  IconChart,
  IconFileText,
  IconPiggyBank,
  IconPackage,
  IconActivity,
  IconExternalLink,
  IconClose,
  IconDownload,
} from "../components/icons.js";

type CategoryId = "sales" | "profitability" | "inventory" | "cashflow";

export interface ReportsProps {
  runtime: DesktopRuntime | null;
  ready: DesktopReadyState | null;
  online: boolean;
  demoMode: boolean;
  onSignIn: () => void;
  onNavigate: (id: ScreenId) => void;
}

export function Reports({ runtime, ready, online, demoMode, onSignIn }: ReportsProps) {
  const [active, setActive] = useState<CategoryId | null>(null);
  const [summary, setSummary] = useState<DesktopReportSummary | null>(demoMode ? SAMPLE_REPORT_SUMMARY : null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (demoMode || !runtime || !ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    runtime.api.getReportSummary(ready.membership.businessId, ready.branch.id)
      .then((s: DesktopReportSummary) => {
        if (cancelled) return;
        setSummary(s);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [demoMode, runtime, ready, online]);

  if (demoMode) {
    return <ReportsBody demoMode summary={SAMPLE_REPORT_SUMMARY} active={active} onActiveChange={setActive} />;
  }
  if (!ready || !runtime) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <AccessState kind="sign-in-required" onSignIn={onSignIn} />
      </div>
    );
  }
  if (loading && !summary) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <div className="dsk-empty" style={{ minHeight: "320px" }}>
          <div className="dsk-empty__title">Loading reports\u2026</div>
        </div>
      </div>
    );
  }
  if (error && !summary) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <AccessState kind="api-unavailable" detail={error} />
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <AccessState kind="api-unavailable" />
      </div>
    );
  }
  return <ReportsBody summary={summary} active={active} onActiveChange={setActive} />;
}

function ScreenHeader() {
  return (
    <div className="dsk-screen__head">
      <div>
        <div className="dsk-screen__eyebrow">Insight · read-only</div>
        <h1 className="dsk-screen__title">Reports</h1>
        <p className="dsk-screen__subtitle">
          Authoritative summaries over posted data. Reports are read-only — they reflect the
          ledger, never mutate it.
        </p>
      </div>
      <div className="dsk-screen__actions">
        <button type="button" className="dsk-btn dsk-btn--outline dsk-btn--sm" disabled>
          <IconDownload width={15} height={15} />
          Export PDF
        </button>
      </div>
    </div>
  );
}

function ReportsBody({
  demoMode,
  summary,
  active,
  onActiveChange,
}: {
  demoMode?: boolean;
  summary: DesktopReportSummary;
  active: CategoryId | null;
  onActiveChange: (id: CategoryId | null) => void;
}) {
  const cards: ReadonlyArray<{
    id: CategoryId;
    title: string;
    desc: string;
    icon: typeof IconChart;
    metrics: ReadonlyArray<{ label: string; value: string }>;
  }> = [
    {
      id: "sales",
      title: "Sales & revenue",
      desc: "Daily and period sales with payment-mix breakdown.",
      icon: IconChart,
      metrics: [
        { label: "Revenue (30d)", value: fmtMoneyMinor(summary.sales.revenueMinor) },
        { label: "Transactions", value: String(summary.sales.txns) },
        { label: "Avg. sale", value: fmtMoneyMinor(summary.sales.avgMinor) },
      ],
    },
    {
      id: "profitability",
      title: "Profitability",
      desc: "Gross profit and margin by category and channel.",
      icon: IconPiggyBank,
      metrics: [
        { label: "Gross profit", value: fmtMoneyMinor(summary.profitability.grossProfitMinor) },
        { label: "Margin", value: `${summary.profitability.marginPct}%` },
        { label: "Best day", value: summary.profitability.bestDay },
      ],
    },
    {
      id: "inventory",
      title: "Inventory & stock",
      desc: "Stock valuation, turnover and reorder risk.",
      icon: IconPackage,
      metrics: [
        { label: "Stock value", value: fmtMoneyMinor(summary.inventory.stockValueMinor) },
        { label: "Low / out", value: `${summary.inventory.lowStock} / ${summary.inventory.outOfStock}` },
        { label: "SKUs", value: String(summary.inventory.skus) },
      ],
    },
    {
      id: "cashflow",
      title: "Cashflow",
      desc: "Money in / out across cash, MoMo and bank accounts.",
      icon: IconActivity,
      metrics: [
        { label: "In today", value: fmtMoneyMinor(summary.cashflow.inTodayMinor) },
        { label: "Out today", value: fmtMoneyMinor(summary.cashflow.outTodayMinor) },
        { label: "Net today", value: fmtMoneyMinor(summary.cashflow.netTodayMinor) },
      ],
    },
  ];

  return (
    <div className="dsk-screen">
      <ScreenHeader />
      {demoMode ? <DemoBanner /> : null}

      <div className="dsk-reportcats">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              className="dsk-reportcat"
              onClick={() => onActiveChange(card.id)}
              aria-label={`Open ${card.title} report`}
            >
              <div className="dsk-reportcat__icon" aria-hidden>
                <Icon width={20} height={20} />
              </div>
              <div className="dsk-reportcat__title">{card.title}</div>
              <div className="dsk-reportcat__desc">{card.desc}</div>
              <div className="dsk-reportcat__metrics">
                {card.metrics.map((m) => (
                  <div className="dsk-reportcat__metric" key={m.label}>
                    <span className="dsk-reportcat__metric-label">{m.label}</span>
                    <span className="dsk-reportcat__metric-val tnum">{m.value}</span>
                  </div>
                ))}
              </div>
              <div className="dsk-reportcat__cta">
                Open report <IconExternalLink width={13} height={13} />
              </div>
            </button>
          );
        })}
      </div>

      <div className="dsk-card">
        <div className="dsk-card__head">
          <div>
            <div className="dsk-card__title">Data as of {new Date().toLocaleDateString("en-GB")}</div>
            <div className="dsk-card__sub">Reports reflect posted, immutable business evidence.</div>
          </div>
          <span className="dsk-badge dsk-badge--neutral">Read-only</span>
        </div>
        <div className="dsk-card__body">
          <div className="dsk-banner dsk-banner--info">
            <IconFileText className="dsk-banner__icon" />
            <div className="dsk-banner__body">
              <div className="dsk-banner__title">Full report viewer lives in the web app</div>
              <div className="dsk-banner__text">
                The desktop client renders summary cards and exports. For the interactive
                charting viewer (drill-downs, custom date ranges, side-by-side periods), open the
                report in the TradeOS web app.
              </div>
            </div>
          </div>
        </div>
      </div>

      {active ? <ReportDetailDialog id={active} onClose={() => onActiveChange(null)} /> : null}
    </div>
  );
}

function ReportDetailDialog({ id, onClose }: { id: CategoryId; onClose: () => void }) {
  const titles: Record<CategoryId, string> = {
    sales: "Sales & revenue report",
    profitability: "Profitability report",
    inventory: "Inventory & stock report",
    cashflow: "Cashflow report",
  };
  return (
    <div
      className="dsk-dialog-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dsk-dialog" role="dialog" aria-modal="true" aria-labelledby="rpt-title">
        <div className="dsk-dialog__head">
          <div>
            <h2 id="rpt-title" className="dsk-dialog__title">
              {titles[id]}
            </h2>
            <div className="dsk-dialog__sub">Read-only · last 30 days</div>
          </div>
          <button type="button" className="dsk-dialog__close" onClick={onClose} aria-label="Close">
            <IconClose width={16} height={16} />
          </button>
        </div>
        <div className="dsk-dialog__body">
          <div className="dsk-banner dsk-banner--info">
            <IconExternalLink className="dsk-banner__icon" />
            <div className="dsk-banner__body">
              <div className="dsk-banner__title">Open in the TradeOS web app</div>
              <div className="dsk-banner__text">
                The interactive charting viewer with drill-downs, custom date ranges and
                side-by-side period comparisons is available in the web client. The desktop
                client ships the summary cards and PDF export.
              </div>
            </div>
          </div>
          <div className="dsk-metricgrid">
            <div className="dsk-metric">
              <div className="dsk-metric__label">Period</div>
              <div className="dsk-metric__val" style={{ fontSize: 16 }}>Last 30 days</div>
            </div>
            <div className="dsk-metric">
              <div className="dsk-metric__label">Source</div>
              <div className="dsk-metric__val" style={{ fontSize: 16 }}>Posted ledger</div>
            </div>
            <div className="dsk-metric">
              <div className="dsk-metric__label">Refreshed</div>
              <div className="dsk-metric__val" style={{ fontSize: 16 }}>Just now</div>
            </div>
          </div>
        </div>
        <div className="dsk-dialog__foot">
          <button type="button" className="dsk-btn dsk-btn--outline" disabled>
            <IconDownload width={15} height={15} />
            Export PDF
          </button>
          <button type="button" className="dsk-btn dsk-btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
