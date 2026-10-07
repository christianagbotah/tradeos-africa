import React from "react";
import type { CashForecastResponse } from "@tradeos/contracts";
import { ResponsiveTable } from "./ui/responsive-table";

export function CashForecastPanel({
  forecast,
  money,
  offlineCached = false,
}: {
  forecast: CashForecastResponse;
  money: (minor: number) => string;
  offlineCached?: boolean;
}) {
  const methods = [...new Set(forecast.days.map((day) => day.baselineMethod))]
    .filter((method) => method !== "NONE")
    .map((method) => method.replaceAll("_", " "));
  const summary = forecast.summary;
  const generatedLabel = new Intl.DateTimeFormat("en-GH", {
    timeZone: forecast.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(forecast.generatedAt));

  return (
    <div className="working-capital-panel cash-forecast-panel" id="cash-forecast">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">TradeOS CFO · forward cash visibility</p>
          <h3>{forecast.horizonDays}-Day Cash Forecast</h3>
        </div>
        <div className="forecast-badges">
          {offlineCached ? <span className="workflow-badge">Offline cached</span> : null}
          <span className="workflow-badge">{forecast.confidence.level} confidence</span>
        </div>
      </div>
      <p className="forecast-generated">
        Generated <time dateTime={forecast.generatedAt}>{generatedLabel}</time> · {forecast.timezone}
      </p>

      <div className="working-capital-grid">
        <article><span>Cash today</span><strong>{money(summary.openingCashMinor)}</strong><small>Authoritative recorded money balance at the start of today.</small></article>
        <article><span>Projected day-{forecast.horizonDays} cash</span><strong className={summary.projectedClosingCashMinor < 0 ? "warning" : undefined}>{money(summary.projectedClosingCashMinor)}</strong><small>Contractual obligations plus the evidence-based operating baseline.</small></article>
        <article><span>Lowest projected cash</span><strong className={summary.lowestProjectedCashMinor < 0 ? "warning" : undefined}>{money(summary.lowestProjectedCashMinor)}</strong><small>{summary.lowestProjectedCashDate}</small></article>
        <article><span>First projected shortfall</span><strong className={summary.firstNegativeCashDate ? "warning" : undefined}>{summary.firstNegativeCashDate ?? "No projected shortfall"}</strong><small>First forecast day whose closing cash is below zero.</small></article>
        <article><span>Contractual inflows</span><strong>{money(summary.totalContractualInflowsMinor)}</strong><small>{forecast.confidence.openCustomerObligationCount} open customer obligation{forecast.confidence.openCustomerObligationCount === 1 ? "" : "s"} · overdue {money(summary.overdueReceivablesMinor)}.</small></article>
        <article><span>Contractual outflows</span><strong>{money(summary.totalContractualOutflowsMinor)}</strong><small>{forecast.confidence.openSupplierObligationCount} open supplier obligation{forecast.confidence.openSupplierObligationCount === 1 ? "" : "s"} · overdue {money(summary.overduePayablesMinor)}.</small></article>
        <article><span>Estimated operating inflow</span><strong>{money(summary.totalBaselineInflowsMinor)}</strong><small>Behavioral estimate over the requested horizon.</small></article>
        <article><span>Estimated operating outflow</span><strong>{money(summary.totalBaselineOutflowsMinor)}</strong><small>Behavioral estimate over the requested horizon.</small></article>
      </div>

      <div className="forecast-explanation">
        <strong>How to read this forecast</strong>
        <p>
          Dated obligations come from recorded credit terms; estimated operating cash comes from recent settled cash behavior. Estimated behavior is not a promise of future sales or spending.
        </p>
        <p>
          Evidence: {forecast.confidence.historyDaysAvailable} completed history days · same-weekday coverage {forecast.confidence.sameWeekdayCoverageDays} day{forecast.confidence.sameWeekdayCoverageDays === 1 ? "" : "s"} · baseline {methods.length ? methods.join(" + ") : "NONE"}.
        </p>
        {forecast.confidence.assumptions.length ? <ul>{forecast.confidence.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul> : null}
      </div>

      <h4>Daily cash path</h4>
      <ResponsiveTable>
        <table>
          <thead><tr><th>Date</th><th>Opening cash</th><th>Customer due</th><th>Supplier due</th><th>Estimated inflow</th><th>Estimated outflow</th><th>Closing cash</th></tr></thead>
          <tbody>{forecast.days.map((day) => <tr className={day.closingCashMinor < 0 ? "forecast-negative" : undefined} key={day.date}>
            <td>{day.date}</td>
            <td>{money(day.openingCashMinor)}</td>
            <td>{money(day.contractualInflowsMinor)}{day.overdueContractualInflowsMinor > 0 ? <small className="forecast-overdue">overdue {money(day.overdueContractualInflowsMinor)}</small> : null}</td>
            <td>{money(day.contractualOutflowsMinor)}{day.overdueContractualOutflowsMinor > 0 ? <small className="forecast-overdue">overdue {money(day.overdueContractualOutflowsMinor)}</small> : null}</td>
            <td>{money(day.baselineInflowsMinor)}</td>
            <td>{money(day.baselineOutflowsMinor)}</td>
            <td><strong>{money(day.closingCashMinor)}</strong></td>
          </tr>)}</tbody>
        </table>
      </ResponsiveTable>
    </div>
  );
}
