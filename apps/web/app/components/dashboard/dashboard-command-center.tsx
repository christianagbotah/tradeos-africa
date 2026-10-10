"use client";

import { useMemo } from "react";
import Link from "next/link";
import { formatMoney } from "@tradeos/contracts";
import { canAccessWorkspaceRoute } from "../workspace/workspace-navigation";
import { buildDashboardModel, type DashboardAttention } from "./dashboard-model";
import { useDashboardData } from "./dashboard-data";
import { dashboardAttentionForRole, dashboardCanViewReports, dashboardQuickActions } from "./dashboard-actions";

const frontlineRoles = new Set(["CASHIER", "SALES", "STAFF"]);

function packCopy(type: string) {
  const copy: Record<string, { label: string; text: string }> = {
    RETAIL_HARDWARE: { label: "Retail / Provisions", text: "Stock and credit are your levers — reorder fast, collect gently." },
    FOOD: { label: "Food / Hospitality", text: "Watch daily sales, ingredient stock and waste before the next rush." },
    SALON_BARBER: { label: "Salon / Barber", text: "Keep services moving, protect consumable stock and follow up on customer balances." },
    DRINKING_SPOT: { label: "Drinks / Hospitality", text: "Track fast-moving drinks, selling units and cash position throughout the day." },
    WASHING_BAY: { label: "Washing bay", text: "Keep service volume, consumables and shift cash visible from opening to close." },
    CAR_PARK: { label: "Car park", text: "Keep vehicle activity, shift custody and collected cash easy to reconcile." },
    DISTRIBUTION: { label: "Wholesale / Distribution", text: "Protect stock availability, customer credit and supplier obligations as volume grows." },
    SERVICES: { label: "Services", text: "Keep jobs, customer balances and operating cash visible in one place." },
  };
  return copy[type] ?? { label: "Business workspace", text: "Use today’s evidence to decide what needs action next." };
}

function actionLabel(href: string, fallback: string) {
  if (href === "/sell") return "New sale";
  if (href === "/customers") return "Send reminders";
  return fallback;
}

function actionIcon(href: string) {
  if (href === "/sell") return "🛒";
  if (href === "/purchases") return "◇";
  if (href === "/cashbook") return "▣";
  if (href === "/customers") return "↩";
  return "+";
}

function evidenceCard(item: DashboardAttention, currencyCode: string) {
  return (
    <article className={`zai-ai-action zai-ai-action--${item.priority}`} key={item.id}>
      <div className="zai-ai-action-title"><span aria-hidden="true">{item.priority === "critical" ? "!" : item.priority === "warning" ? "△" : "○"}</span><strong>{item.title}</strong></div>
      <p>{item.detail}</p>
      {item.amountMinor != null ? <small>{formatMoney(item.amountMinor, currencyCode)}</small> : null}
      <Link href={item.href}>{item.actionLabel} <span aria-hidden="true">→</span></Link>
    </article>
  );
}

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
  const actions = dashboardQuickActions(role).slice(0, 4);
  const visibleAttention = dashboardAttentionForRole(role, model.attention).slice(0, 3);
  const canSell = canAccessWorkspaceRoute(role, "/sell");
  const isFrontline = frontlineRoles.has(role);
  const pack = packCopy(businessType);

  const aiCards: React.ReactNode[] = visibleAttention.map((item) => evidenceCard(item, currencyCode));
  if (aiCards.length === 0) {
    aiCards.push(
      <article className="zai-ai-action zai-ai-action--info" key="quiet-evidence">
        <div className="zai-ai-action-title"><span aria-hidden="true">✣</span><strong>{model.today.salesCount === 0 ? "No sales recorded yet today" : "No urgent exception right now"}</strong></div>
        <p>{model.today.salesCount === 0 ? "TradeOS has not received a sale in the current reporting period." : "The available business evidence does not currently show an urgent exception."}</p>
        <small>{model.dataStatus.coverage}</small>
        {canSell ? <Link href="/sell">Start a sale <span aria-hidden="true">→</span></Link> : dashboardCanViewReports(role) ? <Link href="/reports">See report <span aria-hidden="true">→</span></Link> : null}
      </article>,
    );
  }
  if (aiCards.length < 3 && model.momentum && !isFrontline) {
    aiCards.push(
      <article className="zai-ai-action zai-ai-action--positive" key="momentum-evidence">
        <div className="zai-ai-action-title"><span aria-hidden="true">↗</span><strong>Business momentum</strong></div>
        <p>{model.momentum.revenueChangePercent == null ? "More history is needed before TradeOS can compare revenue reliably." : `Revenue is ${Math.abs(model.momentum.revenueChangePercent).toFixed(1)}% ${model.momentum.revenueChangePercent >= 0 ? "above" : "below"} ${model.momentum.baselineLabel}.`}</p>
        <small>Evidence from the current reporting period</small>
        {dashboardCanViewReports(role) ? <Link href="/reports">See report <span aria-hidden="true">→</span></Link> : null}
      </article>,
    );
  }

  const todaySales = model.today.netRevenueMinor == null ? "—" : formatMoney(model.today.netRevenueMinor, currencyCode);
  const grossProfit = model.today.grossProfitMinor == null ? "—" : formatMoney(model.today.grossProfitMinor, currencyCode);
  const cashPosition = model.moneyPosition.cashMinor == null ? "—" : formatMoney(model.moneyPosition.cashMinor, currencyCode);
  const credit = model.moneyPosition.receivablesMinor == null ? "—" : formatMoney(model.moneyPosition.receivablesMinor, currencyCode);

  return (
    <div className="zai-dashboard" data-workspace-route="dashboard">
      <header className="zai-dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p>{businessName} · {branchName} — Here&apos;s your shop today.</p>
        </div>
        <div className="zai-dashboard-header-actions">
          <span className="zai-online-pill">⌁ Online</span>
          <time className="zai-date-pill" dateTime={new Date().toISOString().slice(0, 10)}>▣ Today</time>
          {canSell ? <Link className="zai-new-sale" href="/sell">🛒 New sale</Link> : null}
        </div>
      </header>

      {message ? <p className="tos-dashboard-message" role="status">{message}</p> : null}

      <section className="zai-business-guidance" aria-label="Business pack guidance">
        <span aria-hidden="true">✣</span><p><strong>{pack.label}:</strong> {pack.text}</p>
      </section>

      {actions.length > 0 ? (
        <nav className="zai-action-rail" aria-label="Quick business actions">
          {actions.map((item) => <Link href={item.href} key={item.href}><span aria-hidden="true">{actionIcon(item.href)}</span>{actionLabel(item.href, item.label)}</Link>)}
        </nav>
      ) : null}

      <section className="zai-ai-actions" aria-labelledby="zai-ai-actions-title">
        <div className="zai-ai-actions-heading"><h2 id="zai-ai-actions-title">✣ AI ACTIONS FOR TODAY</h2><span>Suggestions · not accounting records</span></div>
        <div className="zai-ai-actions-grid">{aiCards.slice(0, 3)}</div>
      </section>

      <section className="zai-kpi-grid" aria-label="Today’s business metrics">
        <article><span>Today&apos;s sales</span><strong>{busy && model.today.netRevenueMinor == null ? "Loading…" : todaySales}</strong><small>{model.today.comparisonText ?? `${model.today.salesCount ?? 0} sales recorded`}</small></article>
        <article><span>Gross profit</span><strong>{grossProfit}</strong><small>{model.momentum?.grossProfitChangePercent == null ? "Current period" : `${model.momentum.grossProfitChangePercent >= 0 ? "+" : ""}${model.momentum.grossProfitChangePercent.toFixed(1)}% vs ${model.momentum.baselineLabel}`}</small></article>
        <article><span>Cash position</span><strong>{cashPosition}</strong><small>Across available money accounts</small></article>
        <article><span>Outstanding credit</span><strong>{credit}</strong><small>{model.moneyPosition.receivablesMinor && model.moneyPosition.receivablesMinor > 0 ? "Customer balances need follow-up" : "No outstanding amount visible"}</small></article>
      </section>

      <section className="zai-dashboard-lower-grid">
        <article className="zai-dashboard-panel zai-sales-trend">
          <div className="zai-dashboard-panel-heading"><div><h2>Sales — last 7 days</h2><p>Daily revenue and gross profit</p></div><span>7d</span></div>
          <div className="zai-chart-placeholder"><strong>{todaySales}</strong><span>{model.today.salesCount ?? 0} transaction{model.today.salesCount === 1 ? "" : "s"} in the available current-period evidence</span><p>Daily trend points appear here as historical report evidence becomes available.</p></div>
        </article>
        <article className="zai-dashboard-panel zai-money-flow">
          <div className="zai-dashboard-panel-heading"><div><h2>Money flow</h2><p>In vs out today</p></div></div>
          <dl><div><dt>Net cash movement</dt><dd>{model.today.cashNetMinor == null ? "—" : formatMoney(model.today.cashNetMinor, currencyCode)}</dd></div><div><dt>Receivables</dt><dd>{credit}</dd></div><div><dt>Payables</dt><dd>{model.moneyPosition.payablesMinor == null ? "—" : formatMoney(model.moneyPosition.payablesMinor, currencyCode)}</dd></div></dl>
          {dashboardCanViewReports(role) ? <Link href="/reports">Open full reports →</Link> : null}
        </article>
      </section>
    </div>
  );
}
