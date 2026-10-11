"use client";

import { useMemo, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { CustomerSheet, CustomerFormSheet } from "./customer-sheet";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconPlus, IconRefresh, IconSearch } from "../ui/icons";
import type { Customer } from "../workspace/workspace-provider";

export function CustomerWorkspace() {
  const { customers, role, refreshCustomers } = useWorkspace();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q));
  }, [customers, query]);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT", "SALES", "STAFF"].includes(role);

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Master data</span>
          <h1 className="tos-page__title">Customers</h1>
          <p className="tos-page__subtitle">Track walk-in and credit customers. Outstanding balances are server-authoritative.</p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => void refreshCustomers()}>Refresh</Button>
          {canWrite ? (
            <Button variant="gold" icon={<IconPlus className="tos-btn__icon" />} onClick={() => setFormOpen(true)}>Add customer</Button>
          ) : null}
        </div>
      </header>

      <div className="tos-toolbar">
        <div className="tos-toolbar__search">
          <IconSearch className="tos-toolbar__search-icon" />
          <input
            type="search"
            className="tos-toolbar__search-input"
            placeholder="Search by name or phone…"
            aria-label="Search customers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="tos-toolbar__spacer" />
        <span className="tos-section__sub">{filtered.length} customer(s)</span>
      </div>

      {customers.length === 0 ? (
        <StatePanel
          variant="empty"
          title="No customers yet"
          text="Add your first customer to track credit and purchase history."
          actionLabel={canWrite ? "Add customer" : undefined}
          onAction={canWrite ? () => setFormOpen(true) : undefined}
        />
      ) : filtered.length === 0 ? (
        <StatePanel inline variant="empty" title="No matches" text={`No customers match "${query}".`} />
      ) : (
        <div className="tos-table-wrap">
          <div className="tos-table-scroll">
            <table className="tos-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th data-align="right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} data-clickable="true" onClick={() => setSelected(c)}>
                    <td>
                      <div className="tos-table__cell-main">
                        <span className="tos-table__cell-title">{c.name}</span>
                        {c.email ? <span className="tos-table__cell-sub">{c.email}</span> : null}
                      </div>
                    </td>
                    <td className="tos-table__muted">{c.phone ?? "—"}</td>
                    <td>
                      <span className={`tos-badge ${c.active ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                        <span className="tos-badge__dot" />{c.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td data-align="right">
                      <span className="tos-table__num">
                        <MoneyValue minor={c.balanceMinor} currencyCode="GHS" tone={c.balanceMinor > 0 ? "negative" : "muted"} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CustomerSheet customer={selected} onClose={() => setSelected(null)} onMutated={() => { void refreshCustomers(); setSelected(null); }} />
      <CustomerFormSheet open={formOpen} onClose={() => setFormOpen(false)} onCreated={() => { setFormOpen(false); void refreshCustomers(); }} />
    </div>
  );
}
