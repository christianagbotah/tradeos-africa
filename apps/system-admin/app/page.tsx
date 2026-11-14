"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { usePlatformAdminSession } from "./components/platform-admin-session";
import { AdminPasswordInput } from "./components/admin-password-input";

export default function RootPage() {
  const { phase, login } = usePlatformAdminSession();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phase === "authenticated") router.replace("/console");
  }, [phase, router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !identifier.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
      router.replace("/console");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Administrator sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "loading") return <div className="admin-auth-state">Checking administrator session…</div>;

  if (forgotMode) return <AdminForgotPassword onBack={() => setForgotMode(false)} initialEmail={identifier} />;

  return (
    <main className="admin-auth-screen">
      <section className="admin-auth-card" aria-labelledby="admin-login-title">
        <div className="admin-auth-brand">
          <div className="admin-auth-mark" aria-hidden="true">T</div>
          <div><strong>TradeOS</strong><span>System Admin</span></div>
        </div>
        <p className="admin-auth-eyebrow">Platform control plane</p>
        <h1 id="admin-login-title">Administrator sign in</h1>
        <p className="admin-auth-intro">Use your separate Lightworld platform administrator account. Merchant and business-user credentials do not grant access here.</p>
        <form className="admin-auth-form" onSubmit={submit}>
          <label className="admin-auth-field">
            <span>Email</span>
            <input type="email" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />
          </label>
          <label className="admin-auth-field">
            <span>Password</span>
            <AdminPasswordInput id="admin-login-password" autoComplete="current-password"
              value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <div style={{ textAlign: "right" }}>
            <button type="button" className="admin-auth-link"
              onClick={() => setForgotMode(true)}>Forgot password?</button>
          </div>
          {error ? <p className="admin-auth-error" role="alert">{error}</p> : null}
          <button className="admin-auth-submit" type="submit" disabled={busy || !identifier.trim() || !password}>{busy ? "Signing in…" : "Sign in securely"}</button>
        </form>
        <p className="admin-auth-note">This console is separate from tenant workspaces. Access is logged and privileged write operations remain disabled in the current read-plane release.</p>
      </section>
    </main>
  );
}


function AdminForgotPassword({
  onBack, initialEmail,
}: { onBack: () => void; initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail.includes("@") ? initialEmail : "");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) setError(data.message ?? "Administrator recovery is unavailable.");
      else setSuccess(data.message ?? "If this account exists, check your email for a reset link.");
    } catch {
      setError("Unable to contact TradeOS. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-auth-screen">
      <section className="admin-auth-card" aria-labelledby="admin-forgot-title">
        <div className="admin-auth-brand">
          <div className="admin-auth-mark" aria-hidden="true">T</div>
          <div><strong>TradeOS</strong><span>System Admin</span></div>
        </div>
        <p className="admin-auth-eyebrow">Secure account recovery</p>
        <h1 id="admin-forgot-title">Forgot your password?</h1>
        <p className="admin-auth-intro">Use your platform administrator email.
          A one-time recovery link expires after 20 minutes. Merchant accounts use
          their own TradeOS sign-in page.</p>
        <form className="admin-auth-form" onSubmit={submit}>
          <label className="admin-auth-field">
            <span>Administrator email</span>
            <input type="email" autoComplete="email" value={email}
              maxLength={254} onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@company.com" required />
          </label>
          {success ? <p className="admin-auth-success" role="status">{success}</p> : null}
          {error ? <p className="admin-auth-error" role="alert">{error}</p> : null}
          <button className="admin-auth-submit" type="submit"
            disabled={busy || !email.trim()}>{busy ? "Sending…" : "Send reset link"}</button>
        </form>
        <button type="button" className="admin-auth-link" onClick={onBack}>Back to sign in</button>
      </section>
    </main>
  );
}
