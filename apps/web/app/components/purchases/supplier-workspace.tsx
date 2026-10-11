"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { SupplierSheet, SupplierFormSheet, type Supplier } from "./supplier-sheet";
import { PurchaseReceiptBuilder } from "./purchase-receipt-builder";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconPlus, IconRefresh, IconSearch } from "../ui/icons";

interface SuppliersResponse { suppliers: Supplier[] }

export function SupplierWorkspace() {
  const { session, role, bump } = useWorkspace();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  const path = session ? `/v1/suppliers?businessId=${encodeURIComponent(session.businessId)}` : null;
  const { data, loading, error, refetch } = useApiFetch<SuppliersResponse>(path);

  useEffect(() => {
    // re-fetch when nonce changes
    if (nonce > 0) refetch();
  }, [nonce, refetch]);

  const canWrite = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "INVENTORY"].includes(role);

  const suppliers = data?.suppliers ?? [];
  const filtered = query.trim()
    ? suppliers.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()) || (s.phone ?? "").includes(query.trim()))
    : suppliers;

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Inventory</span>
          <h1 className="tos-page__title">Purchases &amp; suppliers</h1>
          <p className="tos-page__subtitle">Receive stock from suppliers and track payables. Costs flow into the cashbook and inventory valuation.</p>
        </div>
        <div className="tos-page__actions">
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => setNonce((n) => n + 1)}>Refresh</Button>
          {canWrite ? (
            <>
              <Button variant="outline" icon={<IconPlus className="tos-btn__icon" />} onClick={() => setFormOpen(true)}>Add supplier</Button>
              <Button variant="gold" icon={<IconPlus className="tos-btn__icon" />} onClick={() => setReceiptOpen(true)}>Record receipt</Button>
            </>
          ) : null}
        </div>
      </header>

      <div className="tos-toolbar">
        <div className="tos-toolbar__search">
          <IconSearch className="tos-toolbar__search-icon" />
          <input
            type="search"
            className="tos-toolbar__search-input"
            placeholder="Search suppliers…"
            aria-label="Search suppliers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="tos-toolbar__spacer" />
        <span className="tos-section__sub">{filtered.length} supplier(s)</span>
      </div>

      {loading ? (
        <div className="tos-card tos-card--padded"><StatePanel inline variant="loading" /></div>
      ) : error ? (
        <StatePanel variant="error" title="Could not load suppliers" text={error} actionLabel="Retry" onAction={() => refetch()} />
      ) : suppliers.length === 0 ? (
        <StatePanel
          variant="empty"
          title="No suppliers yet"
          text="Add suppliers so you can record purchase receipts and track payables."
          actionLabel={canWrite ? "Add supplier" : undefined}
          onAction={canWrite ? () => setFormOpen(true) : undefined}
        />
      ) : filtered.length === 0 ? (
        <StatePanel inline variant="empty" title="No matches" text={`No suppliers match "${query}".`} />
      ) : (
        <div className="tos-table-wrap">
          <div className="tos-table-scroll">
            <table className="tos-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Terms</th>
                  <th data-align="center">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} data-clickable="true" onClick={() => setSelected(s)}>
                    <td><div className="tos-table__cell-main"><span className="tos-table__cell-title">{s.name}</span>{s.email ? <span className="tos-table__cell-sub">{s.email}</span> : null}</div></td>
                    <td className="tos-table__muted">{s.phone ?? "—"}</td>
                    <td className="tos-table__muted">{s.paymentTermsDays !== null ? `${s.paymentTermsDays} days` : "—"}</td>
                    <td data-align="center"><span className={`tos-badge ${s.active ? "tos-badge--positive" : "tos-badge--neutral"}`}><span className="tos-badge__dot" />{s.active ? "Active" : "Inactive"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SupplierSheet supplier={selected} onClose={() => setSelected(null)} />
      <SupplierFormSheet open={formOpen} onClose={() => setFormOpen(false)} onCreated={() => { setFormOpen(false); bump(); setNonce((n) => n + 1); }} />
      <PurchaseReceiptBuilder open={receiptOpen} suppliers={suppliers} onClose={() => setReceiptOpen(false)} onComplete={() => setReceiptOpen(false)} />
    </div>
  );
}
