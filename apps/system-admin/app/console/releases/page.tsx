import type { ReactNode } from "react";
import {
  Banner,
  Badge,
  CommandBar,
  CommandButton,
  CommandSelect,
  CommandSpacer,
  PageHeader,
} from "../../components/admin-ui";
import { AdminTable, CellMuted } from "../../components/admin-table";
import { AdminEmptyState } from "../../components/admin-empty-state";
import { IconPlus, IconRelease } from "../../components/icons";

/**
 * Client release management.
 *
 * The admin releases endpoint (API-GAP-REGISTER §6) is not implemented. The
 * release table renders an honest "pending backend" state.
 */
export default function ReleasesPage() {
  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="Platform"
        title="Client releases"
        subtitle="Track web, Windows, macOS, Android and iOS versions and enforce minimum-supported builds across the platform."
        actions={
          <CommandButton icon={IconPlus} label="Publish a new release">
            New release
          </CommandButton>
        }
      />

      <Banner tone="info" icon={IconRelease} title="Release tracking pending backend.">
        <span className="admin-banner__text">
          The admin releases endpoint (API-GAP-REGISTER §6) is not implemented. The release table
          is composed and ready; rows populate when version tracking is connected.
        </span>
      </Banner>

      <CommandBar>
        <CommandSelect
          label="Filter by platform"
          name="platform"
          defaultValue="all"
          options={[
            { value: "all", label: "All platforms" },
            { value: "web", label: "Web" },
            { value: "windows", label: "Windows" },
            { value: "macos", label: "macOS" },
            { value: "android", label: "Android" },
            { value: "ios", label: "iOS" },
          ]}
        />
        <CommandSelect
          label="Filter by status"
          name="status"
          defaultValue="all"
          options={[
            { value: "all", label: "All statuses" },
            { value: "current", label: "Current" },
            { value: "rolling", label: "Rolling out" },
            { value: "supported", label: "Supported" },
            { value: "deprecated", label: "Deprecated" },
            { value: "blocked", label: "Blocked" },
          ]}
        />
        <CommandSpacer />
        <CommandButton icon={IconRelease} label="Refresh release list">
          Refresh
        </CommandButton>
      </CommandBar>

      <AdminTable<ReleaseRow>
        caption="Client releases"
        columns={releaseColumns}
        rows={[]}
        rowKey={(r) => `${r.platform}-${r.version}`}
        emptyState={
          <AdminEmptyState
            title="Release tracking pending backend"
            description="No releases loaded. Once the admin releases endpoint is connected, every published client build appears here with platform, version, minimum-supported build, release date and rollout status."
            icon={IconRelease}
            pending
          />
        }
      />
    </div>
  );
}

interface ReleaseRow {
  platform: "web" | "windows" | "macos" | "android" | "ios";
  version: string;
  minimumSupported: string;
  releaseDate: string;
  status: "current" | "rolling" | "supported" | "deprecated" | "blocked";
}

function statusTone(s: ReleaseRow["status"]): "positive" | "info" | "warning" | "neutral" | "danger" {
  switch (s) {
    case "current":
      return "positive";
    case "rolling":
      return "info";
    case "supported":
      return "neutral";
    case "deprecated":
      return "warning";
    case "blocked":
      return "danger";
  }
}

const releaseColumns = [
  {
    key: "platform",
    header: "Platform",
    width: "140px",
    render: (r: ReleaseRow): ReactNode => (
      <span className="admin-table__strong">{r.platform}</span>
    ),
  },
  {
    key: "version",
    header: "Version",
    width: "160px",
    render: (r: ReleaseRow): ReactNode => <span className="admin-table__mono">{r.version}</span>,
  },
  {
    key: "minimumSupported",
    header: "Minimum supported",
    width: "180px",
    render: (r: ReleaseRow): ReactNode => (
      <span className="admin-table__mono">{r.minimumSupported}</span>
    ),
  },
  {
    key: "releaseDate",
    header: "Release date",
    width: "170px",
    align: "right" as const,
    render: (r: ReleaseRow): ReactNode => <CellMuted>{r.releaseDate}</CellMuted>,
  },
  {
    key: "status",
    header: "Status",
    width: "150px",
    render: (r: ReleaseRow): ReactNode => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
  },
];
