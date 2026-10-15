"use client";

import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { Banner, PageHeader, Section } from "../components/admin-ui";
import { StatCard, StatCardGrid } from "../components/stat-card";
import { IconActivity, IconBuilding, IconDevices, IconFlag, IconInfo, IconRelease } from "../components/icons";
import { useAdminResource } from "../components/platform-admin-session";

interface Tenant { status: string; }
interface Device { health: "ONLINE" | "STALE" | "UNKNOWN"; }
interface Release { status: string; }

export default function ConsoleOverviewPage() {
  const tenants = useAdminResource<{ tenants: Tenant[] }>("/api/admin/tenants");
  const devices = useAdminResource<{ devices: Device[] }>("/api/admin/devices");
  const releases = useAdminResource<{ releases: Release[] }>("/api/admin/releases");
  const loading = tenants.loading || devices.loading || releases.loading;
  const error = tenants.error ?? devices.error ?? releases.error;
  const tenantRows = tenants.data?.tenants ?? [];
  const deviceRows = devices.data?.devices ?? [];
  const releaseRows = releases.data?.releases ?? [];

  return (
    <div className="admin-page">
      <PageHeader eyebrow="TradeOS control plane" title="Platform overview" subtitle="Authenticated read-only operations view for Lightworld platform administrators. Separate from tenant business administration." />
      <Banner tone="info" icon={IconInfo} title="System Admin read plane is active.">
        <span className="admin-banner__text">Live tenant, device, audit, release and feature-flag data is available. Privileged mutations remain intentionally unavailable until the write plane is separately reviewed.</span>
      </Banner>
      {error ? <div className="admin-api-state admin-api-state--error" role="alert">{error}</div> : null}
      <StatCardGrid>
        <StatCard label="Active tenants" value={loading ? "—" : String(tenantRows.filter((tenant) => tenant.status === "ACTIVE").length)} hint={`${tenantRows.length} total loaded`} icon={IconBuilding} tone={loading ? "pending" : "default"} />
        <StatCard label="Registered devices" value={loading ? "—" : String(deviceRows.length)} hint="Across all loaded tenants" icon={IconDevices} tone={loading ? "pending" : "default"} />
        <StatCard label="Devices online" value={loading ? "—" : String(deviceRows.filter((device) => device.health === "ONLINE").length)} hint="Seen in the last 15 minutes" icon={IconActivity} tone={loading ? "pending" : "default"} />
        <StatCard label="Active releases" value={loading ? "—" : String(releaseRows.filter((release) => release.status === "ACTIVE").length)} hint={`${releaseRows.length} release records`} icon={IconRelease} tone={loading ? "pending" : "default"} />
      </StatCardGrid>
      <Section title="Admin areas" sub="All areas below read live control-plane data. Write operations remain unavailable in this milestone.">
        <div className="admin-quicklinks">
          <QuickLink href="/console/tenants" icon={IconBuilding} title="Tenants" desc="Business status, current subscription, branches, devices and recent activity." />
          <QuickLink href="/console/devices" icon={IconDevices} title="Devices & sync" desc="Registered device versions, release channels, last-seen and last-sync telemetry." />
          <QuickLink href="/console/audit" icon={IconInfo} title="Platform audit" desc="Privileged platform audit events and affected resources." />
          <QuickLink href="/console/releases" icon={IconRelease} title="Client releases" desc="Published client versions, support floors and rollout state." />
          <QuickLink href="/console/flags" icon={IconFlag} title="Feature flags" desc="Global and tenant-scoped feature flag state and configuration." />
        </div>
      </Section>
    </div>
  );
}

interface QuickLinkProps {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  desc: string;
}

function QuickLink({ href, icon: Icon, title, desc }: QuickLinkProps) {
  return (
    <Link href={href} className="admin-quicklink">
      <span className="admin-quicklink__head"><span className="admin-quicklink__icon"><Icon /></span><span className="admin-quicklink__title">{title}</span></span>
      <p className="admin-quicklink__desc">{desc}</p>
    </Link>
  );
}
