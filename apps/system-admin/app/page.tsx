"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { usePlatformAdminSession } from "./components/platform-admin-session";

export default function RootPage() {
  const { phase, login } = usePlatformAdminSession();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
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
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {error ? <p className="admin-auth-error" role="alert">{error}</p> : null}
          <button className="admin-auth-submit" type="submit" disabled={busy || !identifier.trim() || !password}>{busy ? "Signing in…" : "Sign in securely"}</button>
        </form>
        <p className="admin-auth-note">This console is separate from tenant workspaces. Access is logged and privileged write operations remain disabled in the current read-plane release.</p>
      </section>
    </main>
  );
}
