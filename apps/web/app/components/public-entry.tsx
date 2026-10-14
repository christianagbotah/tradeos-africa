"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SUPPORTED_COUNTRIES,
  SUPPORTED_CURRENCIES,
  SUPPORTED_TIMEZONES,
  getCountry,
  getDefaultCurrencyCode,
  getSuggestedTimezones,
} from "@tradeos/contracts";
import { getOfflineQueue, type WebSession } from "../../lib/offline-sync";
import { getOrCreateWebDeviceKey, WEB_APP_VERSION } from "../../lib/web-device";
import { Button } from "./ui/button";
import { IconAlert, IconCheck, IconRefresh, IconShield } from "./ui/icons";

// --- Phase state machine --------------------------------------------------

export type PublicEntryPhase = "loading" | "auth" | "onboarding" | "recovery";
export type AuthTab = "signin" | "register";

const BUSINESS_TYPES = [
  { value: "RETAIL_HARDWARE", label: "Retail / Hardware" },
  { value: "FOOD", label: "Food & Beverage" },
  { value: "SALON_BARBER", label: "Salon / Barber" },
  { value: "DRINKING_SPOT", label: "Drinking spot / Bar" },
  { value: "WASHING_BAY", label: "Washing bay" },
  { value: "CAR_PARK", label: "Car park" },
  { value: "DISTRIBUTION", label: "Distribution" },
  { value: "SERVICES", label: "Services" },
  { value: "OTHER", label: "Other" },
] as const;

const APP_VERSION = WEB_APP_VERSION;

// --- API response shapes --------------------------------------------------

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  expiresAt?: string;
}

interface AuthResponse {
  user: { id: string; displayName: string; email: string | null; phoneE164: string | null };
  session: AuthSession;
}

export interface Membership {
  id: string;
  businessId: string;
  businessName: string;
  businessType: string;
  businessStatus: string;
  role: string;
  staffId: string | null;
}

export interface MeResponse {
  user: { id: string; displayName: string; email: string | null; phoneE164: string | null };
  client: { platform: string; deviceKey: string; appVersion: string };
  memberships: Membership[];
}

export interface BusinessContextResponse {
  business: {
    id: string;
    name: string;
    businessType: string;
    countryCode: string;
    currencyCode: string;
    timezone: string;
    status: string;
  };
  membership: { role: string; staffId: string | null };
  branches: Array<{
    id: string;
    name: string;
    code: string;
    timezone: string;
    active: boolean;
  }>;
}

interface OnboardingResponse {
  business: { id: string; name: string; businessType: string; countryCode: string; currencyCode: string; timezone: string };
  branch: { id: string; name: string; code: string };
  owner: { staffId: string; membershipId: string; role: string };
}

export interface PendingAuth {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  displayName: string;
}

// --- Component ------------------------------------------------------------

/**
 * Returns true when the authenticated user has no business memberships yet
 * and must complete onboarding before entering the workspace.
 */
export function needsOnboarding(me: MeResponse): boolean {
  return !me.memberships.some((membership) => (
    membership.businessStatus === "ACTIVE" && Boolean(membership.staffId)
  ));
}

/** Selects a usable membership, preferring the last business used on this device. */
export function selectMembershipForLogin(me: MeResponse, preferredBusinessId?: string | null): Membership | null {
  const usable = me.memberships.filter((membership) => (
    membership.businessStatus === "ACTIVE" && Boolean(membership.staffId)
  ));
  if (preferredBusinessId) {
    const preferred = usable.find((membership) => membership.businessId === preferredBusinessId);
    if (preferred) return preferred;
  }
  return usable[0] ?? null;
}

/**
 * Routing decision for the initial public-entry phase.
 *
 * - no stored session and not yet booted → "loading"
 * - no stored session after boot → "auth"
 * - stored session but validation failed → "recovery"
 * - stored session and validation passed → "loading" (the component will redirect)
 *
 * Exposed for unit testing so the routing logic can be verified without
 * driving the React component.
 */
export function derivePhase(opts: {
  booted: boolean;
  hasStoredSession: boolean;
  validationResult: "pending" | "valid" | "invalid";
}): PublicEntryPhase {
  if (!opts.booted) return "loading";
  if (!opts.hasStoredSession) return "auth";
  if (opts.validationResult === "pending") return "loading";
  if (opts.validationResult === "invalid") return "recovery";
  return "loading";
}

export function PublicEntry() {
  const router = useRouter();
  const offlineQueue = useMemo(() => getOfflineQueue(), []);
  const [phase, setPhase] = useState<PublicEntryPhase>("loading");
  const [authTab, setAuthTab] = useState<AuthTab>("signin");
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  // Initial boot: check for an existing session.
  useEffect(() => {
    const stored = offlineQueue.sessions.load();
    if (!stored) {
      setPhase("auth");
      return;
    }
    // Validate the session by calling /v1/me. If it fails, show recovery.
    void validateSession(stored).then((ok) => {
      if (ok) {
        router.replace("/dashboard");
      } else {
        setPhase("recovery");
        setRecoveryError("Your session could not be verified. It may have expired.");
      }
    });
  }, [offlineQueue, router]);

  if (phase === "loading") {
    return <LoadingScreen title="Loading TradeOS…" text="Checking your session." />;
  }

  if (phase === "recovery") {
    return (
      <RecoveryScreen
        error={recoveryError}
        onRetry={async () => {
          const stored = offlineQueue.sessions.load();
          if (!stored) {
            setPhase("auth");
            return;
          }
          const ok = await validateSession(stored);
          if (ok) {
            router.replace("/dashboard");
          } else {
            setRecoveryError("Session still invalid. Try signing in again.");
          }
        }}
        onSignIn={() => {
          offlineQueue.sessions.clear();
          setPhase("auth");
        }}
      />
    );
  }

  if (phase === "onboarding" && pendingAuth) {
    return (
      <OnboardingForm
        pendingAuth={pendingAuth}
        onComplete={(session) => {
          offlineQueue.sessions.save(session);
          router.replace("/dashboard");
        }}
        onCancel={() => {
          setPendingAuth(null);
          setPhase("auth");
        }}
      />
    );
  }

  return (
    <AuthForm
      tab={authTab}
      onTabChange={setAuthTab}
      onAuthenticated={async (auth, me) => {
        const lastContext = offlineQueue.sessions.loadLastContext();
        const membership = selectMembershipForLogin(me, lastContext?.businessId);
        if (!membership) {
          // No usable active business membership yet → first-business onboarding.
          setPendingAuth({
            accessToken: auth.accessToken,
            refreshToken: auth.refreshToken,
            clientId: auth.clientId,
            displayName: me.user.displayName,
          });
          setPhase("onboarding");
          return;
        }
        // Existing business memberships must be hydrated from the authoritative
        // business context before the workspace is allowed to use branch-scoped APIs.
        const context = await loadBusinessContext(auth.accessToken, membership.businessId);
        const session = buildSessionFromBusinessContext(
          auth,
          me,
          membership,
          context,
          lastContext?.businessId === membership.businessId ? lastContext.branchId : undefined,
        );
        offlineQueue.sessions.save(session);
        router.replace("/dashboard");
      }}
    />
  );
}

// --- Session validation ---------------------------------------------------

async function validateSession(_session: WebSession): Promise<boolean> {
  try {
    const res = await getOfflineQueue().authenticatedFetch("/v1/me");
    return res.ok;
  } catch {
    return false;
  }
}

export function buildSessionFromMembership(auth: AuthSession, me: MeResponse, m: Membership): WebSession {
  // Legacy pure constructor retained for compatibility with callers/tests that do
  // not yet have authoritative business context. Existing-user login no longer
  // persists this placeholder session; it uses buildSessionFromBusinessContext.
  return {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    clientId: auth.clientId,
    businessId: m.businessId,
    branchId: "00000000-0000-0000-0000-000000000000",
    staffId: m.staffId ?? "00000000-0000-0000-0000-000000000000",
    currencyCode: "GHS",
    timezone: "Africa/Accra",
    businessName: m.businessName,
    role: m.role,
    displayName: me.user.displayName,
  };
}

export function buildSessionFromBusinessContext(
  auth: AuthSession,
  me: MeResponse,
  membership: Membership,
  context: BusinessContextResponse,
  preferredBranchId?: string,
): WebSession {
  if (context.business.id !== membership.businessId) {
    throw new Error("BUSINESS_CONTEXT_MISMATCH");
  }

  const activeBranches = context.branches.filter((branch) => branch.active);
  const branch = (preferredBranchId
    ? activeBranches.find((candidate) => candidate.id === preferredBranchId)
    : undefined)
    ?? activeBranches.find((candidate) => candidate.code === "MAIN")
    ?? activeBranches[0];
  if (!branch) {
    throw new Error("NO_ACTIVE_BRANCH");
  }
  if (!context.membership.staffId) {
    throw new Error("NO_ACTIVE_STAFF");
  }

  return {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    clientId: auth.clientId,
    businessId: context.business.id,
    branchId: branch.id,
    staffId: context.membership.staffId,
    currencyCode: context.business.currencyCode,
    timezone: branch.timezone || context.business.timezone,
    businessName: context.business.name,
    role: context.membership.role,
    displayName: me.user.displayName,
  };
}

async function loadBusinessContext(accessToken: string, businessId: string): Promise<BusinessContextResponse> {
  const res = await fetch(`/v1/businesses/${encodeURIComponent(businessId)}/context`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await res.json()) as Partial<BusinessContextResponse> & { error?: string; message?: string };
  if (!res.ok) {
    throw new Error(json.message ?? json.error ?? "Business context could not be loaded.");
  }
  if (!json.business || !json.membership || !Array.isArray(json.branches)) {
    throw new Error("Server returned incomplete business context.");
  }
  return json as BusinessContextResponse;
}

// --- Auth form (sign in / register) --------------------------------------

interface AuthFormProps {
  tab: AuthTab;
  onTabChange: (tab: AuthTab) => void;
  onAuthenticated: (auth: AuthSession, me: MeResponse) => void | Promise<void>;
}

function AuthForm({ tab, onTabChange, onAuthenticated }: AuthFormProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = tab === "signin"
    ? identifier.trim().length > 0 && password.length > 0
    : displayName.trim().length > 0 && password.length >= 6 && (email.trim().length > 0 || phone.trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const deviceKey = getOrCreateWebDeviceKey();
      const endpoint = tab === "signin" ? "/v1/auth/login" : "/v1/auth/register";
      const body =
        tab === "signin"
          ? { identifier: identifier.trim(), password, platform: "WEB", deviceKey, appVersion: APP_VERSION }
          : {
              displayName: displayName.trim(),
              email: email.trim() || undefined,
              phone: phone.trim() || undefined,
              password,
              platform: "WEB",
              deviceKey,
              appVersion: APP_VERSION,
            };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string; message?: string } & Partial<AuthResponse>;
      if (!res.ok) {
        setError(json.message ?? json.error ?? "Authentication failed.");
        setBusy(false);
        return;
      }
      if (!json.session || !json.user) {
        setError("Server returned an incomplete session.");
        setBusy(false);
        return;
      }
      const auth = json.session;
      // Fetch memberships.
      const meRes = await fetch("/v1/me", {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (!meRes.ok) {
        setError("Signed in but could not load your memberships.");
        setBusy(false);
        return;
      }
      const me = (await meRes.json()) as MeResponse;
      await onAuthenticated(auth, me);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Check your connection.");
      setBusy(false);
    }
  };

  return (
    <div className="tos-public tos-animate-fade-in">
      <BrandPanel />
      <div className="tos-public__form-side">
        <div className="tos-public__form tos-stagger">
          <div className="tos-public__form-head">
            <span className="tos-public__form-eyebrow tos-animate-fade-in-down">Secure access</span>
            <h1 className="tos-public__form-title tos-animate-fade-in-up">
              {tab === "signin" ? "Sign in to TradeOS" : "Create your TradeOS account"}
            </h1>
            <p className="tos-public__form-sub tos-animate-fade-in-up">
              {tab === "signin"
                ? "Use the same owner or staff account you use on the mobile and desktop apps."
                : "One account works across web, mobile and desktop. Your business stays in sync everywhere."}
            </p>
          </div>

          <div className="tos-tabs" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              className="tos-tabs__tab"
              aria-selected={tab === "signin"}
              onClick={() => onTabChange("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              className="tos-tabs__tab"
              aria-selected={tab === "register"}
              onClick={() => onTabChange("register")}
            >
              Register
            </button>
          </div>

          {error ? (
            <div className="tos-banner tos-banner--danger" role="alert">
              <IconAlert className="tos-banner__icon" />
              <div className="tos-banner__body">
                <span className="tos-banner__title">Could not continue</span>
                <span className="tos-banner__text">{error}</span>
              </div>
            </div>
          ) : null}

          <form className="tos-stack" onSubmit={handleSubmit}>
            {tab === "register" ? (
              <FieldLabel label="Display name" htmlFor="pe-name" required>
                <input
                    id="pe-name"
                    className="tos-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Ama Mensah"
                    autoComplete="name"
                    required
                  />
              </FieldLabel>
            ) : null}

            <FieldLabel label={tab === "signin" ? "Email or phone" : "Email"} htmlFor="pe-id" required>
              <input
                  id="pe-id"
                  className="tos-input"
                  value={tab === "signin" ? identifier : email}
                  onChange={(e) => (tab === "signin" ? setIdentifier(e.target.value) : setEmail(e.target.value))}
                  placeholder={tab === "signin" ? "you@business.com or +233…" : "you@business.com"}
                  autoComplete="email"
                />
            </FieldLabel>

            {tab === "register" ? (
              <FieldLabel label="Phone (optional if email given)" htmlFor="pe-phone">
                <input
                    id="pe-phone"
                    className="tos-input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+233 24 000 0000"
                    autoComplete="tel"
                  />
              </FieldLabel>
            ) : null}

            <FieldLabel label="Password" htmlFor="pe-pw" required>
              <input
                  id="pe-pw"
                  type="password"
                  className="tos-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tab === "register" ? "At least 6 characters" : "Enter your password"}
                  autoComplete={tab === "signin" ? "current-password" : "new-password"}
                  required
                />
            </FieldLabel>

            <Button type="submit" variant="gold" size="lg" block loading={busy} disabled={!canSubmit}>
              {tab === "signin" ? "Open workspace" : "Create account"}
            </Button>
          </form>

          <div className="tos-public__form-note">
            <IconShield className="tos-public__form-note-icon" />
            <span>
              Your session stays on this device. Sales made offline are saved locally and
              sync automatically when your connection returns.
            </span>
          </div>

          <div className="tos-public__form-foot">
            <span>Need help?</span>
            <a className="tos-public__form-link" href="mailto:support@tradeos.africa">Contact support</a>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Onboarding form ------------------------------------------------------

interface OnboardingFormProps {
  pendingAuth: PendingAuth;
  onComplete: (session: WebSession) => void;
  onCancel: () => void;
}

function OnboardingForm({ pendingAuth, onComplete, onCancel }: OnboardingFormProps) {
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState<typeof BUSINESS_TYPES[number]["value"]>("RETAIL_HARDWARE");
  const [branchName, setBranchName] = useState("Main");
  const [countryCode, setCountryCode] = useState("GH");
  const [currencyCode, setCurrencyCode] = useState("GHS");
  const [timezone, setTimezone] = useState("Africa/Accra");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onCountryChange = (next: string) => {
    setCountryCode(next);
    const country = getCountry(next);
    if (country) {
      const defaultCurrency = getDefaultCurrencyCode(next);
      if (defaultCurrency) setCurrencyCode(defaultCurrency);
      const suggested = getSuggestedTimezones(next);
      if (suggested && suggested.length > 0) setTimezone(suggested[0]!);
    }
  };

  const canSubmit = businessName.trim().length >= 2 && !busy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/v1/onboarding/business", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pendingAuth.accessToken}`,
        },
        body: JSON.stringify({
          name: businessName.trim(),
          businessType,
          branchName: branchName.trim() || "Main",
          countryCode,
          currencyCode,
          timezone,
        }),
      });
      const json = (await res.json()) as { error?: string; message?: string } & Partial<OnboardingResponse>;
      if (!res.ok || !json.business || !json.branch || !json.owner) {
        setError(json.message ?? json.error ?? "Onboarding failed.");
        setBusy(false);
        return;
      }
      const session: WebSession = {
        accessToken: pendingAuth.accessToken,
        refreshToken: pendingAuth.refreshToken,
        clientId: pendingAuth.clientId,
        businessId: json.business.id,
        branchId: json.branch.id,
        staffId: json.owner.staffId,
        currencyCode: json.business.currencyCode,
        timezone: json.business.timezone,
        businessName: json.business.name,
        role: json.owner.role,
        displayName: pendingAuth.displayName,
      };
      onComplete(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Check your connection.");
      setBusy(false);
    }
  };

  return (
    <div className="tos-public tos-animate-fade-in">
      <BrandPanel />
      <div className="tos-public__form-side">
        <div className="tos-public__form tos-stagger">
          <div className="tos-public__form-head">
            <div className="tos-public__onboarding-progress">
              <span className="tos-public__onboarding-step tos-public__onboarding-step--done" aria-label="Step 1 complete">
                <IconCheck style={{ width: 12, height: 12 }} />
              </span>
              <span>Account</span>
              <span aria-hidden="true">→</span>
              <span className="tos-public__onboarding-step tos-public__onboarding-step--active">2</span>
              <span>Business</span>
            </div>
            <span className="tos-public__form-eyebrow tos-animate-fade-in-down">Set up your business</span>
            <h1 className="tos-public__form-title tos-animate-fade-in-up">Tell us about your business</h1>
            <p className="tos-public__form-sub tos-animate-fade-in-up">
              This creates your first branch and registers this device. You can add more branches later.
            </p>
          </div>

          {error ? (
            <div className="tos-banner tos-banner--danger" role="alert">
              <IconAlert className="tos-banner__icon" />
              <div className="tos-banner__body">
                <span className="tos-banner__title">Could not create business</span>
                <span className="tos-banner__text">{error}</span>
              </div>
            </div>
          ) : null}

          <form className="tos-stack" onSubmit={handleSubmit}>
            <FieldLabel label="Business name" htmlFor="ob-name" required>
              <input
                id="ob-name"
                className="tos-input"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Ama Trading Enterprise"
                required
                minLength={2}
                maxLength={120}
              />
            </FieldLabel>

            <div className="tos-public__form-row">
              <FieldLabel label="Business type" htmlFor="ob-type" required>
                <select
                  id="ob-type"
                  className="tos-select"
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value as typeof BUSINESS_TYPES[number]["value"])}
                >
                  {BUSINESS_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel label="First branch name" htmlFor="ob-branch">
                <input
                  id="ob-branch"
                  className="tos-input"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="Main"
                  maxLength={120}
                />
              </FieldLabel>
            </div>

            <FieldLabel label="Country" htmlFor="ob-country" required>
              <select
                id="ob-country"
                className="tos-select"
                value={countryCode}
                onChange={(e) => onCountryChange(e.target.value)}
              >
                {SUPPORTED_COUNTRIES.map((c) => (
                  <option key={c.countryCode} value={c.countryCode}>{c.flag} {c.country}</option>
                ))}
              </select>
            </FieldLabel>

            <div className="tos-public__form-row">
              <FieldLabel label="Base currency" htmlFor="ob-currency" required>
                <select
                  id="ob-currency"
                  className="tos-select"
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value)}
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.currencyCode} value={c.currencyCode}>{c.symbol} {c.currencyCode} — {c.name}</option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel label="Timezone" htmlFor="ob-tz" required>
                <select
                  id="ob-tz"
                  className="tos-select"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {SUPPORTED_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </FieldLabel>
            </div>

            <Button type="submit" variant="gold" size="lg" block loading={busy} disabled={!canSubmit}>
              Create business & open workspace
            </Button>
          </form>

          <div className="tos-public__form-foot">
            <button type="button" className="tos-public__form-link" onClick={onCancel}>← Back to sign in</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Loading + recovery ---------------------------------------------------

function LoadingScreen({ title, text }: { title: string; text: string }) {
  return (
    <div className="tos-loading" role="status">
      <div className="tos-loading__panel">
        <div className="tos-loading__mark" aria-hidden="true">T</div>
        <h1 className="tos-loading__title">{title}</h1>
        <p className="tos-loading__text">{text}</p>
        <span className="tos-spinner" aria-hidden="true" />
      </div>
    </div>
  );
}

interface RecoveryScreenProps {
  error: string | null;
  onRetry: () => void | Promise<void>;
  onSignIn: () => void;
}

function RecoveryScreen({ error, onRetry, onSignIn }: RecoveryScreenProps) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="tos-recovery" role="alertdialog" aria-labelledby="rec-title">
      <div className="tos-recovery__panel">
        <div className="tos-recovery__head">
          <span className="tos-recovery__eyebrow">Session recovery</span>
          <h1 id="rec-title" className="tos-recovery__title">Let&apos;s get you back in</h1>
          <p className="tos-recovery__text">
            {error ?? "Your session could not be verified. Choose an option below."}
          </p>
        </div>
        <ul className="tos-recovery__list">
          <li className="tos-callout">Retry verifying the current session — useful after a brief network drop.</li>
          <li className="tos-callout tos-callout--warning">Sign in again — clears the local session and returns to the sign-in screen.</li>
        </ul>
        <div className="tos-recovery__actions">
          <Button
            variant="primary"
            icon={<IconRefresh className="tos-btn__icon" />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onRetry();
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry session
          </Button>
          <Button variant="outline" onClick={onSignIn}>Sign in again</Button>
        </div>
      </div>
    </div>
  );
}

// --- Brand panel (left side of split layout) ------------------------------

function BrandPanel() {
  return (
    <aside className="tos-public__brand" aria-hidden="true">
      <div className="tos-public__brand-mark">T</div>
      <div>
        <span className="tos-public__brand-eyebrow">The business OS for African trade</span>
        <h2 className="tos-public__brand-title">Run the day from any device.</h2>
        <p className="tos-public__brand-lead">
          Sell, track inventory, reconcile cash, and report on every branch from one
          connected workspace that keeps working when the internet does not.
        </p>
        <div className="tos-public__brand-pillars tos-stagger">
          <div className="tos-public__brand-pillar tos-animate-fade-in-up">
            <IconCheck className="tos-public__brand-pillar-icon" />
            <span className="tos-public__brand-pillar-text">
              <span className="tos-public__brand-pillar-title">Accurate selling</span>
              Use the right unit, price and stock rules consistently at every checkout.
            </span>
          </div>
          <div className="tos-public__brand-pillar tos-animate-fade-in-up">
            <IconCheck className="tos-public__brand-pillar-icon" />
            <span className="tos-public__brand-pillar-text">
              <span className="tos-public__brand-pillar-title">Ready when internet drops</span>
              Keep working during interruptions and sync changes automatically when the connection returns.
            </span>
          </div>
          <div className="tos-public__brand-pillar tos-animate-fade-in-up">
            <IconCheck className="tos-public__brand-pillar-icon" />
            <span className="tos-public__brand-pillar-text">
              <span className="tos-public__brand-pillar-title">Currency-aware</span>
              Money is displayed and recorded using your business currency and its correct precision.
            </span>
          </div>
        </div>
      </div>
      <span className="tos-public__brand-foot">TradeOS Africa · v{APP_VERSION}</span>
    </aside>
  );
}

// --- Small form helpers ---------------------------------------------------

function FieldLabel({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="tos-field">
      <label className="tos-field__label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="tos-field__label-required" aria-hidden="true">*</span> : null}
      </label>
      {children}
    </div>
  );
}
