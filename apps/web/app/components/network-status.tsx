"use client";

import { useEffect, useState } from "react";

export function NetworkStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <div className="sync-card" aria-live="polite">
      <div className={online ? "sync-dot" : "sync-dot offline"} />
      <div>
        <strong>{online ? "Online · sync enabled" : "Offline · work continues"}</strong>
        <span>{online ? "Queued changes sync automatically" : "Changes will sync after reconnection"}</span>
      </div>
    </div>
  );
}
