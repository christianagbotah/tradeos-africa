"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Badge, CommandBar, CommandButton, CommandSpacer, PageHeader } from "../../components/admin-ui";
import { AdminTable, CellMain, CellMuted } from "../../components/admin-table";
import { AdminEmptyState } from "../../components/admin-empty-state";
import { IconAudit, IconRefresh } from "../../components/icons";
import { useAdminResource } from "../../components/platform-admin-session";

interface AuditRow {
  id: string;
  platformUserId: string | null;
  platformUserDisplayName: string | null;
  businessId: string | null;
  businessName: string | null;
  eventType: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export default function AuditPage() {
  const { data, loading, error, reload } = useAdminResource<{ events: AuditRow[] }>("/api/admin/audit-events?limit=200");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => (data?.events ?? []).filter((event) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${event.platformUserDisplayName ?? "system"} ${event.businessName ?? ""} ${event.eventType} ${event.entityType} ${event.entityId ?? ""} ${event.reason ?? ""}`.toLowerCase().includes(q);
  }), [data?.events, query]);

  return (
    <div className="admin-page">
      <PageHeader eyebrow="Operations" title="Platform audit log" subtitle="Privileged control-plane events from the authoritative platform audit stream." />
      <CommandBar>
        <div className="admin-commandbar__search"><input type="search" className="admin-commandbar__search-input" placeholder="Search actor, tenant, event or entity…" aria-label="Search audit events" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <CommandSpacer />
        <CommandButton icon={IconRefresh} label="Refresh audit log" onClick={() => void reload()}>Refresh</CommandButton>
      </CommandBar>
      {loading ? <div className="admin-api-state" role="status">Loading audit events…</div> : error ? <div className="admin-api-state admin-api-state--error" role="alert">{error}</div> : (
        <AdminTable<AuditRow>
          caption="Audit events"
          columns={auditColumns}
          rows={rows}
          rowKey={(row) => row.id}
          scrollable
          maxHeight="560px"
          emptyState={<AdminEmptyState title="No audit events match" description="The platform audit stream is empty for the current search." icon={IconAudit} />}
        />
      )}
    </div>
  );
}

const auditColumns = [
  { key: "timestamp", header: "Timestamp", width: "180px", render: (row: AuditRow): ReactNode => <span className="admin-table__mono">{new Date(row.occurredAt).toLocaleString()}</span> },
  { key: "actor", header: "Actor", width: "210px", render: (row: AuditRow): ReactNode => <CellMain title={row.platformUserDisplayName ?? "System"} sub={row.platformUserId ?? "No platform user"} /> },
  { key: "eventType", header: "Event type", width: "210px", render: (row: AuditRow): ReactNode => <Badge tone="info" dot={false}>{row.eventType}</Badge> },
  { key: "entity", header: "Entity", render: (row: AuditRow): ReactNode => <CellMain title={`${row.entityType}${row.entityId ? ` · ${row.entityId}` : ""}`} sub={row.businessName ?? row.businessId ?? "Platform-wide"} /> },
  { key: "details", header: "Details", width: "300px", render: (row: AuditRow): ReactNode => <CellMuted>{row.reason ?? compactPayload(row.payload)}</CellMuted> },
];

function compactPayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  if (keys.length === 0) return "No additional metadata";
  const text = JSON.stringify(payload);
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}
