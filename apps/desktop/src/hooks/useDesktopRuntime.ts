/**
 * useDesktopRuntime — owns the DesktopRuntime lifecycle for the App.
 *
 * Responsibilities:
 *   - Lazily create a DesktopRuntime on first mount (unless demo mode is on).
 *   - Bootstrap the runtime (call runtime.bootstrap()).
 *   - Track the bootstrap state (SIGNED_OUT / NEEDS_BUSINESS / READY / SESSION_EXPIRED).
 *   - Expose login/logout helpers that re-bootstrap after a state change.
 *   - Expose the runtime + ready state to screens.
 *
 * In demo mode (VITE_TRADEOS_DEMO=true) the runtime is NOT created; the hook
 * returns `runtime: null` so screens fall through to sample data.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DesktopRuntime, type DesktopBootstrapState, type DesktopReadyState } from "../lib/desktop-runtime.js";
import { createDesktopRuntime } from "../lib/desktop-runtime-factory.js";
import { isDemoMode } from "../lib/sample-data.js";

export interface DesktopRuntimeHook {
  demoMode: boolean;
  runtime: DesktopRuntime | null;
  state: DesktopBootstrapState | null;
  ready: DesktopReadyState | null;
  loading: boolean;
  error: string | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useDesktopRuntime(): DesktopRuntimeHook {
  const demoMode = isDemoMode();
  const runtimeRef = useRef<DesktopRuntime | null>(null);
  const [state, setState] = useState<DesktopBootstrapState | null>(null);
  const [loading, setLoading] = useState<boolean>(!demoMode);
  const [error, setError] = useState<string | null>(null);
  const [runtimeReady, setRuntimeReady] = useState<boolean>(false);

  // Async runtime creation: resolveSessionStore() may need to load the Tauri
  // native store plugin, so the factory is async. In demo mode we skip creation.
  useEffect(() => {
    if (demoMode) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { runtime } = await createDesktopRuntime();
        if (cancelled) return;
        runtimeRef.current = runtime;
        setRuntimeReady(true);
        // Bootstrap immediately after creation.
        setLoading(true);
        setError(null);
        try {
          const next = await runtime.bootstrap();
          if (!cancelled) setState(next);
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : String(e));
            setState({ status: "SIGNED_OUT", queue: { pending: 0, blocked: 0, failed: 0 } });
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      } catch (e) {
        // createDesktopRuntime can throw if secure storage is unavailable
        // (e.g. Tauri runtime detected but the store plugin is missing).
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [demoMode]);

  const bootstrap = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setLoading(true);
    setError(null);
    try {
      const next = await runtime.bootstrap();
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState({ status: "SIGNED_OUT", queue: { pending: 0, blocked: 0, failed: 0 } });
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const runtime = runtimeRef.current;
    if (!runtime) throw new Error("Desktop runtime is not initialised. Secure session storage may be unavailable.");
    setLoading(true);
    setError(null);
    try {
      const next = await runtime.login(identifier, password);
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setLoading(true);
    setError(null);
    try {
      await runtime.logout();
      const next = await runtime.bootstrap();
      setState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await bootstrap();
  }, [bootstrap]);

  const ready = runtimeReady && state?.status === "READY" ? state : null;

  return {
    demoMode,
    runtime: runtimeRef.current,
    state,
    ready,
    loading,
    error,
    login,
    logout,
    refresh,
  };
}
