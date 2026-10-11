"use client";

import { useContext } from "react";
import { WorkspaceContext } from "./workspace-provider";

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used inside <WorkspaceProvider>.");
  }
  return ctx;
}
