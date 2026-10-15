"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Badge, CommandBar, CommandButton, CommandSelect, CommandSpacer, PageHeader } from "../../components/admin-ui";
import { AdminTable, CellMain, CellMuted } from "../../components/admin-table";
import { AdminEmptyState } from "../../components/admin-empty-state";
import { StatCard, StatCardGrid } from "../../components/stat-card";
import { IconActivity, IconDevices, IconRefresh, IconServer } from "../../components/icons";
import { useAdminResource } from "../../components/platform-admin-session";

interface DeviceRow {
  id: string;
  businessId: string;
  businessName: string;
  branchId: string | null;
  branchName: string | null;
  deviceKey: string;
  platform: string;
  appVersion: string;
  releaseChannel: string;
  status: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  health: "ONLINE" | "STALE" | "UNKNOWN";
}

export default function DevicesPage() {
  const { data, loading, error, reload } = useAdminResource<{ devices: DeviceRow[] }>("/api/admin/devices");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [health, setHealth] = useState("all");
  const all = data?.devices ?? [];
  const rows = useMemo(() => all.filter((device) => {
    const q = query.trim().toLowerCase();
    if (q && !`${device.businessName} ${device.deviceKey} ${device.branchName ?? ""}`.toLowerCase().includes(q)) return false;
    if (platform !== "all" && device.platform.toLowerCase() !== platform) return false;
    if (health !== "all" && device.health.toLowerCase() !== health) return false;
    return true;
  }), [all, health, platform, query]);

  const online = all.filter((device) => device.health === "ONLINE").length;
  const stale = all.filter((device) => device.health === "STALE").length;
  const unknown = all.filter((device) => device.health === "UNKNOWN").length;

  return (
    <div className="admin-page">
      <PageHeader eyebrow="Operations" title="Devices & sync" subtitle="Registered devices, version/channel state and authoritative last-seen / last-sync telemetry across tenants." />
      <StatCardGrid>
        <StatCard label="Registered devices" value={loading ? "—" : String(all.length)} hint="Current device registry" icon={IconDevices} tone={loading ? "pending" : "default"} />
        <StatCard label="Online now" value={loading ? "—" : String(online)} hint="Seen in the last 15 minutes" icon={IconActivity} tone={loading ? "pending" : "default"} />
        <StatCard label="Stale" value={loading ? "—" : String(stale)} hint="Last seen more than 15 minutes ago" icon={IconServer} tone={loading ? "pending" : "default"} />
        <StatCard label="Unknown" value={loading ? "—" : String(unknown)} hint="No last-seen timestamp recorded" icon={IconRefresh} tone={loading ? "pending" : "default"} />
      </StatCardGrid>
      <CommandBar>
        <div className="admin-commandbar__search"><input type="search" className="admin-commandbar__search-input" placeholder="Search by business or device key…" aria-label="Search devices" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <CommandSelect label="Filter by platform" value={platform} onChange={(event) => setPlatform(event.target.value)} options={[
          { value: "all", label: "All platforms" }, { value: "web", label: "Web" }, { value: "windows", label: "Windows" }, { value: "macos", label: "macOS" }, { value: "android", label: "Android" }, { value: "ios", label: "iOS" },
        ]} />
        <CommandSelect label="Filter by health" value={health} onChange={(event) => setHealth(event.target.value)} options={[
          { value: "all", label: "All health" }, { value: "online", label: "Online" }, { value: "stale", label: "Stale" }, { value: "unknown", label: "Unknown" },
        ]} />
        <CommandSpacer />
        <CommandButton icon={IconRefresh} label="Refresh device telemetry" onClick={() => void reload()}>Refresh</CommandButton>
      </CommandBar>
      {loading ? <div className="admin-api-state" role="status">Loading device telemetry…</div> : error ? <div className="admin-api-state admin-api-state--error" role="alert">{error}</div> : (
        <AdminTable<DeviceRow> caption="Devices" columns={deviceColumns} rows={rows} rowKey={(row) => row.id} emptyState={<AdminEmptyState title="No devices match" description="The live device registry is empty for the current filters." icon={IconDevices} />} />
      )}
    </div>
  );
}

function healthTone(health: DeviceRow["health"]): "positive" | "warning" | "neutral" {
  if (health === "ONLINE") return "positive";
  if (health === "STALE") return "warning";
  return "neutral";
}

const deviceColumns = [
  { key: "business", header: "Business", render: (row: DeviceRow): ReactNode => <CellMain title={row.businessName} sub={row.branchName ?? "No branch"} /> },
  { key: "deviceKey", header: "Device key", width: "220px", render: (row: DeviceRow): ReactNode => <span className="admin-table__mono">{row.deviceKey}</span> },
  { key: "platform", header: "Platform", width: "150px", render: (row: DeviceRow): ReactNode => <CellMain title={row.platform} sub={`${row.appVersion} · ${row.releaseChannel}`} /> },
  { key: "lastSeen", header: "Last seen", width: "180px", align: "right" as const, render: (row: DeviceRow): ReactNode => <CellMuted>{formatDate(row.lastSeenAt)}</CellMuted> },
  { key: "lastSync", header: "Last sync", width: "180px", align: "right" as const, render: (row: DeviceRow): ReactNode => <CellMuted>{formatDate(row.lastSyncAt)}</CellMuted> },
  { key: "health", header: "Health", width: "120px", render: (row: DeviceRow): ReactNode => <Badge tone={healthTone(row.health)}>{row.health.toLowerCase()}</Badge> },
];

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}
