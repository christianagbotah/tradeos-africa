import React from "react";
import { Button } from "../ui/button";
import { CommandBar } from "../ui/command-bar";
import { StatCard } from "../ui/stat-card";
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
      <div className="cashbook-toolbar">
        <CommandBar ariaLabel="Cashbook filters" primaryAction={<Button variant="secondary" type="button" onClick={props.onToday}>Today</Button>}>
          <label><span>Method</span><select value={props.filter} onChange={(e) => props.onFilterChange(e.target.value)}><option value="">All methods</option>{props.methods.map((method) => <option key={method}>{method}</option>)}</select></label>
          <label><span>From</span><input type="date" value={props.from} onChange={(e) => props.onFromChange(e.target.value)} /></label>
          <label><span>To</span><input type="date" value={props.to} onChange={(e) => props.onToChange(e.target.value)} /></label>
        </CommandBar>
      </div>

      <div className="cashbook-stat-grid" aria-label="Cashbook summary">
        <StatCard tone="positive" label="Inflow" value={props.money(props.summary.inflowMinor)} hint="Money received in this period" />
        <StatCard tone="danger" label="Outflow" value={props.money(props.summary.outflowMinor)} hint="Money paid out in this period" />
        <StatCard label="Net movement" value={props.money(props.summary.netMinor)} hint="Inflow less outflow" />
        <StatCard tone={props.queued > 0 ? "warning" : "default"} label="Pending / offline" value={props.queued} hint="Entries waiting to synchronize" />
      </div>

      {props.totals.length > 0 ? <div className="cashbook-method-strip" aria-label="Payment method totals">{props.totals.map((total) => (
        <article key={total.method}><span>{total.method}</span><strong>{props.money(total.balanceMinor)}</strong><small>In {props.money(total.inflowMinor)} · Out {props.money(total.outflowMinor)}</small></article>
      ))}</div> : null}
    </>
  );
}
