"use client";

import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getOfflineQueue, type WebSession } from "../../../lib/offline-sync";
import {
  mapCatalogItem,
  mapInventoryItem,
  indexInventory,
  type CatalogItem,
  type InventoryItem,
} from "../../../lib/catalog-read-model";
import type { WorkspaceRole } from "./workspace-navigation";

// --- Domain types ---------------------------------------------------------
// CatalogItem and InventoryItem are the canonical API read models mapped in
// lib/catalog-read-model.ts. units[]/conversions[] are part of the multi-unit
// contract and must never be flattened into a single sale unit.

export type { CatalogItem, InventoryItem } from "../../../lib/catalog-read-model";

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  creditLimitMinor: number | null;
  creditTermsDays: number | null;
  balanceMinor: number;
  updatedAt: string;
}

export interface SaleSummary {
  id: string;
  status: string;
  currencyCode: string;
  totalMinor: number;
  refundTotalMinor: number;
  completedAt: string | null;
  createdAt: string;
  customer: { name: string | null; phone: string | null } | null;
  cashierName: string | null;
  payments: ReadonlyArray<{ method: string; amountMinor: number; status: string }>;
}

export interface QueueStatus {
  pending: number;
  failed: number;
  online: boolean;
  lastFlushAt: string | null;
  lastError: string | null;
}

export interface WorkspaceContextValue {
  session: WebSession | null;
  role: WorkspaceRole;
  catalog: readonly CatalogItem[];
  /** Per-branch stock levels (last-known) for tracked products. */
  inventory: readonly InventoryItem[];
  customers: readonly Customer[];
  queue: QueueStatus;
  /** True until the initial session + catalog load completes. */
  booting: boolean;
  /** Set when an unrecoverable error prevents the workspace from rendering. */
  fatal: string | null;
  signIn: (session: WebSession) => void;
  signOut: () => void;
  refreshCatalog: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  refreshCustomers: () => Promise<void>;
  flushQueue: () => Promise<void>;
  /** Forces a re-render of consumers (e.g. after enqueueing a mutation). */
  bump: () => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface WorkspaceProviderProps {
  children: ReactNode;
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const offlineQueue = useMemo(() => getOfflineQueue(), []);
  const [session, setSession] = useState<WebSession | null>(null);
  const [catalog, setCatalog] = useState<readonly CatalogItem[]>([]);
  const [inventory, setInventory] = useState<readonly InventoryItem[]>([]);
  const [customers, setCustomers] = useState<readonly Customer[]>([]);
  const [booting, setBooting] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [lastFlushAt, setLastFlushAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // --- Initial boot: load session from localStorage -----------------------
  useEffect(() => {
    const stored = offlineQueue.sessions.load();
    if (stored) {
      setSession(stored);
    }
    setBooting(false);
  }, [offlineQueue]);

  // --- Online/offline detection -------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setOnline(window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // --- Refresh queue counts + flush on session / online change -----------
  const refreshQueueCounts = useCallback(async () => {
    if (!session) {
      setPending(0);
      setFailed(0);
      return;
    }
    const state = await offlineQueue.getState(session.businessId);
    setPending(state.pending);
    setFailed(state.failed);
  }, [offlineQueue, session]);

  useEffect(() => {
    void refreshQueueCounts();
  }, [refreshQueueCounts]);

  // --- Periodic queue flush + on online event ----------------------------
  const flushQueue = useCallback(async () => {
    if (!session || !online) return;
    try {
      const summary = await offlineQueue.flush({
        activeBusinessId: session.businessId,
        online,
      });
      setLastFlushAt(new Date().toISOString());
      setLastError(summary.failed > 0 ? `${summary.failed} mutation(s) rejected` : null);
      await refreshQueueCounts();
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Sync failed");
    }
  }, [offlineQueue, online, refreshQueueCounts, session]);

  useEffect(() => {
    if (!session) return;
    void flushQueue();
    const id = window.setInterval(() => void flushQueue(), 15_000);
    return () => window.clearInterval(id);
  }, [flushQueue, session]);

  useEffect(() => {
    if (online && session) {
      void flushQueue();
    }
  }, [online, session, flushQueue]);

  // --- Catalog + inventory + customers load (when session is set) --------
  const refreshCatalog = useCallback(async () => {
    if (!session) return;
    try {
      const res = await offlineQueue.authenticatedFetch(`/v1/catalog/items?businessId=${encodeURIComponent(session.businessId)}`);
      if (!res.ok) {
        setFatal(`Could not load catalog (${res.status}).`);
        return;
      }
      const json = (await res.json()) as { items?: unknown[] };
      // Explicit mapping layer — never a blind cast. See lib/catalog-read-model.ts.
      setCatalog((json.items ?? []).map((item) => mapCatalogItem(item)));
    } catch (error) {
      setFatal(error instanceof Error ? error.message : "Could not load catalog.");
    }
  }, [offlineQueue, session]);

  const refreshInventory = useCallback(async () => {
    if (!session) return;
    try {
      const res = await offlineQueue.authenticatedFetch(
        `/v1/inventory?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}`,
      );
      if (!res.ok) {
        // Stock levels are non-blocking — POS/Catalog still work without them.
        setInventory([]);
        return;
      }
      const json = (await res.json()) as { items?: unknown[] };
      setInventory((json.items ?? []).map((item) => mapInventoryItem(item)));
    } catch {
      setInventory([]);
    }
  }, [offlineQueue, session]);

  const refreshCustomers = useCallback(async () => {
    if (!session) return;
    try {
      const res = await offlineQueue.authenticatedFetch(`/v1/customers?businessId=${encodeURIComponent(session.businessId)}`);
      if (!res.ok) {
        return;
      }
      const json = (await res.json()) as { customers: Customer[] };
      setCustomers(json.customers ?? []);
    } catch {
      // Customers are non-blocking — leave the list empty.
    }
  }, [offlineQueue, session]);

  useEffect(() => {
    if (!session) {
      setCatalog([]);
      setInventory([]);
      setCustomers([]);
      return;
    }
    void refreshCatalog();
    void refreshInventory();
    void refreshCustomers();
  }, [session, refreshCatalog, refreshInventory, refreshCustomers]);

  // --- Sign-in / sign-out -------------------------------------------------
  const signIn = useCallback((next: WebSession) => {
    offlineQueue.sessions.save(next);
    setSession(next);
    setFatal(null);
  }, [offlineQueue]);

  const signOut = useCallback(() => {
    offlineQueue.sessions.clear();
    void offlineQueue.clear();
    setSession(null);
    setCatalog([]);
    setInventory([]);
    setCustomers([]);
    setPending(0);
    setFailed(0);
  }, [offlineQueue]);

  const bump = useCallback(() => {
    setTick((n) => n + 1);
    void refreshQueueCounts();
  }, [refreshQueueCounts]);

  const role = (session?.role as WorkspaceRole | undefined) ?? "VIEWER";

  const value: WorkspaceContextValue = {
    session,
    role,
    catalog,
    inventory: useMemo(() => Array.from(indexInventory(inventory).values()), [inventory]),
    customers,
    queue: { pending, failed, online, lastFlushAt, lastError },
    booting,
    fatal,
    signIn,
    signOut,
    refreshCatalog,
    refreshInventory,
    refreshCustomers,
    flushQueue,
    bump,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
