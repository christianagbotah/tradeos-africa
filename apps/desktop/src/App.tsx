/**
 * TradeOS Africa — desktop application shell.
 *
 * Titlebar (native window controls) + Sidebar (nav, platform, sync) + Topbar
 * (title, global search, online/offline, profile / sign-in / sign-out) +
 * content area rendering the active screen. Routing is client-side via React
 * state (no router lib).
 *
 * The shell is Tauri-ready: window controls route through lib/tauri-api.ts and
 * degrade to no-ops in plain Vite dev mode.
 *
 * The runtime lifecycle is owned by `useDesktopRuntime`. The App renders one
 * of three top-level surfaces:
 *
 *   - DEMO MODE (VITE_TRADEOS_DEMO=true): screens render sample data with a
 *     prominent DEMO banner.
 *   - SIGNED OUT: screens render an AccessState ("sign-in required") and a
 *     sign-in dialog is available from the topbar.
 *   - READY: screens render live data via the DesktopRuntime.
 */
import { useEffect, useMemo, useState } from "react";
import type { ScreenId } from "./lib/types.js";
import { ensureTauriWindow, windowControls } from "./lib/tauri-api.js";
import { usePlatformProfile } from "./hooks/usePlatformProfile.js";
import { useDesktopRuntime } from "./hooks/useDesktopRuntime.js";
import { Sidebar } from "./components/Sidebar.js";
import { Topbar } from "./components/Topbar.js";
import { Dashboard } from "./screens/Dashboard.js";
import { Pos } from "./screens/Pos.js";
import { Sales } from "./screens/Sales.js";
import { Inventory } from "./screens/Inventory.js";
import { Customers } from "./screens/Customers.js";
import { Reports } from "./screens/Reports.js";
import { SignInDialog } from "./components/SignInDialog.js";
import { IconMinus, IconSquare, IconClose } from "./components/icons.js";

const SCREEN_META: Record<ScreenId, { crumb: string; title: string }> = {
  dashboard: { crumb: "TradeOS Desktop", title: "Dashboard" },
  pos: { crumb: "Counter workspace", title: "Sell" },
  sales: { crumb: "Money & records", title: "Sales" },
  inventory: { crumb: "Stock health", title: "Inventory" },
  customers: { crumb: "People", title: "Customers" },
  reports: { crumb: "Insight", title: "Reports" },
};

export default function App() {
  const profile = usePlatformProfile();
  const [screen, setScreen] = useState<ScreenId>("dashboard");
  const [search, setSearch] = useState("");
  const [online, setOnline] = useState(true);
  const [signInOpen, setSignInOpen] = useState(false);
  const { demoMode, runtime, ready, state, loading, error, login, logout } = useDesktopRuntime();

  useEffect(() => {
    void ensureTauriWindow();
  }, []);

  // Auto-open the sign-in dialog when signed out (and not in demo mode).
  useEffect(() => {
    if (!demoMode && state?.status === "SIGNED_OUT" && !signInOpen) {
      // Don't auto-open on first load (let the user see the empty state first).
      // Only auto-open after an explicit session-expiration event.
    }
  }, [demoMode, state, signInOpen]);

  // Keyboard: "/" focuses global search, "g d/s/i/c/r" navigates.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (editing) return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>(".dsk-search__input");
        el?.focus();
        return;
      }
      if (e.key === "g" && !e.ctrlKey && !e.metaKey) {
        const handler = (ev: KeyboardEvent) => {
          const map: Record<string, ScreenId> = {
            d: "dashboard",
            s: "sales",
            i: "inventory",
            c: "customers",
            r: "reports",
          };
          const next = map[ev.key.toLowerCase()];
          if (next) {
            ev.preventDefault();
            setScreen(next);
          }
          window.removeEventListener("keydown", handler);
        };
        window.addEventListener("keydown", handler, { once: true });
        setTimeout(() => window.removeEventListener("keydown", handler), 800);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function navigate(id: ScreenId) {
    setScreen(id);
    setSearch("");
  }

  const meta = SCREEN_META[screen];
  // Compute the queue-pending count for the sidebar sync indicator.
  const pendingCount = ready?.queue.pending ?? (state && state.status !== "READY" ? state.queue.pending : 0);
  const failedCount = ready?.queue.failed ?? 0;
  const isSignedOut = !demoMode && (state === null || state.status === "SIGNED_OUT" || state.status === "SESSION_EXPIRED");

  // Common screen props.
  const screenProps = {
    runtime,
    ready,
    online,
    demoMode,
    onSignIn: () => setSignInOpen(true),
    onNavigate: navigate,
  };

  return (
    <div className="dsk-shell">
      <Titlebar
        online={online}
        onToggleOnline={() => setOnline((v) => !v)}
        demoMode={demoMode}
        ready={ready}
        failedCount={failedCount}
      />
      <div className="dsk-shell__body">
        <Sidebar
          active={screen}
          onNavigate={navigate}
          platform={profile.platform}
          online={online}
          pendingCount={pendingCount}
          failedCount={failedCount}
        />
        <div className="dsk-main">
          <Topbar
            crumb={meta.crumb}
            title={meta.title}
            online={online}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={
              screen === "pos"
                ? "Global search (use F2 in the product browser)\u2026"
                : "Search products, sales, customers\u2026"
            }
            ready={ready}
            demoMode={demoMode}
            onSignIn={() => setSignInOpen(true)}
            onSignOut={() => void logout()}
          />
          <main className="dsk-content" id="main-content">
            {loading && state === null && !demoMode ? (
              <div className="dsk-screen">
                <div className="dsk-empty" style={{ minHeight: "320px" }}>
                  <div className="dsk-empty__title">Connecting to TradeOS\u2026</div>
                  <div className="dsk-empty__text">Resolving session and business context.</div>
                </div>
              </div>
            ) : null}
            {!loading && error && !demoMode && !ready ? (
              <div className="dsk-screen">
                <div className="dsk-banner dsk-banner--warning">
                  <div className="dsk-banner__body">
                    <div className="dsk-banner__title">Desktop runtime error</div>
                    <div className="dsk-banner__text">{error}</div>
                  </div>
                </div>
              </div>
            ) : null}
            {screen === "dashboard" ? (
              <Dashboard {...screenProps} />
            ) : screen === "pos" ? (
              <Pos {...screenProps} />
            ) : screen === "sales" ? (
              <Sales {...screenProps} />
            ) : screen === "inventory" ? (
              <Inventory {...screenProps} />
            ) : screen === "customers" ? (
              <Customers {...screenProps} />
            ) : screen === "reports" ? (
              <Reports {...screenProps} />
            ) : null}
          </main>
        </div>
      </div>
      <SignInDialog
        open={signInOpen && isSignedOut}
        loading={loading}
        error={error}
        onClose={() => setSignInOpen(false)}
        onSubmit={async (identifier, password) => {
          await login(identifier, password);
          setSignInOpen(false);
        }}
      />
    </div>
  );
}

function Titlebar({
  online,
  onToggleOnline,
  demoMode,
  ready,
  failedCount,
}: {
  online: boolean;
  onToggleOnline: () => void;
  demoMode: boolean;
  ready: { user: { displayName: string }; business: { name: string } } | null;
  failedCount: number;
}) {
  return (
    <div className="dsk-titlebar" role="presentation">
      <div className="dsk-titlebar__brand">
        <span className="dsk-titlebar__brand-dot" aria-hidden />
        TradeOS Africa
      </div>
      <span className="dsk-titlebar__doc">
        Desktop · v0.0.1
        {demoMode ? " · DEMO MODE" : ready ? ` · ${ready.business.name}` : ""}
        {failedCount > 0 ? ` · ${failedCount} sync failed` : ""}
      </span>
      <div className="dsk-titlebar__spacer" />
      <button
        type="button"
        className="dsk-titlebar__ctrl"
        onClick={onToggleOnline}
        title={online ? "Online — click to simulate offline" : "Offline — click to go online"}
        aria-label="Toggle online status"
      >
        {online ? "Online" : "Offline"}
      </button>
      <div className="dsk-titlebar__controls">
        <button
          type="button"
          className="dsk-titlebar__ctrl"
          onClick={() => void windowControls.minimize()}
          aria-label="Minimize window"
        >
          <IconMinus width={14} height={14} />
        </button>
        <button
          type="button"
          className="dsk-titlebar__ctrl"
          onClick={() => void windowControls.toggleMaximize()}
          aria-label="Maximize window"
        >
          <IconSquare width={12} height={12} />
        </button>
        <button
          type="button"
          className="dsk-titlebar__ctrl dsk-titlebar__ctrl--close"
          onClick={() => void windowControls.close()}
          aria-label="Close window"
        >
          <IconClose width={14} height={14} />
        </button>
      </div>
    </div>
  );
}
