"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Badge, Banner, CommandBar, CommandButton, CommandSelect, CommandSpacer, PageHeader } from "../../components/admin-ui";
import { AdminTable, CellMain, CellMuted } from "../../components/admin-table";
import { AdminEmptyState } from "../../components/admin-empty-state";
import { IconFlag, IconRefresh } from "../../components/icons";
import { useAdminResource } from "../../components/platform-admin-session";

interface FlagRow {
  id: string;
  code: string;
  businessId: string | null;
  businessName: string | null;
  enabled: boolean;
  configuration: Record<string, unknown>;
  updatedByPlatformUserId: string | null;
  updatedAt: string;
}

export default function FlagsPage() {
  const { data, loading, error, reload } = useAdminResource<{ flags: FlagRow[] }>("/api/admin/feature-flags");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [scope, setScope] = useState("all");
  const rows = useMemo(() => (data?.flags ?? []).filter((flag) => {
    const q = query.trim().toLowerCase();
    if (q && !`${flag.code} ${flag.businessName ?? "global"}`.toLowerCase().includes(q)) return false;
    if (status === "on" && !flag.enabled) return false;
    if (status === "off" && flag.enabled) return false;
    if (scope === "global" && flag.businessId) return false;
    if (scope === "tenant" && !flag.businessId) return false;
    return true;
  }), [data?.flags, query, scope, status]);

  return (
    <div className="admin-page">
      <PageHeader eyebrow="Platform" title="Feature flags" subtitle="Live global and tenant-scoped platform flags and their current configuration." />
      <Banner tone="info" icon={IconFlag} title="Feature flags are read-only in this release.">
        <span className="admin-banner__text">Flag mutation remains unavailable until the privileged write plane is implemented and separately audited.</span>
      </Banner>
      <CommandBar>
        <div className="admin-commandbar__search"><input type="search" className="admin-commandbar__search-input" placeholder="Search flag key or tenant…" aria-label="Search feature flags" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <CommandSelect label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)} options={[{ value: "all", label: "All statuses" }, { value: "on", label: "On" }, { value: "off", label: "Off" }]} />
        <CommandSelect label="Filter by scope" value={scope} onChange={(event) => setScope(event.target.value)} options={[{ value: "all", label: "All scopes" }, { value: "global", label: "Global" }, { value: "tenant", label: "Tenant" }]} />
        <CommandSpacer />
        <CommandButton icon={IconRefresh} label="Refresh feature flags" onClick={() => void reload()}>Refresh</CommandButton>
      </CommandBar>
      {loading ? <div className="admin-api-state" role="status">Loading feature flags…</div> : error ? <div className="admin-api-state admin-api-state--error" role="alert">{error}</div> : (
        <AdminTable<FlagRow> caption="Feature flags" columns={flagColumns} rows={rows} rowKey={(row) => row.id} emptyState={<AdminEmptyState title="No feature flags match" description="The live flag registry is empty for the current filters." icon={IconFlag} />} />
      )}
    </div>
  );
}

const flagColumns = [
  { key: "code", header: "Flag key", width: "240px", render: (row: FlagRow): ReactNode => <span className="admin-table__mono">{row.code}</span> },
  { key: "scope", header: "Scope", render: (row: FlagRow): ReactNode => <CellMain title={row.businessName ?? "Global"} sub={row.businessId ?? "All tenants"} /> },
  { key: "status", header: "Status", width: "120px", render: (row: FlagRow): ReactNode => <Badge tone={row.enabled ? "positive" : "neutral"}>{row.enabled ? "on" : "off"}</Badge> },
  { key: "configuration", header: "Configuration", width: "280px", render: (row: FlagRow): ReactNode => <CellMuted>{compact(row.configuration)}</CellMuted> },
  { key: "updated", header: "Updated", width: "180px", align: "right" as const, render: (row: FlagRow): ReactNode => <CellMuted>{new Date(row.updatedAt).toLocaleString()}</CellMuted> },
];

function compact(configuration: Record<string, unknown>): string {
  const text = JSON.stringify(configuration ?? {});
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}
