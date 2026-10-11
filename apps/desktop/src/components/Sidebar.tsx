/**
 * Sidebar — TradeOS Desktop navigation sidebar.
 * Brand, grouped navigation (active state via state-based router), platform
 * indicator (Windows/macOS), sync status (online/offline + pending + failed
 * counts). Renders a condensed rail under 980px.
 */
import type { ClientPlatform } from "@tradeos/client-core";
import type { ScreenId } from "../lib/types.js";
import {
  IconDashboard,
  IconSell,
  IconReceipt,
  IconPackage,
  IconUsers,
  IconChart,
  IconMonitor,
  IconApple,
} from "./icons.js";

export interface NavItem {
  id: ScreenId;
  label: string;
  icon: typeof IconDashboard;
  kbd: string;
}

const NAV_GROUPS: ReadonlyArray<{ label: string; items: NavItem[] }> = [
  {
    label: "Operate",
    items: [
      { id: "dashboard", label: "Dashboard", icon: IconDashboard, kbd: "G D" },
      { id: "pos", label: "Sell", icon: IconSell, kbd: "F2" },
      { id: "sales", label: "Sales", icon: IconReceipt, kbd: "G S" },
    ],
  },
  {
    label: "Manage",
    items: [
      { id: "inventory", label: "Inventory", icon: IconPackage, kbd: "G I" },
      { id: "customers", label: "Customers", icon: IconUsers, kbd: "G C" },
      { id: "reports", label: "Reports", icon: IconChart, kbd: "G R" },
    ],
  },
];

export interface SidebarProps {
  active: ScreenId;
  onNavigate: (id: ScreenId) => void;
  platform: ClientPlatform;
  online: boolean;
  pendingCount: number;
  failedCount: number;
}

export function Sidebar({ active, onNavigate, platform, online, pendingCount, failedCount }: SidebarProps) {
  const PlatformIcon = platform === "MACOS" ? IconApple : IconMonitor;
  const platformName = platform === "MACOS" ? "macOS" : "Windows";
  return (
    <aside className="dsk-sidebar" aria-label="Primary navigation">
      <div className="dsk-sidebar__brand">
        <div className="dsk-sidebar__mark" aria-hidden>
          T
        </div>
        <div className="dsk-sidebar__brand-text">
          <span className="dsk-sidebar__brand-name">TradeOS</span>
          <span className="dsk-sidebar__brand-sub">Desktop</span>
        </div>
      </div>
      <nav className="dsk-sidebar__nav">
        {NAV_GROUPS.map((group) => (
          <div className="dsk-sidebar__group" key={group.label}>
            <div className="dsk-sidebar__group-label">{group.label}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === active;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="dsk-sidebar__link"
                  data-active={isActive ? "true" : "false"}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon className="dsk-sidebar__link-icon" />
                  <span className="dsk-sidebar__link-text">{item.label}</span>
                  <span className="dsk-sidebar__link-kbd">{item.kbd}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="dsk-sidebar__footer">
        <div className="dsk-sidebar__platform" title="Native window runtime">
          <PlatformIcon className="dsk-sidebar__platform-icon" />
          <div className="dsk-sidebar__platform-text">
            <span className="dsk-sidebar__platform-name">{platformName}</span>
            <span className="dsk-sidebar__platform-note">Native shell</span>
          </div>
        </div>
        <div className="dsk-sidebar__sync" title={failedCount > 0 ? `${failedCount} sync failed — review needed` : online ? "Live sync" : `${pendingCount} queued for sync`}>
          <span
            className={`dsk-sync-dot ${online ? "dsk-sync-dot--online" : "dsk-sync-dot--offline"}${failedCount > 0 ? " dsk-sync-dot--failed" : ""}`}
            aria-hidden
          />
          <span className="dsk-sidebar__sync-label">
            {online ? (failedCount > 0 ? "Sync failed" : "Synced") : "Offline"}
          </span>
          <span className="dsk-sidebar__sync-note">
            {online
              ? failedCount > 0 ? `${failedCount} failed` : "Live"
              : `${pendingCount} queued`}
          </span>
        </div>
      </div>
    </aside>
  );
}
