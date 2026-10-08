"use client";

import React, { useEffect, useMemo, useState } from "react";
import { clientApi, messageFrom } from "../../lib/client-api";
import { getFailedMutations, mutationAppliedEvent, queueChangedEvent, type AppliedMutationDetail } from "../../lib/offline-sync";
import { Button } from "../ui/button";
import { SupplierSheet } from "./supplier-sheet";
import { supplierCapabilities, type Supplier, type SupplierDetail } from "./supplier-types";

export type SupplierFilter = "ACTIVE" | "ARCHIVED" | "ALL";
type EditorState = { mode: "create"; supplier: null; detail: null } | { mode: "edit" | "view"; supplier: Supplier; detail: SupplierDetail } | null;

export function filterSuppliers(suppliers: Supplier[], filter: SupplierFilter, query: string): Supplier[] {
  const normalized = query.trim().toLowerCase();
  return suppliers.filter((supplier) => {
    if (filter === "ACTIVE" && !supplier.active) return false;
    if (filter === "ARCHIVED" && supplier.active) return false;
    if (!normalized) return true;
    return [supplier.name, supplier.phone ?? "", supplier.email ?? "", supplier.address ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(normalized);
  });
}

export function SupplierWorkspace({ businessId, branchId, currencyCode, role, suppliers, onRefresh }: {
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
  suppliers: Supplier[];
  onRefresh: () => Promise<void> | void;
}) {
  const capabilities = supplierCapabilities(role);
  const [filter, setFilter] = useState<SupplierFilter>("ACTIVE");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncFailure, setSyncFailure] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    const refreshFailures = () => {
      const latest = getFailedMutations().filter((entry) => entry.mutation.businessId === businessId && ["SUPPLIER_CREATE", "SUPPLIER_UPDATE"].includes(entry.mutation.mutationType)).at(-1);
      if (!latest) { setSyncFailure(null); return; }
      setSyncFailure(latest.result.errorCode === "STALE_VERSION"
        ? "A supplier edit could not sync because this supplier changed on another device. Refresh the supplier and review the latest details before retrying."
        : `Supplier sync needs review: ${latest.result.errorMessage ?? latest.result.errorCode ?? "change rejected"}`);
    };
    const onApplied = (event: Event) => {
      const detail = (event as CustomEvent<AppliedMutationDetail>).detail;
      if (!detail || detail.businessId !== businessId || !["SUPPLIER_CREATE", "SUPPLIER_UPDATE"].includes(detail.mutationType)) return;
      refreshFailures();
      void onRefresh();
    };
    refreshFailures();
    window.addEventListener(mutationAppliedEvent, onApplied);
    window.addEventListener(queueChangedEvent, refreshFailures);
    return () => {
      window.removeEventListener(mutationAppliedEvent, onApplied);
      window.removeEventListener(queueChangedEvent, refreshFailures);
    };
  }, [businessId, onRefresh]);

  const visible = useMemo(() => filterSuppliers(suppliers, filter, query), [filter, query, suppliers]);
  const counts = useMemo(() => ({
    ACTIVE: suppliers.filter((supplier) => supplier.active).length,
    ARCHIVED: suppliers.filter((supplier) => !supplier.active).length,
    ALL: suppliers.length,
  }), [suppliers]);

  const openSupplier = async (supplier: Supplier) => {
    setLoadingId(supplier.id);
    setMessage(null);
    try {
      if (!navigator.onLine) {
        setEditor({ mode: capabilities.canEdit ? "edit" : "view", supplier, detail: { supplier, obligations: [], ledger: [] } });
        setMessage("Offline: showing saved supplier summary. Detailed payable history requires a connection until it has been cached.");
        return;
      }
      const detail = await clientApi<SupplierDetail>(`/api/tradeos/v1/suppliers/${supplier.id}?businessId=${encodeURIComponent(businessId)}`);
      setEditor({ mode: capabilities.canEdit ? "edit" : "view", supplier: detail.supplier, detail });
    } catch (reason) {
      setMessage(messageFrom(reason));
    } finally {
      setLoadingId(null);
    }
  };

  const changed = async () => {
    await onRefresh();
  };

  return (
    <section className="supplier-workspace" data-business-id={businessId} data-branch-id={branchId}>
      <div className="supplier-commandbar">
        <label className="supplier-search">
          <span>Search suppliers</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search suppliers" aria-label="Search suppliers" />
        </label>
        {capabilities.canCreate ? <Button type="button" onClick={() => setEditor({ mode: "create", supplier: null, detail: null })}>Add supplier</Button> : null}
      </div>

      <div className="supplier-filterbar" role="tablist" aria-label="Supplier filters">
        {([[
          "ACTIVE", "Active",
        ], ["ARCHIVED", "Archived"], ["ALL", "All"]] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : undefined} onClick={() => setFilter(value)}>
            <span>{label}</span><strong>{counts[value]}</strong>
          </button>
        ))}
      </div>

      <div className="supplier-list">
        {visible.length === 0 ? <div className="supplier-empty-state"><strong>No suppliers match this view.</strong><span>Change the search or lifecycle filter.</span></div> : visible.map((supplier) => (
          <article className={supplier.active ? "supplier-row" : "supplier-row supplier-row--archived"} key={supplier.id}>
            <div className="supplier-row-main">
              <div className="supplier-avatar">{supplier.name.slice(0, 2).toUpperCase()}</div>
              <div><strong>{supplier.name}</strong><span>{supplier.phone ?? supplier.email ?? supplier.address ?? "No contact details"}</span></div>
            </div>
            <div className="supplier-row-fact"><span>Payable</span><strong>{supplier.balanceMinor < 0 ? `Credit ${formatMoney(-supplier.balanceMinor, currencyCode)}` : formatMoney(supplier.balanceMinor, currencyCode)}</strong></div>
            <div className="supplier-row-fact"><span>Terms</span><strong>Net {supplier.paymentTermsDays} day{supplier.paymentTermsDays === 1 ? "" : "s"}</strong></div>
            <div className="supplier-row-status"><span className={supplier.active ? "supplier-status supplier-status--active" : "supplier-status"}>{supplier.active ? "Active" : "Inactive"}</span></div>
            <Button variant="secondary" type="button" disabled={loadingId === supplier.id} onClick={() => void openSupplier(supplier)}>{loadingId === supplier.id ? "Opening…" : capabilities.canEdit ? "Manage" : "View"}</Button>
          </article>
        ))}
      </div>

      {message ? <div className="supplier-workspace-message" role="status">{message}</div> : null}
      {syncFailure ? <div className="supplier-workspace-message" role="alert">{syncFailure}</div> : null}

      {editor ? <SupplierSheet
        mode={editor.mode}
        supplier={editor.supplier}
        detail={editor.detail}
        open
        businessId={businessId}
        branchId={branchId}
        currencyCode={currencyCode}
        role={role}
        onClose={() => setEditor(null)}
        onChanged={changed}
      /> : null}
    </section>
  );
}

function formatMoney(minor: number, currencyCode: string): string {
  return currencyCode === "GHS"
    ? `₵${(minor / 100).toFixed(2)}`
    : new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100);
}
