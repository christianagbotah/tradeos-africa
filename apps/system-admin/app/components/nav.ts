import type { ComponentType, SVGProps } from "react";
import {
  IconActivity,
  IconAudit,
  IconBuilding,
  IconDashboard,
  IconDevices,
  IconFlag,
  IconRelease,
  IconShield,
} from "./icons";

export interface AdminNavItem {
  /** Route pathname (must match app/console route). */
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

export const adminNavGroups: AdminNavGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/console", label: "Overview", icon: IconDashboard },
      { href: "/console/devices", label: "Devices & sync", icon: IconDevices },
      { href: "/console/audit", label: "Audit log", icon: IconAudit },
    ],
  },
  {
    label: "Tenants",
    items: [{ href: "/console/tenants", label: "Tenants", icon: IconBuilding }],
  },
  {
    label: "Billing",
    items: [
      { href: "/console/plans", label: "Plans", icon: IconBuilding },
      { href: "/console/subscriptions", label: "Subscriptions", icon: IconActivity },
      { href: "/console/billing/invoices", label: "Invoices", icon: IconAudit },
      { href: "/console/billing/payments", label: "Payments", icon: IconDevices },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/console/releases", label: "Client releases", icon: IconRelease },
      { href: "/console/flags", label: "Feature flags", icon: IconFlag },
    ],
  },
  {
    label: "Security",
    items: [{ href: "/console/profile", label: "My account", icon: IconShield }],
  },
];

export interface AdminPageMeta {
  crumb: string;
  title: string;
}

/** Derives the topbar title/crumb for a pathname. Falls back to Overview. */
export function resolvePageMeta(pathname: string): AdminPageMeta {
  for (const group of adminNavGroups) {
    for (const item of group.items) {
      if (pathname === item.href) {
        return { crumb: group.label, title: item.label };
      }
    }
  }
  return { crumb: "Operations", title: "Overview" };
}

export const adminAreaIcons = {
  overview: IconDashboard,
  tenants: IconBuilding,
  devices: IconDevices,
  audit: IconAudit,
  releases: IconRelease,
  flags: IconFlag,
  activity: IconActivity,
} as const;
