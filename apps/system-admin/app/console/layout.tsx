import type { ReactNode } from "react";
import { PlatformAdminConsoleGate } from "../components/platform-admin-session";

export default function ConsoleLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <PlatformAdminConsoleGate>{children}</PlatformAdminConsoleGate>;
}
