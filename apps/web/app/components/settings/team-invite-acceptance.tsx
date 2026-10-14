"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { RegisterStaffInvitationResponse, StaffInvitationAcceptance } from "@tradeos/contracts";
import { getOfflineQueue, type WebSession } from "../../../lib/offline-sync";
import { getOrCreateWebDeviceKey, WEB_APP_VERSION } from "../../../lib/web-device";
import { Button } from "../ui/button";
import { IconCheck, IconShield, IconUsers } from "../ui/icons";
import {
  buildSessionFromBusinessContext,
  type AuthSession,
  type BusinessContextResponse,
  type MeResponse,
} from "../public-entry";

type AcceptanceMode = "current" | "signin" | "register";
type Feedback = { tone: "error" | "info" | "success"; text: string } | null;

interface LoginResponse {
  user?: { id: string; displayName: string; email: string | null; phoneE164: string | null };
  session?: AuthSession;
  error?: string;
  message?: string;
}

export function TeamInviteAcceptance() {
  const router = useRouter();
  const queue = useMemo(() => getOfflineQueue(), []);
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<AcceptanceMode>("signin");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const rawToken = params.get("token")?.trim() ?? "";
    // The invitation secret is kept only in component memory. Remove it from
    // browser chrome/history before any API request, analytics or navigation.
    window.history.replaceState(null, "", window.location.pathname);
    setToken(rawToken || null);
    setMode(queue.sessions.load() ? "current" : "signin");
    setReady(true);
  }, [queue]);

  const acceptWithCurrentAccount = async () => {
    if (!token || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await queue.authenticatedFetch("/v1/staff/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptanceToken: token }),
      });
      const payload = await readJson<{ acceptance?: StaffInvitationAcceptance; error?: string; message?: string }>(response);
      if (!response.ok || !payload.acceptance) throw new Error(payload.message ?? payload.error ?? "Invitation could not be accepted.");
      await completeStoredSession(payload.acceptance.businessId);
    } catch (error) {
      setFeedback({ tone: "error", text: errorText(error) });
      setBusy(false);
    }
  };

  const signInAndAccept = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy || !identifier.trim() || !password) return;
    setBusy(true);
    setFeedback(null);
    try {
      const authResponse = await fetch("/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
          platform: "WEB",
          deviceKey: getOrCreateWebDeviceKey(),
          appVersion: WEB_APP_VERSION,
        }),
      });
      const authPayload = await readJson<LoginResponse>(authResponse);
      if (!authResponse.ok || !authPayload.session) throw new Error(authPayload.message ?? authPayload.error ?? "Sign in failed.");

      const acceptanceResponse = await fetch("/v1/staff/invitations/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authPayload.session.accessToken}`,
        },
        body: JSON.stringify({ acceptanceToken: token }),
      });
      const acceptancePayload = await readJson<{ acceptance?: StaffInvitationAcceptance; error?: string; message?: string }>(acceptanceResponse);
      if (!acceptanceResponse.ok || !acceptancePayload.acceptance) {
        throw new Error(acceptancePayload.message ?? acceptancePayload.error ?? "Invitation could not be accepted.");
      }
      await completeDirectSession(authPayload.session, acceptancePayload.acceptance.businessId);
    } catch (error) {
      setFeedback({ tone: "error", text: errorText(error) });
      setBusy(false);
    }
  };

  const registerAndAccept = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy) return;
    if (newPassword.length < 8) {
      setFeedback({ tone: "error", text: "Password must contain at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback({ tone: "error", text: "Password confirmation does not match." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/v1/staff/invitations/accept/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acceptanceToken: token,
          displayName: displayName.trim(),
          password: newPassword,
          platform: "WEB",
          deviceKey: getOrCreateWebDeviceKey(),
          appVersion: WEB_APP_VERSION,
        }),
      });
      const payload = await readJson<RegisterStaffInvitationResponse & { error?: string; message?: string }>(response);
      if (!response.ok || !payload.session || !payload.acceptance) {
        throw new Error(payload.message ?? payload.error ?? "Account could not be created from this invitation.");
      }
      await completeDirectSession(payload.session, payload.acceptance.businessId);
    } catch (error) {
      setFeedback({ tone: "error", text: errorText(error) });
      setBusy(false);
    }
  };

  const completeStoredSession = async (businessId: string) => {
    const latest = queue.sessions.load();
    if (!latest) throw new Error("Your sign-in session is no longer available. Sign in again to accept this invitation.");
    const meResponse = await queue.authenticatedFetch("/v1/me");
    const me = await readJson<MeResponse & { error?: string; message?: string }>(meResponse);
    if (!meResponse.ok || !Array.isArray(me.memberships)) throw new Error(me.message ?? me.error ?? "Your business memberships could not be loaded.");
    const contextResponse = await queue.authenticatedFetch(`/v1/businesses/${encodeURIComponent(businessId)}/context`);
    const context = await readJson<BusinessContextResponse & { error?: string; message?: string }>(contextResponse);
    if (!contextResponse.ok || !context.business || !context.membership || !Array.isArray(context.branches)) {
      throw new Error(context.message ?? context.error ?? "The invited business could not be opened.");
    }
    const membership = me.memberships.find((entry) => entry.businessId === businessId && entry.businessStatus === "ACTIVE" && Boolean(entry.staffId));
    if (!membership) throw new Error("The accepted business membership is not active yet.");
    const refreshed = queue.sessions.load() ?? latest;
    const session = buildSessionFromBusinessContext(
      { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, clientId: refreshed.clientId },
      me,
      membership,
      context,
    );
    finish(session);
  };

  const completeDirectSession = async (auth: AuthSession, businessId: string) => {
    const authorization = { Authorization: `Bearer ${auth.accessToken}` };
    const meResponse = await fetch("/v1/me", { headers: authorization });
    const me = await readJson<MeResponse & { error?: string; message?: string }>(meResponse);
    if (!meResponse.ok || !Array.isArray(me.memberships)) throw new Error(me.message ?? me.error ?? "Your business memberships could not be loaded.");
    const membership = me.memberships.find((entry) => entry.businessId === businessId && entry.businessStatus === "ACTIVE" && Boolean(entry.staffId));
    if (!membership) throw new Error("The accepted business membership is not active yet.");
    const contextResponse = await fetch(`/v1/businesses/${encodeURIComponent(businessId)}/context`, { headers: authorization });
    const context = await readJson<BusinessContextResponse & { error?: string; message?: string }>(contextResponse);
    if (!contextResponse.ok || !context.business || !context.membership || !Array.isArray(context.branches)) {
      throw new Error(context.message ?? context.error ?? "The invited business could not be opened.");
    }
    finish(buildSessionFromBusinessContext(auth, me, membership, context));
  };

  const finish = (session: WebSession) => {
    setToken(null);
    queue.sessions.save(session);
    setFeedback({ tone: "success", text: "Invitation accepted. Opening your workspace…" });
    router.replace("/dashboard");
  };

  if (!ready) {
    return <InviteFrame><div className="tos-team-invite__state"><span className="tos-spinner" /><strong>Checking invitation…</strong></div></InviteFrame>;
  }

  if (!token) {
    return (
      <InviteFrame>
        <div className="tos-team-invite__state">
          <IconShield />
          <h1>This invitation link is no longer available in this tab</h1>
          <p>Open the original invitation link again. TradeOS removes the secret from the address bar immediately and never stores it in the browser.</p>
          <Button variant="outline" onClick={() => router.replace("/")}>Go to TradeOS sign in</Button>
        </div>
      </InviteFrame>
    );
  }

  return (
    <InviteFrame>
      <div className="tos-team-invite__head">
        <span className="tos-settings__mini-eyebrow">Secure team invitation</span>
        <h1>Join this business on TradeOS</h1>
        <p>Use the invited account identity. The invitation secret has already been removed from your address bar.</p>
      </div>

      {feedback ? <div className={`tos-settings__feedback tos-settings__feedback--${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}><span>{feedback.text}</span></div> : null}

      <div className="tos-team-invite__tabs" role="tablist" aria-label="Invitation acceptance mode">
        {queue.sessions.load() ? <button type="button" role="tab" aria-selected={mode === "current"} data-active={mode === "current"} onClick={() => setMode("current")}>Current account</button> : null}
        <button type="button" role="tab" aria-selected={mode === "signin"} data-active={mode === "signin"} onClick={() => setMode("signin")}>I have an account</button>
        <button type="button" role="tab" aria-selected={mode === "register"} data-active={mode === "register"} onClick={() => setMode("register")}>Create account</button>
      </div>

      {mode === "current" ? (
        <div className="tos-team-invite__panel">
          <IconCheck />
          <div><strong>Accept with the account already signed in on this device</strong><p>If this is not the invited account, choose “I have an account” and sign in with the invited email or phone instead.</p></div>
          <Button variant="primary" loading={busy} onClick={() => void acceptWithCurrentAccount()}>Accept invitation</Button>
        </div>
      ) : null}

      {mode === "signin" ? (
        <form className="tos-team-invite__form" onSubmit={signInAndAccept}>
          <InviteField label="Email or phone" htmlFor="team-invite-identifier"><input id="team-invite-identifier" className="tos-input" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required /></InviteField>
          <InviteField label="Password" htmlFor="team-invite-password"><input id="team-invite-password" className="tos-input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></InviteField>
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!identifier.trim() || !password}>Sign in & accept invitation</Button>
        </form>
      ) : null}

      {mode === "register" ? (
        <form className="tos-team-invite__form" onSubmit={registerAndAccept}>
          <p className="tos-team-invite__note">Your invited email or phone is taken directly from the secure invitation. You only need to set your name and password.</p>
          <InviteField label="Display name" htmlFor="team-invite-name"><input id="team-invite-name" className="tos-input" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></InviteField>
          <InviteField label="Password" htmlFor="team-invite-new-password"><input id="team-invite-new-password" className="tos-input" type="password" minLength={8} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></InviteField>
          <InviteField label="Confirm password" htmlFor="team-invite-confirm-password"><input id="team-invite-confirm-password" className="tos-input" type="password" minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></InviteField>
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!displayName.trim() || newPassword.length < 8 || !confirmPassword}>Create account & join business</Button>
        </form>
      ) : null}
    </InviteFrame>
  );
}

function InviteFrame({ children }: { children: React.ReactNode }) {
  return <main className="tos-team-invite"><div className="tos-team-invite__brand"><div className="tos-team-invite__mark">T</div><div><strong>TradeOS</strong><span>Team access</span></div></div><section className="tos-team-invite__card">{children}</section></main>;
}

function InviteField({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div className="tos-field"><label className="tos-field__label" htmlFor={htmlFor}>{label}</label>{children}</div>;
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json().catch(() => ({})) as T;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The invitation could not be completed.";
}
