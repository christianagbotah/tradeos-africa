/**
 * Customers — customer master-data list.
 *
 * Search + status filter, customer table (name, phone, balance, status, LTV),
 * empty state. Balances are derived from the customer credit ledger — never
 * edited directly.
 *
 * State handling:
 *   - DEMO MODE: renders sample customers with a DemoBanner.
 *   - SIGNED OUT: renders an AccessState.
 *   - READY: loads customers from the API; on failure renders an AccessState.
 */
import { useEffect, useMemo, useState } from "react";
import type { DesktopCustomerRow, ScreenId } from "../lib/types.js";
import { SAMPLE_CUSTOMERS } from "../lib/sample-data.js";
import type { DesktopCustomerListResponse } from "../lib/desktop-api-client.js";
import type { DesktopRuntime, DesktopReadyState } from "../lib/desktop-runtime.js";
import { fmtMoneyMinor, fmtDate } from "../lib/format.js";
import { EmptyState } from "../components/EmptyState.js";
import { AccessState } from "../components/AccessState.js";
import { DemoBanner } from "../components/DemoBanner.js";
import {
  IconUsers,
  IconSearch,
  IconUserPlus,
  IconBox,
} from "../components/icons.js";

type StatusFilter = "all" | "active" | "inactive";

export interface CustomersProps {
  runtime: DesktopRuntime | null;
  ready: DesktopReadyState | null;
  online: boolean;
  demoMode: boolean;
  onSignIn: () => void;
  onNavigate: (id: ScreenId) => void;
}

export function Customers({ runtime, ready, online, demoMode, onSignIn }: CustomersProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [rows, setRows] = useState<readonly DesktopCustomerRow[]>(demoMode ? SAMPLE_CUSTOMERS : []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (demoMode || !runtime || !ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    runtime.api.getCustomers(ready.membership.businessId)
      .then((res: DesktopCustomerListResponse) => {
        if (cancelled) return;
        setRows(res.items);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [demoMode, runtime, ready, online]);

  const filtered = useMemo(() => {
    return rows.filter((c) => {
      const matchesQuery =
        !query ||
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        (c.phone ?? "").includes(query);
      const matchesStatus = status === "all" || (status === "active" && c.active) || (status === "inactive" && !c.active);
      return matchesQuery && matchesStatus;
    });
  }, [rows, query, status]);

  const totalBalanceMinor = rows.reduce((s, c) => s + c.balanceMinor, 0);
  const totalLtvMinor = rows.reduce((s, c) => s + c.lifetimeValueMinor, 0);

  if (demoMode) {
    return <CustomersBody demoMode rows={filtered} query={query} onQueryChange={setQuery} status={status} onStatusChange={setStatus} totalBalanceMinor={totalBalanceMinor} totalLtvMinor={totalLtvMinor} count={rows.length} activeCount={rows.filter((c) => c.active).length} owingCount={rows.filter((c) => c.balanceMinor > 0).length} />;
  }
  if (!ready || !runtime) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <AccessState kind="sign-in-required" onSignIn={onSignIn} />
      </div>
    );
  }
  if (loading && rows.length === 0) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <div className="dsk-empty" style={{ minHeight: "320px" }}>
          <div className="dsk-empty__title">Loading customers\u2026</div>
        </div>
      </div>
    );
  }
  if (error && rows.length === 0) {
    return (
      <div className="dsk-screen">
        <ScreenHeader />
        <AccessState kind="api-unavailable" detail={error} />
      </div>
    );
  }
  return <CustomersBody rows={filtered} query={query} onQueryChange={setQuery} status={status} onStatusChange={setStatus} totalBalanceMinor={totalBalanceMinor} totalLtvMinor={totalLtvMinor} count={rows.length} activeCount={rows.filter((c) => c.active).length} owingCount={rows.filter((c) => c.balanceMinor > 0).length} />;
}

function ScreenHeader() {
  return (
    <div className="dsk-screen__head">
      <div>
        <div className="dsk-screen__eyebrow">People</div>
        <h1 className="dsk-screen__title">Customers</h1>
        <p className="dsk-screen__subtitle">
          Customer balances are derived from the credit ledger. Record a payment to settle
          outstanding credit.
        </p>
      </div>
      <div className="dsk-screen__actions">
        <button type="button" className="dsk-btn dsk-btn--gold dsk-btn--sm" disabled>
          <IconUserPlus width={15} height={15} />
          Add customer
        </button>
      </div>
    </div>
  );
}

function CustomersBody({
  demoMode,
  rows,
  query,
  onQueryChange,
  status,
  onStatusChange,
  totalBalanceMinor,
  totalLtvMinor,
  count,
  activeCount,
  owingCount,
}: {
  demoMode?: boolean;
  rows: readonly DesktopCustomerRow[];
  query: string;
  onQueryChange: (v: string) => void;
  status: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
  totalBalanceMinor: number;
  totalLtvMinor: number;
  count: number;
  activeCount: number;
  owingCount: number;
}) {
  return (
    <div className="dsk-screen">
      <ScreenHeader />
      {demoMode ? <DemoBanner /> : null}

      <div className="dsk-metricgrid">
        <div className="dsk-metric">
          <div className="dsk-metric__label">Total customers</div>
          <div className="dsk-metric__val tnum">{count}</div>
          <div className="dsk-metric__sub">{activeCount} active</div>
        </div>
        <div className="dsk-metric">
          <div className="dsk-metric__label">Outstanding credit</div>
          <div className="dsk-metric__val tnum" style={{ color: "var(--tos-warning)" }}>
            {fmtMoneyMinor(totalBalanceMinor)}
          </div>
          <div className="dsk-metric__sub">{owingCount} owe balances</div>
        </div>
        <div className="dsk-metric">
          <div className="dsk-metric__label">Lifetime value</div>
          <div className="dsk-metric__val tnum">{fmtMoneyMinor(totalLtvMinor)}</div>
          <div className="dsk-metric__sub">Across all customers</div>
        </div>
      </div>

      <div className="dsk-cmdbar">
        <div className="dsk-cmdbar__search">
          <IconSearch className="dsk-cmdbar__search-icon" />
          <input
            type="search"
            className="dsk-cmdbar__search-input"
            placeholder="Search name or phone\u2026"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search customers"
          />
        </div>
        <div role="group" aria-label="Filter by status">
          {([
            { id: "all", label: "All" },
            { id: "active", label: "Active" },
            { id: "inactive", label: "Inactive" },
          ] as const).map((f) => (
            <button
              key={f.id}
              type="button"
              className="dsk-chip"
              aria-pressed={status === f.id ? "true" : "false"}
              onClick={() => onStatusChange(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="dsk-cmdbar__spacer" />
        <span className="dsk-text-muted" style={{ fontSize: 12 }}>
          {rows.length} {rows.length === 1 ? "customer" : "customers"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="dsk-card">
          <EmptyState
            icon={<IconBox width={44} height={44} />}
            title="No customers match your filters"
            text="Try a different name, phone number or status filter. New customers appear here as soon as they're created."
            tag={demoMode ? "Sample data" : undefined}
          />
        </div>
      ) : (
        <div className="dsk-table__wrap">
          <table className="dsk-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th data-num>Balance</th>
                <th data-num>Lifetime value</th>
                <th>Last seen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} data-clickable="true" tabIndex={0}>
                  <td>
                    <div className="dsk-table__cell-main">{c.name}</div>
                    <div className="dsk-table__cell-sub">{c.id}</div>
                  </td>
                  <td className="dsk-table__cell-mono">{c.phone ?? "—"}</td>
                  <td data-num>
                    <span className={c.balanceMinor > 0 ? "dsk-text-neg tnum" : "dsk-text-muted tnum"}>
                      {fmtMoneyMinor(c.balanceMinor)}
                    </span>
                  </td>
                  <td data-num className="tnum dsk-text-strong">{fmtMoneyMinor(c.lifetimeValueMinor)}</td>
                  <td className="dsk-text-muted">{c.lastSeen ? fmtDate(c.lastSeen) : "—"}</td>
                  <td>
                    <span
                      className={
                        c.active
                          ? "dsk-badge dsk-badge--positive"
                          : "dsk-badge dsk-badge--neutral"
                      }
                    >
                      {c.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
