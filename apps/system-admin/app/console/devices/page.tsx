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
import { StatCard, StatCardGrid } from "../../components/stat-card";
import { IconActivity, IconDevices, IconRefresh, IconServer } from "../../components/icons";

/**
 * Devices & sync health.
 *
 * The admin devices endpoint (API-GAP-REGISTER §4) is not implemented. Sync
 * health cards and the device table render honest "pending backend" states.
 */
export default function DevicesPage() {
  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="Operations"
        title="Devices & sync"
        subtitle="Registered devices across tenants, last-seen state, sync queue health and revocation."
      />

      <StatCardGrid>
        <StatCard
          label="Registered devices"
          value="—"
          hint="Pending backend · admin devices API"
          icon={IconDevices}
          tone="pending"
        />
        <StatCard
          label="Online now"
          value="—"
          hint="Pending backend · last-seen telemetry"
          icon={IconActivity}
          tone="pending"
        />
        <StatCard
          label="Stuck queues"
          value="—"
          hint="Pending backend · sync queue health"
          icon={IconServer}
          tone="pending"
        />
        <StatCard
          label="Avg sync lag"
          value="—"
          hint="Pending backend · queue depth probe"
          icon={IconRefresh}
          tone="pending"
        />
      </StatCardGrid>

      <Banner tone="info" icon={IconDevices} title="Device telemetry pending backend.">
        <span className="admin-banner__text">
          The admin devices endpoint (API-GAP-REGISTER §4) is not implemented. The device table is
          composed and ready; rows populate when telemetry is connected.
        </span>
      </Banner>

      <CommandBar>
        <CommandSearch
          placeholder="Search by business or device key…"
          label="Search devices"
          name="q"
        />
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
          label="Filter by health"
          name="health"
          defaultValue="all"
          options={[
            { value: "all", label: "All health" },
            { value: "healthy", label: "Healthy" },
            { value: "lagging", label: "Lagging" },
            { value: "stuck", label: "Stuck" },
            { value: "offline", label: "Offline" },
          ]}
        />
        <CommandSpacer />
        <CommandButton icon={IconRefresh} label="Refresh device telemetry">
          Refresh
        </CommandButton>
      </CommandBar>

      <AdminTable<DeviceRow>
        caption="Devices"
        columns={deviceColumns}
        rows={[]}
        rowKey={(r) => r.deviceKey}
        emptyState={
          <AdminEmptyState
            title="Device telemetry pending backend"
            description="No devices loaded. Once the admin devices endpoint is connected, every registered device appears here with its business, platform, last-seen timestamp and sync queue health."
            icon={IconDevices}
            pending
          />
        }
      />
    </div>
  );
}

interface DeviceRow {
  business: string;
  deviceKey: string;
  platform: "web" | "windows" | "macos" | "android" | "ios";
  lastSeen: string;
  queueHealth: "healthy" | "lagging" | "stuck" | "offline";
}

function healthTone(h: DeviceRow["queueHealth"]): "positive" | "warning" | "danger" | "neutral" {
  switch (h) {
    case "healthy":
      return "positive";
    case "lagging":
      return "warning";
    case "stuck":
      return "danger";
    case "offline":
      return "neutral";
  }
}

const deviceColumns = [
  {
    key: "business",
    header: "Business",
    render: (r: DeviceRow): ReactNode => <CellMain title={r.business} sub="Tenant" />,
  },
  {
    key: "deviceKey",
    header: "Device key",
    width: "220px",
    render: (r: DeviceRow): ReactNode => <span className="admin-table__mono">{r.deviceKey}</span>,
  },
  {
    key: "platform",
    header: "Platform",
    width: "120px",
    render: (r: DeviceRow): ReactNode => <span className="admin-table__strong">{r.platform}</span>,
  },
  {
    key: "lastSeen",
    header: "Last seen",
    width: "170px",
    align: "right" as const,
    render: (r: DeviceRow): ReactNode => <CellMuted>{r.lastSeen}</CellMuted>,
  },
  {
    key: "queueHealth",
    header: "Queue health",
    width: "140px",
    render: (r: DeviceRow): ReactNode => (
      <Badge tone={healthTone(r.queueHealth)}>{r.queueHealth}</Badge>
    ),
  },
];
