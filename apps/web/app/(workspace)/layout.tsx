import type { ReactNode } from "react";
import { WorkspaceBoundary } from "../components/workspace/workspace-boundary";
import { WorkspaceProvider } from "../components/workspace/workspace-provider";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <WorkspaceBoundary>{children}</WorkspaceBoundary>
    </WorkspaceProvider>
  );
}
