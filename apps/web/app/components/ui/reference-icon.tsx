import React from "react";

export type ReferenceIconName =
  | "search" | "sparkles" | "help" | "bell" | "store" | "home" | "menu" | "wifi"
  | "chevronDown" | "scan" | "user" | "cash" | "phone" | "bank" | "card" | "clock"
  | "cart" | "calendar" | "box" | "wallet" | "reply";

const iconPaths: Record<ReferenceIconName, React.ReactNode> = {
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z"/><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z"/><path d="m5 13 .6 1.9 1.9.6-1.9.6L5 18l-.6-1.9-1.9-.6 1.9-.6L5 13Z"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.5 2.5 0 0 1 4.8 1c0 1.8-2.6 2.1-2.6 3.8"/><path d="M12 17h.01"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  store: <><path d="M4 9h16l-2-5H6L4 9Z"/><path d="M5 9v10h14V9M9 19v-5h6v5"/><path d="M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3"/></>,
  home: <><path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  wifi: <><path d="M5 10.5a10 10 0 0 1 14 0M8 14a5.7 5.7 0 0 1 8 0M11 17.5a1.5 1.5 0 0 1 2 0"/><circle cx="12" cy="19" r=".6" fill="currentColor" stroke="none"/></>,
  chevronDown: <path d="m7 10 5 5 5-5"/>,
  scan: <><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M8 8v8M11 8v8M15 8v8M17 8v8"/></>,
  user: <><circle cx="12" cy="8" r="3"/><path d="M6 20a6 6 0 0 1 12 0"/></>,
  cash: <><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9h.01M18 15h.01"/></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></>,
  bank: <><path d="m3 9 9-5 9 5"/><path d="M5 10h14M6 19h12M4 21h16M7 10v9M12 10v9M17 10v9"/></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  cart: <><path d="M4 5h2l2 10h9l2-7H7"/><circle cx="10" cy="19" r="1"/><circle cx="17" cy="19" r="1"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
  box: <><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></>,
  wallet: <><path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><path d="M16 11h6v5h-6a2.5 2.5 0 0 1 0-5Z"/></>,
  reply: <><path d="m9 7-5 5 5 5"/><path d="M4 12h9a6 6 0 0 1 6 6"/></>,
};

export function ReferenceIcon({ name, className = "" }: { name: ReferenceIconName; className?: string }) {
  return (
    <svg className={`zai-reference-icon${className ? ` ${className}` : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {iconPaths[name]}
    </svg>
  );
}
