import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { PageHeader, Banner, Section } from "../components/admin-ui";
import { StatCard, StatCardGrid } from "../components/stat-card";
import {
  IconActivity,
  IconAlert,
  IconBuilding,
  IconDevices,
  IconFlag,
  IconInfo,
  IconRelease,
  IconServer,
  IconTrend,
  IconUsers,
} from "../components/icons";

export default function ConsoleOverviewPage() {
  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="TradeOS control plane"
        title="Platform overview"
        subtitle="Operator console for super admins, support, compliance and billing. Separate from tenant business administration."
      />

      <Banner tone="warning" icon={IconAlert} title="Control-plane API pending.">
        <span className="admin-banner__text">
          Platform-admin authentication, tenant, device, audit, release and feature-flag endpoints
          are not implemented yet (see API-GAP-REGISTER §1–§6). Metrics below show{" "}
          <strong>—</strong> until the control-plane API lands.
        </span>
      </Banner>

      <StatCardGrid>
        <StatCard
          label="Active tenants"
          value="—"
          hint="Pending backend · admin tenants API"
          icon={IconBuilding}
          tone="pending"
        />
        <StatCard
          label="MRR"
          value="—"
          hint="Pending backend · subscription ledger"
          icon={IconTrend}
          tone="pending"
        />
        <StatCard
          label="Sync health"
          value="—"
          hint="Pending backend · device telemetry"
          icon={IconActivity}
          tone="pending"
        />
        <StatCard
          label="Release health"
          value="—"
          hint="Pending backend · client release tracking"
          icon={IconRelease}
          tone="pending"
        />
      </StatCardGrid>

      <Section
        title="Admin areas"
        sub="Each area is composed and reachable. Data populates once the matching control-plane endpoint ships."
      >
        <div className="admin-quicklinks">
          <QuickLink
            href="/console/tenants"
            icon={IconBuilding}
            title="Tenants"
            desc="Businesses, branches, activation, suspension and support access."
          />
          <QuickLink
            href="/console/devices"
            icon={IconDevices}
            title="Devices & sync"
            desc="Registered devices, last-seen state, queue health and revocation."
          />
          <QuickLink
            href="/console/audit"
            icon={IconInfo}
            title="Platform audit"
            desc="Privileged actions, support access and configuration changes."
          />
          <QuickLink
            href="/console/releases"
            icon={IconRelease}
            title="Client releases"
            desc="Web, Windows, macOS, Android and iOS versions and minimum-supported builds."
          />
          <QuickLink
            href="/console/flags"
            icon={IconFlag}
            title="Feature flags"
            desc="Module licensing, limits, overrides and platform-wide toggles."
          />
        </div>
      </Section>

      <Section title="Platform status" sub="Live once control-plane telemetry is connected.">
        <div
          className="admin-stat-card__grid"
          style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}
        >
          <StatCard
            label="API uptime"
            value="—"
            hint="Pending backend · health probe"
            icon={IconServer}
            tone="pending"
          />
          <StatCard
            label="Support agents online"
            value="—"
            hint="Pending backend · admin session API"
            icon={IconUsers}
            tone="pending"
          />
          <StatCard
            label="Open incidents"
            value="—"
            hint="Pending backend · incident feed"
            icon={IconAlert}
            tone="pending"
          />
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
      <span className="admin-quicklink__head">
        <span className="admin-quicklink__icon">
          <Icon />
        </span>
        <span className="admin-quicklink__title">{title}</span>
      </span>
      <p className="admin-quicklink__desc">{desc}</p>
    </Link>
  );
}
