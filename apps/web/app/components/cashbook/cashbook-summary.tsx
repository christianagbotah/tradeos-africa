import React from "react";
import type { CashbookSummaryData, CashbookTotal } from "./types";

type Props = {
  filter: string;
  from: string;
  to: string;
  methods: readonly string[];
  queued: number;
  summary: CashbookSummaryData;
  totals: readonly CashbookTotal[];
  money: (minor: number) => string;
  onFilterChange: (value: string) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onToday: () => void;
};

export function CashbookSummary(props: Props) {
  return (
    <>
      <div className="cashbook-toolbar" aria-label="Cashbook filters">
        <label><span>Method</span><select value={props.filter} onChange={(e) => props.onFilterChange(e.target.value)}><option value="">All methods</option>{props.methods.map((method) => <option key={method}>{method}</option>)}</select></label>
        <label><span>From</span><input type="date" value={props.from} onChange={(e) => props.onFromChange(e.target.value)} /></label>
        <label><span>To</span><input type="date" value={props.to} onChange={(e) => props.onToChange(e.target.value)} /></label>
        <button className="cashbook-today-button" type="button" onClick={props.onToday}>Today</button>
      </div>

      <div className="cashbook-stat-grid" aria-label="Cashbook summary">
        <article className="cashbook-stat-card positive"><span>Inflow</span><strong>{props.money(props.summary.inflowMinor)}</strong><small>Money received in this period</small></article>
        <article className="cashbook-stat-card negative"><span>Outflow</span><strong>{props.money(props.summary.outflowMinor)}</strong><small>Money paid out in this period</small></article>
        <article className="cashbook-stat-card"><span>Net movement</span><strong>{props.money(props.summary.netMinor)}</strong><small>Inflow less outflow</small></article>
        <article className="cashbook-stat-card"><span>Pending / offline</span><strong>{props.queued}</strong><small>Entries waiting to synchronize</small></article>
      </div>

      {props.totals.length > 0 ? <div className="cashbook-method-strip" aria-label="Payment method totals">{props.totals.map((total) => (
        <article key={total.method}><span>{total.method}</span><strong>{props.money(total.balanceMinor)}</strong><small>In {props.money(total.inflowMinor)} · Out {props.money(total.outflowMinor)}</small></article>
      ))}</div> : null}
    </>
  );
}
