"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { clientApi, messageFrom } from "../lib/client-api";
import { customersChangedEvent, notifyCustomersChanged } from "../lib/customer-events";
import {
  enqueueMutation,
  flushPendingMutations,
  getOrCreateClientId,
  mutationAppliedEvent,
  type AppliedMutationDetail,
} from "../lib/offline-sync";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  creditLimitMinor: number | null;
  balanceMinor: number;
  availableCreditMinor: number | null;
  creditEnabled: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type LedgerEntry = {
  id: string;
  branchId: string;
  currencyCode: string;
  entryType: "CREDIT_SALE" | "PAYMENT" | "CREDIT_REFUND" | "ADJUSTMENT";
  balanceDeltaMinor: number;
  sourceType: string;
  sourceId: string;
  actorName: string | null;
  occurredAt: string;
};

type CustomerDetail = { customer: Customer; ledger: LedgerEntry[] };
type PaymentMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";

type Props = {
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
};

const creditControlRoles = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

export function CustomersCredit({ businessId, branchId, currencyCode, role }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CustomerDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canControlCredit = creditControlRoles.has(role);

  const loadCustomers = async (search = query) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ businessId, limit: "100" });
      if (search.trim()) params.set("query", search.trim());
      const body = await clientApi<{ customers: Customer[] }>(`/api/tradeos/v1/customers?${params}`);
      setCustomers(body.customers);
    } catch (error) {
      setMessage(messageFrom(error));
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (customerId: string) => {
    try {
      const detail = await clientApi<CustomerDetail>(
        `/api/tradeos/v1/customers/${customerId}?businessId=${encodeURIComponent(businessId)}&limit=100`,
      );
      setSelected(detail);
    } catch (error) {
      setMessage(messageFrom(error));
    }
  };

  useEffect(() => {
    setSelected(null);
    void loadCustomers("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  useEffect(() => {
    const onChanged = () => void loadCustomers(query);
    const onApplied = (event: Event) => {
      const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
      if (!detail || detail.businessId !== businessId) return;
      if (!["SALE_CREATE", "RETURN_CREATE", "REFUND_CREATE", "CUSTOMER_PAYMENT_CREATE"].includes(detail.mutationType)) return;
      void loadCustomers(query);
      if (selected) void loadDetail(selected.customer.id);
    };
    window.addEventListener(customersChangedEvent, onChanged);
    window.addEventListener(mutationAppliedEvent, onApplied);
    return () => {
      window.removeEventListener(customersChangedEvent, onChanged);
      window.removeEventListener(mutationAppliedEvent, onApplied);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, query, selected?.customer.id]);

  const totalReceivableMinor = useMemo(
    () => customers.reduce((sum, customer) => sum + Math.max(0, customer.balanceMinor), 0),
    [customers],
  );
  const accountsWithDebt = useMemo(() => customers.filter((customer) => customer.balanceMinor > 0).length, [customers]);

  return (
    <section className="panel customer-credit-panel" id="customers">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Receivables · customer accounts</p>
          <h2>Customers & credit</h2>
        </div>
        <div className="customer-credit-summary">
          <span>Customers owe</span>
          <strong>{formatMoney(totalReceivableMinor, currencyCode)}</strong>
          <small>{accountsWithDebt} account{accountsWithDebt === 1 ? "" : "s"} with debt</small>
        </div>
      </div>

      <CustomerCreate
        businessId={businessId}
        currencyCode={currencyCode}
        canControlCredit={canControlCredit}
        onCreated={(customer) => {
          notifyCustomersChanged();
          void loadCustomers("");
          void loadDetail(customer.id);
        }}
      />

      <form className="customer-search" onSubmit={(event) => { event.preventDefault(); void loadCustomers(query); }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer name, phone or email" />
        <button className="ghost-button" type="submit">Search</button>
        <button className="text-button" type="button" onClick={() => { setQuery(""); void loadCustomers(""); }}>Clear</button>
      </form>

      <div className="customer-credit-grid">
        <div className="customer-list" aria-busy={loading}>
          {loading ? <div className="customer-empty">Loading customers…</div> : null}
          {!loading && customers.length === 0 ? <div className="customer-empty">No customers yet. Add one above when you need named sales or credit.</div> : null}
          {customers.map((customer) => (
            <button
              type="button"
              key={customer.id}
              className={selected?.customer.id === customer.id ? "customer-row active" : "customer-row"}
              onClick={() => void loadDetail(customer.id)}
            >
              <div>
                <strong>{customer.name}</strong>
                <span>{customer.phone ?? customer.email ?? (customer.creditEnabled ? "Credit account" : "Cash customer")}</span>
              </div>
              <div className="customer-row-money">
                <strong className={customer.balanceMinor > 0 ? "customer-debt" : customer.balanceMinor < 0 ? "customer-credit" : ""}>
                  {customer.balanceMinor < 0 ? `Credit ${formatMoney(-customer.balanceMinor, currencyCode)}` : formatMoney(customer.balanceMinor, currencyCode)}
                </strong>
                <span>{customer.creditLimitMinor === null ? "Pay later off" : `Limit ${formatMoney(customer.creditLimitMinor, currencyCode)}`}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="customer-account-detail">
          {!selected ? (
            <div className="customer-placeholder"><strong>Select a customer</strong><span>View the account ledger, credit limit, available credit and repayments.</span></div>
          ) : (
            <CustomerAccount
              detail={selected}
              businessId={businessId}
              branchId={branchId}
              currencyCode={currencyCode}
              canControlCredit={canControlCredit}
              onChanged={() => {
                notifyCustomersChanged();
                void loadCustomers(query);
                void loadDetail(selected.customer.id);
              }}
              onMessage={setMessage}
            />
          )}
        </div>
      </div>
      {message ? <div className="customer-message">{message}</div> : null}
    </section>
  );
}

function CustomerCreate({ businessId, currencyCode, canControlCredit, onCreated }: {
  businessId: string;
  currencyCode: string;
  canControlCredit: boolean;
  onCreated: (customer: Customer) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        businessId,
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
      };
      if (canControlCredit) payload.creditLimitMinor = creditLimit.trim() ? moneyToMinor(creditLimit) : null;
      const result = await clientApi<{ customer: Customer }>("/api/tradeos/v1/customers", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setName(""); setPhone(""); setEmail(""); setCreditLimit(""); setOpen(false);
      onCreated(result.customer);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="customer-create">
      <button className="primary-button" type="button" onClick={() => setOpen((value) => !value)}>{open ? "Close customer form" : "+ Add customer"}</button>
      {open ? (
        <form className="customer-create-form" onSubmit={(event) => void submit(event)}>
          <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer or business name" /></label>
          <label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="024…" /></label>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="optional" /></label>
          {canControlCredit ? <label>Credit limit ({currencyCode === "GHS" ? "₵" : currencyCode})<input inputMode="decimal" value={creditLimit} onChange={(event) => setCreditLimit(event.target.value)} placeholder="Leave blank to disable Pay later" /></label> : null}
          <button className="ghost-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save customer"}</button>
          {error ? <span className="form-error inline-error">{error}</span> : null}
        </form>
      ) : null}
    </div>
  );
}

function CustomerAccount({ detail, businessId, branchId, currencyCode, canControlCredit, onChanged, onMessage }: {
  detail: CustomerDetail;
  businessId: string;
  branchId: string;
  currencyCode: string;
  canControlCredit: boolean;
  onChanged: () => void;
  onMessage: (message: string | null) => void;
}) {
  const customer = detail.customer;
  const [limit, setLimit] = useState(customer.creditLimitMinor === null ? "" : String(customer.creditLimitMinor / 100));
  const [payment, setPayment] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [providerReference, setProviderReference] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLimit(customer.creditLimitMinor === null ? "" : String(customer.creditLimitMinor / 100));
  }, [customer.id, customer.creditLimitMinor]);

  const updateCredit = async () => {
    if (!canControlCredit || busy) return;
    setBusy(true); onMessage(null);
    try {
      await clientApi(`/api/tradeos/v1/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ businessId, creditLimitMinor: limit.trim() ? moneyToMinor(limit) : null }),
      });
      onMessage("Customer credit settings updated.");
      onChanged();
    } catch (error) {
      onMessage(messageFrom(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!canControlCredit || busy) return;
    setBusy(true); onMessage(null);
    try {
      await clientApi(`/api/tradeos/v1/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ businessId, active: !customer.active }),
      });
      onMessage(customer.active ? "Customer account disabled for new sales." : "Customer account reactivated.");
      onChanged();
    } catch (error) {
      onMessage(messageFrom(error));
    } finally {
      setBusy(false);
    }
  };

  const recordPayment = async () => {
    const amountMinor = moneyToMinor(payment);
    if (amountMinor <= 0 || busy) return;
    setBusy(true); onMessage(null);
    try {
      enqueueMutation({
        clientId: getOrCreateClientId(),
        clientMutationId: crypto.randomUUID(),
        businessId,
        branchId,
        mutationType: "CUSTOMER_PAYMENT_CREATE",
        occurredAt: new Date().toISOString(),
        payload: {
          customerId: customer.id,
          amountMinor,
          method,
          ...(providerReference.trim() ? { providerReference: providerReference.trim() } : {}),
        },
      });
      setPayment(""); setProviderReference("");
      if (!navigator.onLine) {
        onMessage("Customer payment saved offline. It will post to the account when this device reconnects.");
        return;
      }
      const summary = await flushPendingMutations();
      if (summary.rejected > 0) onMessage("The payment is saved but needs review before it can post.");
      else if (summary.applied > 0) onMessage("Customer payment received and account balance updated.");
      else onMessage("Customer payment is queued for synchronization.");
    } catch (error) {
      onMessage(messageFrom(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="customer-account">
      <div className="customer-account-head">
        <div><p className="eyebrow">Customer account</p><h3>{customer.name}</h3><span>{customer.phone ?? customer.email ?? "No contact recorded"}</span></div>
        <span className={customer.active ? "account-status active" : "account-status"}>{customer.active ? "Active" : "Inactive"}</span>
      </div>

      <div className="customer-account-metrics">
        <div><span>Balance owed</span><strong>{customer.balanceMinor >= 0 ? formatMoney(customer.balanceMinor, currencyCode) : `-${formatMoney(-customer.balanceMinor, currencyCode)}`}</strong></div>
        <div><span>Credit limit</span><strong>{customer.creditLimitMinor === null ? "Off" : formatMoney(customer.creditLimitMinor, currencyCode)}</strong></div>
        <div><span>Available credit</span><strong>{customer.availableCreditMinor === null ? "—" : formatMoney(customer.availableCreditMinor, currencyCode)}</strong></div>
      </div>

      {canControlCredit ? (
        <div className="credit-controls">
          <label>Credit limit<input inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="Blank disables Pay later" /></label>
          <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateCredit()}>Update limit</button>
          <button className="text-button" type="button" disabled={busy} onClick={() => void toggleActive()}>{customer.active ? "Disable account" : "Reactivate account"}</button>
        </div>
      ) : null}

      <div className="customer-payment-box">
        <div><p className="eyebrow">Receive money</p><strong>Record customer payment</strong></div>
        <label>Amount<input inputMode="decimal" value={payment} onChange={(event) => setPayment(event.target.value)} placeholder="0.00" /></label>
        <label>Method<select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}><option value="CASH">Cash</option><option value="MOMO">MoMo</option><option value="CARD">Card</option><option value="BANK">Bank</option><option value="OTHER">Other</option></select></label>
        <label>Reference<input value={providerReference} onChange={(event) => setProviderReference(event.target.value)} placeholder="optional" /></label>
        <button className="primary-button" type="button" disabled={busy || moneyToMinor(payment) <= 0} onClick={() => void recordPayment()}>{busy ? "Saving…" : "Receive payment"}</button>
      </div>

      <div className="customer-ledger">
        <div className="ledger-head"><strong>Account ledger</strong><span>Positive increases debt · negative reduces it</span></div>
        {detail.ledger.length === 0 ? <div className="customer-empty">No account entries yet.</div> : detail.ledger.map((entry) => (
          <div className="ledger-row" key={entry.id}>
            <div><strong>{ledgerLabel(entry.entryType)}</strong><span>{formatDate(entry.occurredAt)} · {entry.actorName ?? "Staff"}</span></div>
            <strong className={entry.balanceDeltaMinor > 0 ? "ledger-debit" : "ledger-credit"}>{entry.balanceDeltaMinor > 0 ? "+" : "−"}{formatMoney(Math.abs(entry.balanceDeltaMinor), entry.currencyCode)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ledgerLabel(type: LedgerEntry["entryType"]): string {
  if (type === "CREDIT_SALE") return "Pay-later sale";
  if (type === "PAYMENT") return "Customer payment";
  if (type === "CREDIT_REFUND") return "Refund / account credit";
  return "Account adjustment";
}

function moneyToMinor(value: string): number {
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return 0;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

function formatMoney(minor: number, currencyCode: string): string {
  if (currencyCode === "GHS") return `₵${(minor / 100).toFixed(2)}`;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
