"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/button";

const BUILD_STORAGE_KEY = "tradeos:workspace-build-id";
const POLL_INTERVAL_MS = 60_000;

interface BuildResponse {
  buildId?: string | null;
}

export function DeploymentUpdateGuard() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    let cancelled = false;

    const checkForUpdate = async () => {
      if (document.visibilityState === "hidden") return;

      try {
        const response = await fetch(`/client-build?ts=${Date.now()}`, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) return;

        const payload = (await response.json()) as BuildResponse;
        const activeBuildId = typeof payload.buildId === "string" ? payload.buildId.trim() : "";
        if (!activeBuildId) return;

        const loadedBuildId = sessionStorage.getItem(BUILD_STORAGE_KEY);
        if (!loadedBuildId) {
          sessionStorage.setItem(BUILD_STORAGE_KEY, activeBuildId);
          return;
        }

        if (loadedBuildId !== activeBuildId && !cancelled) {
          setUpdateAvailable(true);
        }
      } catch {
        // Version checks must never interrupt normal TradeOS work while offline
        // or during a transient network failure.
      }
    };

    void checkForUpdate();
    const intervalId = window.setInterval(() => void checkForUpdate(), POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.75rem 1rem",
        borderBottom: "1px solid var(--tos-border, #d8d5cf)",
        background: "var(--tos-surface, #fff)",
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div>
        <strong>TradeOS update available</strong>
        <div style={{ fontSize: "0.875rem", marginTop: "0.125rem" }}>
          Reload to use the latest forms, fixes and automation safely.
        </div>
      </div>
      <Button variant="gold" onClick={() => window.location.reload()}>
        Reload now
      </Button>
    </div>
  );
}
