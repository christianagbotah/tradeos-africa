"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";
import { IconCalendar, IconClose, IconMail, IconPhone, IconReceipt, IconShield, IconWallet } from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import {
  buildSupplierUpdatePayload,
  buildSupplierPaymentPayload,
  SUPPLIER_UPDATE_TYPE,
  SUPPLIER_PAYMENT_CREATE_TYPE,
  SUPPLIER_WRITE_ROLES,
  SUPPLIER_PAYMENT_ROLES,
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

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTermsDays: number | null;
  active: boolean;
  balanceMinor: number;
  updatedAt: string;
}

interface SupplierSheetProps {
  supplier: Supplier | null;
  onClose: () => void;
  /** Called after a SUPPLIER_UPDATE or SUPPLIER_PAYMENT_CREATE enqueues successfully. */
  onMutated?: () => void;
}

const PAYMENT_METHODS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "MOMO", label: "Mobile money" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

type StatIconTone = "gold" | "positive" | "warning" | "midnight" | "neutral";

const STAT_TILE_CLASS: Record<StatIconTone, string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

export function SupplierSheet({ supplier, onClose, onMutated }: SupplierSheetProps) {
  const { session, role, bump } = useWorkspace();
  const [editOpen, setEditOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  useEffect(() => {
    if (!supplier) return;
    setEditOpen(false);
    setPaymentOpen(false);
    if (typeof document !== "undefined") document.body.style.overflow = "hidden";
    return () => { if (typeof document !== "undefined") document.body.style.overflow = ""; };
  }, [supplier]);

  if (!supplier || !session) return null;

  const canWrite = roleCan(role as WorkspaceRole, SUPPLIER_WRITE_ROLES);
  const canPay = roleCan(role as WorkspaceRole, SUPPLIER_PAYMENT_ROLES);
  const currencyCode = session.currencyCode;

  const owesAmount = supplier.balanceMinor > 0;
  const balanceCls = owesAmount
    ? "tos-supplier-hero__balance tos-supplier-hero__balance--owes"
    : "tos-supplier-hero__balance tos-supplier-hero__balance--settled";

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Supplier detail">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Supplier</span>
            <h2 className="tos-sheet__title">{supplier.name}</h2>
            <p className="tos-sheet__sub">{supplier.active ? "Active account" : "Inactive account"} · Updated {new Date(supplier.updatedAt).toLocaleString()}</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close supplier detail"><IconClose style={{ width: 18, height: 18 }} /></button>
        </div>
        <div className="tos-sheet__body">
          {/* Supplier hero — gold-tinted card with prominent payable balance */}
          <div className="tos-supplier-hero tos-animate-fade-in-up">
            <div className="tos-supplier-hero__head">
              <div className="tos-supplier-hero__head-main">
                <span className="tos-supplier-hero__eyebrow">{supplier.active ? "Active supplier" : "Inactive supplier"}</span>
                <h3 className="tos-supplier-hero__name">{supplier.name}</h3>
                <p className="tos-supplier-hero__sub">{supplier.address ?? "No address on file"}</p>
              </div>
              <span className={`tos-badge ${supplier.active ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                <span className="tos-badge__dot" />{supplier.active ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="tos-supplier-hero__balance-row">
              <span className="tos-supplier-hero__balance-label">
                {owesAmount ? "Outstanding payable" : "Payable balance"}
              </span>
              <MoneyValue
                minor={supplier.balanceMinor}
                currencyCode={currencyCode}
                className={balanceCls}
              />
            </div>
            <p className="tos-supplier-hero__hint">
              {owesAmount
                ? "This supplier is owed the amount above. Record a payment to settle it — the new balance is computed server-side from the supplier ledger."
                : "Payable balance is settled. Purchase receipts will create new payables; payments reduce them — both are server-authoritative."}
            </p>
          </div>

          {/* Supplier credit info — 3-up stats grid */}
          <div className="tos-supplier-stats tos-animate-fade-in-up">
            <SupplierStat
              label="Payment terms"
              icon={<IconCalendar className="tos-stat__icon-tile-svg" />}
              iconTone={supplier.paymentTermsDays !== null ? "midnight" : "neutral"}
              value={
                supplier.paymentTermsDays !== null ? (
                  <span className="tos-stat__value">{supplier.paymentTermsDays} days</span>
                ) : (
                  <span className="tos-stat__value tos-stat__value--muted">—</span>
                )
              }
              hint={supplier.paymentTermsDays !== null ? "Pay within" : "No terms set"}
            />
            <SupplierStat
              label="Account status"
              icon={<IconShield className="tos-stat__icon-tile-svg" />}
              iconTone={supplier.active ? "positive" : "warning"}
              value={<span className="tos-stat__value">{supplier.active ? "Active" : "Inactive"}</span>}
              hint={supplier.active ? "Can receive POs" : "Hidden from new POs"}
            />
            <SupplierStat
              label="Last updated"
              icon={<IconWallet className="tos-stat__icon-tile-svg" />}
              iconTone="neutral"
              value={<span className="tos-stat__value">{new Date(supplier.updatedAt).toLocaleDateString()}</span>}
              hint={new Date(supplier.updatedAt).toLocaleTimeString()}
            />
          </div>

          {/* Contact info — phone / email rows */}
          <div className="tos-section tos-animate-fade-in-up">
            <div className="tos-section__head">
              <h3 className="tos-section__title">Contact</h3>
              <span className="tos-section__sub">Reach the supplier</span>
            </div>
            <div className="tos-section__body--padded">
              <div className="tos-contact-row">
                <span className="tos-contact-row__icon" aria-hidden="true">
                  <IconPhone style={{ width: 16, height: 16 }} />
                </span>
                <div className="tos-contact-row__body">
                  <span className="tos-contact-row__label">Phone</span>
                  <span className={supplier.phone ? "tos-contact-row__value" : "tos-contact-row__value tos-contact-row__value--muted"}>
                    {supplier.phone ?? "No phone on file"}
                  </span>
                </div>
              </div>
              <div className="tos-contact-row">
                <span className="tos-contact-row__icon" aria-hidden="true">
                  <IconMail style={{ width: 16, height: 16 }} />
                </span>
                <div className="tos-contact-row__body">
                  <span className="tos-contact-row__label">Email</span>
                  <span className={supplier.email ? "tos-contact-row__value" : "tos-contact-row__value tos-contact-row__value--muted"}>
                    {supplier.email ?? "No email on file"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Supplier ledger section — server-authoritative framing */}
          <div className="tos-section tos-animate-fade-in-up">
            <div className="tos-section__head">
              <h3 className="tos-section__title">Supplier ledger</h3>
              <span className="tos-section__sub">Server-authoritative</span>
            </div>
            <div className="tos-section__body">
              <div className="tos-ledger-row">
                <div className="tos-ledger-row__main">
                  <span className="tos-ledger-row__icon" aria-hidden="true">
                    <IconWallet style={{ width: 16, height: 16 }} />
                  </span>
                  <div className="tos-ledger-row__body">
                    <span className="tos-ledger-row__title">Outstanding payable</span>
                    <span className="tos-ledger-row__sub">
                      Derived from purchase receipts − supplier payments
                    </span>
                  </div>
                </div>
                <MoneyValue
                  minor={supplier.balanceMinor}
                  currencyCode={currencyCode}
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
                    <IconReceipt style={{ width: 16, height: 16 }} />
                  </span>
                  <div className="tos-ledger-row__body">
                    <span className="tos-ledger-row__title">Last account update</span>
                    <span className="tos-ledger-row__sub">
                      {new Date(supplier.updatedAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <span className="tos-ledger-row__amount">Recorded</span>
              </div>
            </div>
            <div className="tos-section__foot">
              <span className="tos-callout tos-callout--info" style={{ flex: "1 1 auto" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: "var(--tos-space-1)" }}>
                  <span>Ledger entries (purchase receipts, supplier payments, purchase returns) are recorded as server-authoritative transactions.</span>
                  <span style={{ fontWeight: 400 }}>View the Purchases screen to see this supplier&apos;s recent receipts and post returns to them.</span>
                </span>
              </span>
            </div>
          </div>

          {editOpen && session ? (
            <SupplierEditForm
              supplier={supplier}
              onCancel={() => setEditOpen(false)}
              onSubmit={async (payload) => {
                const queue = getOfflineQueue();
                const mutation = queue.build({
                  businessId: session.businessId,
                  mutationType: SUPPLIER_UPDATE_TYPE,
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
            <SupplierPaymentForm
              supplier={supplier}
              currencyCode={currencyCode}
              businessId={session.businessId}
              branchId={session.branchId}
              onCancel={() => setPaymentOpen(false)}
              onSubmit={async (payload) => {
                const queue = getOfflineQueue();
                const mutation = queue.build({
                  businessId: session.businessId,
                  branchId: session.branchId,
                  mutationType: SUPPLIER_PAYMENT_CREATE_TYPE,
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
            <Button variant="gold" onClick={() => { setPaymentOpen((v) => !v); setEditOpen(false); }} disabled={paymentOpen || supplier.balanceMinor <= 0}>
              {paymentOpen ? "Recording…" : "Record payment"}
            </Button>
          ) : null}
          {!canWrite && !canPay ? <span className="tos-section__sub">View-only role.</span> : null}
        </div>
      </div>
    </>
  );
}

// --- SUPPLIER_UPDATE form ------------------------------------------------

interface SupplierEditFormProps {
  supplier: Supplier;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

function SupplierEditForm({ supplier, onCancel, onSubmit }: SupplierEditFormProps) {
  const [name, setName] = useState(supplier.name);
  const [phone, setPhone] = useState(supplier.phone ?? "");
  const [email, setEmail] = useState(supplier.email ?? "");
  const [address, setAddress] = useState(supplier.address ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = buildSupplierUpdatePayload({
        supplierId: supplier.id,
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        expectedUpdatedAt: supplier.updatedAt,
      });
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update supplier.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tos-stack" onSubmit={handleSubmit} style={{ marginTop: "var(--tos-space-3)" }}>
      <div className="tos-callout tos-callout--info">
        Payment terms and active status can only be changed via an online server check. They are not part of this offline-queued update.
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="sup-edit-name">Name<span className="tos-field__label-required">*</span></label>
        <input id="sup-edit-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={180} />
      </div>
      <div className="tos-public__form-row">
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="sup-edit-phone">Phone</label>
          <input id="sup-edit-phone" className="tos-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="tos-field">
          <label className="tos-field__label" htmlFor="sup-edit-email">Email</label>
          <input id="sup-edit-email" type="email" className="tos-input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="sup-edit-addr">Address</label>
        <textarea id="sup-edit-addr" className="tos-textarea" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
      <div className="tos-row tos-row--between">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>Save changes</Button>
      </div>
    </form>
  );
}

// --- SUPPLIER_PAYMENT_CREATE form (account-selection logic byte-identical) --

interface SupplierPaymentFormProps {
  supplier: Supplier;
  currencyCode: string;
  businessId: string;
  branchId: string;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

function SupplierPaymentForm({ supplier, currencyCode, businessId, branchId, onCancel, onSubmit }: SupplierPaymentFormProps) {
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
      const payload = buildSupplierPaymentPayload({
        supplierId: supplier.id,
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
        The server validates the payment does not exceed the supplier's outstanding payable. The new balance is computed server-side.
      </div>
      <MoneyInput currencyCode={currencyCode} valueMinor={amountMinor} onChange={setAmountMinor} label="Amount paid" size="lg" required />
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="sup-pay-method">Method</label>
        <select id="sup-pay-method" className="tos-select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div className="tos-field">
        <label className="tos-field__label" htmlFor="sup-pay-account">Account</label>
        {accountsLoading ? (
          <div className="tos-input tos-input--readonly">Loading accounts…</div>
        ) : eligibleAccounts.length > 1 ? (
          <select id="sup-pay-account" className="tos-select" value={moneyAccountId ?? ""} onChange={(e) => setMoneyAccountId(e.target.value || null)}>
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
        <label className="tos-field__label" htmlFor="sup-pay-ref">Provider reference (optional)</label>
        <input id="sup-pay-ref" className="tos-input" value={providerReference} onChange={(e) => setProviderReference(e.target.value)} placeholder="e.g. cheque number, MoMo ref" />
      </div>
      {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
      <div className="tos-row tos-row--between">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={amountMinor === null || amountMinor <= 0 || noMatchingAccount || !moneyAccountId}>Record payment</Button>
      </div>
    </form>
  );
}

interface SupplierFormSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function SupplierFormSheet({ open, onClose, onCreated }: SupplierFormSheetProps) {
  const { session, role, bump } = useWorkspace();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setName(""); setPhone(""); setEmail(""); setAddress(""); setTerms(""); setBusy(false); setError(null); }
  }, [open]);

  if (!open || !session) return null;
  const canWrite = roleCan(role as WorkspaceRole, SUPPLIER_WRITE_ROLES);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy || !canWrite) return;
    setBusy(true); setError(null);
    try {
      const queue = getOfflineQueue();
      const payload: Record<string, unknown> = { name: name.trim() };
      if (phone.trim()) payload.phone = phone.trim();
      if (email.trim()) payload.email = email.trim();
      if (address.trim()) payload.address = address.trim();
      if (terms.trim()) payload.paymentTermsDays = Number(terms);
      const mutation = queue.build({ businessId: session.businessId, mutationType: "SUPPLIER_CREATE", payload });
      await queue.enqueue(mutation);
      await queue.flush({ activeBusinessId: session.businessId, online: typeof navigator !== "undefined" ? navigator.onLine : true });
      bump(); onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create supplier.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet" role="dialog" aria-label="Add supplier">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Master data</span>
            <h2 className="tos-sheet__title">Add supplier</h2>
            <p className="tos-sheet__sub">Suppliers carry payment terms and a payable balance derived server-side.</p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close"><IconClose style={{ width: 18, height: 18 }} /></button>
        </div>
        <form className="tos-sheet__body" onSubmit={handleSubmit}>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="sup-name">Name<span className="tos-field__label-required">*</span></label>
            <input id="sup-name" className="tos-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} disabled={!canWrite} />
          </div>
          <div className="tos-public__form-row">
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="sup-phone">Phone</label>
              <input id="sup-phone" className="tos-input" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!canWrite} />
            </div>
            <div className="tos-field">
              <label className="tos-field__label" htmlFor="sup-email">Email</label>
              <input id="sup-email" type="email" className="tos-input" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canWrite} />
            </div>
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="sup-addr">Address</label>
            <textarea id="sup-addr" className="tos-textarea" value={address} onChange={(e) => setAddress(e.target.value)} disabled={!canWrite} />
          </div>
          <div className="tos-field">
            <label className="tos-field__label" htmlFor="sup-terms">Payment terms (days)</label>
            <input id="sup-terms" type="number" min={0} className="tos-input" value={terms} onChange={(e) => setTerms(e.target.value)} disabled={!canWrite} />
          </div>
          {error ? <div className="tos-banner tos-banner--danger"><span className="tos-banner__title">{error}</span></div> : null}
        </form>
        <div className="tos-sheet__foot">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} loading={busy} disabled={!name.trim() || !canWrite}>
            {canWrite ? "Create supplier" : "No permission"}
          </Button>
        </div>
      </div>
    </>
  );
}

// --- Supplier stat card (reuses tos-stat + tos-stat__icon-tile) ----------

interface SupplierStatProps {
  label: string;
  icon: ReactNode;
  iconTone: StatIconTone;
  value: ReactNode;
  hint?: string;
}

function SupplierStat({ label, icon, iconTone, value, hint }: SupplierStatProps) {
  return (
    <div className="tos-stat tos-card-hover">
      <div className="tos-stat__head">
        <span className={STAT_TILE_CLASS[iconTone]} aria-hidden="true">
          {icon}
        </span>
        <span className="tos-stat__label">{label}</span>
      </div>
      {value}
      {hint ? <span className="tos-stat__hint">{hint}</span> : null}
    </div>
  );
}
