import type { ReactNode } from "react";
import {
  Banner,
  Badge,
  CommandBar,
  CommandButton,
  CommandSearch,
  CommandSelect,
  CommandSpacer,
  PageHeader,
} from "../../components/admin-ui";
import { AdminTable, CellMain, CellMuted } from "../../components/admin-table";
import { AdminEmptyState } from "../../components/admin-empty-state";
import { IconAudit, IconRefresh } from "../../components/icons";

/**
 * Platform audit log.
 *
 * The admin audit-events endpoint (API-GAP-REGISTER §3) is not implemented.
 * The filter bar and audit table render honest "pending backend" states.
 */
export default function AuditPage() {
  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="Operations"
        title="Platform audit log"
        subtitle="Privileged actions, support access and system configuration changes across the control plane."
      />

      <Banner tone="warning" icon={IconAudit} title="Audit events pending backend.">
        <span className="admin-banner__text">
          The admin audit-events endpoint (API-GAP-REGISTER §3) is not implemented. Audit capture
          begins once the control-plane API lands; until then this view is intentionally empty.
        </span>
      </Banner>

      <CommandBar>
        <CommandSearch
          placeholder="Search by actor or entity…"
          label="Search audit events"
          name="q"
        />
        <CommandSelect
          label="Filter by event type"
          name="eventType"
          defaultValue="all"
          options={[
            { value: "all", label: "All event types" },
            { value: "tenant.activated", label: "Tenant · activated" },
            { value: "tenant.suspended", label: "Tenant · suspended" },
            { value: "support.impersonated", label: "Support · impersonated" },
            { value: "config.changed", label: "Config · changed" },
            { value: "flag.toggled", label: "Flag · toggled" },
            { value: "release.published", label: "Release · published" },
          ]}
        />
        <CommandSelect
          label="Filter by actor role"
          name="actor"
          defaultValue="all"
          options={[
            { value: "all", label: "All actors" },
            { value: "super-admin", label: "Super admin" },
            { value: "support", label: "Support" },
            { value: "compliance", label: "Compliance" },
            { value: "billing", label: "Billing" },
            { value: "system", label: "System" },
          ]}
        />
        <CommandSelect
          label="Date range"
          name="range"
          defaultValue="7d"
          options={[
            { value: "24h", label: "Last 24 hours" },
            { value: "7d", label: "Last 7 days" },
            { value: "30d", label: "Last 30 days" },
            { value: "90d", label: "Last 90 days" },
          ]}
        />
        <CommandSpacer />
        <CommandButton icon={IconRefresh} label="Refresh audit log">
          Refresh
        </CommandButton>
      </CommandBar>

      <AdminTable<AuditRow>
        caption="Audit events"
        columns={auditColumns}
        rows={[]}
        rowKey={(r) => r.id}
        scrollable
        maxHeight="560px"
        emptyState={
          <AdminEmptyState
            title="Audit events pending backend"
            description="No events loaded. Once the admin audit-events endpoint is connected, every privileged action — impersonation, config changes, flag toggles, releases — appears here with timestamp, actor, event type, affected entity and a details payload."
            icon={IconAudit}
            pending
          />
        }
      />
    </div>
  );
}

interface AuditRow {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: "super-admin" | "support" | "compliance" | "billing" | "system";
  eventType: string;
  entity: string;
  details: string;
}

function roleTone(role: AuditRow["actorRole"]): "warning" | "info" | "neutral" {
  switch (role) {
    case "super-admin":
      return "warning";
    case "system":
      return "neutral";
    default:
      return "info";
  }
}

const auditColumns = [
  {
    key: "timestamp",
    header: "Timestamp",
    width: "180px",
    render: (r: AuditRow): ReactNode => <span className="admin-table__mono">{r.timestamp}</span>,
  },
  {
    key: "actor",
    header: "Actor",
    width: "220px",
    render: (r: AuditRow): ReactNode => (
      <CellMain title={r.actor} sub={<Badge tone={roleTone(r.actorRole)} dot={false}>{r.actorRole}</Badge>} />
    ),
  },
  {
    key: "eventType",
    header: "Event type",
    width: "200px",
    render: (r: AuditRow): ReactNode => <span className="admin-table__strong">{r.eventType}</span>,
  },
  {
    key: "entity",
    header: "Entity",
    render: (r: AuditRow): ReactNode => <CellMain title={r.entity} sub="Affected resource" />,
  },
  {
    key: "details",
    header: "Details",
    width: "260px",
    render: (r: AuditRow): ReactNode => <CellMuted>{r.details}</CellMuted>,
  },
];
