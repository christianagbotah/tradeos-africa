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
    <main className="auth-page">
      {/* ===== Left: brand / story panel ===== */}
      <aside className="auth-aside">
        <div className="auth-aside-glow auth-aside-glow--gold" />
        <div className="auth-aside-glow auth-aside-glow--green" />

        <div className="auth-aside-top">
          <div className="auth-card-brand">
            <div className="auth-mark">T</div>
            <div className="auth-brand-text">
              <strong>TradeOS</strong>
              <span>Africa</span>
            </div>
          </div>
        </div>

        <div className="auth-aside-body">
          <p className="auth-aside-eyebrow">The business OS for African trade</p>
          <h2 className="auth-aside-headline">
            Run your whole business from your pocket.
          </h2>
          <p className="auth-aside-sub">
            Sells, stocks, and reconciles — even when the network drops. One ledger from waakye spot to wholesale.
          </p>
          <ul className="auth-aside-points">
            <li>
              <span className="auth-aside-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span>
              <span>Track every cedi, shift, and sale in real time</span>
            </li>
            <li>
              <span className="auth-aside-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span>
              <span>Works offline — syncs the moment you reconnect</span>
            </li>
            <li>
              <span className="auth-aside-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></span>
              <span>POS, inventory, cashbook &amp; reports in one place</span>
            </li>
          </ul>
        </div>

        <figure className="auth-aside-quote">
          <blockquote>“TradeOS replaced three notebooks and my calculator. I close the day in two minutes now.”</blockquote>
          <figcaption>
            <span className="auth-aside-quote-name">Akosua M.</span>
            <span className="auth-aside-quote-role">Waakye spot owner · Kumasi</span>
          </figcaption>
        </figure>
      </aside>

      {/* ===== Right: form panel ===== */}
      <section className="auth-main">
        <div className="auth-main-inner">
          <div className="auth-main-brand">
            <div className="auth-mark">T</div>
            <div className="auth-brand-text">
              <strong>TradeOS</strong>
              <span>Africa</span>
            </div>
          </div>

          <div className="auth-card-head">
            <h1 className="auth-card-title">
              {mode === "login" ? "Welcome back" : "Create account"}
            </h1>
            <p className="auth-card-subtitle">
              {mode === "login"
                ? "Sign in to run your business"
                : "Start your business journey today"}
            </p>
          </div>

          <div className="auth-switch">
            <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>Sign in</button>
            <button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>Register</button>
          </div>

          <form className="auth-card-form" onSubmit={(event) => void submit(event)}>
            {mode === "register" ? (
              <label className="auth-input">
                <span>Full name</span>
                <span className="auth-input-field">
                  <svg className="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                  <input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Business owner name" autoComplete="name" />
                </span>
              </label>
            ) : (
              <div className="auth-input">
                <span>Demo account</span>
                <span className="auth-input-field">
                  <svg className="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M6 21v-1a6 6 0 0 1 12 0v1" /></svg>
                  <DemoAccountSelect hideLabel selectedId={demoAccountId} onSelect={(account) => {
                    setDemoAccountId(account?.id ?? "");
                    if (!account) return;
                    setIdentifier(account.email);
                    setPassword(account.password);
                    setLocalError(null);
                  }} />
                </span>
              </div>
            )}
            <label className="auth-input">
              <span>Email or phone</span>
              <span className="auth-input-field">
                <svg className="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>
                <input required value={identifier} onChange={(event) => { setIdentifier(event.target.value); if (mode === "login") setDemoAccountId(""); }} placeholder="name@example.com or +233" autoComplete="email" />
              </span>
            </label>
            <label className="auth-input">
              <span>Password</span>
              <span className="auth-input-field">
                <svg className="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                <input required minLength={8} type="password" value={password} onChange={(event) => { setPassword(event.target.value); if (mode === "login") setDemoAccountId(""); }} placeholder="At least 8 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} />
              </span>
            </label>
            {mode === "login" ? (
              <div className="auth-form-aux">
                <a className="auth-forgot" href="#" onClick={(event) => { event.preventDefault(); setLocalError("Password reset is not available in this build. Contact your workspace admin."); }}>Forgot password?</a>
              </div>
            ) : null}
            {localError ? <div className="auth-card-error">{localError}</div> : null}
            <button className="auth-card-submit" type="submit" disabled={busy}>
              {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
              {!busy && (
                <svg className="auth-submit-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              )}
            </button>
          </form>

          <div className="auth-trust">
            <span className="auth-trust-item">
              <span className="auth-trust-dot">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </span>
              Offline-first
            </span>
            <span className="auth-trust-item">
              <span className="auth-trust-dot">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </span>
              GHS ready
            </span>
            <span className="auth-trust-item">
              <span className="auth-trust-dot">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </span>
              Works without internet
            </span>
          </div>

          <p className="auth-card-foot">
            TradeOS Africa · Built for African businesses
          </p>
        </div>
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
    <main className="onboarding-shell">
      <header className="onboarding-topbar">
        <div className="auth-card-brand">
          <div className="auth-mark">T</div>
          <div>
            <strong>TradeOS</strong>
            <span>Africa</span>
          </div>
        </div>
        <button className="tos-button tos-button--ghost" type="button" onClick={onLogout}>Sign out</button>
      </header>

      <section className="onboarding-card">
        <div className="onboarding-header">
          <p className="tradeos-page-eyebrow">Welcome, {userName}</p>
          <h1>Create your first business</h1>
          <p className="onboarding-description">Choose what best describes the business. TradeOS will use the same strong commerce engine while tailoring the workflow and language.</p>
        </div>

        <form className="onboarding-form" onSubmit={(event) => void submit(event)}>
          <div className="tradeos-form-row">
            <label className="auth-input">
              <span>Business name</span>
              <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Akosua's Waakye" />
            </label>
            <label className="auth-input">
              <span>Branch name</span>
              <input required value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="Main" />
            </label>
          </div>

          <div className="business-type-grid">
            {businessTypes.map(([id, label, detail]) => (
              <button type="button" key={id} className={businessType === id ? "business-type selected" : "business-type"} onClick={() => setBusinessType(id)}>
                <strong>{label}</strong>
                <span>{detail}</span>
              </button>
            ))}
          </div>

          {error ? <div className="auth-card-error">{error}</div> : null}

          <button className="tos-button tos-button--primary onboarding-submit" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create business"}
          </button>
        </form>
      </section>
    </main>
  );
}

function WorkspaceRecoveryScreen({ message, onRetry, onLogout }: { message: string; onRetry: () => void; onLogout: () => void }) {
  return (
    <main className="loading-shell workspace-recovery-shell">
      <div className="auth-mark">T</div>
      <div className="workspace-recovery-card">
        <p className="tradeos-page-eyebrow">Workspace unavailable</p>
        <h1>TradeOS could not open your business workspace.</h1>
        <p>{message}</p>
        <div className="workspace-recovery-actions">
          <button className="tos-button tos-button--primary" type="button" onClick={onRetry}>Try again</button>
          <button className="tos-button tos-button--secondary" type="button" onClick={onLogout}>Sign out</button>
        </div>
      </div>
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-shell">
      <div className="auth-mark">T</div>
      <strong>Loading TradeOS Africa…</strong>
    </main>
  );
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
