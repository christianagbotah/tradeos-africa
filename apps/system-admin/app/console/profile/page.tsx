"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Badge, Banner, PageHeader, Section } from "../../components/admin-ui";
import { IconRefresh, IconShield } from "../../components/icons";
import { useAdminResource, usePlatformAdminSession } from "../../components/platform-admin-session";

type AdminProfile = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  lastLoginAt: string | null;
};

type AdminSession = {
  id: string;
  deviceKey: string;
  platform: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  current: boolean;
};

export default function ProfileSecurityPage() {
  const { apiFetch, refreshAdminUser } = usePlatformAdminSession();
  const profile = useAdminResource<{ profile: AdminProfile }>("/api/admin/profile");
  const sessions = useAdminResource<{ sessions: AdminSession[] }>("/api/admin/profile/sessions");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile.data?.profile) return;
    setEmail(profile.data.profile.email);
    setDisplayName(profile.data.profile.displayName);
  }, [profile.data?.profile]);

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setNotice(null);
    setError(null);
    try {
      const response = await apiFetch("/api/admin/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, displayName }),
      });
      const body = await response.json().catch(() => ({})) as { profile?: AdminProfile; message?: string };
      if (!response.ok || !body.profile) throw new Error(body.message ?? "Profile could not be updated");
      setEmail(body.profile.email);
      setDisplayName(body.profile.displayName);
      await refreshAdminUser();
      await profile.reload();
      setNotice("Profile updated.");
    } catch (requestError) {
      setError(messageOf(requestError));
    } finally {
      setSavingProfile(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const currentPassword = String(values.get("currentPassword") ?? "");
    const newPassword = String(values.get("newPassword") ?? "");
    setChangingPassword(true);
    setNotice(null);
    setError(null);
    try {
      const response = await apiFetch("/api/admin/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? "Password could not be changed");
      }
      await sessions.reload();
      setNotice("Password changed. Other administrator sessions were revoked.");
    } catch (requestError) {
      setError(messageOf(requestError));
    } finally {
      form.reset();
      setChangingPassword(false);
    }
  }

  async function revokeSession(sessionId: string) {
    setRevokingSessionId(sessionId);
    setNotice(null);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/profile/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? "Session could not be revoked");
      }
      await sessions.reload();
      setNotice("Session revoked.");
    } catch (requestError) {
      setError(messageOf(requestError));
    } finally {
      setRevokingSessionId(null);
    }
  }

  const loading = profile.loading || sessions.loading;
  const resourceError = profile.error ?? sessions.error;
  const currentProfile = profile.data?.profile;

  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="My account"
        title="Account & security"
        subtitle="Keep your platform administrator identity current and control where your privileged account is signed in."
        actions={(
          <button type="button" className="admin-secondary-button" onClick={() => { void profile.reload(); void sessions.reload(); }}>
            <IconRefresh aria-hidden="true" /> Refresh
          </button>
        )}
      />

      {notice ? <Banner title="Saved">{notice}</Banner> : null}
      {error || resourceError ? <Banner tone="danger" title="Action needed">{error ?? resourceError}</Banner> : null}
      {loading ? <div className="admin-api-state" role="status">Loading account security…</div> : null}

      {!loading && currentProfile ? (
        <div className="admin-profile-grid">
          <Section title="Profile" sub="This identity is used across the TradeOS platform control plane." padded>
            <form className="admin-profile-form" onSubmit={submitProfile}>
              <label className="admin-field">
                <span className="admin-field__label">Display name</span>
                <input className="admin-field__input" name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required />
              </label>
              <label className="admin-field">
                <span className="admin-field__label">Email</span>
                <input className="admin-field__input" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
              </label>
              <div className="admin-profile-facts">
                <div><span>Role</span><Badge tone="info">{humanize(currentProfile.role)}</Badge></div>
                <div><span>Last sign in</span><strong>{formatDate(currentProfile.lastLoginAt)}</strong></div>
              </div>
              <div className="admin-profile-actions">
                <button className="admin-primary-button" type="submit" disabled={savingProfile}>
                  {savingProfile ? "Saving…" : "Save profile"}
                </button>
              </div>
            </form>
          </Section>

          <Section title="Change password" sub="Changing your password signs every other administrator session out." padded>
            <form className="admin-profile-form" onSubmit={submitPassword}>
              <label className="admin-field">
                <span className="admin-field__label">Current password</span>
                <input className="admin-field__input" name="currentPassword" type="password" autoComplete="current-password" required />
              </label>
              <label className="admin-field">
                <span className="admin-field__label">New password</span>
                <input className="admin-field__input" name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
                <small className="admin-field__hint">Use at least 12 characters.</small>
              </label>
              <div className="admin-profile-actions">
                <button className="admin-primary-button" type="submit" disabled={changingPassword}>
                  {changingPassword ? "Changing…" : "Change password"}
                </button>
              </div>
            </form>
          </Section>
        </div>
      ) : null}

      {!loading ? (
        <Section title="Active sessions" sub="Review devices that currently have access to your System Admin account." padded>
          <div className="admin-security-session-list">
            {(sessions.data?.sessions ?? []).map((session) => (
              <article className="admin-security-session" key={session.id}>
                <div className="admin-security-session__icon" aria-hidden="true"><IconShield /></div>
                <div className="admin-security-session__body">
                  <div className="admin-security-session__title">
                    <strong>{session.platform}</strong>
                    {session.current ? <Badge tone="positive">Current</Badge> : null}
                  </div>
                  <span>{session.deviceKey}</span>
                  <small>Last active {formatDate(session.lastUsedAt)} · Expires {formatDate(session.expiresAt)}</small>
                </div>
                {!session.current ? (
                  <button
                    type="button"
                    className="admin-danger-button"
                    disabled={revokingSessionId === session.id}
                    onClick={() => void revokeSession(session.id)}
                  >
                    {revokingSessionId === session.id ? "Revoking…" : "Revoke session"}
                  </button>
                ) : null}
              </article>
            ))}
            {(sessions.data?.sessions.length ?? 0) === 0 ? <p className="admin-section__sub">No active sessions were returned.</p> : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed";
}

function humanize(value: string): string {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}
