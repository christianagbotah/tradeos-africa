"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "./use-workspace";
import { Button } from "../ui/button";
import { IconAlert, IconRefresh } from "../ui/icons";

/**
 * Auth gate + loading + error boundary for the workspace.
 *
 * - If the workspace is still booting, render a loading screen.
 * - If no session is present, redirect to the public entry (sign-in).
 * - If a fatal error occurred, render an honest error screen with retry.
 * - Otherwise, render the children inside the workspace shell.
 */
export function WorkspaceBoundary({ children }: { children: React.ReactNode }) {
  const { booting, session, fatal, refreshCatalog } = useWorkspace();
  const router = useRouter();

  useEffect(() => {
    if (!booting && !session) {
      router.replace("/");
    }
  }, [booting, session, router]);

  if (booting) {
    return (
      <div className="tos-loading" role="status">
        <div className="tos-loading__panel">
          <div className="tos-loading__mark" aria-hidden="true">T</div>
          <h1 className="tos-loading__title">Loading your workspace…</h1>
          <p className="tos-loading__text">Resuming session from secure storage.</p>
          <span className="tos-spinner" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (!session) {
    // The useEffect above will redirect; render a minimal placeholder meanwhile.
    return (
      <div className="tos-loading" role="status">
        <div className="tos-loading__panel">
          <div className="tos-loading__mark" aria-hidden="true">T</div>
          <p className="tos-loading__text">Redirecting to sign-in…</p>
        </div>
      </div>
    );
  }

  if (fatal) {
    return (
      <div className="tos-boundary" role="alert">
        <div className="tos-boundary__panel">
          <div className="tos-boundary__mark" aria-hidden="true">
            <IconAlert style={{ width: 24, height: 24 }} />
          </div>
          <h1 className="tos-boundary__title">Workspace unavailable</h1>
          <p className="tos-boundary__text">{fatal}</p>
          <div className="tos-boundary__actions">
            <Button variant="primary" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => void refreshCatalog()}>
              Retry
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
