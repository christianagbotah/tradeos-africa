/**
 * Dashboard — business overview.
 *
 * KPI cards (today's sales, cash position, outstanding credit, stock warnings),
 * quick actions, and an activity feed.
 *
 * State handling:
 *   - DEMO MODE: renders sample KPIs + sample activity with a DemoBanner.
 *   - SIGNED OUT / SESSION_EXPIRED: renders an AccessState.
 *   - READY: loads KPIs + activity from the API; on failure renders an
 *     AccessState ("api-unavailable").
 */
import { useEffect, useState } from "react";
import type { ScreenId } from "../lib/types.js";
import type { DesktopRuntime, DesktopReadyState } from "../lib/desktop-runtime.js";
import {
  SAMPLE_ACTIVITY,
  SAMPLE_DASHBOARD_KPIS,
} from "../lib/sample-data.js";
import {
  type DesktopActivityItem,
  type DesktopDashboardKpis,
} from "../lib/desktop-api-client.js";
import { fmtMoneyMinor, relativeTime } from "../lib/format.js";
import { StatCard } from "../components/StatCard.js";
import { AccessState } from "../components/AccessState.js";
import { DemoBanner } from "../components/DemoBanner.js";
import {
  IconSell,
  IconWallet,
  IconArrowLeftRight,
  IconAlert,
  IconArrowRight,
  IconReceipt,
  IconPackage,
  IconUserPlus,
  IconUndo,
  IconTrendUp,
  IconTrendDown,
  IconInfo,
  IconRefresh,
} from "../components/icons.js";

export interface DashboardProps {
  runtime: DesktopRuntime | null;
  ready: DesktopReadyState | null;
  online: boolean;
  demoMode: boolean;
  onSignIn: () => void;
  onNavigate: (id: ScreenId) => void;
}

const ACTIVITY_ICON = {
  sale: IconReceipt,
  expense: IconArrowLeftRight,
  stock: IconPackage,
  customer: IconUserPlus,
  return: IconUndo,
} as const;

export function Dashboard({ runtime, ready, online, demoMode, onSignIn, onNavigate }: DashboardProps) {
  const [kpis, setKpis] = useState<DesktopDashboardKpis | null>(null);
  const [activity, setActivity] = useState<readonly DesktopActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (demoMode || !runtime || !ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      runtime ? fetchDashboardKpis(runtime, ready) : Promise.resolve(null),
      runtime ? fetchActivityFeed(runtime, ready) : Promise.resolve([]),
    ])
      .then(([k, a]) => {
        if (cancelled) return;
        if (k) setKpis(k);
        setActivity(a);
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
    return <DashboardBody demoMode kpis={SAMPLE_DASHBOARD_KPIS} activity={SAMPLE_ACTIVITY} onNavigate={onNavigate} />;
  }
  if (!ready || !runtime) {
    return <AccessState kind="sign-in-required" onSignIn={onSignIn} />;
  }
  if (loading && !kpis) {
    return (
      <div className="dsk-screen">
        <div className="dsk-empty" style={{ minHeight: "320px" }}>
          <div className="dsk-empty__title">Loading dashboard\u2026</div>
        </div>
      </div>
    );
  }
  if (error && !kpis) {
    return (
      <AccessState
        kind="api-unavailable"
        detail={error}
        onRetry={() => {
          setError(null);
          // Trigger a re-load by toggling state (cheap & local).
          setKpis(null);
        }}
      />
    );
  }
  if (!kpis) {
    return <AccessState kind="api-unavailable" onSignIn={onSignIn} />;
  }
  return <DashboardBody kpis={kpis} activity={activity} onNavigate={onNavigate} />;
}

function DashboardBody({
  demoMode,
  kpis,
  activity,
  onNavigate,
}: {
  demoMode?: boolean;
  kpis: DesktopDashboardKpis;
  activity: readonly DesktopActivityItem[];
  onNavigate: (id: ScreenId) => void;
}) {
  return (
    <div className="dsk-screen">
      <div className="dsk-screen__head">
        <div>
          <div className="dsk-screen__eyebrow">Overview · Today</div>
          <h1 className="dsk-screen__title">Dashboard</h1>
          <p className="dsk-screen__subtitle">
            Counter performance, cash position and stock health at a glance.
          </p>
        </div>
        <div className="dsk-screen__actions">
          <button
            type="button"
            className="dsk-btn dsk-btn--gold"
            onClick={() => onNavigate("pos")}
          >
            <IconSell width={16} height={16} />
            New sale
          </button>
        </div>
      </div>

      {demoMode ? <DemoBanner /> : null}

      <div className="dsk-statgrid">
        <StatCard
          label="Today's sales"
          value={fmtMoneyMinor(kpis.todaySalesMinor)}
          icon={<IconTrendUp />}
          tone="positive"
          hint={<><IconTrendUp width={12} height={12} /> Server-derived · live ledger</>}
          hintTone="positive"
        />
        <StatCard
          label="Cash position"
          value={fmtMoneyMinor(kpis.cashPositionMinor)}
          icon={<IconWallet />}
          tone="gold"
          hint="Across till, MoMo & bank"
        />
        <StatCard
          label="Outstanding credit"
          value={fmtMoneyMinor(kpis.outstandingCreditMinor)}
          icon={<IconArrowLeftRight />}
          tone="warning"
          hint="Customer credit ledger"
          hintTone="warning"
        />
        <StatCard
          label="Stock warnings"
          value={String(kpis.stockWarnings)}
          icon={<IconAlert />}
          tone="warning"
          hint="Low + out of stock"
          hintTone="warning"
        />
      </div>

      <div className="dsk-quickactions">
        <button type="button" className="dsk-quickaction" onClick={() => onNavigate("pos")}>
          <span className="dsk-quickaction__icon"><IconSell width={16} height={16} /></span>
          <span className="dsk-quickaction__text">
            New sale
            <span className="dsk-quickaction__sub">Open the POS workspace</span>
          </span>
        </button>
        <button type="button" className="dsk-quickaction" onClick={() => onNavigate("sales")}>
          <span className="dsk-quickaction__icon"><IconReceipt width={16} height={16} /></span>
          <span className="dsk-quickaction__text">
            View sales
            <span className="dsk-quickaction__sub">Posted receipts & detail</span>
          </span>
        </button>
        <button type="button" className="dsk-quickaction" onClick={() => onNavigate("customers")}>
          <span className="dsk-quickaction__icon"><IconUserPlus width={16} height={16} /></span>
          <span className="dsk-quickaction__text">
            Add customer
            <span className="dsk-quickaction__sub">New master-data record</span>
          </span>
        </button>
        <button type="button" className="dsk-quickaction" onClick={() => onNavigate("inventory")}>
          <span className="dsk-quickaction__icon"><IconPackage width={16} height={16} /></span>
          <span className="dsk-quickaction__text">
            Receive stock
            <span className="dsk-quickaction__sub">Movement-derived correction</span>
          </span>
        </button>
      </div>

      <div className="dsk-grid-2" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
        <div className="dsk-card">
          <div className="dsk-card__head">
            <div>
              <div className="dsk-card__title">Recent activity</div>
              <div className="dsk-card__sub">Sales, expenses, stock & customer events</div>
            </div>
            {demoMode ? <span className="dsk-badge dsk-badge--neutral">Sample data</span> : <span className="dsk-badge dsk-badge--positive">Live</span>}
          </div>
          <div className="dsk-activity">
            {activity.length === 0 ? (
              <div className="dsk-empty__text" style={{ padding: "var(--tos-space-4)" }}>No recent activity.</div>
            ) : null}
            {activity.map((item) => {
              const Icon = ACTIVITY_ICON[item.kind] ?? IconInfo;
              return (
                <div className="dsk-activity__item" key={item.id}>
                  <div className="dsk-activity__dot" aria-hidden>
                    <Icon width={14} height={14} />
                  </div>
                  <div className="dsk-activity__body">
                    <div className="dsk-activity__title">{item.title}</div>
                    <div className="dsk-activity__meta">{item.meta}</div>
                  </div>
                  {item.amountMinor ? (
                    <div
                      className="dsk-activity__amt tnum"
                      style={{
                        color:
                          item.tone === "positive"
                            ? "var(--tos-positive)"
                            : item.tone === "negative"
                              ? "var(--tos-danger)"
                              : "var(--tos-text-strong)",
                      }}
                    >
                      {item.tone === "negative" ? "-" : item.tone === "positive" ? "+" : ""}
                      {fmtMoneyMinor(item.amountMinor)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="dsk-card">
          <div className="dsk-card__head">
            <div>
              <div className="dsk-card__title">Jump to</div>
              <div className="dsk-card__sub">Frequent workspaces</div>
            </div>
          </div>
          <div className="dsk-card__body" style={{ display: "flex", flexDirection: "column", gap: "var(--tos-space-2)" }}>
            {([
              { id: "pos", label: "Sell", sub: "Counter POS workspace", icon: IconSell },
              { id: "sales", label: "Sales history", sub: "Posted receipts & detail", icon: IconReceipt },
              { id: "inventory", label: "Inventory", sub: "On-hand & corrections", icon: IconPackage },
              { id: "customers", label: "Customers", sub: "Balances & credit", icon: IconUserPlus },
              { id: "reports", label: "Reports", sub: "Sales, profit, stock", icon: IconReceipt },
            ] as const).map((link) => {
              const Icon = link.icon;
              return (
                <button
                  key={link.id}
                  type="button"
                  className="dsk-quickaction"
                  style={{ minHeight: "48px", boxShadow: "none" }}
                  onClick={() => onNavigate(link.id)}
                >
                  <span className="dsk-quickaction__icon"><Icon width={16} height={16} /></span>
                  <span className="dsk-quickaction__text">
                    {link.label}
                    <span className="dsk-quickaction__sub">{link.sub}</span>
                  </span>
                  <IconArrowRight width={14} height={14} style={{ marginLeft: "auto", color: "var(--tos-text-soft)" }} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live data fetch helpers. These call the DesktopApiClient directly (the
// runtime does not own dashboard data; only commerce + queue state).
// ---------------------------------------------------------------------------

async function fetchDashboardKpis(
  runtime: DesktopRuntime,
  ready: DesktopReadyState,
): Promise<DesktopDashboardKpis> {
  return runtime.api.getDashboardKpis(ready.membership.businessId, ready.branch.id);
}

async function fetchActivityFeed(
  runtime: DesktopRuntime,
  ready: DesktopReadyState,
): Promise<readonly DesktopActivityItem[]> {
  const res = await runtime.api.getActivityFeed(ready.membership.businessId, ready.branch.id);
  return res.items;
}
