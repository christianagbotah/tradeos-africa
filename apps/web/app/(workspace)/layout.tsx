import type { ReactNode } from "react";
import { WorkspaceProvider } from "../components/workspace/workspace-provider";
import { WorkspaceBoundary } from "../components/workspace/workspace-boundary";
import { AppShell } from "../components/workspace/app-shell";

/**
 * Workspace area shell. Wraps every authenticated route in the workspace
 * provider (session + business context), the auth/loading/error boundary,
 * and the application shell (sidebar + topbar + bottom nav).
 */
export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <WorkspaceProvider>
      <WorkspaceBoundary>
        <AppShell>{children}</AppShell>
      </WorkspaceBoundary>
    </WorkspaceProvider>
  );
}
