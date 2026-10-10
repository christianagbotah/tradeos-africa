"use client";

import { useMemo } from "react";
import { formatMoney } from "@tradeos/contracts";
import Link from "next/link";
import { MoneyValue } from "../business/money-value";
import { canAccessWorkspaceRoute } from "../workspace/workspace-navigation";
import { buildDashboardModel } from "./dashboard-model";
import { useDashboardData } from "./dashboard-data";
import { dashboardAttentionForRole, dashboardCanViewReports } from "./dashboard-actions";

const frontlineRoles = new Set(["CASHIER", "SALES", "STAFF"]);

const businessGuidance = (businessType: string) => {
  const type = businessType.toUpperCase();
  if (type.includes("FOOD")) return ["Food / Hospitality", "Watch ingredients, wastage and today's cash position."] as const;
  if (type.includes("SALON") || type.includes("BARBER")) return ["Salon / Barber", "Bookings, staff time and consumables are your levers."] as const;
  if (type.includes("DRINK")) return ["Drinks / Spot", "Keep fast-moving stock visible and protect your cash margin."] as const;
  if (type.includes("SERVICE")) return ["Services", "Keep jobs moving, collect promptly and protect capacity."] as const;
  if (type.includes("DISTRIBUT")) return ["Distribution", "Stock turns, receivables and delivery discipline drive the day."] as const;
  return ["Retail / Provisions", "Stock and credit are your levers — reorder fast, collect gently."] as const;
};

export function DashboardCommandCenter({
  businessId,
  businessName,
  businessType,
  branchId,
  branchName,
  currencyCode,
  role,
  branchTimezone,
}: {
  businessId: string;
  businessName: string;
  businessType: string;
  branchId: string;
  branchName: string;
  currencyCode: string;
  role: string;
  branchTimezone: string;
}) {
  const { evidence, busy, message } = useDashboardData({ businessId, branchId, currencyCode, branchTimezone });
  const model = useMemo(() => buildDashboardModel(evidence), [evidence]);
  const visibleAttention = dashboardAttentionForRole(role, model.attention).slice(0, 3);
  const isFrontline = frontlineRoles.has(role);
  const canSell = canAccessWorkspaceRoute(role, "/sell");
  const canPurchase = canAccessWorkspaceRoute(role, "/purchases");
  const canCashbook = canAccessWorkspaceRoute(role, "/cashbook");
  const canCustomers = canAccessWorkspaceRoute(role, "/customers");
  const [packLabel, packGuidance] = businessGuidance(businessType);

  const trend = (value: number | null | undefined) => value == null ? "More history needed" : `${value >= 0 ? "↗ +" : "↘ "}${value.toFixed(1)}% · vs yesterday`;
  const moneyValue = (value: number | null, loadingText = "—") => value == null
    ? <strong className="tos-zai-kpi-empty">{busy ? "Loading…" : loadingText}</strong>
    : <MoneyValue minor={value} currencyCode={currencyCode} emphasis="strong" />;

  const quickActions = [
    canSell ? { href: "/sell", label: "New sale", icon: "⌑" } : null,
    canPurchase ? { href: "/purchases", label: "Receive stock", icon: "◇" } : null,
    canCashbook ? { href: "/cashbook", label: "Record expense", icon: "▤" } : null,
    canCustomers ? { href: "/customers", label: "Send reminders", icon: "↩" } : null,
  ].filter((item): item is { href: string; label: string; icon: string } => Boolean(item));

  const aiItems = visibleAttention.length ? visibleAttention : [{
    id: "pulse",
    priority: "info" as const,
    title: model.pulse.headline,
    detail: model.pulse.summary,
    href: dashboardCanViewReports(role) ? "/reports" : "/dashboard",
    actionLabel: dashboardCanViewReports(role) ? "See report" : "Review dashboard",
  }];

  return (
    <div className="tos-dashboard tos-zai-dashboard" data-workspace-route="dashboard">
      <header className="tos-zai-dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p>{businessName} · {branchName} — Here&apos;s your shop today.</p>
        </div>
        <div className="tos-zai-dashboard-header-actions">
          <span className="tos-zai-date-chip">▣ <span>Today</span></span>
          {canSell ? <Link className="tos-zai-primary-action" href="/sell">⌑ <span>New sale</span></Link> : null}
        </div>
      </header>

      {message ? <p className="tos-dashboard-message" role="status">{message}</p> : null}

      <section className="tos-zai-pack-banner" aria-label={`${packLabel} operating guidance`}>
        <span aria-hidden="true">✣</span>
        <p><strong>{packLabel}:</strong> {packGuidance}</p>
      </section>

      {quickActions.length ? (
        <nav className="tos-zai-dashboard-actions" aria-label="Quick actions">
          {quickActions.map((action) => <Link key={action.href} href={action.href}><span aria-hidden="true">{action.icon}</span>{action.label}</Link>)}
        </nav>
      ) : null}

      <section className="tos-zai-ai-actions" aria-labelledby="ai-actions-title">
        <div className="tos-zai-ai-heading">
          <div><span aria-hidden="true">✣</span><h2 id="ai-actions-title">AI actions for today</h2></div>
          <small>Suggestions · not accounting records</small>
        </div>
        <div className="tos-zai-ai-grid">
          {aiItems.map((item) => (
            <article key={item.id} className={`tos-zai-ai-card tos-zai-ai-card--${item.priority}`}>
              <div className="tos-zai-ai-card-title"><span aria-hidden="true">{item.priority === "critical" ? "!" : item.priority === "warning" ? "△" : "?"}</span><h3>{item.title}</h3></div>
              <p>{item.detail}</p>
              {"amountMinor" in item && item.amountMinor != null ? <small>{formatMoney(item.amountMinor, currencyCode)}</small> : null}
              <Link href={item.href}>{item.actionLabel} →</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="tos-zai-kpi-grid" aria-label="Today business position">
        <article className="tos-zai-kpi-card">
          <div className="tos-zai-kpi-head"><span>Today&apos;s sales</span><i aria-hidden="true">↗</i></div>
          {moneyValue(model.today.netRevenueMinor)}
          <small className={(model.momentum?.revenueChangePercent ?? 0) < 0 ? "negative" : "positive"}>{trend(model.momentum?.revenueChangePercent)}</small>
          <p>{model.today.salesCount == null ? "Transaction count unavailable" : `${model.today.salesCount} sale${model.today.salesCount === 1 ? "" : "s"} today`}</p>
        </article>
        <article className="tos-zai-kpi-card">
          <div className="tos-zai-kpi-head"><span>Gross profit</span><i aria-hidden="true">▣</i></div>
          {moneyValue(model.today.grossProfitMinor)}
          <small className={(model.momentum?.grossProfitChangePercent ?? 0) < 0 ? "negative" : "positive"}>{trend(model.momentum?.grossProfitChangePercent)}</small>
          <p>Current-period gross profit evidence</p>
        </article>
        <article className="tos-zai-kpi-card">
          <div className="tos-zai-kpi-head"><span>Cash position</span><i aria-hidden="true">▭</i></div>
          {moneyValue(model.moneyPosition.cashMinor)}
          <small>Across available money accounts</small>
          <p>Cash and settlement position</p>
        </article>
        <article className="tos-zai-kpi-card">
          <div className="tos-zai-kpi-head"><span>Outstanding credit</span><i aria-hidden="true">▤</i></div>
          {moneyValue(model.moneyPosition.receivablesMinor)}
          <small>{model.moneyPosition.receivablesMinor && model.moneyPosition.receivablesMinor > 0 ? "Customer balances need follow-up" : "No outstanding credit visible"}</small>
          <p>Receivables in current evidence</p>
        </article>
      </section>

      <section className="tos-zai-dashboard-lower">
        <article className="tos-zai-analytics-card">
          <div className="tos-zai-section-title"><div><h2>Sales — today</h2><p>Current activity and gross-profit signal</p></div><span>{model.today.salesCount ?? 0} transactions</span></div>
          <div className="tos-zai-sales-signal">
            <div><span>Net revenue</span>{moneyValue(model.today.netRevenueMinor)}</div>
            <div><span>Gross profit</span>{moneyValue(model.today.grossProfitMinor)}</div>
          </div>
        </article>
        <article className="tos-zai-analytics-card">
          <div className="tos-zai-section-title"><div><h2>Money flow</h2><p>What is available, owed to you and owed out</p></div></div>
          <div className="tos-zai-money-flow">
            <div><span>Cash</span>{moneyValue(model.moneyPosition.cashMinor)}</div>
            <div><span>Receivables</span>{moneyValue(model.moneyPosition.receivablesMinor)}</div>
            <div><span>Payables</span>{moneyValue(model.moneyPosition.payablesMinor)}</div>
          </div>
        </article>
      </section>

      {isFrontline && canSell ? <Link className="tos-zai-mobile-sell" href="/sell">Start selling</Link> : null}
    </div>
  );
}
