"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { SupplierSheet, SupplierFormSheet, type Supplier } from "./supplier-sheet";
import { PurchaseReceiptBuilder } from "./purchase-receipt-builder";
import { PurchaseDetailSheet } from "./purchase-detail-sheet";
import { MoneyValue } from "../business/money-value";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import { IconPlus, IconRefresh, IconSearch } from "../ui/icons";

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

export function SupplierWorkspace() {
  const { session, role, bump } = useWorkspace();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [purchaseDetailId, setPurchaseDetailId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

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

  const suppliers = suppliersData?.suppliers ?? [];
  const filtered = query.trim()
    ? suppliers.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()) || (s.phone ?? "").includes(query.trim()))
    : suppliers;
  const purchases = purchasesData?.purchases ?? [];
  const currencyCode = session?.currencyCode ?? "GHS";

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Inventory</span>
          <h1 className="tos-page__title">Purchases &amp; suppliers</h1>
          <p className="tos-page__subtitle">Receive stock from suppliers, track payables, and return faulty goods. Costs flow into the cashbook and inventory valuation.</p>
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

      {suppliersLoading ? (
        <div className="tos-card tos-card--padded"><StatePanel inline variant="loading" /></div>
      ) : suppliersError ? (
        <StatePanel variant="error" title="Could not load suppliers" text={suppliersError} actionLabel="Retry" onAction={() => refetchSuppliers()} />
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

      <section className="tos-section" style={{ marginTop: "var(--tos-space-5)" }}>
        <div className="tos-section__head">
          <h2 className="tos-section__title">Recent purchase receipts</h2>
          <span className="tos-section__sub">Tap a row to view detail and post returns</span>
        </div>
        <div className="tos-section__body">
          {purchasesLoading ? (
            <StatePanel inline variant="loading" />
          ) : purchasesError ? (
            <StatePanel inline variant="error" text={purchasesError} actionLabel="Retry" onAction={() => refetchPurchases()} />
          ) : purchases.length === 0 ? (
            <StatePanel inline variant="empty" title="No purchases yet" text="Record a purchase receipt to see it here. Stock and cashbook will update automatically." />
          ) : (
            <div className="tos-table-wrap">
              <div className="tos-table-scroll">
                <table className="tos-table">
                  <thead>
                    <tr>
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
                        <td><div className="tos-table__cell-main"><span className="tos-table__cell-title">{p.supplierName}</span></div></td>
                        <td className="tos-table__mono">{p.supplierReference ?? "—"}</td>
                        <td className="tos-table__muted">{p.settlementMethod}</td>
                        <td data-align="right" className="tos-table__num"><MoneyValue minor={p.totalMinor} currencyCode={p.currencyCode ?? currencyCode} tone="muted" /></td>
                        <td data-align="right" className="tos-table__muted">{p.lineCount}</td>
                        <td className="tos-table__muted">{new Date(p.receivedAt).toLocaleDateString()}</td>
                        <td className="tos-table__muted">{p.receiverName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      <SupplierSheet supplier={selected} onClose={() => setSelected(null)} onMutated={() => { bump(); setNonce((n) => n + 1); }} />
      <SupplierFormSheet open={formOpen} onClose={() => setFormOpen(false)} onCreated={() => { setFormOpen(false); bump(); setNonce((n) => n + 1); }} />
      <PurchaseReceiptBuilder open={receiptOpen} suppliers={suppliers} onClose={() => setReceiptOpen(false)} onComplete={() => { setReceiptOpen(false); bump(); setNonce((n) => n + 1); }} />
      <PurchaseDetailSheet purchaseId={purchaseDetailId} onClose={() => setPurchaseDetailId(null)} onMutated={() => { bump(); setNonce((n) => n + 1); }} />
    </div>
  );
}
