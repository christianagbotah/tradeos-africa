"use client";

import React, { useEffect, useMemo, useState } from "react";
import { clientApi, messageFrom } from "../../lib/client-api";
import { customersChangedEvent, notifyCustomersChanged } from "../../lib/customer-events";
import { getFailedMutations, mutationAppliedEvent, queueChangedEvent, type AppliedMutationDetail } from "../../lib/offline-sync";
import { Button } from "../ui/button";
import { CommandBar } from "../ui/command-bar";
import { MobileRecordCard } from "../ui/mobile-record-card";
import { StatusBadge } from "../ui/status-badge";
import { CustomerSheet, type CustomerSheetMode } from "./customer-sheet";
import { formatCustomerMoney, type Customer, type CustomerDetail } from "./customer-types";

export type CustomerFilter = "ALL" | "ACTIVE" | "ARCHIVED";

type EditorState = { mode: CustomerSheetMode; detail: CustomerDetail | null } | null;

type Props = {
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
};

const customerWriteRoles = new Set(["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT"]);
const customerReadRoles = new Set(["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER"]);

export function filterCustomers(items: Customer[], query: string, filter: CustomerFilter): Customer[] {
  const normalized = query.trim().toLowerCase();
  return items.filter((customer) => {
    if (filter === "ACTIVE" && !customer.active) return false;
    if (filter === "ARCHIVED" && customer.active) return false;
    if (!normalized) return true;
    return [customer.name, customer.phone ?? "", customer.email ?? ""].join(" ").toLowerCase().includes(normalized);
  });
}

export function CustomerWorkspace({ businessId, branchId, currencyCode, role }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("ACTIVE");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [syncFailure, setSyncFailure] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const canCreate = customerWriteRoles.has(role);
  const canRead = customerReadRoles.has(role);

  const loadCustomers = async (search = "") => {
    if (!canRead) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ businessId, limit: "100" });
      if (search.trim()) params.set("query", search.trim());
      const body = await clientApi<{ customers: Customer[] }>(`/api/tradeos/v1/customers?${params}`);
      setCustomers(body.customers);
      setMessage(null);
    } catch (reason) {
      setMessage(messageFrom(reason));
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (customerId: string): Promise<CustomerDetail | null> => {
    try {
      return await clientApi<CustomerDetail>(`/api/tradeos/v1/customers/${customerId}?businessId=${encodeURIComponent(businessId)}&limit=100`);
    } catch (reason) {
      setMessage(messageFrom(reason));
      return null;
    }
  };

  const openCustomer = async (customer: Customer) => {
    const detail = await loadDetail(customer.id);
    if (!detail) return;
    setEditor({ mode: customerWriteRoles.has(role) ? "edit" : "view", detail });
  };

  const refreshAfterSave = async () => {
    notifyCustomersChanged();
    await loadCustomers(query);
  };

  useEffect(() => {
    setEditor(null);
    setQuery("");
    setFilter("ACTIVE");
    void loadCustomers("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  useEffect(() => {
    const onChanged = () => void loadCustomers(query);
    const refreshFailures = () => {
      const latest = getFailedMutations().filter((entry) => entry.mutation.businessId === businessId && ["CUSTOMER_CREATE", "CUSTOMER_UPDATE"].includes(entry.mutation.mutationType)).at(-1);
      if (!latest) { setSyncFailure(null); return; }
      setSyncFailure(latest.result.errorCode === "STALE_VERSION"
        ? "A customer edit could not sync because this customer changed on another device. Refresh the customer and review the latest details before retrying."
        : `Customer sync needs review: ${latest.result.errorMessage ?? latest.result.errorCode ?? "change rejected"}`);
    };
    const onApplied = (event: Event) => {
      const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
      if (!detail || detail.businessId !== businessId) return;
      if (!["SALE_CREATE", "RETURN_CREATE", "REFUND_CREATE", "CUSTOMER_PAYMENT_CREATE", "CUSTOMER_CREATE", "CUSTOMER_UPDATE"].includes(detail.mutationType)) return;
      refreshFailures();
      void loadCustomers(query);
    };
    refreshFailures();
    window.addEventListener(customersChangedEvent, onChanged);
    window.addEventListener(mutationAppliedEvent, onApplied);
    window.addEventListener(queueChangedEvent, refreshFailures);
    return () => {
      window.removeEventListener(customersChangedEvent, onChanged);
      window.removeEventListener(mutationAppliedEvent, onApplied);
      window.removeEventListener(queueChangedEvent, refreshFailures);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, query]);

  const visibleCustomers = useMemo(() => filterCustomers(customers, query, filter), [customers, filter, query]);
  const counts = useMemo(() => ({
    ALL: customers.length,
    ACTIVE: customers.filter((customer) => customer.active).length,
    ARCHIVED: customers.filter((customer) => !customer.active).length,
  }), [customers]);
  const totalReceivableMinor = useMemo(() => customers.reduce((sum, customer) => sum + Math.max(0, customer.balanceMinor), 0), [customers]);
  const accountsWithDebt = useMemo(() => customers.filter((customer) => customer.balanceMinor > 0).length, [customers]);

  return (
    <section className="customer-workspace" data-business-id={businessId} data-branch-id={branchId}>
      <div className="customer-overview">
        <div><span>Customer receivables</span><strong>{formatCustomerMoney(totalReceivableMinor, currencyCode)}</strong><small>{accountsWithDebt} account{accountsWithDebt === 1 ? "" : "s"} with money due</small></div>
        <div><span>Active customers</span><strong>{counts.ACTIVE}</strong><small>{counts.ARCHIVED} inactive</small></div>
      </div>

      <form className="customer-commandbar" onSubmit={(event) => { event.preventDefault(); void loadCustomers(query); }}>
        <CommandBar ariaLabel="Customer filters">
        <label className="customer-search">
          <span>Search customers</span>
          <input type="search" aria-label="Search customers" placeholder="Name, phone or email" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <Button variant="secondary" type="submit" disabled={loading}>{loading ? "Searching…" : "Search"}</Button>
        {canCreate ? <Button type="button" onClick={() => setEditor({ mode: "create", detail: null })}>Add customer</Button> : null}
        </CommandBar>
      </form>

      <div className="customer-filterbar" role="tablist" aria-label="Customer filters">
        {([ ["ACTIVE", "Active"], ["ARCHIVED", "Inactive"], ["ALL", "All"] ] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : undefined} onClick={() => setFilter(value)}>
            <span>{label}</span><strong>{counts[value]}</strong>
          </button>
        ))}
      </div>

      <div className="customer-list-shell" aria-busy={loading}>
        <div className="customer-list-header" aria-hidden="true"><span>Customer</span><span>Account</span><span>Credit</span><span>Status</span></div>
        {loading && customers.length === 0 ? <div className="customer-empty">Loading customers…</div> : null}
        {!loading && visibleCustomers.length === 0 ? <div className="customer-empty"><strong>No customers in this view.</strong><span>{query ? "Try another search or filter." : "Add a customer when you need named sales, history or credit."}</span></div> : null}
        <div className="customer-management-list">
          {visibleCustomers.map((customer) => (
            <React.Fragment key={customer.id}>
            <button type="button" className={customer.active ? "customer-management-row customer-management-row--desktop" : "customer-management-row customer-management-row--desktop archived"} onClick={() => void openCustomer(customer)}>
              <div className="customer-identity"><span className="customer-avatar" aria-hidden="true">{customer.name.slice(0, 1).toUpperCase()}</span><div><strong>{customer.name}</strong><span>{customer.phone ?? customer.email ?? "No contact recorded"}</span></div></div>
              <div className="customer-fact"><span>Balance owed</span><strong className={customer.balanceMinor > 0 ? "debit" : customer.balanceMinor < 0 ? "credit" : undefined}>{customer.balanceMinor < 0 ? `Credit ${formatCustomerMoney(-customer.balanceMinor, currencyCode)}` : formatCustomerMoney(customer.balanceMinor, currencyCode)}</strong></div>
              <div className="customer-fact"><span>Credit</span><strong>{customer.creditLimitMinor === null ? "Pay later off" : `Limit ${formatCustomerMoney(customer.creditLimitMinor, currencyCode)}`}</strong></div>
              <div className="customer-row-status"><span className={customer.active ? "customer-status active" : "customer-status"}>{customer.active ? "Active" : "Inactive"}</span><small>Open details</small></div>
            </button>
            {/* Mobile record-card representation */}
            <div className="customer-management-row--mobile">
              <MobileRecordCard
                title={<span>{customer.name}</span>}
                meta={<span>{customer.phone ?? customer.email ?? "No contact recorded"} · Balance {formatCustomerMoney(customer.balanceMinor, currencyCode)}</span>}
                status={<StatusBadge tone={customer.active ? "positive" : "neutral"}>{customer.active ? "Active" : "Inactive"}</StatusBadge>}
              >
                <p>{customer.creditLimitMinor === null ? "Pay later off" : `Credit limit ${formatCustomerMoney(customer.creditLimitMinor, currencyCode)}`}</p>
              </MobileRecordCard>
            </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      {message ? <div className="customer-workspace-message" role="status">{message}</div> : null}
      {syncFailure ? <div className="customer-workspace-message" role="alert">{syncFailure}</div> : null}
      <button type="button" className="customer-refresh-link" onClick={() => void loadCustomers(query)}>Refresh customers</button>

      {editor ? <CustomerSheet mode={editor.mode} detail={editor.detail} open businessId={businessId} branchId={branchId} currencyCode={currencyCode} role={role} onClose={() => setEditor(null)} onSaved={refreshAfterSave} /> : null}
    </section>
  );
}
