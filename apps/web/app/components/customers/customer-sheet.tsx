"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";
import { IconClose } from "../ui/icons";
import type { Customer } from "../workspace/workspace-provider";
import { getOfflineQueue } from "../../../lib/offline-sync";
import {
  buildCustomerUpdatePayload,
  buildCustomerPaymentPayload,
  CUSTOMER_UPDATE_TYPE,
  CUSTOMER_PAYMENT_CREATE_TYPE,
  CUSTOMER_WRITE_ROLES,
  CUSTOMER_PAYMENT_ROLES,
  roleCan,
  type PaymentMethod,
  type WorkspaceRole,
} from "../../../lib/mutation-builders";
import { useApiFetch } from "../../../lib/use-api-fetch";

interface MoneyAccount {
  id: string;
  name: string;
  method: string;
  active: boolean;
  currencyCode: string;
}

interface CustomerSheetProps {
  customer: Customer | null;
  onClose: () => void;
  /** Called after a CUSTOMER_UPDATE or CUSTOMER_PAYMENT_CREATE enqueues successfully. */
  onMutated?: () => void;
}

const PAYMENT_METHODS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "MOMO", label: "Mobile money" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

export function CustomerSheet({ customer, onClose, onMutated }: CustomerSheetProps) {
  const { session, role, bump } = useWorkspace();
  const [editOpen, setEditOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  useEffect(() => {
    if (!customer) return;
    setEditOpen(false);
    setPaymentOpen(false);
    if (typeof document !== "undefined") document.body.style.overflow = "hidden";
    return () => {
      if (typeof document !== "undefined") document.body.style.overflow = "";
    };
  }, [customer]);

  if (!customer) return null;
  const currency = "GHS"; // customer balance currency not in the read model; use a stable default

  const canWrite = roleCan(role as WorkspaceRole, CUSTOMER_WRITE_ROLES);
  const canPay = roleCan(role as WorkspaceRole, CUSTOMER_PAYMENT_ROLES);

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Customer detail">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Customer</span>
            <h2 className="tos-sheet__title">{customer.name}</h2>
            <p className="tos-sheet__sub">{customer.active ? "Active" : "Inactive"}</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close customer detail">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <div className="tos-sheet__body">
          <dl className="tos-kv">
            <div><dt className="tos-kv__key">Phone</dt><dd className="tos-kv__val">{customer.phone ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Email</dt><dd className="tos-kv__val">{customer.email ?? "—"}</dd></div>
            <div><dt className="tos-kv__key">Credit limit</dt><dd className="tos-kv__val">{customer.creditLimitMinor !== null ? <MoneyValue minor={customer.creditLimitMinor} currencyCode={currency} tone="muted" /> : "—"}</dd></div>
            <div><dt className="tos-kv__key">Credit terms</dt><dd className="tos-kv__val">{customer.creditTermsDays !== null ? `${customer.creditTermsDays} days` : "—"}</dd></div>
            <div><dt className="tos-kv__key">Outstanding balance</dt><dd className="tos-kv__val"><MoneyValue minor={customer.balanceMinor} currencyCode={currency} tone={customer.balanceMinor > 0 ? "negative" : "positive"} /></dd></div>
            <div><dt className="tos-kv__key">Updated</dt><dd className="tos-kv__val">{new Date(customer.updatedAt).toLocaleString()}</dd></div>
          </dl>

          {editOpen && session ? (
            <CustomerEditForm
              customer={customer}
              onCancel={() => setEditOpen(false)}
              onSubmit={async (payload) => {
                const queue = getOfflineQueue();
                const mutation = queue.build({
                  businessId: session.businessId,
                  mutationType: CUSTOMER_UPDATE_TYPE,
                  payload,
                });
                await queue.enqueue(mutation);
                await queue.flush({
                  activeBusinessId: session.businessId,
                  online: typeof navigator !== "undefined" ? navigator.onLine : true,
                });
                bump();
                onMutated?.();
                setEditOpen(false);
              }}
            />
          ) : null}

          {paymentOpen && session ? (
            <CustomerPaymentForm
              customer={customer}
              currencyCode={currency}
              businessId={session.businessId}
              branchId={session.branchId}
              onCancel={() => setPaymentOpen(false)}
              onSubmit={async (payload) => {
                const queue = getOfflineQueue();
                const mutation = queue.build({
                  businessId: session.businessId,
                  branchId: session.branchId,
                  mutationType: CUSTOMER_PAYMENT_CREATE_TYPE,
                  payload,
                });
                await queue.enqueue(mutation);
                await queue.flush({
                  activeBusinessId: session.businessId,
                  online: typeof navigator !== "undefined" ? navigator.onLine : true,
                });
                bump();
                onMutated?.();
                setPaymentOpen(false);
              }}
            />
          ) : null}
        </div>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {canWrite ? (
            <Button variant="outline" onClick={() => { setEditOpen((v) => !v); setPaymentOpen(false); }} disabled={editOpen}>
              {editOpen ? "Editing…" : "Edit"}
            </Button>
          ) : null}
          {canPay ? (
            <Button variant="gold" onClick={() => { setPaymentOpen((v) => !v); setEditOpen(false); }} disabled={paymentOpen || customer.balanceMinor <= 0}>
              {paymentOpen ? "Recording…" : "Record payment"}
            </Button>
          ) : null}
          {!canWrite && !canPay ? <span className="tos-section__sub">View-only role.</span> : null}
        </div>
      </div>
    </>
  );
}

// --- CUSTOMER_UPDATE form ------------------------------------------------

interface CustomerEditFormProps {
  customer: Customer;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

function CustomerEditForm({ customer, onCancel, onSubmit }: CustomerEditFormProps) {
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [email, setEmail] = useState(customer.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = buildCustomerUpdatePayload({
        customerId: customer.id,
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        expectedUpdatedAt: customer.updatedAt,
      });
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update customer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tos-stack" onSubmit={handleSubmit} style={{ marginTop: "var(--tos-space-3)" }}>
      <div className="tos-callout tos-callout--info">
        Credit limit, credit terms and active status can only be changed via an online server check (CREDIT_CONTROL role). They are not part of this offline-queued update.
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="cust-edit-name">Name<span className="tos-field__label-required">*</span></label>
        <input id="cust-edit-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="cust-edit-phone">Phone</label>
        <input id="cust-edit-phone" className="tos-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="cust-edit-email">Email</label>
        <input id="cust-edit-email" type="email" className="tos-input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
      <div className="tos-row tos-row--between">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>Save changes</Button>
      </div>
    </form>
  );
}

// --- CUSTOMER_PAYMENT_CREATE form ---------------------------------------

interface CustomerPaymentFormProps {
  customer: Customer;
  currencyCode: string;
  businessId: string;
  branchId: string;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

function CustomerPaymentForm({ customer, currencyCode, businessId, branchId, onCancel, onSubmit }: CustomerPaymentFormProps) {
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [providerReference, setProviderReference] = useState("");
  const [moneyAccountId, setMoneyAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountsPath = `/v1/money-accounts?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}`;
  const { data: accountsData, loading: accountsLoading } = useApiFetch<{ accounts: MoneyAccount[] }>(accountsPath);
  const accounts = (accountsData?.accounts ?? []).filter((a) => a.active && a.currencyCode === currencyCode);
  const matchingAccounts = accounts.filter((a) => a.method === method);
  const noMatchingAccount = !accountsLoading && matchingAccounts.length === 0;

  // Auto-select default matching account when method changes or accounts load
  useEffect(() => {
    if (matchingAccounts.length >= 1) {
      const current = matchingAccounts.find((a) => a.id === moneyAccountId);
      if (!current) setMoneyAccountId(matchingAccounts[0]!.id);
    } else {
      setMoneyAccountId(null);
    }
  }, [method, matchingAccounts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amountMinor === null || amountMinor <= 0 || busy || !moneyAccountId) return;
    setBusy(true);
    setError(null);
    try {
      const payload = buildCustomerPaymentPayload({
        customerId: customer.id,
        amountMinor,
        method,
        moneyAccountId,
        providerReference: providerReference.trim() || null,
      });
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tos-stack" onSubmit={handleSubmit} style={{ marginTop: "var(--tos-space-3)" }}>
      <div className="tos-callout tos-callout--info">
        The new balance is computed server-side from the customer account ledger. The client never sends a balance.
      </div>
      <MoneyInput currencyCode={currencyCode} valueMinor={amountMinor} onChange={setAmountMinor} label="Amount received" size="lg" required />
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="cust-pay-method">Method</label>
        <select id="cust-pay-method" className="tos-select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="cust-pay-account">Account</label>
        {accountsLoading ? (
          <div className="tos-input tos-input--readonly">Loading accounts…</div>
        ) : matchingAccounts.length > 1 ? (
          <select id="cust-pay-account" className="tos-select" value={moneyAccountId ?? ""} onChange={(e) => setMoneyAccountId(e.target.value || null)}>
            {matchingAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        ) : matchingAccounts.length === 1 ? (
          <div className="tos-input tos-input--readonly">{matchingAccounts[0]!.name}</div>
        ) : (
          <div className="tos-banner tos-banner--warning">
            <span className="tos-banner__title">No active {PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method} account is configured for this branch.</span>
            <a className="tos-banner__action" href="/cashbook">Configure in Cashbook →</a>
          </div>
        )}
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="cust-pay-ref">Provider reference (optional)</label>
        <input id="cust-pay-ref" className="tos-input" value={providerReference} onChange={(e) => setProviderReference(e.target.value)} placeholder="e.g. MoMo transaction id" />
      </div>
      {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
      <div className="tos-row tos-row--between">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={amountMinor === null || amountMinor <= 0 || noMatchingAccount || !moneyAccountId}>Record payment</Button>
      </div>
    </form>
  );
}

interface CustomerFormSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CustomerFormSheet({ open, onClose, onCreated }: CustomerFormSheetProps) {
  const { session, role, bump } = useWorkspace();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(""); setPhone(""); setEmail(""); setBusy(false); setError(null);
    }
  }, [open]);

  if (!open || !session) return null;

  const canWrite = roleCan(role as WorkspaceRole, CUSTOMER_WRITE_ROLES);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy || !canWrite) return;
    setBusy(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      const payload: Record<string, unknown> = { name: name.trim() };
      if (phone.trim()) payload.phone = phone.trim();
      if (email.trim()) payload.email = email.trim();
      const mutation = queue.build({
        businessId: session.businessId,
        mutationType: "CUSTOMER_CREATE",
        payload,
      });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      bump();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create customer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Add customer">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Master data</span>
            <h2 className="tos-sheet__title">Add customer</h2>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <form className="tos-sheet__body" onSubmit={handleSubmit}>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cust-name">Name<span className="tos-field__label-required">*</span></label>
            <input id="cust-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cust-phone">Phone</label>
            <input id="cust-phone" className="tos-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="cust-email">Email</label>
            <input id="cust-email" type="email" className="tos-input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
        </form>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={!name.trim() || !canWrite}>
            {canWrite ? "Create customer" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}
