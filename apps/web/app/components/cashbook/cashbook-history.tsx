import React from "react";
import { MobileRecordCard } from "../ui/mobile-record-card";
import { StatePanel } from "../ui/state-panel";
import { StatusBadge } from "../ui/status-badge";
import type { CashbookEntry, CashbookExpense } from "./types";

type Props = { entries: CashbookEntry[]; expenses: CashbookExpense[]; money: (minor: number) => string };

export function CashbookHistory({ entries, expenses, money }: Props) {
  return (
    <div className="cashbook-history-grid">
      <section className="cashbook-card cashbook-data-card">
        <div className="cashbook-section-heading"><div><span>Ledger activity</span><h3>Recent movements</h3></div><small>{entries.length} record{entries.length === 1 ? "" : "s"}</small></div>
        {entries.length === 0 ? <StatePanel state="empty" title="No money movements yet" description="Sales, expenses, supplier payments and other cash movements will appear here." /> : <>
          <div className="cashbook-table-scroll cashbook-history--desktop"><table><thead><tr><th>Date</th><th>Movement</th><th>Method</th><th className="amount-cell">Amount</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{new Date(entry.occurredAt).toLocaleString()}</td><td>{humanize(entry.entryType)}</td><td>{entry.method}</td><td className="amount-cell">{money(entry.amountDeltaMinor)}</td></tr>)}</tbody></table></div>
          <div className="cashbook-history--mobile">{entries.map((entry) => <MobileRecordCard key={entry.id} title={humanize(entry.entryType)} meta={new Date(entry.occurredAt).toLocaleString()} status={<StatusBadge tone={entry.amountDeltaMinor >= 0 ? "positive" : "warning"}>{entry.method}</StatusBadge>}><p><strong>{money(entry.amountDeltaMinor)}</strong></p></MobileRecordCard>)}</div>
        </>}
      </section>

      <section className="cashbook-card cashbook-data-card">
        <div className="cashbook-section-heading"><div><span>Operating costs</span><h3>Recent expenses</h3></div><small>{expenses.length} record{expenses.length === 1 ? "" : "s"}</small></div>
        {expenses.length === 0 ? <StatePanel state="empty" title="No expenses yet" description="Recorded expenses will appear here with category, payee and payment method." /> : <>
          <div className="cashbook-table-scroll cashbook-history--desktop"><table><thead><tr><th>Category</th><th>Description / payee</th><th>Method</th><th className="amount-cell">Amount</th></tr></thead><tbody>{expenses.map((expense) => <tr key={expense.id}><td>{expense.categoryName}</td><td>{expense.description || expense.payee || "—"}</td><td>{expense.method}</td><td className="amount-cell">{money(expense.amountMinor)}</td></tr>)}</tbody></table></div>
          <div className="cashbook-history--mobile">{expenses.map((expense) => <MobileRecordCard key={expense.id} title={expense.categoryName} meta={expense.description || expense.payee || "No description"} status={<StatusBadge tone="warning">{expense.method}</StatusBadge>}><p><strong>{money(expense.amountMinor)}</strong></p></MobileRecordCard>)}</div>
        </>}
      </section>
    </div>
  );
}

function humanize(value: string): string { return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
