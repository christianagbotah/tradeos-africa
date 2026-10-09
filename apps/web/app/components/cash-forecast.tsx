import React from "react";
import type { CashForecastResponse } from "@tradeos/contracts";
import { MobileRecordCard } from "./ui/mobile-record-card";
import { ResponsiveTable } from "./ui/responsive-table";
import { StatCard } from "./ui/stat-card";
import { StatusBadge } from "./ui/status-badge";

export function CashForecastPanel({ forecast, money, offlineCached = false }: { forecast: CashForecastResponse; money: (minor: number) => string; offlineCached?: boolean }) {
  const methods = [...new Set(forecast.days.map((day) => day.baselineMethod))]
    .filter((method) => method !== "NONE")
    .map((method) => method.replaceAll("_", " "));
  const summary = forecast.summary;
  const generatedLabel = new Intl.DateTimeFormat("en-GH", { timeZone: forecast.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(forecast.generatedAt));

  return (
    <section className="cash-forecast-panel" id="cash-forecast">
      <header className="reports-section-heading">
        <div><span>TradeOS CFO · forward cash visibility</span><h3>{forecast.horizonDays}-Day Cash Forecast</h3></div>
        <div className="reports-status-cluster">{offlineCached ? <StatusBadge tone="warning">Offline cached</StatusBadge> : null}<StatusBadge tone={forecast.confidence.level === "LOW" ? "warning" : "info"}>{forecast.confidence.level} confidence</StatusBadge></div>
      </header>
      <p className="cash-forecast-generated">Generated <time dateTime={forecast.generatedAt}>{generatedLabel}</time> · {forecast.timezone}</p>

      <div className="reports-stat-grid">
        <StatCard label="Cash today" value={money(summary.openingCashMinor)} hint="Authoritative recorded money balance at the start of today." />
        <StatCard tone={summary.projectedClosingCashMinor < 0 ? "danger" : "default"} label={`Projected day-${forecast.horizonDays} cash`} value={money(summary.projectedClosingCashMinor)} hint="Contractual obligations plus the evidence-based operating baseline." />
        <StatCard tone={summary.lowestProjectedCashMinor < 0 ? "danger" : "default"} label="Lowest projected cash" value={money(summary.lowestProjectedCashMinor)} hint={summary.lowestProjectedCashDate} />
        <StatCard tone={summary.firstNegativeCashDate ? "warning" : "positive"} label="First projected shortfall" value={summary.firstNegativeCashDate ?? "No projected shortfall"} hint="First forecast day whose closing cash is below zero." />
        <StatCard label="Contractual inflows" value={money(summary.totalContractualInflowsMinor)} hint={`${forecast.confidence.openCustomerObligationCount} open customer obligation${forecast.confidence.openCustomerObligationCount === 1 ? "" : "s"} · overdue ${money(summary.overdueReceivablesMinor)}.`} />
        <StatCard label="Contractual outflows" value={money(summary.totalContractualOutflowsMinor)} hint={`${forecast.confidence.openSupplierObligationCount} open supplier obligation${forecast.confidence.openSupplierObligationCount === 1 ? "" : "s"} · overdue ${money(summary.overduePayablesMinor)}.`} />
        <StatCard label="Estimated inflow" value={money(summary.totalBaselineInflowsMinor)} hint="Behavioral estimate over the requested horizon." />
        <StatCard label="Estimated outflow" value={money(summary.totalBaselineOutflowsMinor)} hint="Behavioral estimate over the requested horizon." />
      </div>

      <div className="cash-forecast-explanation">
        <strong>How to read this forecast</strong>
        <p>Dated obligations come from recorded credit terms; estimated operating cash comes from recent settled cash behavior. Estimated behavior is not a promise of future sales or spending.</p>
        <p>Evidence: {forecast.confidence.historyDaysAvailable} completed history days · same-weekday coverage {forecast.confidence.sameWeekdayCoverageDays} day{forecast.confidence.sameWeekdayCoverageDays === 1 ? "" : "s"} · baseline {methods.length ? methods.join(" + ") : "NONE"}.</p>
        {forecast.confidence.assumptions.length ? <ul>{forecast.confidence.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul> : null}
      </div>

      <div className="reports-section-heading"><div><span>30-day path</span><h4>Daily cash path</h4></div></div>
      <ResponsiveTable className="reports-table--desktop">
        <table><thead><tr><th>Date</th><th>Opening cash</th><th>Customer due</th><th>Supplier due</th><th>Estimated inflow</th><th>Estimated outflow</th><th>Closing cash</th></tr></thead>
          <tbody>{forecast.days.map((day) => <tr className={day.closingCashMinor < 0 ? "forecast-negative" : undefined} key={day.date}><td>{day.date}</td><td>{money(day.openingCashMinor)}</td><td>{money(day.contractualInflowsMinor)}{day.overdueContractualInflowsMinor > 0 ? <small className="cash-forecast-overdue">overdue {money(day.overdueContractualInflowsMinor)}</small> : null}</td><td>{money(day.contractualOutflowsMinor)}{day.overdueContractualOutflowsMinor > 0 ? <small className="cash-forecast-overdue">overdue {money(day.overdueContractualOutflowsMinor)}</small> : null}</td><td>{money(day.baselineInflowsMinor)}</td><td>{money(day.baselineOutflowsMinor)}</td><td><strong>{money(day.closingCashMinor)}</strong></td></tr>)}</tbody>
        </table>
      </ResponsiveTable>
      <div className="reports-records--mobile">{forecast.days.map((day) => <MobileRecordCard key={day.date} title={day.date} meta={`Opening ${money(day.openingCashMinor)} · customer due ${money(day.contractualInflowsMinor)} · supplier due ${money(day.contractualOutflowsMinor)}`} status={<StatusBadge tone={day.closingCashMinor < 0 ? "danger" : "positive"}>{day.closingCashMinor < 0 ? "Shortfall" : "Projected positive"}</StatusBadge>}><p><strong>{money(day.closingCashMinor)}</strong> projected closing cash</p></MobileRecordCard>)}</div>
    </section>
  );
}
