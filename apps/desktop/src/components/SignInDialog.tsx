/**
 * SignInDialog — modal for collecting identifier + password.
 *
 * The dialog calls `onSubmit(identifier, password)` which routes through the
 * DesktopRuntime.login() -> API client -> /v1/auth/login. On success the
 * runtime bootstraps into a READY state and the dialog closes.
 *
 * Errors are surfaced inline (never as a browser alert). Esc closes; Enter
 * submits when both fields are non-empty.
 */
import { useEffect, useState } from "react";
import { IconClose, IconUser, IconLock, IconAlert } from "./icons.js";

export interface SignInDialogProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (identifier: string, password: string) => Promise<void>;
}

export function SignInDialog({ open, loading, error, onClose, onSubmit }: SignInDialogProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setIdentifier("");
      setPassword("");
      setLocalError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && identifier.trim() && password && !loading) {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identifier, password, loading]);

  if (!open) return null;

  async function submit() {
    setLocalError(null);
    if (!identifier.trim() || !password) {
      setLocalError("Enter your email or phone and password to sign in.");
      return;
    }
    try {
      await onSubmit(identifier.trim(), password);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    }
  }

  const shownError = localError ?? error;

  return (
    <div className="dsk-dialog-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dsk-dialog" role="dialog" aria-modal="true" aria-labelledby="signin-title">
        <div className="dsk-dialog__head">
          <div>
            <h2 id="signin-title" className="dsk-dialog__title">Sign in to TradeOS</h2>
            <div className="dsk-dialog__sub">Connect a business session to load live data</div>
          </div>
          <button type="button" className="dsk-dialog__close" onClick={onClose} aria-label="Close">
            <IconClose width={16} height={16} />
          </button>
        </div>
        <div className="dsk-dialog__body">
          {shownError ? (
            <div className="dsk-banner dsk-banner--warning" style={{ marginBottom: "var(--tos-space-3)" }}>
              <IconAlert className="dsk-banner__icon" />
              <div className="dsk-banner__body">
                <div className="dsk-banner__title">Sign-in failed</div>
                <div className="dsk-banner__text">{shownError}</div>
              </div>
            </div>
          ) : null}
          <div className="dsk-field" style={{ marginBottom: "var(--tos-space-3)" }}>
            <span className="dsk-field__label">Email or phone</span>
            <div className="dsk-cmdbar__search">
              <IconUser className="dsk-cmdbar__search-icon" />
              <input
                type="text"
                className="dsk-input"
                placeholder="you@example.com or +233\u2026"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoFocus
                aria-label="Email or phone"
                autoComplete="username"
              />
            </div>
          </div>
          <div className="dsk-field">
            <span className="dsk-field__label">Password</span>
            <div className="dsk-cmdbar__search">
              <IconLock className="dsk-cmdbar__search-icon" />
              <input
                type="password"
                className="dsk-input"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password"
                autoComplete="current-password"
              />
            </div>
          </div>
          <div className="dsk-banner dsk-banner--info" style={{ marginTop: "var(--tos-space-3)" }}>
            <div className="dsk-banner__body">
              <div className="dsk-banner__title">Desktop shares the same API as web &amp; mobile</div>
              <div className="dsk-banner__text">
                Sign in with your TradeOS business credentials. The desktop client uses the same
                server-authoritative sync, pricing, and accounting as the other clients.
              </div>
            </div>
          </div>
        </div>
        <div className="dsk-dialog__foot">
          <button type="button" className="dsk-btn dsk-btn--ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="dsk-btn dsk-btn--primary"
            onClick={() => void submit()}
            disabled={loading || !identifier.trim() || !password}
          >
            {loading ? "Signing in\u2026" : "Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
