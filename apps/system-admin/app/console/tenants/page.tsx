"use client";

import { useMemo, useState, type ReactNode } from "react";
import { PageHeader, CommandBar, CommandSelect, CommandButton, CommandSpacer, Banner, Badge } from "../../components/admin-ui";
import { AdminTable, CellMain, CellMuted } from "../../components/admin-table";
import { AdminEmptyState } from "../../components/admin-empty-state";
import { IconBuilding, IconRefresh } from "../../components/icons";
import { useAdminResource } from "../../components/platform-admin-session";

interface TenantRow {
  id: string;
  name: string;
  businessType: string;
  status: string;
  countryCode: string;
  currencyCode: string;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  branchCount: number;
  deviceCount: number;
  lastSeenAt: string | null;
  updatedAt: string;
}

export default function TenantsPage() {
  const { data, loading, error, reload } = useAdminResource<{ tenants: TenantRow[] }>("/api/admin/tenants");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [plan, setPlan] = useState("all");
  const rows = useMemo(() => (data?.tenants ?? []).filter((tenant) => {
    const q = query.trim().toLowerCase();
    if (q && !`${tenant.name} ${tenant.id} ${tenant.businessType}`.toLowerCase().includes(q)) return false;
    if (status !== "all" && tenant.status.toLowerCase() !== status) return false;
    if (plan !== "all" && (tenant.planCode ?? "none").toLowerCase() !== plan) return false;
    return true;
  }), [data?.tenants, plan, query, status]);

  return (
    <div className="admin-page">
      <PageHeader eyebrow="Tenants" title="Tenants" subtitle="Authoritative businesses, subscription state, branches, registered devices and latest activity across TradeOS." />
      <Banner tone="info" icon={IconBuilding} title="Read-only control plane active.">
        <span className="admin-banner__text">Tenant lifecycle writes remain deliberately disabled in this release. This view reads live platform data only.</span>
      </Banner>
      <CommandBar>
        <div className="admin-commandbar__search">
          <input type="search" className="admin-commandbar__search-input" placeholder="Search by tenant name or id…" aria-label="Search tenants" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <CommandSelect label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)} options={[
          { value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "closed", label: "Closed" },
        ]} />
        <CommandSelect label="Filter by plan" value={plan} onChange={(event) => setPlan(event.target.value)} options={[
          { value: "all", label: "All plans" },
          ...Array.from(new Set((data?.tenants ?? []).map((tenant) => tenant.planCode).filter((value): value is string => Boolean(value)))).sort().map((value) => ({ value: value.toLowerCase(), label: value })),
        ]} />
        <CommandSpacer />
        <CommandButton icon={IconRefresh} label="Refresh tenant list" onClick={() => void reload()}>Refresh</CommandButton>
      </CommandBar>
      {loading ? <div className="admin-api-state" role="status">Loading tenants…</div> : error ? <div className="admin-api-state admin-api-state--error" role="alert">{error}</div> : (
        <AdminTable<TenantRow>
          caption="Tenants"
          columns={tenantColumns}
          rows={rows}
          rowKey={(row) => row.id}
          emptyState={<AdminEmptyState title="No tenants match" description="The live tenant API returned no businesses for the current filters." icon={IconBuilding} />}
        />
      )}
      <p className="admin-section__sub">Showing {rows.length} of {data?.tenants.length ?? 0} loaded tenants. Tenant mutation and support impersonation remain unavailable in the read-plane release.</p>
    </div>
  );
}

function statusTone(status: string): "positive" | "warning" | "neutral" {
  if (status === "ACTIVE") return "positive";
  if (status === "SUSPENDED") return "warning";
  return "neutral";
}

const tenantColumns = [
  { key: "name", header: "Tenant", render: (row: TenantRow): ReactNode => <CellMain title={row.name} sub={`${row.businessType.replaceAll("_", " ")} · ${row.id}`} /> },
  { key: "status", header: "Status", width: "120px", render: (row: TenantRow): ReactNode => <Badge tone={statusTone(row.status)}>{row.status.toLowerCase()}</Badge> },
  { key: "plan", header: "Plan", width: "150px", render: (row: TenantRow): ReactNode => <CellMain title={row.planName ?? "No plan"} sub={row.subscriptionStatus ?? "No subscription"} /> },
  { key: "branches", header: "Branches", width: "100px", align: "right" as const, render: (row: TenantRow): ReactNode => <span>{row.branchCount}</span> },
  { key: "devices", header: "Devices", width: "100px", align: "right" as const, render: (row: TenantRow): ReactNode => <span>{row.deviceCount}</span> },
  { key: "lastSeen", header: "Last seen", width: "180px", align: "right" as const, render: (row: TenantRow): ReactNode => <CellMuted>{formatDate(row.lastSeenAt)}</CellMuted> },
];

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}
