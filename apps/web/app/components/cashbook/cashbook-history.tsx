import React from "react";
import type { CashbookEntry, CashbookExpense } from "./types";

type Props = { entries: CashbookEntry[]; expenses: CashbookExpense[]; money: (minor: number) => string };

export function CashbookHistory({ entries, expenses, money }: Props) {
  return (
    <div className="cashbook-history-grid">
      <section className="cashbook-card cashbook-data-card">
        <div className="cashbook-section-heading"><div><span>Ledger activity</span><h3>Recent movements</h3></div><small>{entries.length} record{entries.length === 1 ? "" : "s"}</small></div>
        {entries.length === 0 ? <div className="cashbook-empty-state"><strong>No money movements yet</strong><span>Sales, expenses, supplier payments and other cash movements will appear here.</span></div> : <div className="cashbook-table-scroll"><table><thead><tr><th>Date</th><th>Movement</th><th>Method</th><th className="amount-cell">Amount</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{new Date(entry.occurredAt).toLocaleString()}</td><td>{entry.entryType.replaceAll("_", " ")}</td><td>{entry.method}</td><td className="amount-cell">{money(entry.amountDeltaMinor)}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="cashbook-card cashbook-data-card">
        <div className="cashbook-section-heading"><div><span>Operating costs</span><h3>Recent expenses</h3></div><small>{expenses.length} record{expenses.length === 1 ? "" : "s"}</small></div>
        {expenses.length === 0 ? <div className="cashbook-empty-state"><strong>No expenses yet</strong><span>Recorded expenses will appear here with category, payee and payment method.</span></div> : <div className="cashbook-table-scroll"><table><thead><tr><th>Category</th><th>Description / payee</th><th>Method</th><th className="amount-cell">Amount</th></tr></thead><tbody>{expenses.map((expense) => <tr key={expense.id}><td>{expense.categoryName}</td><td>{expense.description || expense.payee || "—"}</td><td>{expense.method}</td><td className="amount-cell">{money(expense.amountMinor)}</td></tr>)}</tbody></table></div>}
      </section>
    </div>
  );
}
