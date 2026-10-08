"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { clientApi, messageFrom } from "../../lib/client-api";
import { Button } from "../ui/button";

export type PosCustomer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  creditLimitMinor: number | null;
  creditTermsDays: number;
  balanceMinor: number;
  availableCreditMinor: number | null;
  creditEnabled: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const CUSTOMER_WRITE_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT"]);

export function filterPosCustomers(customers: readonly PosCustomer[], query: string): PosCustomer[] {
  const normalized = query.trim().toLowerCase();
  return customers.filter((customer) => {
    if (!customer.active) return false;
    if (!normalized) return true;
    return [customer.name, customer.phone ?? "", customer.email ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(normalized);
  });
}

export function canCreateCustomerFromPos(role: string): boolean {
  return CUSTOMER_WRITE_ROLES.has(role);
}

export function customerCreditContext(customer: PosCustomer, currencyCode: string): string {
  if (!customer.creditEnabled || customer.creditLimitMinor === null) return "Customer credit is off";
  const available = customer.availableCreditMinor ?? 0;
  return `${formatMoney(available, currencyCode)} available credit · ${customer.creditTermsDays} day terms`;
}

export function CustomerPicker({
  businessId,
  currencyCode,
  selectedCustomer,
  role,
  open,
  initialCustomers = [],
  onSelect,
  onWalkIn,
  onClose,
}: {
  businessId: string;
  currencyCode: string;
  selectedCustomer: PosCustomer | null;
  role: string;
  open: boolean;
  initialCustomers?: PosCustomer[];
  onSelect: (customer: PosCustomer) => void;
  onWalkIn: () => void;
  onClose: () => void;
}) {
  const [customers, setCustomers] = useState<PosCustomer[]>(initialCustomers);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const visibleCustomers = useMemo(() => filterPosCustomers(customers, query), [customers, query]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !businessId) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      setMessage(null);
      try {
        const params = new URLSearchParams({ businessId, limit: "200" });
        if (query.trim()) params.set("query", query.trim());
        const response = await clientApi<{ customers: PosCustomer[] }>(`/api/tradeos/v1/customers?${params}`);
        if (!cancelled) setCustomers(response.customers);
      } catch (reason) {
        if (!cancelled) setMessage(`${messageFrom(reason)} Walk-in selling is still available.`);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, query.trim() ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [businessId, open, query]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const sheet = sheetRef.current;
        if (!sheet) return;
        const tabbables = Array.from(sheet.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        )).filter((element) => element.offsetParent !== null);
        if (tabbables.length === 0) return;
        const first = tabbables[0]!;
        const last = tabbables[tabbables.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="pos-customer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={sheetRef}
        className="pos-customer-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-customer-title"
      >
        <header className="pos-customer-header">
          <div>
            <span>Current sale</span>
            <h2 id="pos-customer-title">Choose customer</h2>
            <p>Attach a customer to any payment method, or keep this sale as Walk-in.</p>
          </div>
          <button className="pos-customer-close" type="button" aria-label="Close customer picker" onClick={onClose}>×</button>
        </header>

        <div className="pos-customer-search-row">
          <label>
            <span>Find customer</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, phone or email"
              aria-label="Search customers"
            />
          </label>
          {canCreateCustomerFromPos(role) ? <a className="pos-add-customer" href="/customers">Add customer</a> : null}
        </div>

        <div className="pos-customer-list" aria-busy={busy}>
          <button
            className={`pos-customer-option pos-walk-in${selectedCustomer === null ? " selected" : ""}`}
            type="button"
            onClick={() => { onWalkIn(); onClose(); }}
          >
            <span className="pos-customer-avatar" aria-hidden="true">W</span>
            <span className="pos-customer-copy">
              <strong>Walk-in customer</strong>
              <small>{selectedCustomer === null ? "Selected by default" : "No customer account attached"}</small>
            </span>
            <span className="pos-customer-check" aria-hidden="true">{selectedCustomer === null ? "✓" : ""}</span>
          </button>

          {visibleCustomers.map((customer) => (
            <button
              key={customer.id}
              className={`pos-customer-option${selectedCustomer?.id === customer.id ? " selected" : ""}`}
              type="button"
              onClick={() => { onSelect(customer); onClose(); }}
            >
              <span className="pos-customer-avatar" aria-hidden="true">{initials(customer.name)}</span>
              <span className="pos-customer-copy">
                <strong>{customer.name}</strong>
                <small>{customer.phone ?? customer.email ?? "Named customer"}</small>
                {customer.creditEnabled ? <em>{customerCreditContext(customer, currencyCode)}</em> : null}
              </span>
              <span className="pos-customer-check" aria-hidden="true">{selectedCustomer?.id === customer.id ? "✓" : ""}</span>
            </button>
          ))}

          {!busy && visibleCustomers.length === 0 ? (
            <div className="pos-customer-empty">
              <strong>No active customer found</strong>
              <span>Try another name, phone or email. Walk-in remains available.</span>
            </div>
          ) : null}
        </div>

        {message ? <div className="pos-customer-message" role="status">{message}</div> : null}
        <footer className="pos-customer-footer">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        </footer>
      </div>
    </div>
  );
}

function formatMoney(minor: number, currencyCode: string): string {
  if (currencyCode === "GHS") return `₵${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100);
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "C";
}
