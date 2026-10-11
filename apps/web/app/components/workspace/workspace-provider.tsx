"use client";

import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getOfflineQueue, type WebSession } from "../../../lib/offline-sync";
import type { WorkspaceRole } from "./workspace-navigation";

// --- Domain types (mirror of the API read models) -------------------------

export interface CatalogItem {
  id: string;
  name: string;
  sku: string | null;
  kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  status: "ACTIVE" | "ARCHIVED";
  saleUnitCode: string;
  saleUnitName: string;
  priceMinor: number;
  taxRatePercent: number | null;
  costMinor: number | null;
  trackInventory: boolean;
  inventoryOnHand: number | null;
  inventoryAvailable: number | null;
  updatedAt: string;
}

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
  customers: readonly Customer[];
  queue: QueueStatus;
  /** True until the initial session + catalog load completes. */
  booting: boolean;
  /** Set when an unrecoverable error prevents the workspace from rendering. */
  fatal: string | null;
  signIn: (session: WebSession) => void;
  signOut: () => void;
  refreshCatalog: () => Promise<void>;
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

  // --- Catalog + customers load (when session is set) --------------------
  const refreshCatalog = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(`/v1/catalog/items?businessId=${encodeURIComponent(session.businessId)}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!res.ok) {
        setFatal(`Could not load catalog (${res.status}).`);
        return;
      }
      const json = (await res.json()) as { items: CatalogItem[] };
      setCatalog(json.items ?? []);
    } catch (error) {
      setFatal(error instanceof Error ? error.message : "Could not load catalog.");
    }
  }, [session]);

  const refreshCustomers = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(`/v1/customers?businessId=${encodeURIComponent(session.businessId)}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!res.ok) {
        return;
      }
      const json = (await res.json()) as { customers: Customer[] };
      setCustomers(json.customers ?? []);
    } catch {
      // Customers are non-blocking — leave the list empty.
    }
  }, [session]);

  useEffect(() => {
    if (!session) {
      setCatalog([]);
      setCustomers([]);
      return;
    }
    void refreshCatalog();
    void refreshCustomers();
  }, [session, refreshCatalog, refreshCustomers]);

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
    customers,
    queue: { pending, failed, online, lastFlushAt, lastError },
    booting,
    fatal,
    signIn,
    signOut,
    refreshCatalog,
    refreshCustomers,
    flushQueue,
    bump,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
