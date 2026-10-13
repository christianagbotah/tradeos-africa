"use client";

import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "../app/components/workspace/use-workspace";
import { getOfflineQueue } from "./offline-sync";
import { readApiErrorMessage } from "./auth-fetch";

export interface ApiFetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface ApiFetchResult<T> extends ApiFetchState<T> {
  refetch: () => void;
  setData: (data: T | null) => void;
}

/**
 * Fetch a relative API path with the current session's access token.
 * The Caddy gateway forwards to the API on port 4000; we never write a port.
 *
 * Honest states only: returns loading/error/data. No fake fallbacks.
 */
export function useApiFetch<T>(path: string | null, options?: { method?: string; body?: unknown }): ApiFetchResult<T> {
  const { session } = useWorkspace();
  const [state, setState] = useState<ApiFetchState<T>>({ data: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!path || !session) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    void (async () => {
      try {
        const init: RequestInit = {
          method: options?.method ?? "GET",
          headers: {
            ...(options?.body ? { "Content-Type": "application/json" } : {}),
          },
        };
        if (options?.body) {
          init.body = JSON.stringify(options.body);
        }
        const res = await getOfflineQueue().authenticatedFetch(path, init);
        if (cancelled) return;
        if (!res.ok) {
          const message = await readApiErrorMessage(res);
          setState({ data: null, loading: false, error: message });
          return;
        }
        const json = (await res.json()) as T;
        if (cancelled) return;
        setState({ data: json, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Network error" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, session, nonce, options?.method, JSON.stringify(options?.body)]);

  const setData = useCallback((data: T | null) => {
    setState((prev) => ({ ...prev, data, loading: false, error: null }));
  }, []);

  return { ...state, refetch, setData };
}
