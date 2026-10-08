"use client";

import { useContext } from "react";
import { WorkspaceStoreContext, type WorkspaceContextValue, type WorkspaceStore } from "./workspace-provider";

export function useWorkspaceStore(): WorkspaceStore {
  const store = useContext(WorkspaceStoreContext);
  if (!store) throw new Error("Workspace hooks must be used inside WorkspaceProvider.");
  return store;
}

export function useWorkspace(): WorkspaceContextValue {
  const store = useWorkspaceStore();
  const { session, context, branchId } = store;
  if (!session || !context || !branchId) throw new Error("Workspace is not ready.");
  const activeBranch = context.branches.find((branch) => branch.id === branchId && branch.active);
  if (!activeBranch) throw new Error("Active branch is not available.");
  return {
    session,
    context,
    branchId,
    activeBranch,
    catalog: store.catalog,
    sellableItems: store.sellableItems,
    setBusiness: store.setBusiness,
    setBranch: store.setBranch,
    refreshBusiness: store.refreshBusiness,
    logout: store.logout,
    retryWorkspace: store.retryWorkspace,
  };
}
