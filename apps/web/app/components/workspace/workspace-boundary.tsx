"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getWorkspaceGate } from "./workspace-provider";
import { useWorkspaceStore } from "./use-workspace";

export function WorkspaceBoundary({ children }: { children: ReactNode }) {
  const router = useRouter();
  const store = useWorkspaceStore();
  const gate = getWorkspaceGate(store);

  useEffect(() => {
    if (gate === "redirect-root") router.replace("/");
  }, [gate, router]);

  if (gate === "redirect-root" || gate === "loading") {
    if (store.error && store.resolved && store.session) {
      return (
        <main className="loading-shell">
          <div className="brand-mark">T</div>
          <strong>TradeOS could not load this workspace.</strong>
          <span>{store.error}</span>
        </main>
      );
    }
    return <main className="loading-shell"><div className="brand-mark">T</div><strong>Loading TradeOS Africa…</strong></main>;
  }

  return children;
}
