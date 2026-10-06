"use client";

import { useEffect, useState } from "react";
import { flushPendingMutations, getQueueState, queueChangedEvent, type QueueState } from "../lib/offline-sync";

export function NetworkStatus() {
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueueState>({ pending: 0, blocked: 0, failed: 0 });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);

  useEffect(() => {
    let active = true;

    const updateQueue = () => {
      if (active) setQueue(getQueueState());
    };

    const syncNow = async () => {
      if (!navigator.onLine) {
        updateQueue();
        return;
      }
      setSyncing(true);
      try {
        const summary = await flushPendingMutations();
        if (active) {
          setQueue({ pending: summary.pending, blocked: summary.blocked, failed: summary.failed });
          setSyncError(false);
        }
      } catch {
        if (active) {
          setSyncError(true);
          updateQueue();
        }
      } finally {
        if (active) setSyncing(false);
      }
    };

    const updateNetwork = () => {
      const isOnline = navigator.onLine;
      if (active) setOnline(isOnline);
      updateQueue();
      if (isOnline) void syncNow();
    };

    const queueChanged = () => {
      updateQueue();
      if (navigator.onLine) void syncNow();
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Selling remains available even if shell caching is unsupported.
      });
    }

    updateNetwork();
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
    window.addEventListener("storage", queueChanged);
    window.addEventListener(queueChangedEvent, queueChanged);
    const timer = window.setInterval(() => {
      const state = getQueueState();
      if (navigator.onLine && state.pending > state.blocked) void syncNow();
    }, 15_000);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
      window.removeEventListener("storage", queueChanged);
      window.removeEventListener(queueChangedEvent, queueChanged);
    };
  }, []);

  const readyToSync = queue.pending - queue.blocked;
  const title = !online
    ? "Offline · work continues"
    : syncing
      ? `Syncing · ${readyToSync} waiting`
      : queue.failed > 0
        ? `Online · ${queue.failed} needs review`
        : queue.blocked > 0
          ? "Other business · sync paused"
          : readyToSync > 0
            ? `Online · ${readyToSync} waiting to sync`
            : "Online · fully synced";

  const detail = !online
    ? `${queue.pending} change${queue.pending === 1 ? "" : "s"} stored safely on this device`
    : syncError
      ? "Sync service unavailable — changes remain safely queued"
      : queue.failed > 0
        ? "Rejected changes are separated for review and do not retry forever"
        : queue.blocked > 0
          ? "Some queued changes belong to another business and remain safely stored until that business is active"
          : readyToSync > 0
            ? "Queued changes retry automatically"
            : "No pending changes";

  return (
    <div className="sync-card" aria-live="polite">
      <div
        className="sync-dot"
        style={!online || syncError || queue.failed > 0 || queue.blocked > 0
          ? { background: "#f59e0b", boxShadow: "0 0 0 4px rgba(245,158,11,.12)" }
          : undefined}
      />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}
