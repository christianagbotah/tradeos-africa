"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { ContextualIntelligencePanel } from "../intelligence/contextual-intelligence-panel";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { SupplierSheet, SupplierFormSheet, type Supplier } from "./supplier-sheet";
import { PurchaseReceiptBuilder } from "./purchase-receipt-builder";
import { PurchaseDetailSheet } from "./purchase-detail-sheet";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import {
  IconPurchases,
  IconCashbook,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconWallet,
  IconTrash,
} from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";

interface SuppliersResponse { suppliers: Supplier[] }

interface PurchaseListItem {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierReference: string | null;
  totalMinor: number;
  settlementMethod: string;
  currencyCode: string;
  receivedAt: string;
  receiverName: string | null;
  lineCount: number;
}

interface PurchasesResponse { purchases: PurchaseListItem[] }

type StatIconTone = "gold" | "positive" | "warning" | "midnight" | "neutral";

const STAT_TILE_CLASS: Record<StatIconTone, string> = {
  gold: "tos-stat__icon-tile tos-stat__icon-tile--gold",
  positive: "tos-stat__icon-tile tos-stat__icon-tile--positive",
  warning: "tos-stat__icon-tile tos-stat__icon-tile--warning",
  midnight: "tos-stat__icon-tile tos-stat__icon-tile--midnight",
  neutral: "tos-stat__icon-tile tos-stat__icon-tile--neutral",
};

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
type BalanceFilter = "ALL" | "OWES" | "SETTLED";

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

const BALANCE_FILTERS: ReadonlyArray<{ value: BalanceFilter; label: string }> = [
  { value: "ALL", label: "All balances" },
  { value: "OWES", label: "Owes payable" },
  { value: "SETTLED", label: "Settled" },
];

function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "S";
  return trimmed.charAt(0).toUpperCase();
}

function networkFailureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? `Network request failed: ${error.message}`
    : "Network request failed";
}

export function SupplierWorkspace() {
  const { session, role, bump } = useWorkspace();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("ALL");
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [purchaseDetailId, setPurchaseDetailId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteArmed, setBulkDeleteArmed] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  const suppliersPath = session ? `/v1/suppliers?businessId=${encodeURIComponent(session.businessId)}` : null;
  const purchasesPath = session ? `/v1/purchases?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}` : null;
  const { data: suppliersData, loading: suppliersLoading, error: suppliersError, refetch: refetchSuppliers } = useApiFetch<SuppliersResponse>(suppliersPath);
  const { data: purchasesData, loading: purchasesLoading, error: purchasesError, refetch: refetchPurchases } = useApiFetch<PurchasesResponse>(purchasesPath);

  useEffect(() => {
    // re-fetch when nonce changes
    if (nonce > 0) {
      refetchSuppliers();
      refetchPurchases();
    }
  }, [nonce, refetchSuppliers, refetchPurchases]);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "INVENTORY"].includes(role);
  const canDelete = ["OWNER", "ADMIN"].includes(role);

  const suppliers = suppliersData?.suppliers ?? [];
  const purchases = purchasesData?.purchases ?? [];
  const currencyCode = session?.currencyCode ?? "GHS";

  const filteredSuppliers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (statusFilter !== "ALL") {
        if (statusFilter === "ACTIVE" && !s.active) return false;
        if (statusFilter === "INACTIVE" && s.active) return false;
      }
      if (balanceFilter !== "ALL") {
        if (balanceFilter === "OWES" && s.balanceMinor <= 0) return false;
        if (balanceFilter === "SETTLED" && s.balanceMinor > 0) return false;
      }
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.phone ?? "").toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [suppliers, query, statusFilter, balanceFilter]);

  const stats = useMemo(() => {
    const total = suppliers.length;
    const active = suppliers.filter((s) => s.active).length;
    const owesCount = suppliers.filter((s) => s.balanceMinor > 0).length;
    const totalPayableMinor = suppliers.reduce((sum, s) => sum + Math.max(0, s.balanceMinor), 0);
    return { total, active, owesCount, totalPayableMinor };
  }, [suppliers]);

  const selectedSuppliers = useMemo(
    () => suppliers.filter((supplier) => selectedIds.has(supplier.id)),
    [suppliers, selectedIds],
  );
  const allFilteredSelected = filteredSuppliers.length > 0 && filteredSuppliers.every((supplier) => selectedIds.has(supplier.id));
  const hasActiveSelection = selectedSuppliers.some((supplier) => supplier.active);
  const hasInactiveSelection = selectedSuppliers.some((supplier) => !supplier.active);

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkDeleteArmed(false);
    setBulkNotice(null);
  }, [query, statusFilter, balanceFilter]);

  useEffect(() => {
    const currentIds = new Set(suppliers.map((supplier) => supplier.id));
    setSelectedIds((previous) => {
      const next = new Set([...previous].filter((id) => currentIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [suppliers]);

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("ALL");
    setBalanceFilter("ALL");
  };

  const openAddSupplier = () => {
    setSelected(null);
    setFormOpen(true);
  };

  const openSupplier = (supplier: Supplier) => {
    setFormOpen(false);
    setSelected(supplier);
  };

  const toggleSelection = (supplierId: string) => {
    setBulkDeleteArmed(false);
    setBulkNotice(null);
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(supplierId)) next.delete(supplierId);
      else next.add(supplierId);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setBulkDeleteArmed(false);
    setBulkNotice(null);
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allFilteredSelected) filteredSuppliers.forEach((supplier) => next.delete(supplier.id));
      else filteredSuppliers.forEach((supplier) => next.add(supplier.id));
      return next;
    });
  };

  const runBulkStatus = async (active: boolean) => {
    if (!session || !canWrite || bulkBusy) return;
    const targets = selectedSuppliers.filter((supplier) => supplier.active !== active);
    if (targets.length === 0) return;
    setBulkBusy(true);
    setBulkDeleteArmed(false);
    setBulkNotice(null);
    const failures: Array<{ id: string; name: string; message: string }> = [];
    let changed = 0;
    try {
      for (const supplier of targets) {
        try {
          const response = await getOfflineQueue().authenticatedFetch(
            `/v1/suppliers/${encodeURIComponent(supplier.id)}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                businessId: session.businessId,
                expectedUpdatedAt: supplier.updatedAt,
                active,
              }),
            },
          );
          if (!response.ok) {
            failures.push({ id: supplier.id, name: supplier.name, message: await readApiErrorMessage(response, "Supplier status could not be changed") });
          } else {
            changed += 1;
          }
        } catch (error) {
          failures.push({ id: supplier.id, name: supplier.name, message: networkFailureMessage(error) });
        }
      }
      refetchSuppliers();
      bump();
      setSelectedIds(new Set(failures.map((failure) => failure.id)));
      const action = active ? "activated" : "deactivated";
      setBulkNotice(
        failures.length > 0
          ? `${changed} supplier(s) ${action}. ${failures.length} could not be changed: ${failures.map((failure) => `${failure.name} — ${failure.message}`).join("; ")}`
          : `${changed} supplier(s) ${action}.`,
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkDelete = async () => {
    if (!session || !canDelete || bulkBusy || selectedSuppliers.length === 0) return;
    if (!bulkDeleteArmed) {
      setBulkDeleteArmed(true);
      setBulkNotice("Permanent deletion only succeeds for suppliers with no purchase, payment, return or credit history. Protected suppliers should be deactivated instead.");
      return;
    }
    setBulkBusy(true);
    setBulkNotice(null);
    const failures: Array<{ id: string; name: string; message: string }> = [];
    let deleted = 0;
    try {
      for (const supplier of selectedSuppliers) {
        try {
          const response = await getOfflineQueue().authenticatedFetch(
            `/v1/suppliers/${encodeURIComponent(supplier.id)}?businessId=${encodeURIComponent(session.businessId)}&expectedUpdatedAt=${encodeURIComponent(supplier.updatedAt)}`,
            { method: "DELETE" },
          );
          if (!response.ok) {
            failures.push({ id: supplier.id, name: supplier.name, message: await readApiErrorMessage(response, "Supplier could not be deleted") });
          } else {
            deleted += 1;
          }
        } catch (error) {
          failures.push({ id: supplier.id, name: supplier.name, message: networkFailureMessage(error) });
        }
      }
      refetchSuppliers();
      bump();
      setSelectedIds(new Set(failures.map((failure) => failure.id)));
      setBulkDeleteArmed(false);
      setBulkNotice(
        failures.length > 0
          ? `${deleted} supplier(s) deleted. ${failures.length} protected or changed supplier(s) remain selected: ${failures.map((failure) => `${failure.name} — ${failure.message}`).join("; ")}`
          : `${deleted} supplier(s) permanently deleted.`,
      );
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Inventory</span>
          <h1 className="tos-page__title">Purchases &amp; suppliers</h1>
          <p className="tos-page__subtitle">
            Receive stock from suppliers, track payables and return faulty goods. Receipts update inventory value and cashbook records automatically.
          </p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => setNonce((n) => n + 1)}>Refresh</Button>
          {canWrite ? (
            <>
              <Button variant="outline" icon={<IconPurchases className="tos-btn__icon" />} onClick={openAddSupplier}>Add supplier</Button>
              <Button variant="gold" icon={<IconReceipt className="tos-btn__icon" />} onClick={() => setReceiptOpen(true)}>Record receipt</Button>
            </>
          ) : null}
        </div>
      </header>

      {/* KPI strip — 4-up desktop / 2x2 mobile */}
      <ContextualIntelligencePanel surface="purchases" />

      <div className="tos-dashboard-stats tos-stagger">
        <StatCard
          label="Total payable"
          icon={<IconWallet className="tos-stat__icon-tile-svg" />}
          iconTone="gold"
          variant="hero"
          value={<MoneyValue minor={stats.totalPayableMinor} currencyCode={currencyCode} className="tos-stat__value tos-stat__value--hero" />}
          hint={`${stats.owesCount} supplier(s) owe a balance`}
          hintTone={stats.owesCount > 0 ? "warning" : "positive"}
        />
        <StatCard
          label="Suppliers"
          icon={<IconPurchases className="tos-stat__icon-tile-svg" />}
          iconTone="midnight"
          value={<span className="tos-stat__value">{stats.total}</span>}
          hint={`${stats.active} active`}
        />
        <StatCard
          label="Owes payable"
          icon={<IconCashbook className="tos-stat__icon-tile-svg" />}
          iconTone={stats.owesCount > 0 ? "warning" : "positive"}
          value={<span className="tos-stat__value">{stats.owesCount}</span>}
          hint={stats.owesCount > 0 ? "Receivable balance" : "All settled"}
          hintTone={stats.owesCount > 0 ? "warning" : "positive"}
        />
        <StatCard
          label="Recent receipts"
          icon={<IconReceipt className="tos-stat__icon-tile-svg" />}
          iconTone="neutral"
          value={<span className="tos-stat__value">{purchases.length}</span>}
          hint="Last 50 receipts"
        />
      </div>

      {/* Toolbar — search + status chips + balance chips */}
      <div className="tos-toolbar tos-toolbar--stacked">
        <div className="tos-toolbar__search">
          <IconSearch className="tos-toolbar__search-icon" />
          <input
            type="search"
            className="tos-toolbar__search-input"
            placeholder="Search suppliers by name, phone, or email…"
            aria-label="Search suppliers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="tos-filter-row">
          <span className="tos-filter-label">Status</span>
          {STATUS_FILTERS.map((s) => (
            <FilterChip key={s.value} pressed={statusFilter === s.value} onClick={() => setStatusFilter(s.value)}>
              {s.label}
            </FilterChip>
          ))}
          <span className="tos-filter-label" style={{ marginLeft: "var(--tos-space-2)" }}>Balance</span>
          {BALANCE_FILTERS.map((b) => (
            <FilterChip key={b.value} pressed={balanceFilter === b.value} onClick={() => setBalanceFilter(b.value)}>
              {b.label}
            </FilterChip>
          ))}
          <span className="tos-toolbar__spacer" />
          <span className="tos-section__sub">{filteredSuppliers.length} supplier(s)</span>
        </div>
      </div>

      {canWrite && filteredSuppliers.length > 0 ? (
        <div className={`tos-bulk-bar ${selectedSuppliers.length > 0 ? "tos-bulk-bar--active" : ""}`}>
          <div className="tos-bulk-bar__summary">
            <Button size="sm" variant="ghost" onClick={toggleAllFiltered}>
              {allFilteredSelected ? "Clear visible selection" : "Select all visible"}
            </Button>
            <span className="tos-bulk-bar__count">{selectedSuppliers.length} selected</span>
          </div>
          {selectedSuppliers.length > 0 ? (
            <div className="tos-bulk-bar__actions">
              <Button size="sm" variant="outline" onClick={() => void runBulkStatus(false)} loading={bulkBusy} disabled={!hasActiveSelection}>
                Deactivate selected
              </Button>
              <Button size="sm" variant="outline" onClick={() => void runBulkStatus(true)} loading={bulkBusy} disabled={!hasInactiveSelection}>
                Activate selected
              </Button>
              {canDelete ? (
                <Button size="sm" variant="danger" icon={<IconTrash style={{ width: 14, height: 14 }} />} onClick={() => void runBulkDelete()} loading={bulkBusy}>
                  {bulkDeleteArmed ? `Confirm delete ${selectedSuppliers.length}` : "Delete selected"}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => { setSelectedIds(new Set()); setBulkDeleteArmed(false); setBulkNotice(null); }} disabled={bulkBusy}>
                Clear
              </Button>
            </div>
          ) : (
            <span className="tos-section__sub">Select suppliers to activate, deactivate, or delete unused records in bulk.</span>
          )}
        </div>
      ) : null}

      {bulkNotice ? (
        <div className="tos-callout tos-callout--info" role="status">{bulkNotice}</div>
      ) : null}

      {suppliersLoading ? (
        <div className="tos-card tos-card--padded"><StatePanel inline variant="loading" /></div>
      ) : suppliersError ? (
        <StatePanel variant="error" title="Could not load suppliers" text={suppliersError} actionLabel="Retry" onAction={() => refetchSuppliers()} />
      ) : suppliers.length === 0 ? (
        <StatePanel
          variant="empty"
          icon={<IconPurchases className="tos-state__icon" />}
          title="No suppliers yet"
          text="Add suppliers so you can record purchase receipts, track payables, and post returns to suppliers. Each supplier carries its own payment terms and payable balance."
          actionLabel={canWrite ? "Add supplier" : undefined}
          onAction={canWrite ? openAddSupplier : undefined}
        />
      ) : filteredSuppliers.length === 0 ? (
        <StatePanel
          inline
          variant="empty"
          icon={<IconSearch className="tos-state__icon" />}
          title="No matches"
          text="No suppliers match the current filters. Try widening the status or balance filter or clearing the search."
          actionLabel="Clear filters"
          onAction={clearFilters}
        />
      ) : (
        <>
          {/* Mobile: premium tappable supplier cards with balance color stripe */}
          <ul className="tos-list-cards tos-stagger" aria-label="Suppliers">
            {filteredSuppliers.map((s) => {
              const owes = s.balanceMinor > 0;
              const cardCls = owes
                ? "tos-supplier-card tos-supplier-card--owes tos-card-hover tos-animate-fade-in-up"
                : s.active
                  ? "tos-supplier-card tos-supplier-card--settled tos-card-hover tos-animate-fade-in-up"
                  : "tos-supplier-card tos-supplier-card--neutral tos-card-hover tos-animate-fade-in-up";
              const balanceCls = owes
                ? "tos-supplier-card__balance tos-supplier-card__balance--owes"
                : "tos-supplier-card__balance tos-supplier-card__balance--settled";
              return (
                <li key={s.id}>
                  <div className={`tos-selectable-card ${selectedIds.has(s.id) ? "tos-selectable-card--selected" : ""}`}>
                    {canWrite ? (
                      <label className="tos-row-select tos-row-select--card">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelection(s.id)}
                          aria-label={`Select ${s.name}`}
                        />
                      </label>
                    ) : null}
                    <button
                      type="button"
                      className={cardCls}
                      onClick={() => openSupplier(s)}
                      aria-label={`Open ${s.name}`}
                    >
                    <span className="tos-supplier-card__avatar" aria-hidden="true">{initialOf(s.name)}</span>
                    <span className="tos-supplier-card__body">
                      <span className="tos-supplier-card__name">{s.name}</span>
                      <span className="tos-supplier-card__sub">
                        {s.phone ?? "No phone"} · {s.email ?? "No email"}
                      </span>
                      <span className="tos-supplier-card__sub">
                        {s.paymentTermsDays !== null ? `${s.paymentTermsDays} day terms` : "No credit terms"}
                      </span>
                    </span>
                    <span className="tos-supplier-card__meta">
                      {owes ? (
                        <MoneyValue minor={s.balanceMinor} currencyCode={currencyCode} className={balanceCls} />
                      ) : (
                        <span className={balanceCls}>Settled</span>
                      )}
                      <span className={`tos-badge ${s.active ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                        <span className="tos-badge__dot" />{s.active ? "Active" : "Inactive"}
                      </span>
                    </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop: clean table with balance + terms + status */}
          <div className="tos-table-wrap tos-table-wrap--desktop">
            <div className="tos-table-scroll">
              <table className="tos-table">
                <thead>
                  <tr>
                    {canWrite ? (
                      <th className="tos-table__select-col">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleAllFiltered}
                          aria-label="Select all visible suppliers"
                        />
                      </th>
                    ) : null}
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Terms</th>
                    <th data-align="right">Balance owed</th>
                    <th data-align="center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((s) => (
                    <tr key={s.id} data-clickable="true" data-selected={selectedIds.has(s.id) ? "true" : undefined} onClick={() => openSupplier(s)}>
                      {canWrite ? (
                        <td className="tos-table__select-col" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(s.id)}
                            onChange={() => toggleSelection(s.id)}
                            aria-label={`Select ${s.name}`}
                          />
                        </td>
                      ) : null}
                      <td>
                        <div className="tos-table__cell-main">
                          <span className="tos-table__cell-title">{s.name}</span>
                        </div>
                      </td>
                      <td className="tos-table__muted">{s.phone ?? "—"}</td>
                      <td className="tos-table__muted">{s.email ?? "—"}</td>
                      <td className="tos-table__muted">{s.paymentTermsDays !== null ? `${s.paymentTermsDays} days` : "—"}</td>
                      <td data-align="right" className="tos-table__num">
                        {s.balanceMinor > 0 ? (
                          <MoneyValue minor={s.balanceMinor} currencyCode={currencyCode} tone="negative" />
                        ) : (
                          <span className="tos-table__muted">Settled</span>
                        )}
                      </td>
                      <td data-align="center">
                        <span className={`tos-badge ${s.active ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                          <span className="tos-badge__dot" />{s.active ? "Active" : "Inactive"}
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

      {/* Recent purchase receipts section */}
      <section className="tos-section" style={{ marginTop: "var(--tos-space-5)" }}>
        <div className="tos-section__head">
          <h2 className="tos-section__title">Recent purchase receipts</h2>
          <span className="tos-section__sub">Tap a receipt to view lines, returns, and post supplier returns</span>
        </div>
        <div className="tos-section__body">
          {purchasesLoading ? (
            <StatePanel inline variant="loading" />
          ) : purchasesError ? (
            <StatePanel inline variant="error" text={purchasesError} actionLabel="Retry" onAction={() => refetchPurchases()} />
          ) : purchases.length === 0 ? (
            <StatePanel
              inline
              variant="empty"
              icon={<IconReceipt className="tos-state__icon" />}
              title="No purchases yet"
              text="Record a purchase receipt to receive stock. Inventory value and cashbook records will update automatically."
              actionLabel={canWrite ? "Record receipt" : undefined}
              onAction={canWrite ? () => setReceiptOpen(true) : undefined}
            />
          ) : (
            <>
              {/* Mobile: premium purchase cards */}
              <ul className="tos-list-cards tos-stagger" aria-label="Purchase receipts">
                {purchases.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="tos-purchase-card tos-card-hover tos-animate-fade-in-up"
                      onClick={() => setPurchaseDetailId(p.id)}
                      aria-label={`Open receipt ${p.id.slice(0, 8)}`}
                    >
                      <span className="tos-purchase-card__icon" aria-hidden="true">
                        <IconReceipt style={{ width: 20, height: 20 }} />
                      </span>
                      <span className="tos-purchase-card__body">
                        <span className="tos-purchase-card__title">{p.supplierName}</span>
                        <span className="tos-purchase-card__sub">
                          {p.supplierReference ? `Ref ${p.supplierReference}` : `Receipt #${p.id.slice(0, 8)}`}
                        </span>
                        <span className="tos-purchase-card__row">
                          <span className="tos-purchase-card__lines">{p.lineCount} line(s)</span>
                          <span className="tos-purchase-card__lines">·</span>
                          <span className="tos-purchase-card__lines">{p.settlementMethod}</span>
                          {p.receiverName ? (
                            <>
                              <span className="tos-purchase-card__lines">·</span>
                              <span className="tos-purchase-card__lines">{p.receiverName}</span>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <span className="tos-purchase-card__meta">
                        <MoneyValue minor={p.totalMinor} currencyCode={p.currencyCode ?? currencyCode} className="tos-purchase-card__total" />
                        <span className="tos-purchase-card__date">{new Date(p.receivedAt).toLocaleDateString()}</span>
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
                        <th>Receipt</th>
                        <th>Supplier</th>
                        <th>Reference</th>
                        <th>Settlement</th>
                        <th data-align="right">Total</th>
                        <th data-align="right">Lines</th>
                        <th>Received</th>
                        <th>Receiver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchases.map((p) => (
                        <tr key={p.id} data-clickable="true" onClick={() => setPurchaseDetailId(p.id)}>
                          <td className="tos-table__mono">{p.id.slice(0, 8)}</td>
                          <td>
                            <div className="tos-table__cell-main">
                              <span className="tos-table__cell-title">{p.supplierName}</span>
                            </div>
                          </td>
                          <td className="tos-table__mono">{p.supplierReference ?? "—"}</td>
                          <td className="tos-table__muted">{p.settlementMethod}</td>
                          <td data-align="right" className="tos-table__num">
                            <MoneyValue minor={p.totalMinor} currencyCode={p.currencyCode ?? currencyCode} tone="muted" />
                          </td>
                          <td data-align="right" className="tos-table__muted">{p.lineCount}</td>
                          <td className="tos-table__muted">{new Date(p.receivedAt).toLocaleDateString()}</td>
                          <td className="tos-table__muted">{p.receiverName ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Payables callout — guides users to record supplier payments */}
      {stats.owesCount > 0 ? (
        <div className="tos-callout tos-callout--warning">
          <span className="tos-callout__icon-wrap" aria-hidden="true">
            <IconWallet style={{ width: 16, height: 16 }} />
          </span>
          <span className="tos-callout__body">
            {stats.owesCount} supplier(s) are owed a total payable balance.
            <span className="tos-callout__sub"> Open a supplier to record a payment and the outstanding balance will update automatically.</span>
          </span>
        </div>
      ) : null}

      <SupplierSheet supplier={selected} onClose={() => setSelected(null)} onMutated={() => { bump(); setNonce((n) => n + 1); }} />
      <SupplierFormSheet open={formOpen} onClose={() => setFormOpen(false)} onCreated={() => { setFormOpen(false); bump(); setNonce((n) => n + 1); }} />
      <PurchaseReceiptBuilder open={receiptOpen} suppliers={suppliers} onClose={() => setReceiptOpen(false)} onComplete={() => { setReceiptOpen(false); bump(); setNonce((n) => n + 1); }} />
      <PurchaseDetailSheet purchaseId={purchaseDetailId} onClose={() => setPurchaseDetailId(null)} onMutated={() => { bump(); setNonce((n) => n + 1); }} />
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
