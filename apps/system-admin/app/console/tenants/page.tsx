import type { ReactNode } from "react";
import { PageHeader, CommandBar, CommandSearch, CommandSelect, CommandButton, CommandSpacer, Banner } from "../../components/admin-ui";
import { AdminTable, CellMain, CellMuted } from "../../components/admin-table";
import { AdminEmptyState } from "../../components/admin-empty-state";
import { Badge } from "../../components/admin-ui";
import { IconBuilding, IconRefresh } from "../../components/icons";

/**
 * Tenant management.
 *
 * The admin tenants endpoint (API-GAP-REGISTER §2) is not implemented, so the
 * table renders zero rows and an honest "pending backend" state. The column
 * schema is fully composed so the data shape is documented and ready.
 */
export default function TenantsPage() {
  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="Tenants"
        title="Tenants"
        subtitle="Businesses, branches, activation, suspension and support access across the platform."
      />

      <Banner tone="info" icon={IconBuilding} title="Admin tenants API pending.">
        <span className="admin-banner__text">
          Tenant list &amp; detail endpoints are not implemented yet (API-GAP-REGISTER §2). The
          table is composed and ready; rows will populate when the endpoint ships.
        </span>
      </Banner>

      <CommandBar>
        <CommandSearch
          placeholder="Search by tenant name or id…"
          label="Search tenants"
          name="q"
        />
        <CommandSelect
          label="Filter by status"
          name="status"
          defaultValue="all"
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "trial", label: "Trial" },
            { value: "suspended", label: "Suspended" },
            { value: "churned", label: "Churned" },
          ]}
        />
        <CommandSelect
          label="Filter by plan"
          name="plan"
          defaultValue="all"
          options={[
            { value: "all", label: "All plans" },
            { value: "starter", label: "Starter" },
            { value: "growth", label: "Growth" },
            { value: "scale", label: "Scale" },
          ]}
        />
        <CommandSpacer />
        <CommandButton icon={IconRefresh} label="Refresh tenant list">
          Refresh
        </CommandButton>
      </CommandBar>

      <AdminTable<TenantRow>
        caption="Tenants"
        columns={tenantColumns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyState={
          <AdminEmptyState
            title="No tenants loaded"
            description="The admin tenants endpoint is pending. Once connected, every business on the platform appears here with status, plan, branch and device counts, and last-seen telemetry."
            icon={IconBuilding}
            pending
          />
        }
      />

      <p className="admin-section__sub">
        Tenant detail (branches, entitlements, billing state, support impersonation) will open in a
        side sheet — a future enhancement once the tenant detail endpoint ships.
      </p>
    </div>
  );
}

/** Intended tenant row shape (documented; populated when the API ships). */
interface TenantRow {
  id: string;
  name: string;
  status: "active" | "trial" | "suspended" | "churned";
  plan: "starter" | "growth" | "scale";
  branches: number;
  devices: number;
  lastSeen: string;
}

function statusTone(status: TenantRow["status"]): "positive" | "info" | "warning" | "neutral" {
  switch (status) {
    case "active":
      return "positive";
    case "trial":
      return "info";
    case "suspended":
      return "warning";
    case "churned":
      return "neutral";
  }
}

const tenantColumns = [
  {
    key: "name",
    header: "Tenant",
    render: (r: TenantRow): ReactNode => (
      <CellMain title={r.name} sub={`ID · ${r.id}`} />
    ),
  },
  {
    key: "status",
    header: "Status",
    width: "120px",
    render: (r: TenantRow): ReactNode => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
  },
  {
    key: "plan",
    header: "Plan",
    width: "110px",
    render: (r: TenantRow): ReactNode => <span className="admin-table__strong">{r.plan}</span>,
  },
  {
    key: "branches",
    header: "Branches",
    width: "100px",
    align: "right" as const,
    render: (r: TenantRow): ReactNode => <span>{r.branches}</span>,
  },
  {
    key: "devices",
    header: "Devices",
    width: "100px",
    align: "right" as const,
    render: (r: TenantRow): ReactNode => <span>{r.devices}</span>,
  },
  {
    key: "lastSeen",
    header: "Last seen",
    width: "160px",
    align: "right" as const,
    render: (r: TenantRow): ReactNode => <CellMuted>{r.lastSeen}</CellMuted>,
  },
];
