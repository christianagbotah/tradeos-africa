import React from "react";
import type { CashForecastResponse, CfoAction } from "@tradeos/contracts";

export type AgingSideSnapshot = {
  totalOpenMinor: number;
  notDueMinor: number;
  dueWithin7DaysMinor: number;
  dueWithin30DaysMinor: number;
  overdue1To30DaysMinor: number;
  overdue31To60DaysMinor: number;
  overdue61To90DaysMinor: number;
  overdueOver90DaysMinor: number;
  obligationCount: number;
  oldestDueAt: string | null;
};

export type CreditAgingSnapshot = {
  businessId: string;
  branchId: string | null;
  currencyCode: string;
  generatedAt: string;
  receivables: AgingSideSnapshot;
  payables: AgingSideSnapshot;
};

type BuildInput = {
  healthActions: readonly CfoAction[];
  aging: CreditAgingSnapshot | null;
  forecast: CashForecastResponse | null;
};

const priorityRank: Record<CfoAction["priority"], number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function overdueTotal(side: AgingSideSnapshot): number {
  return side.overdue1To30DaysMinor + side.overdue31To60DaysMinor + side.overdue61To90DaysMinor + side.overdueOver90DaysMinor;
}

function olderOverdueTotal(side: AgingSideSnapshot): number {
  return side.overdue31To60DaysMinor + side.overdue61To90DaysMinor + side.overdueOver90DaysMinor;
}

export function buildCfoActionCenterItems({ healthActions, aging, forecast }: BuildInput): CfoAction[] {
  const precise: CfoAction[] = [];
  const suppressed = new Set<string>();

  if (forecast && (forecast.summary.firstNegativeCashDate !== null || forecast.summary.lowestProjectedCashMinor < 0)) {
    const gap = Math.max(0, -forecast.summary.lowestProjectedCashMinor);
    precise.push({
      code: "ACTION_FORECAST_SHORTFALL",
      sourceInsightCode: "CASH_FORECAST_SHORTFALL",
      priority: "URGENT",
      area: "CASH",
      title: forecast.summary.firstNegativeCashDate
        ? `Cash shortfall projected for ${forecast.summary.firstNegativeCashDate}`
        : "Cash forecast falls below zero",
      reason: `The 30-day forecast reaches a low of ${forecast.summary.lowestProjectedCashMinor < 0 ? "negative cash" : "zero cash"} on ${forecast.summary.lowestProjectedCashDate}.`,
      action: "Protect cash now: accelerate customer collections and defer or reschedule non-essential outflows before the projected shortfall.",
      href: "#cashbook",
      navigationLabel: "Open cashbook",
      evidence: [
        { key: "projectedCashGap", label: "Projected cash gap", value: gap, unit: "MINOR" },
        { key: "projectedClosingCash", label: "Projected day-30 cash", value: forecast.summary.projectedClosingCashMinor, unit: "MINOR" },
      ],
    });
    suppressed.add("ACTION_NEGATIVE_OPERATING_CASH");
    suppressed.add("ACTION_NON_OPERATING_CASH_SUPPORT");
  }

  if (aging) {
    const receivablesOverdue = overdueTotal(aging.receivables);
    if (receivablesOverdue > 0) {
      const older = olderOverdueTotal(aging.receivables);
      precise.push({
        code: "ACTION_OVERDUE_RECEIVABLES",
        sourceInsightCode: "OVERDUE_RECEIVABLES",
        priority: older > 0 ? "HIGH" : "MEDIUM",
        area: "CUSTOMERS",
        title: "Collect overdue customer balances",
        reason: `${aging.receivables.obligationCount} customer obligation${aging.receivables.obligationCount === 1 ? " is" : "s are"} open, with overdue balances already past their agreed due dates.`,
        action: "Start collections with the oldest overdue balances first, then work through amounts due in the next 7 days.",
        href: "#customers",
        navigationLabel: "Review customer credit",
        evidence: [
          { key: "overdueReceivables", label: "Overdue receivables", value: receivablesOverdue, unit: "MINOR" },
          { key: "olderOverdueReceivables", label: "31+ days overdue", value: older, unit: "MINOR" },
          { key: "customerObligations", label: "Open customer obligations", value: aging.receivables.obligationCount, unit: "COUNT" },
        ],
      });
      suppressed.add("ACTION_RECEIVABLE_PRESSURE");
      suppressed.add("ACTION_LOW_CASH_CONVERSION");
    }

    const payablesOverdue = overdueTotal(aging.payables);
    const dueSoon = aging.payables.dueWithin7DaysMinor;
    if (payablesOverdue > 0 || dueSoon > 0) {
      const availableCash = forecast?.summary.openingCashMinor ?? null;
      const urgent = availableCash !== null && payablesOverdue > Math.max(0, availableCash) && payablesOverdue > 0;
      const supplierEvidence: CfoAction["evidence"] = [
        { key: "overduePayables", label: "Overdue supplier payables", value: payablesOverdue, unit: "MINOR" },
        { key: "payablesDue7", label: "Due within 7 days", value: dueSoon, unit: "MINOR" },
      ];
      if (availableCash !== null) {
        supplierEvidence.push({ key: "openingCash", label: "Cash available now", value: availableCash, unit: "MINOR" });
      }
      precise.push({
        code: "ACTION_SUPPLIER_PAYMENT_PRESSURE",
        sourceInsightCode: "SUPPLIER_PAYMENT_PRESSURE",
        priority: urgent ? "URGENT" : payablesOverdue > 0 ? "HIGH" : "MEDIUM",
        area: "CASH",
        title: "Supplier payments need attention",
        reason: payablesOverdue > 0
          ? "Some supplier obligations are already overdue; additional payments may also fall due within the next 7 days."
          : "Supplier obligations fall due within the next 7 days and should be matched against available cash.",
        action: "Schedule essential supplier payments first and negotiate revised dates before cash pressure becomes a missed payment.",
        href: "#purchases",
        navigationLabel: "Review supplier balances",
        evidence: supplierEvidence,
      });
      suppressed.add("ACTION_PAYABLE_COVERAGE");
    }
  }

  const merged = [...precise, ...healthActions.filter((item) => !suppressed.has(item.code))];
  return merged
    .map((item, index) => ({ item, index }))
    .sort((a, b) => priorityRank[a.item.priority] - priorityRank[b.item.priority] || a.index - b.index)
    .slice(0, 5)
    .map(({ item }) => item);
}

function evidenceValue(row: CfoAction["evidence"][number], money: (minor: number) => string): string {
  if (row.unit === "MINOR") return money(row.value);
  if (row.unit === "PERCENT") return `${row.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  if (row.unit === "MONTHS") return `${row.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} months`;
  if (row.unit === "RATIO") return `${row.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`;
  return row.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function CfoActionCenter({
  healthActions,
  aging,
  forecast,
  money,
  offlineCached = false,
}: BuildInput & { money: (minor: number) => string; offlineCached?: boolean }) {
  const items = buildCfoActionCenterItems({ healthActions, aging, forecast });
  const elevated = items.filter((item) => item.priority === "URGENT" || item.priority === "HIGH").length;
  const top = items[0] ?? null;

  return (
    <div className="cfo-action-center">
      <div className="panel-heading compact">
        <div><p className="eyebrow">TradeOS CFO · prioritized next moves</p><h3>What needs my attention today?</h3></div>
        <span>{items.length} action{items.length === 1 ? "" : "s"}{offlineCached ? " · saved" : ""}</span>
      </div>
      {top ? (
        <p><strong>{elevated > 0 ? `${elevated} high-priority item${elevated === 1 ? "" : "s"}.` : "No high-priority warning."}</strong> Start with: {top.title}.</p>
      ) : <p>No action is generated until TradeOS has enough operating evidence.</p>}
      {items.length ? <div className="cfo-action-list">{items.map((item) => (
        <article className="cfo-action" key={item.code}>
          <div className="cfo-action-head"><div><span className={`cfo-priority ${item.priority.toLowerCase()}`}>{item.priority}</span><span>{item.area.replaceAll("_", " ")}</span></div><a className="ghost-button" href={item.href}>{item.navigationLabel}</a></div>
          <strong>{item.title}</strong>
          <p>{item.reason}</p>
          {item.evidence.length ? <p><b>Evidence:</b> {item.evidence.map((row) => `${row.label}: ${evidenceValue(row, money)}`).join(" · ")}</p> : null}
          <p><b>Do:</b> {item.action}</p>
        </article>
      ))}</div> : null}
    </div>
  );
}
