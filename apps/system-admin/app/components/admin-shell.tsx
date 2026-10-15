"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AdminSidebar } from "./admin-sidebar";
import { AdminTopbar } from "./admin-topbar";
import { resolvePageMeta } from "./nav";

interface AdminShellProps {
  children: ReactNode;
  adminName?: string;
  adminRole?: string;
  adminInitials?: string;
  actions?: ReactNode;
  onSignOut?: () => void;
}

export function AdminShell({
  children,
  adminName = "Operator",
  adminRole = "Platform admin",
  adminInitials = "OP",
  actions,
  onSignOut,
}: AdminShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const meta = resolvePageMeta(pathname);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sidebarOpen]);

  return (
    <div className="admin-shell">
      <AdminSidebar
        open={sidebarOpen}
        onNavigate={() => setSidebarOpen(false)}
        onSignOut={() => onSignOut?.()}
      />
      <div
        className="admin-sidebar-scrim"
        data-open={sidebarOpen ? "true" : "false"}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <div className="admin-main">
        <AdminTopbar
          crumb={meta.crumb}
          title={meta.title}
          adminName={adminName}
          adminRole={adminRole}
          adminInitials={adminInitials}
          actions={actions}
          menuOpen={sidebarOpen}
          onMenuClick={() => setSidebarOpen((v) => !v)}
        />
        <main className="admin-content" id="admin-content">
          {children}
        </main>
      </div>
    </div>
  );
}
