import type { ReactNode } from "react";
import { AdminShell } from "../components/admin-shell";

/**
 * Console area shell. Wraps every /console/* route in the operator console
 * (midnight sidebar + topbar + privileged-access indicators).
 *
 * NOTE: platform-admin authentication does not exist yet (API-GAP-REGISTER §1),
 * so the operator identity shown here is a clearly-labelled placeholder. The
 * overview page surfaces this honestly via a status banner.
 */
export default function ConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AdminShell
      adminName="Operator"
      adminRole="Demo session"
      adminInitials="OP"
    >
      {children}
    </AdminShell>
  );
}
