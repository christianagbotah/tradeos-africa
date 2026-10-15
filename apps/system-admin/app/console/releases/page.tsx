"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Badge, CommandBar, CommandButton, CommandSelect, CommandSpacer, PageHeader, Banner } from "../../components/admin-ui";
import { AdminTable, CellMuted } from "../../components/admin-table";
import { AdminEmptyState } from "../../components/admin-empty-state";
import { IconRelease } from "../../components/icons";
import { useAdminResource } from "../../components/platform-admin-session";

interface ReleaseRow {
  id: string;
  platform: string;
  version: string;
  buildNumber: string | null;
  releaseChannel: string;
  status: string;
  minimumSupportedVersion: string | null;
  rolloutPercent: number;
  releaseNotes: string | null;
  releasedAt: string | null;
  createdAt: string;
}

export default function ReleasesPage() {
  const { data, loading, error, reload } = useAdminResource<{ releases: ReleaseRow[] }>("/api/admin/releases");
  const [platform, setPlatform] = useState("all");
  const [status, setStatus] = useState("all");
  const rows = useMemo(() => (data?.releases ?? []).filter((release) => {
    if (platform !== "all" && release.platform.toLowerCase() !== platform) return false;
    if (status !== "all" && release.status.toLowerCase() !== status) return false;
    return true;
  }), [data?.releases, platform, status]);

  return (
    <div className="admin-page">
      <PageHeader eyebrow="Platform" title="Client releases" subtitle="Read-only release inventory for web, desktop and mobile clients, including minimum-supported versions and rollout state." />
      <Banner tone="info" icon={IconRelease} title="Release publishing is intentionally unavailable.">
        <span className="admin-banner__text">This milestone reads live release metadata only. Publishing, withdrawal and minimum-version changes follow in the write-plane release.</span>
      </Banner>
      <CommandBar>
        <CommandSelect label="Filter by platform" value={platform} onChange={(event) => setPlatform(event.target.value)} options={[
          { value: "all", label: "All platforms" }, { value: "web", label: "Web" }, { value: "windows", label: "Windows" }, { value: "macos", label: "macOS" }, { value: "android", label: "Android" }, { value: "ios", label: "iOS" },
        ]} />
        <CommandSelect label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)} options={[
          { value: "all", label: "All statuses" }, { value: "draft", label: "Draft" }, { value: "rollout", label: "Rollout" }, { value: "active", label: "Active" }, { value: "withdrawn", label: "Withdrawn" },
        ]} />
        <CommandSpacer />
        <CommandButton icon={IconRelease} label="Refresh release list" onClick={() => void reload()}>Refresh</CommandButton>
      </CommandBar>
      {loading ? <div className="admin-api-state" role="status">Loading client releases…</div> : error ? <div className="admin-api-state admin-api-state--error" role="alert">{error}</div> : (
        <AdminTable<ReleaseRow> caption="Client releases" columns={releaseColumns} rows={rows} rowKey={(row) => row.id} emptyState={<AdminEmptyState title="No releases match" description="The live release registry is empty for the current filters." icon={IconRelease} />} />
      )}
    </div>
  );
}

function statusTone(status: string): "positive" | "info" | "neutral" | "warning" {
  if (status === "ACTIVE") return "positive";
  if (status === "ROLLOUT") return "info";
  if (status === "WITHDRAWN") return "warning";
  return "neutral";
}

const releaseColumns = [
  { key: "platform", header: "Platform", width: "140px", render: (row: ReleaseRow): ReactNode => <span className="admin-table__strong">{row.platform}</span> },
  { key: "version", header: "Version", width: "170px", render: (row: ReleaseRow): ReactNode => <span className="admin-table__mono">{row.version}{row.buildNumber ? ` (${row.buildNumber})` : ""}</span> },
  { key: "minimum", header: "Minimum supported", width: "180px", render: (row: ReleaseRow): ReactNode => <span className="admin-table__mono">{row.minimumSupportedVersion ?? "—"}</span> },
  { key: "rollout", header: "Rollout", width: "110px", align: "right" as const, render: (row: ReleaseRow): ReactNode => <span>{row.rolloutPercent}%</span> },
  { key: "date", header: "Released", width: "180px", align: "right" as const, render: (row: ReleaseRow): ReactNode => <CellMuted>{formatDate(row.releasedAt ?? row.createdAt)}</CellMuted> },
  { key: "status", header: "Status", width: "130px", render: (row: ReleaseRow): ReactNode => <Badge tone={statusTone(row.status)}>{row.status.toLowerCase()}</Badge> },
];

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
