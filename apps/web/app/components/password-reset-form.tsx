"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import { PasswordInput } from "./ui/password-input";
import { IconAlert, IconCheck } from "./ui/icons";

export function PasswordResetForm() {
  const [token, setToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const supplied = url.searchParams.get("token");
    setToken(supplied ?? "");
    // Do not leave this secret in the browser address bar or subsequent referrers.
    if (supplied) {
      url.searchParams.delete("token");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }, []);

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (!token || busy || completed) return;
    if (newPassword.length < 8) { setError("Use at least 8 characters."); return; }
    if (newPassword !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/v1/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        cache: "no-store",
        body: JSON.stringify({ token, newPassword }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(result.message ?? "The reset link could not be verified.");
        return;
      }
      setCompleted(true);
      setToken("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("Could not connect. Check your internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="tos-public tos-animate-fade-in">
      <aside className="tos-public__brand" aria-label="TradeOS account security">
        <div className="tos-public__brand-mark">T</div>
        <p className="tos-public__brand-eyebrow">TRADEOS AFRICA</p>
        <h1 className="tos-public__brand-title">Secure account recovery.</h1>
        <p className="tos-public__brand-lead">
          Protect your business records and access across web, desktop and mobile.
        </p>
      </aside>
      <div className="tos-public__form-side">
        <div className="tos-public__form tos-stagger">
          <div className="tos-public__form-head">
            <span className="tos-public__form-eyebrow">One-time recovery link</span>
            <h2 className="tos-public__form-title">Choose a new password</h2>
            <p className="tos-public__form-sub">
              Your recovery link is valid for 20 minutes and can be used only once.
              Resetting your password will sign out existing sessions on all devices.
            </p>
          </div>
          {completed ? (
            <div className="tos-banner tos-banner--success" role="status">
              <IconCheck className="tos-banner__icon" />
              <div className="tos-banner__body">
                <span className="tos-banner__title">Password reset successful</span>
                <span className="tos-banner__text">
                  You can now sign in with your new password. Your previous sessions were revoked.
                </span>
              </div>
            </div>
          ) : token === null ? (
            <p className="tos-public__reset-help" role="status">Checking your recovery link…</p>
          ) : !token ? (
            <div className="tos-banner tos-banner--danger" role="alert">
              <IconAlert className="tos-banner__icon" />
              <div className="tos-banner__body">
                <span className="tos-banner__text">
                  Your reset link is missing. Request a new one on the sign-in page.
                </span>
              </div>
            </div>
          ) : (
            <form className="tos-stack" onSubmit={resetPassword}>
              {error ? (
                <div className="tos-banner tos-banner--danger" role="alert">
                  <IconAlert className="tos-banner__icon" />
                  <div className="tos-banner__body"><span className="tos-banner__text">{error}</span></div>
                </div>
              ) : null}
              <label className="tos-stack--tight" htmlFor="reset-new-password">
                <strong>New password</strong>
              </label>
              <PasswordInput id="reset-new-password" name="new-password"
                value={newPassword} onChange={(event) => setNewPassword(event.target.value)}
                minLength={8} maxLength={200} required autoComplete="new-password"
                placeholder="At least 8 characters" />
              <label className="tos-stack--tight" htmlFor="reset-confirm-password">
                <strong>Confirm password</strong>
              </label>
              <PasswordInput id="reset-confirm-password" name="confirm-password"
                value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8} maxLength={200} required autoComplete="new-password"
                placeholder="Repeat your new password" />
              <Button type="submit" variant="gold" size="lg" block
                disabled={busy || newPassword.length < 8 || !confirmPassword} loading={busy}>
                Set new password
              </Button>
            </form>
          )}
          <div className="tos-public__form-foot">
            <Link href="/" className="tos-public__form-link">
              {completed ? "Return to sign in" : "Back to sign in"}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
