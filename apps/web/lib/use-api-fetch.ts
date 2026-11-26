"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useWorkspace } from "../app/components/workspace/use-workspace";
import { getOfflineQueue, MUTATION_INVALIDATION_EVENT } from "./offline-sync";
import { readApiErrorMessage } from "./auth-fetch";

export interface ApiFetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface ApiFetchResult<T> extends ApiFetchState<T> {
  refetch: () => void;
  setData: Dispatch<SetStateAction<T | null>>;
}

/**
 * Fetch a relative API path with the current session's access token.
 * The Caddy gateway forwards to the API on port 4000; we never write a port.
 *
 * Honest states only: returns loading/error/data. No fake fallbacks.
 */
export function useApiFetch<T>(
  path: string | null,
  options?: { method?: string; body?: unknown; reconcile?: (incoming: T) => T },
): ApiFetchResult<T> {
  const { session } = useWorkspace();
  // A mutation can complete while an older GET is in flight. Each successful
  // read passes through the current reconciliation rule before it reaches UI.
  const reconcileRef = useRef(options?.reconcile);
  reconcileRef.current = options?.reconcile;
  const contextKey = session
    ? session.businessId + ":" + session.branchId + ":" + (path ?? "")
    : null;
  const [sourceKey, setSourceKey] = useState<string | null>(contextKey);
  const [state, setState] = useState<ApiFetchState<T>>({ data: null, loading: true, error: null });
  const [nonce, setNonce] = useState(0);

  const generation = useRef(0);
  const refetch = useCallback(() => { generation.current++; setNonce((n) => n + 1); }, []);
  useEffect(() => {
    if(!session?.businessId || (options?.method??"GET").toUpperCase()!=="GET")return;
    const listener=(event:Event)=>{
      if((event as CustomEvent<{businessId:string}>).detail?.businessId===session.businessId)refetch();
    };
    window.addEventListener(MUTATION_INVALIDATION_EVENT,listener);
    return ()=>window.removeEventListener(MUTATION_INVALIDATION_EVENT,listener);
  },[session?.businessId,options?.method,refetch]);

  useEffect(() => {
    setSourceKey(contextKey);
    if (!path || !session) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    const requestGeneration = ++generation.current;
    const stale = () => cancelled || generation.current !== requestGeneration;
    setState((prev) => ({
      data: sourceKey === contextKey ? prev.data : null,
      loading: true,
      error: null,
    }));
    void (async () => {
      try {
        const init: RequestInit = {
          method: options?.method ?? "GET",
          cache: "no-store",
          headers: {
            ...(options?.body ? { "Content-Type": "application/json" } : {}),
          },
        };
        if (options?.body) {
          init.body = JSON.stringify(options.body);
        }
        const res = await getOfflineQueue().authenticatedFetch(path, init);
        if (stale()) return;
        if (!res.ok) {
          const message = await readApiErrorMessage(res);
          if(stale())return;
          setState(prev=>({ ...prev, loading:false,error:message }));
          return;
        }
        const json = (await res.json()) as T;
        if (stale()) return;
        setState({ data: reconcileRef.current?.(json) ?? json, loading: false, error: null });
      } catch (err) {
        if (stale()) return;
        setState(prev=>({ ...prev, loading:false,error:err instanceof Error ? err.message : "Network error" }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, contextKey, session, nonce, options?.method, JSON.stringify(options?.body)]);

  const setData = useCallback<Dispatch<SetStateAction<T | null>>>((update) => {
    setState((prev) => ({
      ...prev,
      data: typeof update === "function"
        ? (update as (value: T | null) => T | null)(prev.data)
        : update,
      loading: false,
      error: null,
    }));
  }, []);

  // Hide a previous tenant/branch's data synchronously on a context switch,
  // before the effect starts the new read.
  return {
    ...(sourceKey === contextKey
      ? state
      : { data: null, loading: Boolean(path && session), error: null }),
    refetch,
    setData,
  };
}
