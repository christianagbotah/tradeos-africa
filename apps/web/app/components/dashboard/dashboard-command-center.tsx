"use client";

import { useMemo } from "react";
import Link from "next/link";
import { BusinessPulse } from "../business/business-pulse";
import { AttentionItem } from "../business/attention-item";
import { MoneyValue } from "../business/money-value";
import { QuickAction } from "../business/quick-action";
import { canAccessWorkspaceRoute } from "../workspace/workspace-navigation";
import { buildDashboardModel } from "./dashboard-model";
import { useDashboardData } from "./dashboard-data";
import { dashboardAttentionForRole, dashboardCanViewReports, dashboardQuickActions } from "./dashboard-actions";

const greeting = (tz: string) => {
  const h = Number(new Intl.DateTimeFormat("en-GH", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

const frontlineRoles = new Set(["CASHIER", "SALES", "STAFF"]);

export function DashboardCommandCenter({
  businessId,
  businessName,
  branchId,
  branchName,
  currencyCode,
  role,
  branchTimezone,
}: {
  businessId: string;
  businessName: string;
  branchId: string;
  branchName: string;
  currencyCode: string;
  role: string;
  branchTimezone: string;
}) {
  const { evidence, busy, message } = useDashboardData({ businessId, branchId, currencyCode, branchTimezone });
  const model = useMemo(() => buildDashboardModel(evidence), [evidence]);
  const actions = dashboardQuickActions(role);
  const visibleAttention = dashboardAttentionForRole(role, model.attention);
  const pulseActions = visibleAttention.slice(0, 2).map((a) => ({ href: a.href, label: a.actionLabel }));
  const isFrontline = frontlineRoles.has(role);
  const canSell = canAccessWorkspaceRoute(role, "/sell");

  const money = (label: string, value: number | null) => (
    <article>
      <span>{label}</span>
      {value == null ? <strong>—</strong> : <MoneyValue minor={value} currencyCode={currencyCode} emphasis="strong" />}
    </article>
  );

  return (
    <div className="tos-dashboard" data-workspace-route="dashboard">
      {/* Greeting + business context */}
      <header className="tos-dashboard-greeting">
        <div>
          <span>{greeting(branchTimezone)}</span>
          <h1>{businessName}</h1>
          <p>{branchName} · {model.dataStatus.coverage}</p>
        </div>
        {dashboardCanViewReports(role) ? <Link href="/reports">View reports</Link> : null}
      </header>

      {/* Status message — offline/partial/error */}
      {message ? <p className="tos-dashboard-message" role="status">{message}</p> : null}

      {/* Frontline Sell CTA — promoted for cashier/sales roles */}
      {isFrontline && canSell ? (
        <Link href="/sell" className="tos-dashboard-sell-cta">
          <span className="tos-dashboard-sell-cta-icon">→</span>
          <div>
            <strong>Start selling</strong>
            <span>Open the POS to take a new sale</span>
          </div>
        </Link>
      ) : null}

      {/* Today — business state (hero metric for owners) */}
      <section className="tos-today" aria-labelledby="today-title">
        <div className="tos-today-hero">
          <span className="tos-section-kicker">Today</span>
          <h2 id="today-title">Sales</h2>
          {model.today.netRevenueMinor == null ? (
            <strong className="tos-today-empty">{busy ? "Loading…" : "—"}</strong>
          ) : (
            <MoneyValue minor={model.today.netRevenueMinor} currencyCode={currencyCode} emphasis="hero" />
          )}
          {model.today.comparisonText ? (
            <p>{model.today.comparisonText}</p>
          ) : (
            <p>Comparison appears when enough history is available.</p>
          )}
        </div>
        <div className="tos-today-support">
          {money("Gross profit", model.today.grossProfitMinor)}
          <article>
            <span>Transactions</span>
            <strong>{model.today.salesCount ?? "—"}</strong>
          </article>
          {money("Net cash movement", model.today.cashNetMinor)}
        </div>
      </section>

      {/* Business pulse — AI/operational summary */}
      <BusinessPulse
        headline={model.pulse.headline}
        summary={model.pulse.summary}
        evidence={model.pulse.evidence}
        actions={pulseActions}
        coverage={model.dataStatus.coverage}
      />

      {/* Quick actions — what should I do next */}
      {actions.length > 0 ? (
        <section className="tos-dashboard-section" aria-labelledby="quick-actions-title">
          <div className="tos-section-heading">
            <div>
              <span className="tos-section-kicker">Do it now</span>
              <h2 id="quick-actions-title">Quick actions</h2>
            </div>
          </div>
          <div className="tos-quick-grid">
            {actions.map((a) => <QuickAction key={a.href + a.label} {...a} />)}
          </div>
        </section>
      ) : null}

      {/* Needs attention — exceptions */}
      <section className="tos-dashboard-section" aria-labelledby="attention-title">
        <div className="tos-section-heading">
          <div>
            <span className="tos-section-kicker">Priority</span>
            <h2 id="attention-title">Needs attention</h2>
          </div>
        </div>
        {visibleAttention.length ? (
          <div className="tos-attention-list">
            {visibleAttention.map((a) => (
              <AttentionItem
                key={a.id}
                title={a.title}
                detail={a.detail}
                priority={a.priority}
                href={a.href}
                actionLabel={a.actionLabel}
                evidence={a.amountMinor != null ? [
                  new Intl.NumberFormat("en-GH", {
                    style: "currency",
                    currency: currencyCode,
                    currencyDisplay: currencyCode === "GHS" ? "narrowSymbol" : "code",
                  }).format(a.amountMinor / 100).replace("GH₵", "₵"),
                ] : undefined}
              />
            ))}
          </div>
        ) : (
          <p className="tos-dashboard-empty">No urgent exception is visible in the available evidence.</p>
        )}
      </section>

      {/* Money position — cash/receivables/payables */}
      <section className="tos-dashboard-section" aria-labelledby="money-position-title">
        <div className="tos-section-heading">
          <div>
            <span className="tos-section-kicker">Balances</span>
            <h2 id="money-position-title">Money position</h2>
          </div>
        </div>
        <div className="tos-money-grid">
          {money("Cash / money accounts", model.moneyPosition.cashMinor)}
          {money("Receivables", model.moneyPosition.receivablesMinor)}
          {money("Payables", model.moneyPosition.payablesMinor)}
        </div>
      </section>

      {/* Momentum — trends (owner/manager only — not shown for frontline) */}
      {model.momentum && !isFrontline ? (
        <section className="tos-dashboard-section" aria-labelledby="momentum-title">
          <div className="tos-section-heading">
            <div>
              <span className="tos-section-kicker">Trend</span>
              <h2 id="momentum-title">Business momentum</h2>
            </div>
            <small>Compared with {model.momentum.baselineLabel}</small>
          </div>
          <div className="tos-momentum-grid">
            <article>
              <span>Revenue</span>
              <strong>
                {model.momentum.revenueChangePercent == null
                  ? "Not enough history"
                  : `${model.momentum.revenueChangePercent >= 0 ? "+" : ""}${model.momentum.revenueChangePercent.toFixed(1)}%`}
              </strong>
            </article>
            <article>
              <span>Gross profit</span>
              <strong>
                {model.momentum.grossProfitChangePercent == null
                  ? "Not enough history"
                  : `${model.momentum.grossProfitChangePercent >= 0 ? "+" : ""}${model.momentum.grossProfitChangePercent.toFixed(1)}%`}
              </strong>
            </article>
          </div>
        </section>
      ) : null}
    </div>
  );
}
