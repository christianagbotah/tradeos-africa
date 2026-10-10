"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DemoAccountSelect } from "./demo-account-select";
import { getActiveBusinessId, getOrCreateClientId, setActiveBusinessId } from "../lib/offline-sync";
import { clearWorkspaceBootstrap, readWorkspaceBootstrap } from "../lib/workspace-bootstrap";
import { clearFeatureCaches } from "../lib/feature-cache";
import { finalizePendingLogout, invalidateSessionEpoch, isLogoutPending, markLogoutPending } from "../lib/session-lifecycle";
import type { BusinessContext, MePayload } from "../lib/workspace-types";

type AuthMode = "login" | "register";
type PublicEntryMode =
  | { kind: "loading" }
  | { kind: "auth" }
  | { kind: "onboarding" }
  | { kind: "error" }
  | { kind: "redirect"; href: "/dashboard" };

export function getPublicEntryMode(input: {
  resolved: boolean;
  session: MePayload | null;
  workspaceReady: boolean;
  error: string | null;
}): PublicEntryMode {
  if (!input.resolved) return { kind: "loading" };
  if (!input.session) return { kind: "auth" };
  if (input.session.memberships.length === 0) return { kind: "onboarding" };
  if (input.workspaceReady) return { kind: "redirect", href: "/dashboard" };
  if (input.error) return { kind: "error" };
  return { kind: "loading" };
}

export function PublicEntry() {
  const router = useRouter();
  const [resolved, setResolved] = useState(false);
  const [session, setSession] = useState<MePayload | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setError(null);
    setWorkspaceReady(false);
    try {
      const pendingLogout = await finalizePendingLogout();
      if (pendingLogout !== "none") {
        clearWorkspaceBootstrap();
        clearFeatureCaches();
        setActiveBusinessId(null);
        setSession(null);
        if (pendingLogout === "pending") setError("Sign-out is saved on this device and will finish when the connection is available.");
        return;
      }
      const response = await fetch("/api/session/me", { cache: "no-store" });
      if (response.status === 401) {
        invalidateSessionEpoch();
        clearWorkspaceBootstrap();
        clearFeatureCaches();
        setSession(null);
        setActiveBusinessId(null);
        return;
      }
      const data = await readResponse<MePayload>(response);
      setSession(data);
      if (data.memberships.length === 0) {
        setActiveBusinessId(null);
        return;
      }

      const remembered = getActiveBusinessId();
      const membership = data.memberships.find((item) => item.businessId === remembered) ?? data.memberships[0]!;
      const business = await api<BusinessContext>(`/api/tradeos/v1/businesses/${membership.businessId}/context`);
      if (!business.branches.some((branch) => branch.active)) throw new Error("This business has no active branch.");
      setActiveBusinessId(membership.businessId);
      setWorkspaceReady(true);
    } catch (reason) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const cached = readWorkspaceBootstrap();
        if (cached) {
          setSession(cached.session);
          setActiveBusinessId(cached.context.business.id);
          setWorkspaceReady(true);
          return;
        }
      }
      setError(messageFrom(reason));
    } finally {
      setResolved(true);
    }
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);

  const mode = getPublicEntryMode({ resolved, session, workspaceReady, error });
  useEffect(() => {
    if (mode.kind === "redirect") router.replace(mode.href);
  }, [mode.kind, router]);

  if (mode.kind === "loading" || mode.kind === "redirect") return <LoadingScreen />;
  if (mode.kind === "auth") return <AuthScreen onAuthenticated={() => void loadSession()} error={error} />;
  if (mode.kind === "error") return <WorkspaceRecoveryScreen message={error ?? "TradeOS could not load this workspace."} onRetry={() => void loadSession()} onLogout={() => void logout(setSession)} />;
  return <BusinessOnboarding userName={session!.user.displayName} onCreated={() => void loadSession()} onLogout={() => void logout(setSession)} />;
}

const businessTypes = [
  ["RETAIL_HARDWARE", "Retail & hardware", "Provisions, nails, rods, cable, sandpaper and building materials"],
  ["FOOD", "Food & waakye", "Waakye, chop bar, restaurant, bakery and food vending"],
  ["SALON_BARBER", "Salon & barber", "Hair, barbering, beauty, nails and related services"],
  ["DRINKING_SPOT", "Drinking spot", "Drinks by crate, bottle, glass or shot"],
  ["WASHING_BAY", "Washing bay", "Vehicle wash services, attendants and consumables"],
  ["CAR_PARK", "Car park", "Entry/exit, time billing and shift cash"],
  ["DISTRIBUTION", "Distribution", "Wholesale, FMCG, cement and multi-unit distribution"],
  ["SERVICES", "Services", "Other appointment, job or service businesses"],
  ["OTHER", "Other", "Start with the common TradeOS core and configure your workflow"],
] as const;

function AuthScreen({ onAuthenticated, error }: { onAuthenticated: () => void; error: string | null }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [displayName, setDisplayName] = useState("");
  const [demoAccountId, setDemoAccountId] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(error);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      if (isLogoutPending()) {
        const pendingLogout = await finalizePendingLogout();
        if (pendingLogout === "pending") throw new Error("TradeOS is still finishing your previous sign-out. Reconnect and try again.");
      }
      const deviceKey = getOrCreateClientId();
      const common = { password, platform: "WEB", deviceKey, appVersion: webVersion() };
      const body = mode === "register"
        ? { ...common, displayName, ...(identifier.trim().startsWith("+") ? { phone: identifier.trim() } : { email: identifier.trim() }) }
        : { ...common, identifier: identifier.trim() };
      await api(`/api/session/${mode}`, { method: "POST", body: JSON.stringify(body) });
      onAuthenticated();
    } catch (reason) {
      setLocalError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand-lockup auth-brand"><div className="brand-mark">T</div><div><strong>TradeOS</strong><span>Africa</span></div></div>
        <p  className="tradeos-kicker">One operating system for everyday business</p>
        <h1>From a single chair or food stand to a multi-branch company.</h1>
        <p>Sell, track stock, manage services and credit, work offline, and understand what is happening in plain business language.</p>
        <div className="auth-points"><span>Offline-first</span><span>Bulk → unit selling</span><span>Services + consumables</span><span>Returns & refunds</span></div>
      </section>

      <section className="auth-card">
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>Sign in</button>
          <button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>Create account</button>
        </div>
        <div><p  className="tradeos-kicker">{mode === "login" ? "Welcome back" : "Start your business"}</p><h2>{mode === "login" ? "Sign in to TradeOS" : "Create your owner account"}</h2></div>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {mode === "register" ? (
            <label>Full name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Business owner name" /></label>
          ) : (
            <DemoAccountSelect selectedId={demoAccountId} onSelect={(account) => {
              setDemoAccountId(account?.id ?? "");
              if (!account) return;
              setIdentifier(account.email);
              setPassword(account.password);
              setLocalError(null);
            }} />
          )}
          <label>Email or phone<input required value={identifier} onChange={(event) => { setIdentifier(event.target.value); if (mode === "login") setDemoAccountId(""); }} placeholder="name@example.com or +233…" /></label>
          <label>Password<input required minLength={8} type="password" value={password} onChange={(event) => { setPassword(event.target.value); if (mode === "login") setDemoAccountId(""); }} placeholder="At least 8 characters" /></label>
          {localError ? <div className="form-error">{localError}</div> : null}
          <button  className="tos-button tos-button--primary auth-submit" type="submit" disabled={busy}>{busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <small className="security-note">Your browser session uses HttpOnly cookies; TradeOS access tokens are not exposed to page JavaScript.</small>
      </section>
    </main>
  );
}

function BusinessOnboarding({ userName, onCreated, onLogout }: { userName: string; onCreated: () => void; onLogout: () => void }) {
  const [name, setName] = useState("");
  const [branchName, setBranchName] = useState("Main");
  const [businessType, setBusinessType] = useState<(typeof businessTypes)[number][0]>("RETAIL_HARDWARE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/tradeos/v1/onboarding/business", {
        method: "POST",
        body: JSON.stringify({ name, branchName, businessType }),
      });
      onCreated();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup-shell">
      <header className="setup-topbar">
        <div className="brand-lockup"><div className="brand-mark">T</div><div><strong>TradeOS</strong><span>Africa</span></div></div>
        <button  className="tos-button tos-button--ghost" type="button" onClick={onLogout}>Sign out</button>
      </header>
      <section className="setup-card wide">
        <p  className="tradeos-kicker">Welcome, {userName}</p>
        <h1>Create your first business</h1>
        <p className="setup-copy">Choose what best describes the business. TradeOS will use the same strong commerce engine while tailoring the workflow and language.</p>
        <form onSubmit={(event) => void submit(event)}>
          <div className="tradeos-form-row">
            <label>Business name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Akosua's Waakye" /></label>
            <label>Branch name<input required value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="Main" /></label>
          </div>
          <div className="business-type-grid">
            {businessTypes.map(([id, label, detail]) => (
              <button type="button" key={id} className={businessType === id ? "business-type selected" : "business-type"} onClick={() => setBusinessType(id)}>
                <strong>{label}</strong><span>{detail}</span>
              </button>
            ))}
          </div>
          {error ? <div className="form-error">{error}</div> : null}
          <button  className="tos-button tos-button--primary setup-submit" type="submit" disabled={busy}>{busy ? "Creating…" : "Create business"}</button>
        </form>
      </section>
    </main>
  );
}


function WorkspaceRecoveryScreen({ message, onRetry, onLogout }: { message: string; onRetry: () => void; onLogout: () => void }) {
  return (
    <main className="loading-shell workspace-recovery-shell">
      <div className="brand-mark">T</div>
      <div className="workspace-recovery-card">
        <p  className="tradeos-kicker">Workspace unavailable</p>
        <h1>TradeOS could not open your business workspace.</h1>
        <p>{message}</p>
        <div className="workspace-recovery-actions">
          <button  className="tos-button tos-button--primary" type="button" onClick={onRetry}>Try again</button>
          <button  className="tos-button tos-button--secondary" type="button" onClick={onLogout}>Sign out</button>
        </div>
      </div>
    </main>
  );
}

function LoadingScreen() {
  return <main className="loading-shell"><div className="brand-mark">T</div><strong>Loading TradeOS Africa…</strong></main>;
}

async function logout(setSession: (value: MePayload | null) => void) {
  markLogoutPending();
  clearWorkspaceBootstrap();
  clearFeatureCaches();
  setActiveBusinessId(null);
  setSession(null);
  await finalizePendingLogout();
}

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  return readResponse<T>(response);
}

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) {
    const candidate = body as { message?: unknown } | null;
    throw new Error(typeof candidate?.message === "string" ? candidate.message : `Request failed (${response.status})`);
  }
  return body as T;
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Something went wrong. Please try again.";
}

function webVersion(): string {
  return process.env.NEXT_PUBLIC_TRADEOS_VERSION ?? "web-dev";
}
