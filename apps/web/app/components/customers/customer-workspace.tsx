"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { ContextualIntelligencePanel } from "../intelligence/contextual-intelligence-panel";
import { CustomerSheet, CustomerFormSheet } from "./customer-sheet";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import {
  IconCustomers,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrending,
  IconUser,
  IconWallet,
} from "../ui/icons";
import type { Customer } from "../workspace/workspace-provider";

type ActiveFilter = "ALL" | "ACTIVE" | "INACTIVE";

const ACTIVE_FILTERS: ReadonlyArray<{ value: ActiveFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

type BalanceFilter = "ALL" | "OWES" | "CLEAR";

const BALANCE_FILTERS: ReadonlyArray<{ value: BalanceFilter; label: string }> = [
  { value: "ALL", label: "All balances" },
  { value: "OWES", label: "Owes" },
  { value: "CLEAR", label: "Clear" },
];

type StatIconTone = "gold" | "positive" | "warning" | "midnight" | "neutral";

const STAT_TILE_CLASS: Record<StatIconTone, string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

export function CustomerWorkspace() {
  const { customers, role, refreshCustomers, session } = useWorkspace();
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("ALL");
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("ALL");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const currency = session?.currencyCode ?? "GHS";
  const canWrite = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT", "SALES", "STAFF"].includes(role);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (activeFilter === "ACTIVE" && !c.active) return false;
      if (activeFilter === "INACTIVE" && c.active) return false;
      if (balanceFilter === "OWES" && c.balanceMinor <= 0) return false;
      if (balanceFilter === "CLEAR" && c.balanceMinor > 0) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [customers, query, activeFilter, balanceFilter]);

  const stats = useMemo(() => {
    const total = customers.length;
    const active = customers.filter((c) => c.active).length;
    const owesCount = customers.filter((c) => c.balanceMinor > 0).length;
    const totalOwed = customers.reduce((sum, c) => sum + (c.balanceMinor > 0 ? c.balanceMinor : 0), 0);
    return { total, active, owesCount, totalOwed };
  }, [customers]);

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Master data</span>
          <h1 className="tos-page__title">Customers</h1>
          <p className="tos-page__subtitle">Track walk-in and credit customers. Outstanding balances update automatically from credit sales and payments.</p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => void refreshCustomers()}>Refresh</Button>
          {canWrite ? (
            <Button variant="gold" icon={<IconPlus className="tos-btn__icon" />} onClick={() => setFormOpen(true)}>Add customer</Button>
          ) : null}
        </div>
      </header>

      <ContextualIntelligencePanel surface="customers" />

      {/* KPI strip — 4-up desktop / 2x2 mobile. Mirrors dashboard + sales. */}
      <div className="tos-dashboard-stats tos-stagger">
        <StatCard
          label="Total owed"
          icon={<IconWallet className="tos-stat__icon-tile-svg" />}
          iconTone="gold"
          variant="hero"
          value={<MoneyValue minor={stats.totalOwed} currencyCode={currency} className="tos-stat__value--hero" />}
          hint={`${stats.owesCount} customer(s) with balance`}
        />
        <StatCard
          label="Customers"
          icon={<IconCustomers className="tos-stat__icon-tile-svg" />}
          iconTone="midnight"
          value={<span className="tos-stat__value">{stats.total}</span>}
          hint={`${stats.active} active`}
        />
        <StatCard
          label="Owes balance"
          icon={<IconTrending className="tos-stat__icon-tile-svg" />}
          iconTone={stats.owesCount > 0 ? "warning" : "positive"}
          value={<span className="tos-stat__value">{stats.owesCount}</span>}
          hint={stats.owesCount > 0 ? "Receivable" : "All settled"}
          hintTone={stats.owesCount > 0 ? "warning" : "positive"}
        />
        <StatCard
          label="Inactive"
          icon={<IconUser className="tos-stat__icon-tile-svg" />}
          iconTone={stats.total - stats.active > 0 ? "neutral" : "positive"}
          value={<span className="tos-stat__value">{stats.total - stats.active}</span>}
          hint={stats.total - stats.active > 0 ? "Hidden from POS" : "All active"}
          hintTone={stats.total - stats.active > 0 ? "default" : "positive"}
        />
      </div>

      {/* Toolbar — search + filter chips */}
      <div className="tos-toolbar tos-toolbar--stacked">
        <div className="tos-toolbar__search">
          <IconSearch className="tos-toolbar__search-icon" />
          <input
            type="search"
            className="tos-toolbar__search-input"
            placeholder="Search by name, phone, or email…"
            aria-label="Search customers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="tos-filter-row">
          <span className="tos-filter-label">Status</span>
          {ACTIVE_FILTERS.map((f) => (
            <FilterChip key={f.value} pressed={activeFilter === f.value} onClick={() => setActiveFilter(f.value)}>
              {f.label}
            </FilterChip>
          ))}
          <span className="tos-filter-label" style={{ marginLeft: "var(--tos-space-2)" }}>Balance</span>
          {BALANCE_FILTERS.map((f) => (
            <FilterChip key={f.value} pressed={balanceFilter === f.value} onClick={() => setBalanceFilter(f.value)}>
              {f.label}
            </FilterChip>
          ))}
          <span className="tos-toolbar__spacer" />
          <span className="tos-section__sub">{filtered.length} customer(s)</span>
        </div>
      </div>

      {customers.length === 0 ? (
        <StatePanel
          variant="empty"
          icon={<IconCustomers className="tos-state__icon" />}
          title="No customers yet"
          text="Add your first customer to track credit terms, outstanding balances, and purchase history. Walk-in customers are created automatically at the POS."
          actionLabel={canWrite ? "Add customer" : undefined}
          onAction={canWrite ? () => setFormOpen(true) : undefined}
        />
      ) : filtered.length === 0 ? (
        <StatePanel
          inline
          variant="empty"
          icon={<IconSearch className="tos-state__icon" />}
          title="No matches"
          text="No customers match the current filters. Try clearing the search or widening the status filter."
          actionLabel="Clear filters"
          onAction={() => { setQuery(""); setActiveFilter("ALL"); setBalanceFilter("ALL"); }}
        />
      ) : (
        <>
          {/* Mobile: premium tappable cards with initial-avatar + balance */}
          <ul className="tos-list-cards tos-stagger" aria-label="Customers">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="tos-customer-card tos-card-hover tos-animate-fade-in-up"
                  onClick={() => setSelected(c)}
                  aria-label={`Open ${c.name}`}
                >
                  <span className="tos-customer-card__avatar" aria-hidden="true">
                    {initials(c.name)}
                  </span>
                  <span className="tos-customer-card__body">
                    <span className="tos-customer-card__name">{c.name}</span>
                    <span className="tos-customer-card__sub">
                      {c.phone ?? "No phone"}{c.email ? ` · ${c.email}` : ""}
                    </span>
                  </span>
                  <span className="tos-customer-card__meta">
                    <MoneyValue
                      minor={c.balanceMinor}
                      currencyCode={currency}
                      className={
                        c.balanceMinor > 0
                          ? "tos-customer-card__balance tos-customer-card__balance--owes"
                          : c.balanceMinor < 0
                            ? "tos-customer-card__balance tos-customer-card__balance--credit"
                            : "tos-customer-card__balance"
                      }
                    />
                    <span className={`tos-badge ${c.active ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                      <span className="tos-badge__dot" />{c.active ? "Active" : "Inactive"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: clean table */}
          <div className="tos-table-wrap tos-table-wrap--desktop">
            <div className="tos-table-scroll">
              <table className="tos-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th data-align="right">Credit limit</th>
                    <th data-align="right">Balance</th>
                    <th data-align="center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} data-clickable="true" onClick={() => setSelected(c)}>
                      <td>
                        <div className="tos-table__cell-main">
                          <span className="tos-table__cell-title">{c.name}</span>
                        </div>
                      </td>
                      <td className="tos-table__muted">{c.phone ?? "—"}</td>
                      <td className="tos-table__muted">{c.email ?? "—"}</td>
                      <td data-align="right" className="tos-table__muted">
                        {c.creditLimitMinor !== null ? (
                          <MoneyValue minor={c.creditLimitMinor} currencyCode={currency} tone="muted" />
                        ) : "—"}
                      </td>
                      <td data-align="right">
                        <span className="tos-table__num">
                          <MoneyValue
                            minor={c.balanceMinor}
                            currencyCode={currency}
                            tone={c.balanceMinor > 0 ? "negative" : "muted"}
                          />
                        </span>
                      </td>
                      <td data-align="center">
                        <span className={`tos-badge ${c.active ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                          <span className="tos-badge__dot" />{c.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <CustomerSheet customer={selected} onClose={() => setSelected(null)} onMutated={() => { void refreshCustomers(); setSelected(null); }} />
      <CustomerFormSheet open={formOpen} onClose={() => setFormOpen(false)} onCreated={() => { setFormOpen(false); void refreshCustomers(); }} />
    </div>
  );
}

interface StatCardProps {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  hint?: string;
  hintTone?: "default" | "warning" | "positive";
  variant?: "default" | "hero";
  iconTone?: StatIconTone;
}

function StatCard({
  label,
  icon,
  value,
  hint,
  hintTone = "default",
  variant = "default",
  iconTone = "neutral",
}: StatCardProps) {
  const cls = variant === "hero"
    ? "tos-stat tos-card-hover tos-animate-fade-in-up tos-stat--hero"
    : "tos-stat tos-card-hover tos-animate-fade-in-up";

  const hintCls = hintTone === "warning"
    ? "tos-stat__hint tos-stat__hint--warning"
    : hintTone === "positive"
      ? "tos-stat__hint tos-stat__hint--positive"
      : "tos-stat__hint";

  return (
    <div className={cls}>
      <div className="tos-stat__head">
        <span className={STAT_TILE_CLASS[iconTone]} aria-hidden="true">
          {icon}
        </span>
        <span className="tos-stat__label">{label}</span>
      </div>
      {value}
      {hint ? <span className={hintCls}>{hint}</span> : null}
    </div>
  );
}

function FilterChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="tos-filter-chip"
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}
