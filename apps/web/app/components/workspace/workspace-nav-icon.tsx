import React from "react";
import type { WorkspaceNavIcon as IconName } from "./workspace-navigation";

const paths: Record<IconName, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  sell: <><path d="M4 5h16v12H4z"/><path d="M8 21h8M12 17v4M7 9h10M9 13h6"/></>,
  sales: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  customers: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  purchases: <><path d="M3 6h18l-2 12H5z"/><path d="M8 6a4 4 0 0 1 8 0M8 11h8"/></>,
  inventory: <><path d="M4 7l8-4 8 4-8 4z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></>,
  catalog: <><path d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z"/></>,
  returns: <><path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 5 5v3"/></>,
  cashbook: <><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h4"/><circle cx="17" cy="16" r="2"/></>,
  operations: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21h-4v-.09a1.7 1.7 0 0 0-1.4-1.66 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 3.8 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H2v-4h.09a1.7 1.7 0 0 0 1.66-1.4 1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8 3.8a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V2h4v.09a1.7 1.7 0 0 0 1.4 1.66 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 20.2 8c.2.39.3.82.3 1.25V10h1.5v4h-.09a1.7 1.7 0 0 0-1.66 1z"/></>,
  reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  more: <><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></>,
};

export function WorkspaceNavIcon({ name }: { name: IconName }) {
  return <svg className="workspace-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
