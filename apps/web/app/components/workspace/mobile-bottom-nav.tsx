"use client";

import Link from "next/link";
import { WorkspaceNavIcon } from "./workspace-nav-icon";
import { isMobileMoreActive, isWorkspaceNavActive, mobileWorkspaceNav } from "./workspace-navigation";

export function MobileBottomNav({ role, pathname, onOpenMore }: { role: string; pathname: string; onOpenMore: () => void }) {
  const moreActive = isMobileMoreActive(role, pathname);
  return (
    <nav className="workspace-mobile-bottom-nav" aria-label="Mobile primary navigation">
      {mobileWorkspaceNav(role).map((item) => {
        if (item.href === "#more") {
          return <button key="#more" type="button" data-more-trigger="true" className={moreActive ? "active" : undefined} aria-current={moreActive ? "page" : undefined} onClick={onOpenMore} aria-label="Open more TradeOS modules"><WorkspaceNavIcon name="more" /><span>More</span></button>;
        }
        const active = isWorkspaceNavActive(pathname, item.href);
        return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={active ? "active" : undefined}><WorkspaceNavIcon name={item.icon} /><span>{item.label}</span></Link>;
      })}
    </nav>
  );
}
