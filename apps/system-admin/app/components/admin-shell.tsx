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
  /** Right-hand topbar actions slot. */
  actions?: ReactNode;
}

export function AdminShell({
  children,
  adminName = "Operator",
  adminRole = "Platform admin",
  adminInitials = "OP",
  actions,
}: AdminShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const meta = resolvePageMeta(pathname);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!sidebarOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sidebarOpen]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!sidebarOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sidebarOpen]);

  const handleSignOut = () => {
    // Platform-admin auth API does not exist yet (API-GAP-REGISTER §1).
    // No-op until the control-plane session endpoint lands.
    if (typeof window !== "undefined") {
      window.console.info("[system-admin] sign-out requested — admin session API pending.");
    }
  };

  return (
    <div className="admin-shell">
      <AdminSidebar
        open={sidebarOpen}
        onNavigate={() => setSidebarOpen(false)}
        onSignOut={handleSignOut}
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
