import type { ReactNode } from "react";
import { WorkspaceProvider } from "../components/workspace/workspace-provider";
import { WorkspaceBoundary } from "../components/workspace/workspace-boundary";
import { AppShell } from "../components/workspace/app-shell";
import { DeploymentUpdateGuard } from "../components/workspace/deployment-update-guard";

/**
 * Workspace area shell. Wraps every authenticated route in the workspace
 * provider (session + business context), the auth/loading/error boundary,
 * and the application shell (sidebar + topbar + bottom nav).
 */
export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <WorkspaceProvider>
      <WorkspaceBoundary>
        <DeploymentUpdateGuard />
        <AppShell>{children}</AppShell>
      </WorkspaceBoundary>
    </WorkspaceProvider>
  );
}
