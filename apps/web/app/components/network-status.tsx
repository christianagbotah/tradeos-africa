"use client";

import { useEffect, useState } from "react";

export function NetworkStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline support is progressive enhancement; registration failures
        // should never block selling or other business workflows.
      });
    }

    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <div className="sync-card" aria-live="polite">
      <div
        className="sync-dot"
        style={online ? undefined : { background: "#f59e0b", boxShadow: "0 0 0 4px rgba(245,158,11,.12)" }}
      />
      <div>
        <strong>{online ? "Online · sync enabled" : "Offline · work continues"}</strong>
        <span>{online ? "Queued changes sync automatically" : "Changes will sync after reconnection"}</span>
      </div>
    </div>
  );
}
