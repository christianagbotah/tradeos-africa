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

  if (gate === "redirect-root") {
    return <main className="loading-shell"><div className="brand-mark">T</div><strong>Returning to sign in…</strong></main>;
  }

  if (gate === "loading") {
    if (store.error && store.resolved && store.session) {
      return (
        <main className="loading-shell workspace-recovery-shell">
          <div className="brand-mark">T</div>
          <section className="workspace-recovery-card" aria-live="polite">
            <p className="eyebrow">Workspace unavailable</p>
            <h1>TradeOS could not open this business workspace.</h1>
            <p>{store.error}</p>
            {store.session.memberships.length > 1 ? (
              <label className="workspace-recovery-switch">
                <span>Switch business</span>
                <select defaultValue="" onChange={(event) => { if (event.target.value) void store.setBusiness(event.target.value); }}>
                  <option value="" disabled>Choose another business</option>
                  {store.session.memberships.map((membership) => <option key={membership.businessId} value={membership.businessId}>{membership.businessName}</option>)}
                </select>
              </label>
            ) : null}
            <div className="workspace-recovery-actions">
              <button className="primary-button" type="button" onClick={() => void store.retryWorkspace()}>Try again</button>
              <button className="ghost-button" type="button" onClick={() => void store.logout()}>Sign out</button>
            </div>
          </section>
        </main>
      );
    }
    return <main className="loading-shell"><div className="brand-mark">T</div><strong>Loading TradeOS Africa…</strong></main>;
  }

  return children;
}
