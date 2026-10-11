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
import { IconFlag, IconPlus, IconRefresh } from "../../components/icons";

/**
 * Feature flags.
 *
 * The admin feature-flags endpoint (API-GAP-REGISTER §5) is not implemented.
 * The flag table renders an honest "pending backend" state.
 */
export default function FlagsPage() {
  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="Platform"
        title="Feature flags"
        subtitle="Module licensing, limits, overrides and platform-wide toggles scoped per tenant, plan or globally."
        actions={
          <CommandButton icon={IconPlus} label="Create a new feature flag">
            New flag
          </CommandButton>
        }
      />

      <Banner tone="info" icon={IconFlag} title="Feature flags pending backend.">
        <span className="admin-banner__text">
          The admin feature-flags endpoint (API-GAP-REGISTER §5) is not implemented. The flag table
          is composed and ready; rows populate when the flag service is connected.
        </span>
      </Banner>

      <CommandBar>
        <CommandSearch
          placeholder="Search by flag key or description…"
          label="Search feature flags"
          name="q"
        />
        <CommandSelect
          label="Filter by status"
          name="status"
          defaultValue="all"
          options={[
            { value: "all", label: "All statuses" },
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
            { value: "gradual", label: "Gradual rollout" },
          ]}
        />
        <CommandSelect
          label="Filter by scope"
          name="scope"
          defaultValue="all"
          options={[
            { value: "all", label: "All scopes" },
            { value: "global", label: "Global" },
            { value: "plan", label: "Plan" },
            { value: "tenant", label: "Tenant" },
          ]}
        />
        <CommandSpacer />
        <CommandButton icon={IconRefresh} label="Refresh feature flags">
          Refresh
        </CommandButton>
      </CommandBar>

      <AdminTable<FlagRow>
        caption="Feature flags"
        columns={flagColumns}
        rows={[]}
        rowKey={(r) => r.key}
        emptyState={
          <AdminEmptyState
            title="Feature flags pending backend"
            description="No flags loaded. Once the admin feature-flags endpoint is connected, every platform toggle appears here with its key, description, status (on / off / gradual rollout) and scope (global, plan, tenant)."
            icon={IconFlag}
            pending
          />
        }
      />
    </div>
  );
}

interface FlagRow {
  key: string;
  description: string;
  status: "on" | "off" | "gradual";
  scope: "global" | "plan" | "tenant";
}

function statusTone(s: FlagRow["status"]): "positive" | "neutral" | "info" {
  switch (s) {
    case "on":
      return "positive";
    case "off":
      return "neutral";
    case "gradual":
      return "info";
  }
}

const flagColumns = [
  {
    key: "key",
    header: "Flag key",
    width: "240px",
    render: (r: FlagRow): ReactNode => <span className="admin-table__mono">{r.key}</span>,
  },
  {
    key: "description",
    header: "Description",
    render: (r: FlagRow): ReactNode => <CellMain title={r.description} sub="What this flag controls" />,
  },
  {
    key: "status",
    header: "Status",
    width: "150px",
    render: (r: FlagRow): ReactNode => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
  },
  {
    key: "scope",
    header: "Scope",
    width: "120px",
    render: (r: FlagRow): ReactNode => <CellMuted>{r.scope}</CellMuted>,
  },
];
