"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";
import {
  IconCalendar,
  IconClose,
  IconMail,
  IconPhone,
  IconRefresh,
  IconShield,
  IconWallet,
} from "../ui/icons";
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
import {
  filterEligibleAccounts,
  resolveDefaultAccountId,
  isSelectionValid,
  type MoneyAccount as PaymentAccount,
  type MoneyAccountDefault,
} from "../../../lib/payment-account-selection";

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

  if (!customer || !session) return null;
  const currency = session.currencyCode;

  const canWrite = roleCan(role as WorkspaceRole, CUSTOMER_WRITE_ROLES);
  const canPay = roleCan(role as WorkspaceRole, CUSTOMER_PAYMENT_ROLES);

  const owesAmount = customer.balanceMinor > 0;
  const hasCredit = customer.balanceMinor < 0;

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Customer detail">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Customer</span>
            <h2 className="tos-sheet__title">{customer.name}</h2>
            <p className="tos-sheet__sub">
              {customer.active ? "Active account" : "Inactive account"} · Updated {new Date(customer.updatedAt).toLocaleString()}
            </p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close customer detail">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>
        <div className="tos-sheet__body">
          {/* Customer hero — gold-tinted card with prominent balance. */}
          <div className="tos-customer-hero tos-animate-fade-in-up">
            <div className="tos-customer-hero__head">
              <div className="tos-customer-hero__head-main">
                <h3 className="tos-customer-hero__name">{customer.name}</h3>
                <p className="tos-customer-hero__sub">
                  {customer.active ? "Active account" : "Inactive account"}
                </p>
              </div>
              <span className={`tos-badge ${customer.active ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                <span className="tos-badge__dot" />{customer.active ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="tos-customer-hero__balance-row">
              <span className="tos-customer-hero__balance-label">
                {owesAmount ? "Outstanding balance" : hasCredit ? "Credit balance" : "Balance"}
              </span>
              <MoneyValue
                minor={customer.balanceMinor}
                currencyCode={currency}
                className={
                  owesAmount
                    ? "tos-customer-hero__balance tos-customer-hero__balance--owes"
                    : hasCredit
                      ? "tos-customer-hero__balance tos-customer-hero__balance--credit"
                      : "tos-customer-hero__balance"
                }
              />
            </div>
            <p className="tos-customer-hero__hint">
              {owesAmount
                ? "This customer owes the amount above. Record a payment to reduce the outstanding balance."
                : hasCredit
                  ? "This customer has credit (paid in advance). It will be applied automatically to their next sale."
                  : "Balance is settled. New credit sales increase the balance and customer payments reduce it automatically."}
            </p>
          </div>

          {/* Credit info — 3-up stat row. Stays 1-col on phone. */}
          <div className="tos-customer-stats tos-animate-fade-in-up">
            <CreditStat
              label="Credit limit"
              icon={<IconWallet className="tos-stat__icon-tile-svg" />}
              iconTone={customer.creditLimitMinor !== null ? "midnight" : "neutral"}
              value={
                customer.creditLimitMinor !== null ? (
                  <MoneyValue minor={customer.creditLimitMinor} currencyCode={currency} />
                ) : (
                  <span className="tos-stat__value tos-stat__value--muted">—</span>
                )
              }
              hint={customer.creditLimitMinor !== null ? "Server-checked" : "No limit set"}
            />
            <CreditStat
              label="Credit terms"
              icon={<IconCalendar className="tos-stat__icon-tile-svg" />}
              iconTone={customer.creditTermsDays !== null ? "midnight" : "neutral"}
              value={
                customer.creditTermsDays !== null ? (
                  <span className="tos-stat__value">{customer.creditTermsDays} days</span>
                ) : (
                  <span className="tos-stat__value tos-stat__value--muted">—</span>
                )
              }
              hint={customer.creditTermsDays !== null ? "Pay within" : "No terms"}
            />
            <CreditStat
              label="Last updated"
              icon={<IconRefresh className="tos-stat__icon-tile-svg" />}
              iconTone="neutral"
              value={<span className="tos-stat__value">{new Date(customer.updatedAt).toLocaleDateString()}</span>}
              hint={new Date(customer.updatedAt).toLocaleTimeString()}
            />
          </div>

          {/* Profile / contact info */}
          <div className="tos-section tos-animate-fade-in-up">
            <div className="tos-section__head">
              <h3 className="tos-section__title">Profile</h3>
              <span className="tos-section__sub">Contact details</span>
            </div>
            <div className="tos-section__body--padded">
              <div className="tos-contact-row">
                <span className="tos-contact-row__icon" aria-hidden="true">
                  <IconPhone style={{ width: 16, height: 16 }} />
                </span>
                <div className="tos-contact-row__body">
                  <span className="tos-contact-row__label">Phone</span>
                  <span className={customer.phone ? "tos-contact-row__value" : "tos-contact-row__value tos-contact-row__value--muted"}>
                    {customer.phone ?? "No phone on file"}
                  </span>
                </div>
              </div>
              <div className="tos-contact-row">
                <span className="tos-contact-row__icon" aria-hidden="true">
                  <IconMail style={{ width: 16, height: 16 }} />
                </span>
                <div className="tos-contact-row__body">
                  <span className="tos-contact-row__label">Email</span>
                  <span className={customer.email ? "tos-contact-row__value" : "tos-contact-row__value tos-contact-row__value--muted"}>
                    {customer.email ?? "No email on file"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Customer ledger / activity — server-authoritative framing. */}
          <div className="tos-section tos-animate-fade-in-up">
            <div className="tos-section__head">
              <h3 className="tos-section__title">Customer ledger</h3>
              <span className="tos-section__sub">Account history</span>
            </div>
            <div className="tos-section__body">
              <div className="tos-ledger-row">
                <div className="tos-ledger-row__main">
                  <span className="tos-ledger-row__icon" aria-hidden="true">
                    <IconWallet style={{ width: 16, height: 16 }} />
                  </span>
                  <div className="tos-ledger-row__body">
                    <span className="tos-ledger-row__title">Outstanding balance</span>
                    <span className="tos-ledger-row__sub">
                      Derived from credit sales − payments received
                    </span>
                  </div>
                </div>
                <MoneyValue
                  minor={customer.balanceMinor}
                  currencyCode={currency}
                  className={
                    owesAmount
                      ? "tos-ledger-row__amount tos-ledger-row__amount--negative"
                      : "tos-ledger-row__amount"
                  }
                />
              </div>
              <div className="tos-ledger-row">
                <div className="tos-ledger-row__main">
                  <span className="tos-ledger-row__icon" aria-hidden="true">
                    <IconShield style={{ width: 16, height: 16 }} />
                  </span>
                  <div className="tos-ledger-row__body">
                    <span className="tos-ledger-row__title">Last account update</span>
                    <span className="tos-ledger-row__sub">
                      {new Date(customer.updatedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <span className="tos-ledger-row__amount">Recorded</span>
              </div>
            </div>
            <div className="tos-section__foot">
              <span className="tos-callout tos-callout--info" style={{ flex: "1 1 auto" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: "var(--tos-space-1)" }}>
                  <span>Credit sales, payments and adjustments are kept in this customer’s account history.</span>
                  <span style={{ fontWeight: 400 }}>View the customer&apos;s sales in the Sales screen to see their full purchase history.</span>
                </span>
              </span>
            </div>
          </div>

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
                await queue.flushOrThrow({
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
                await queue.flushOrThrow({
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

interface CreditStatProps {
  label: string;
  icon: React.ReactNode;
  iconTone: "gold" | "positive" | "warning" | "midnight" | "neutral";
  value: React.ReactNode;
  hint?: string;
}

const CREDIT_STAT_TILE: Record<CreditStatProps["iconTone"], string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

function CreditStat({ label, icon, iconTone, value, hint }: CreditStatProps) {
  return (
    <div className="tos-stat tos-card-hover">
      <div className="tos-stat__head">
        <span className={CREDIT_STAT_TILE[iconTone]} aria-hidden="true">
          {icon}
        </span>
        <span className="tos-stat__label">{label}</span>
      </div>
      {value}
      {hint ? <span className="tos-stat__hint">{hint}</span> : null}
    </div>
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
  const { data: accountsData, loading: accountsLoading } = useApiFetch<{ accounts: PaymentAccount[] }>(accountsPath);
  const defaultsPath = `/v1/money-account-defaults?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}`;
  const { data: defaultsData } = useApiFetch<{ defaults: MoneyAccountDefault[] }>(defaultsPath);

  const allAccounts = accountsData?.accounts ?? [];
  const defaults = defaultsData?.defaults ?? [];
  const eligibleAccounts = filterEligibleAccounts(allAccounts, method, currencyCode);
  const noMatchingAccount = !accountsLoading && eligibleAccounts.length === 0;

  // Resolve default using production helper: configured default wins,
  // otherwise auto-select if exactly one, otherwise require explicit selection
  useEffect(() => {
    if (accountsLoading) return;
    if (isSelectionValid(moneyAccountId, eligibleAccounts)) return;
    const resolved = resolveDefaultAccountId(eligibleAccounts, defaults, method);
    setMoneyAccountId(resolved);
  }, [method, accountsLoading, eligibleAccounts.length, defaults.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
        TradeOS updates the customer balance automatically after the payment is recorded.
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
        ) : eligibleAccounts.length > 1 ? (
          <select id="cust-pay-account" className="tos-select" value={moneyAccountId ?? ""} onChange={(e) => setMoneyAccountId(e.target.value || null)}>
            {eligibleAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        ) : eligibleAccounts.length === 1 ? (
          <div className="tos-input tos-input--readonly">{eligibleAccounts[0]!.name}</div>
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
      await queue.flushOrThrow({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
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
