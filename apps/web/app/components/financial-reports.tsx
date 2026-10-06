"use client";

import { useEffect, useMemo, useState } from "react";
import { clientApi, messageFrom } from "../lib/client-api";
import { mutationAppliedEvent } from "../lib/offline-sync";

type Flow = {
  grossRevenueMinor: number; returnsRevenueMinor: number; netRevenueMinor: number;
  grossTaxMinor: number; returnsTaxMinor: number; netTaxMinor: number;
  grossCogsMinor: number; cogsReversalMinor: number; netCogsMinor: number; discardedReturnCostMinor: number;
  grossProfitMinor: number; expenseMinor: number; purchaseReturnVarianceMinor: number; operatingProfitMinor: number;
  grossSalesTotalMinor: number; refundTotalMinor: number; salesCount: number; returnCount: number;
  averageNetSaleMinor: number; cashInflowMinor: number; cashOutflowMinor: number;
  netCashMovementMinor: number; operatingCashNetMinor: number;
};
type Position = {
  cashBalanceMinor: number; receivablesMinor: number; customerCreditBalanceMinor: number;
  payablesMinor: number; supplierCreditBalanceMinor: number; inventoryValueMinor: number;
  inventoryAvailableValueMinor: number; inventoryQuarantineValueMinor: number; inventoryOtherValueMinor: number;
  inventorySnapshotAt: string;
};
type Daily = { date: string; netRevenueMinor: number; netCogsMinor: number; grossProfitMinor: number; expenseMinor: number; purchaseReturnVarianceMinor: number; operatingProfitMinor: number; cashNetMinor: number; salesCount: number; returnCount: number };
type Branch = { branchId: string; branchName: string; netRevenueMinor: number; netCogsMinor: number; grossProfitMinor: number; expenseMinor: number; purchaseReturnVarianceMinor: number; operatingProfitMinor: number; cashNetMinor: number; receivablesMinor: number; payablesMinor: number; inventoryValueMinor: number; salesCount: number; returnCount: number };
type Item = { itemId: string; itemName: string; itemKind: string; unitCode: string; quantitySold: number; quantityReturned: number; netRevenueMinor: number; netCogsMinor: number; grossProfitMinor: number };
type HealthDimension = { key: string; label: string; weight: number; applicable: boolean; score: number | null; summary: string; metrics: Array<{ key: string; label: string; value: number | null; unit: string }> };
type HealthEvidence = { key: string; label: string; value: number; unit: string };
type HealthInsight = { code: string; severity: "CRITICAL" | "WARNING" | "OPPORTUNITY" | "POSITIVE" | "INFO"; title: string; message: string; action: string; evidence: HealthEvidence[] };
type WorkingCapital = { status: string; headline: string; inventorySnapshotAligned: boolean; cashAfterPayablesMinor: number; netTradeCreditMinor: number; operatingWorkingCapitalMinor: number | null; payableCoverageRatio: number | null; receivableMonths: number | null; inventoryMonths: number | null; operatingCashConversionPercent: number | null };
type CfoAction = { code: string; sourceInsightCode: string; priority: "URGENT" | "HIGH" | "MEDIUM" | "LOW"; area: string; title: string; reason: string; action: string; href: string; navigationLabel: string; evidence: HealthEvidence[] };
type Health = { algorithmVersion: string; score: number | null; status: string; confidence: string; headline: string; periodDays: number; dimensions: HealthDimension[]; insights: HealthInsight[]; workingCapital: WorkingCapital; actions: CfoAction[] };
type AgingSide = { totalOpenMinor: number; notDueMinor: number; dueWithin7DaysMinor: number; dueWithin30DaysMinor: number; overdue1To30DaysMinor: number; overdue31To60DaysMinor: number; overdue61To90DaysMinor: number; overdueOver90DaysMinor: number; obligationCount: number; oldestDueAt: string | null };
type CreditAging = { businessId: string; branchId: string | null; currencyCode: string; generatedAt: string; receivables: AgingSide; payables: AgingSide };
type Report = {
  currencyCode: string;
  period: { from: string; to: string; timezone: string };
  previousPeriod: { from: string; to: string; timezone: string };
  flow: Flow;
  previousFlow: Flow;
  comparison: { netRevenueDeltaMinor: number; grossProfitDeltaMinor: number; expenseDeltaMinor: number; operatingProfitDeltaMinor: number; salesCountDelta: number; netCashMovementDeltaMinor: number; netRevenueChangePercent: number | null; grossProfitChangePercent: number | null; operatingProfitChangePercent: number | null };
  position: Position;
  previousPosition: { cashBalanceMinor: number; receivablesMinor: number; customerCreditBalanceMinor: number; payablesMinor: number; supplierCreditBalanceMinor: number };
  daily: Daily[];
  branches: Branch[];
  topItems: Item[];
  health: Health;
};

const allowedRoles = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "VIEWER"];
const moneyMutations = new Set(["SALE_CREATE", "CUSTOMER_PAYMENT_CREATE", "PURCHASE_RECEIVE_CREATE", "SUPPLIER_PAYMENT_CREATE", "RETURN_CREATE", "REFUND_CREATE", "PURCHASE_RETURN_CREATE", "EXPENSE_CREATE", "CASHBOOK_ADJUSTMENT_CREATE", "MONEY_TRANSFER_CREATE", "MONEY_RECONCILIATION_RESOLVE"]);

function dateInZone(timezone: string, offsetDays = 0) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return addLocalDays(`${parts.year}-${parts.month}-${parts.day}`, offsetDays);
}
function addLocalDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}
function zonedMidnightIso(date: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const targetAsUtc = Date.UTC(year!, month! - 1, day!, 0, 0, 0);
  let instant = targetAsUtc;
  // Two passes handle offset changes near DST boundaries without relying on browser-local timezone.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant += targetAsUtc - localAsUtc;
  }
  return new Date(instant).toISOString();
}
function percentage(value: number | null) { return value === null ? "new" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`; }
function signed(value: number, money: (n: number) => string) { return `${value >= 0 ? "+" : ""}${money(value)}`; }
function overdueTotal(side: AgingSide) { return side.overdue1To30DaysMinor + side.overdue31To60DaysMinor + side.overdue61To90DaysMinor + side.overdueOver90DaysMinor; }

export function FinancialReports({ businessId, branchId, currencyCode, role, businessTimezone, branchTimezone }: { businessId: string; branchId: string; currencyCode: string; role: string; businessTimezone: string; branchTimezone: string }) {
  const [fromDate, setFromDate] = useState(() => dateInZone(branchTimezone, -29));
  const [toDate, setToDate] = useState(() => dateInZone(branchTimezone, 0));
  const [allBranches, setAllBranches] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [aging, setAging] = useState<CreditAging | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const canRead = allowedRoles.includes(role);
  const cacheKey = useMemo(() => `tradeos.report.v2:${businessId}:${allBranches ? "all" : branchId}:${fromDate}:${toDate}`, [businessId, branchId, allBranches, fromDate, toDate]);
  const money = (minor: number) => `${currencyCode === "GHS" ? "₵" : currencyCode} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const healthValue = (value: number, unit: string) => {
    if (unit === "MINOR") return money(value);
    if (unit === "PERCENT") return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
    if (unit === "MONTHS") return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} months`;
    if (unit === "RATIO") return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`;
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  useEffect(() => {
    if (!canRead) return;
    let alive = true;
    setMessage("");
    setAging(null);
    let cachedReport: Report | null = null;
    try { const cached = localStorage.getItem(cacheKey); if (cached) cachedReport = JSON.parse(cached) as Report; } catch { /* optional cache */ }
    setReport(cachedReport);
    const load = async () => {
      if (!navigator.onLine) { setBusy(false); setMessage(cachedReport ? "Offline: showing the saved report for this exact period and scope." : "Offline: no saved report exists for this period and scope yet."); return; }
      if (fromDate > toDate) { setMessage("Start date must not be after end date."); return; }
      setBusy(true);
      try {
        const reportTimezone = allBranches ? businessTimezone : branchTimezone;
        const query = new URLSearchParams({ businessId, from: zonedMidnightIso(fromDate, reportTimezone), to: zonedMidnightIso(addLocalDays(toDate, 1), reportTimezone) });
        if (!allBranches) query.set("branchId", branchId);
        const agingQuery = new URLSearchParams({ businessId });
        if (!allBranches) agingQuery.set("branchId", branchId);
        const [next,nextAging] = await Promise.all([
          clientApi<Report>(`/api/tradeos/v1/reports/financial-summary?${query}`),
          clientApi<CreditAging>(`/api/tradeos/v1/reports/credit-aging?${agingQuery}`),
        ]);
        if (!alive) return;
        setReport(next);
        setAging(nextAging);
        setMessage("");
        try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* optional cache */ }
      } catch (error) { if (alive) setMessage(messageFrom(error)); }
      finally { if (alive) setBusy(false); }
    };
    void load();
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ businessId: string; branchId?: string; mutationType: string }>).detail;
      if (event.type === "online" || (detail?.businessId === businessId && (allBranches || detail.branchId === branchId) && moneyMutations.has(detail.mutationType))) void load();
    };
    window.addEventListener("online", refresh);
    window.addEventListener(mutationAppliedEvent, refresh);
    return () => { alive = false; window.removeEventListener("online", refresh); window.removeEventListener(mutationAppliedEvent, refresh); };
  }, [businessId, branchId, fromDate, toDate, allBranches, canRead, cacheKey, businessTimezone, branchTimezone]);

  if (!canRead) return null;
  const f = report?.flow;
  const p = report?.position;
  return (
    <section className="panel" id="reports">
      <div className="panel-heading"><div><p className="eyebrow">Owner intelligence</p><h2>Financial performance</h2></div><span>{busy ? "Refreshing…" : allBranches ? "All branches" : "Current branch"}</span></div>
      <div className="form-row triple">
        <label>From<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
        <label>To<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
        <label>Scope<select value={allBranches ? "all" : "branch"} onChange={(e) => setAllBranches(e.target.value === "all")}><option value="branch">Current branch</option><option value="all">All branches</option></select></label>
      </div>
      {message ? <p role="status">{message}</p> : null}
      {!report || !f || !p ? <p>{busy ? "Calculating financial performance…" : "No saved report is available yet."}</p> : <>
        <div className="ai-panel">
          <div className="panel-heading compact"><div><p className="eyebrow">TradeOS CFO · explainable health</p><h3>Business health</h3></div><span className="workflow-badge">{report.health.score === null ? "—" : `${report.health.score}/100`} · {report.health.status.replaceAll("_", " ")}</span></div>
          <p>{report.health.headline} <small>Signal confidence: {report.health.confidence.toLowerCase()} · {report.health.algorithmVersion} · this is an operating-health score, not a lending/credit score.</small></p>
          <div className="metrics-grid">{report.health.dimensions.map((dimension) => <article className="metric-card" key={dimension.key}><span>{dimension.label}</span><strong>{dimension.applicable && dimension.score !== null ? `${dimension.score}/100` : "N/A"}</strong><small>{dimension.summary}</small></article>)}</div>

          <div className="working-capital-panel">
            <div className="panel-heading compact"><div><p className="eyebrow">Cash conversion</p><h3>Working capital cockpit</h3></div><span className="workflow-badge">{report.health.workingCapital.status.replaceAll("_", " ")}</span></div>
            <p>{report.health.workingCapital.headline}</p>
            <div className="working-capital-grid">
              <article><span>Cash less supplier payables</span><strong>{money(report.health.workingCapital.cashAfterPayablesMinor)}</strong><small>Current cash minus recorded supplier balances; not a due-date forecast.</small></article>
              <article><span>Net trade credit</span><strong>{money(report.health.workingCapital.netTradeCreditMinor)}</strong><small>Customer receivables minus supplier payables.</small></article>
              <article><span>Operating working capital</span><strong>{report.health.workingCapital.operatingWorkingCapitalMinor === null ? "N/A" : money(report.health.workingCapital.operatingWorkingCapitalMinor)}</strong><small>{report.health.workingCapital.inventorySnapshotAligned ? "Receivables + inventory at cost − payables." : "Not shown because the current inventory snapshot does not align with this historical period."}</small></article>
              <article><span>Cash / payables</span><strong>{report.health.workingCapital.payableCoverageRatio === null ? "N/A" : `${report.health.workingCapital.payableCoverageRatio.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`}</strong><small>{report.health.workingCapital.receivableMonths === null ? "Receivable run-rate unavailable" : `${report.health.workingCapital.receivableMonths.toLocaleString(undefined, { maximumFractionDigits: 2 })} months of revenue in receivables`} · {report.health.workingCapital.inventoryMonths === null ? "inventory run-rate unavailable" : `${report.health.workingCapital.inventoryMonths.toLocaleString(undefined, { maximumFractionDigits: 2 })} months of COGS in inventory`}.</small></article>
            </div>
            {aging ? <div className="working-capital-grid credit-aging-grid">
              <article><span>Receivables overdue</span><strong>{money(overdueTotal(aging.receivables))}</strong><small>{aging.receivables.obligationCount} open obligation{aging.receivables.obligationCount === 1 ? "" : "s"} · {money(aging.receivables.dueWithin30DaysMinor)} due in the next 30 days.</small></article>
              <article><span>Supplier payables overdue</span><strong>{money(overdueTotal(aging.payables))}</strong><small>{aging.payables.obligationCount} open obligation{aging.payables.obligationCount === 1 ? "" : "s"} · {money(aging.payables.dueWithin30DaysMinor)} due in the next 30 days.</small></article>
              <article><span>Receivables 31–90+ days late</span><strong>{money(aging.receivables.overdue31To60DaysMinor + aging.receivables.overdue61To90DaysMinor + aging.receivables.overdueOver90DaysMinor)}</strong><small>1–30 days late: {money(aging.receivables.overdue1To30DaysMinor)}.</small></article>
              <article><span>Payables 31–90+ days late</span><strong>{money(aging.payables.overdue31To60DaysMinor + aging.payables.overdue61To90DaysMinor + aging.payables.overdueOver90DaysMinor)}</strong><small>1–30 days late: {money(aging.payables.overdue1To30DaysMinor)}.</small></article>
            </div> : null}
            <small className="working-capital-note">Credit aging is a current snapshot built from fixed due dates on each pay-later sale and supplier-credit purchase. Legacy obligations that predate terms tracking are conservatively treated as due on their original transaction date. This schedule is now suitable as the timing foundation for the next cash-forecast layer.</small>
          </div>

          <div className="cfo-action-center">
            <div className="panel-heading compact"><div><p className="eyebrow">Prioritized next moves</p><h3>CFO Action Center</h3></div><span>{report.health.actions.length} action{report.health.actions.length === 1 ? "" : "s"}</span></div>
            {report.health.actions.length === 0 ? <p>No action is generated until TradeOS has enough operating evidence.</p> : <div className="cfo-action-list">{report.health.actions.map((item) => <article className="cfo-action" key={item.code}>
              <div className="cfo-action-head"><div><span className={`cfo-priority ${item.priority.toLowerCase()}`}>{item.priority}</span><span>{item.area.replaceAll("_", " ")}</span></div><a className="ghost-button" href={item.href}>{item.navigationLabel}</a></div>
              <strong>{item.title}</strong><p>{item.reason}</p>{item.evidence.length ? <p><b>Evidence:</b> {item.evidence.map((row) => `${row.label}: ${healthValue(row.value, row.unit)}`).join(" · ")}</p> : null}<p><b>Do:</b> {item.action}</p>
            </article>)}</div>}
          </div>

          <div>{report.health.insights.map((item) => <div className={`insight ${item.severity === "CRITICAL" || item.severity === "WARNING" ? "important" : ""}`} key={item.code}><strong>{item.severity.replaceAll("_", " ")} · {item.title}</strong><p>{item.message}</p>{item.evidence.length ? <p><b>Evidence:</b> {item.evidence.map((row) => `${row.label}: ${healthValue(row.value, row.unit)}`).join(" · ")}</p> : null}<p><b>Next:</b> {item.action}</p></div>)}</div>
        </div>

        <div className="metrics-grid">
          <article className="metric-card"><span>Net revenue</span><strong>{money(f.netRevenueMinor)}</strong><small>{percentage(report.comparison.netRevenueChangePercent)} vs previous period</small></article>
          <article className="metric-card"><span>Gross profit</span><strong>{money(f.grossProfitMinor)}</strong><small>{percentage(report.comparison.grossProfitChangePercent)} vs previous period</small></article>
          <article className="metric-card"><span>Operating profit</span><strong>{money(f.operatingProfitMinor)}</strong><small>{percentage(report.comparison.operatingProfitChangePercent)} vs previous period</small></article>
          <article className="metric-card"><span>Money balance</span><strong>{money(p.cashBalanceMinor)}</strong><small>{signed(p.cashBalanceMinor - report.previousPosition.cashBalanceMinor, money)} since prior period end</small></article>
          <article className="metric-card"><span>Receivables</span><strong>{money(p.receivablesMinor)}</strong><small>Customer credit owed to the business</small></article>
          <article className="metric-card"><span>Payables</span><strong>{money(p.payablesMinor)}</strong><small>Supplier obligations outstanding</small></article>
          <article className="metric-card"><span>Inventory value</span><strong>{money(p.inventoryValueMinor)}</strong><small>Current valuation snapshot · not historical</small></article>
          <article className="metric-card"><span>Sales</span><strong>{f.salesCount}</strong><small>Average net sale {money(f.averageNetSaleMinor)}</small></article>
        </div>

        <div className="form-row">
          <div><h3>Profit bridge</h3><p>Gross revenue {money(f.grossRevenueMinor)} − returns {money(f.returnsRevenueMinor)} = <strong>{money(f.netRevenueMinor)}</strong></p><p>Net COGS {money(f.netCogsMinor)} · gross profit <strong>{money(f.grossProfitMinor)}</strong> · expenses {money(f.expenseMinor)} · purchase-return variance {signed(f.purchaseReturnVarianceMinor, money)} · operating profit <strong>{money(f.operatingProfitMinor)}</strong></p><p><small>Discarded/unusable customer-return cost retained in COGS: {money(f.discardedReturnCostMinor)}.</small></p></div>
          <div><h3>Money movement</h3><p>In {money(f.cashInflowMinor)} · Out {money(f.cashOutflowMinor)} · Net <strong>{money(f.netCashMovementMinor)}</strong></p><p>Operating cash net {money(f.operatingCashNetMinor)} · refunds {money(f.refundTotalMinor)} · tax net {money(f.netTaxMinor)}</p></div>
        </div>
        <div className="form-row">
          <div><h3>Credit position</h3><p>Receivables {money(p.receivablesMinor)} · customer prepaid/credit {money(p.customerCreditBalanceMinor)}</p><p>Payables {money(p.payablesMinor)} · supplier credit due back {money(p.supplierCreditBalanceMinor)}</p></div>
          <div><h3>Inventory valuation</h3><p>Available {money(p.inventoryAvailableValueMinor)} · quarantine {money(p.inventoryQuarantineValueMinor)} · other {money(p.inventoryOtherValueMinor)}</p><p><small>Snapshot generated {new Date(p.inventorySnapshotAt).toLocaleString()}.</small></p></div>
        </div>

        <h3>Daily performance</h3>
        <table><thead><tr><th>Date</th><th>Net revenue</th><th>Gross profit</th><th>Expenses</th><th>Purchase variance</th><th>Operating profit</th><th>Money net</th><th>Sales</th></tr></thead><tbody>{report.daily.slice(-31).map((d) => <tr key={d.date}><td>{d.date}</td><td>{money(d.netRevenueMinor)}</td><td>{money(d.grossProfitMinor)}</td><td>{money(d.expenseMinor)}</td><td>{signed(d.purchaseReturnVarianceMinor, money)}</td><td>{money(d.operatingProfitMinor)}</td><td>{money(d.cashNetMinor)}</td><td>{d.salesCount}</td></tr>)}</tbody></table>

        <h3>Top items by net revenue</h3>
        <table><thead><tr><th>Item</th><th>Sold</th><th>Returned</th><th>Net revenue</th><th>COGS</th><th>Gross profit</th></tr></thead><tbody>{report.topItems.map((item) => <tr key={`${item.itemId}:${item.unitCode}`}><td>{item.itemName}<small> · {item.itemKind}</small></td><td>{item.quantitySold} {item.unitCode}</td><td>{item.quantityReturned} {item.unitCode}</td><td>{money(item.netRevenueMinor)}</td><td>{money(item.netCogsMinor)}</td><td>{money(item.grossProfitMinor)}</td></tr>)}</tbody></table>

        {allBranches ? <><h3>Branch performance</h3><table><thead><tr><th>Branch</th><th>Net revenue</th><th>Gross profit</th><th>Expenses</th><th>Purchase variance</th><th>Operating profit</th><th>Money net</th><th>Receivables</th><th>Payables</th><th>Inventory now</th></tr></thead><tbody>{report.branches.map((b) => <tr key={b.branchId}><td>{b.branchName}</td><td>{money(b.netRevenueMinor)}</td><td>{money(b.grossProfitMinor)}</td><td>{money(b.expenseMinor)}</td><td>{signed(b.purchaseReturnVarianceMinor, money)}</td><td>{money(b.operatingProfitMinor)}</td><td>{money(b.cashNetMinor)}</td><td>{money(b.receivablesMinor)}</td><td>{money(b.payablesMinor)}</td><td>{money(b.inventoryValueMinor)}</td></tr>)}</tbody></table></> : null}
      </>}
    </section>
  );
}
