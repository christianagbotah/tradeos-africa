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
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import type { WorkspaceRole } from "./workspace-navigation";

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

export interface WorkspaceAccount {
  id: string;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
  avatarUrl: string | null;
}

export interface WorkspaceMembership {
  id: string;
  businessId: string;
  businessName: string;
  businessType: string;
  businessStatus: string;
  role: string;
  staffId: string | null;
}

export interface WorkspaceBusinessProfile {
  id: string;
  name: string;
  legalName: string | null;
  businessType: string;
  email: string | null;
  phone: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  logoUrl: string | null;
  status: string;
}

export interface WorkspaceBranch {
  id: string;
  name: string;
  code: string;
  timezone: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  active: boolean;
  updatedAt: string;
}

export interface WorkspaceBusinessContext {
  business: WorkspaceBusinessProfile;
  membership: { role: string; staffId: string | null };
  branches: WorkspaceBranch[];
}

interface WorkspaceIdentityResponse {
  user: WorkspaceAccount;
  memberships: WorkspaceMembership[];
}

export interface WorkspaceContextValue {
  session: WebSession | null;
  role: WorkspaceRole;
  account: WorkspaceAccount | null;
  memberships: readonly WorkspaceMembership[];
  businessContext: WorkspaceBusinessContext | null;
  contextBusy: boolean;
  catalog: readonly CatalogItem[];
  inventory: readonly InventoryItem[];
  customers: readonly Customer[];
  queue: QueueStatus;
  booting: boolean;
  fatal: string | null;
  signIn: (session: WebSession) => void;
  signOut: () => void;
  refreshWorkspaceContext: () => Promise<void>;
  switchBusiness: (businessId: string) => Promise<void>;
  switchBranch: (branchId: string) => Promise<void>;
  refreshCatalog: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  refreshCustomers: () => Promise<void>;
  flushQueue: () => Promise<void>;
  bump: () => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

interface WorkspaceProviderProps {
  children: ReactNode;
}

/**
 * Builds a new authenticated workspace session from authoritative business
 * context. Tokens/client identity are global-account credentials and are
 * preserved; all tenant/staff/branch fields are replaced from the server.
 */
export function buildBusinessSwitchSession(
  current: WebSession,
  membership: WorkspaceMembership,
  context: WorkspaceBusinessContext,
  preferredBranchId?: string,
): WebSession {
  if (membership.businessStatus !== "ACTIVE") throw new Error("BUSINESS_MEMBERSHIP_INACTIVE");
  if (context.business.id !== membership.businessId) throw new Error("BUSINESS_CONTEXT_MISMATCH");
  if (context.business.status !== "ACTIVE") throw new Error("BUSINESS_INACTIVE");
  if (!membership.staffId || !context.membership.staffId) throw new Error("NO_ACTIVE_STAFF");

  const activeBranches = context.branches.filter((branch) => branch.active);
  const branch = (preferredBranchId
    ? activeBranches.find((candidate) => candidate.id === preferredBranchId)
    : undefined)
    ?? activeBranches.find((candidate) => candidate.code === "MAIN")
    ?? activeBranches[0];
  if (!branch) throw new Error("NO_ACTIVE_BRANCH");

  return {
    ...current,
    businessId: context.business.id,
    branchId: branch.id,
    staffId: context.membership.staffId,
    currencyCode: context.business.currencyCode,
    timezone: branch.timezone || context.business.timezone,
    businessName: context.business.name,
    role: context.membership.role,
  };
}

/** Switches branch only inside the already-authoritative current business. */
export function buildBranchSwitchSession(
  current: WebSession,
  context: WorkspaceBusinessContext,
  branchId: string,
): WebSession {
  if (context.business.id !== current.businessId) throw new Error("BUSINESS_CONTEXT_MISMATCH");
  const branch = context.branches.find((candidate) => candidate.id === branchId && candidate.active);
  if (!branch) throw new Error("BRANCH_NOT_ACTIVE");
  return {
    ...current,
    branchId: branch.id,
    timezone: branch.timezone || context.business.timezone,
  };
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const offlineQueue = useMemo(() => getOfflineQueue(), []);
  const [session, setSession] = useState<WebSession | null>(null);
  const [account, setAccount] = useState<WorkspaceAccount | null>(null);
  const [memberships, setMemberships] = useState<readonly WorkspaceMembership[]>([]);
  const [businessContext, setBusinessContext] = useState<WorkspaceBusinessContext | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
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

  useEffect(() => {
    const stored = offlineQueue.sessions.load();
    if (stored) setSession(stored);
    setBooting(false);
  }, [offlineQueue]);

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

  const loadIdentity = useCallback(async (): Promise<WorkspaceIdentityResponse> => {
    const response = await offlineQueue.authenticatedFetch("/v1/me");
    if (!response.ok) throw new Error(await readApiErrorMessage(response, "Account context could not be loaded"));
    const value = await response.json() as WorkspaceIdentityResponse;
    if (!value.user || !Array.isArray(value.memberships)) throw new Error("Server returned incomplete account context.");
    return value;
  }, [offlineQueue]);

  const loadBusiness = useCallback(async (businessId: string): Promise<WorkspaceBusinessContext> => {
    const response = await offlineQueue.authenticatedFetch(`/v1/businesses/${encodeURIComponent(businessId)}/context`);
    if (!response.ok) throw new Error(await readApiErrorMessage(response, "Business context could not be loaded"));
    const value = await response.json() as WorkspaceBusinessContext;
    if (!value.business || !value.membership || !Array.isArray(value.branches)) {
      throw new Error("Server returned incomplete business context.");
    }
    return value;
  }, [offlineQueue]);

  const refreshWorkspaceContext = useCallback(async () => {
    const current = offlineQueue.sessions.load() ?? session;
    if (!current) return;
    setContextBusy(true);
    try {
      const identity = await loadIdentity();
      const membership = identity.memberships.find((candidate) => (
        candidate.businessId === current.businessId
        && candidate.businessStatus === "ACTIVE"
        && Boolean(candidate.staffId)
      ));
      if (!membership) throw new Error("BUSINESS_ACCESS_DENIED");
      const context = await loadBusiness(current.businessId);
      const normalized = buildBusinessSwitchSession(
        { ...current, displayName: identity.user.displayName },
        membership,
        context,
        current.branchId,
      );
      setAccount(identity.user);
      setMemberships(identity.memberships);
      setBusinessContext(context);
      setFatal(null);
      if (!sessionsEquivalent(current, normalized)) {
        offlineQueue.sessions.save(normalized);
        setSession(normalized);
      }
    } catch (error) {
      setFatal(error instanceof Error ? error.message : "Workspace context could not be loaded.");
    } finally {
      setContextBusy(false);
    }
  }, [loadBusiness, loadIdentity, offlineQueue, session]);

  useEffect(() => {
    if (session) void refreshWorkspaceContext();
    else {
      setAccount(null);
      setMemberships([]);
      setBusinessContext(null);
    }
  // refreshWorkspaceContext intentionally changes when session changes; the
  // normalizer avoids re-saving an equivalent session and therefore loops.
  }, [session, refreshWorkspaceContext]);

  const switchBusiness = useCallback(async (businessId: string) => {
    const current = offlineQueue.sessions.load() ?? session;
    if (!current) throw new Error("You are signed out.");
    if (!online) throw new Error("Connect to the internet before switching businesses so access can be verified.");
    setContextBusy(true);
    try {
      const identity = await loadIdentity();
      const membership = identity.memberships.find((candidate) => (
        candidate.businessId === businessId
        && candidate.businessStatus === "ACTIVE"
        && Boolean(candidate.staffId)
      ));
      if (!membership) throw new Error("BUSINESS_ACCESS_DENIED");
      const context = await loadBusiness(businessId);
      const next = buildBusinessSwitchSession(
        { ...current, displayName: identity.user.displayName },
        membership,
        context,
      );
      // Clear business-scoped read models before changing identity so no frame
      // can present another tenant's catalog/customer/stock data under the new header.
      setCatalog([]);
      setInventory([]);
      setCustomers([]);
      setAccount(identity.user);
      setMemberships(identity.memberships);
      setBusinessContext(context);
      setFatal(null);
      offlineQueue.sessions.save(next);
      setSession(next);
    } finally {
      setContextBusy(false);
    }
  }, [loadBusiness, loadIdentity, offlineQueue, online, session]);

  const switchBranch = useCallback(async (branchId: string) => {
    const current = offlineQueue.sessions.load() ?? session;
    if (!current || !businessContext) throw new Error("Business context is not ready.");
    const next = buildBranchSwitchSession(current, businessContext, branchId);
    setInventory([]);
    offlineQueue.sessions.save(next);
    setSession(next);
  }, [businessContext, offlineQueue, session]);

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

  const flushQueue = useCallback(async () => {
    if (!session || !online) return;
    try {
      const summary = await offlineQueue.flush({ activeBusinessId: session.businessId, online });
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
    if (online && session) void flushQueue();
  }, [online, session, flushQueue]);

  const refreshCatalog = useCallback(async () => {
    if (!session) return;
    try {
      const res = await offlineQueue.authenticatedFetch(`/v1/catalog/items?businessId=${encodeURIComponent(session.businessId)}`);
      if (!res.ok) {
        setFatal(`Could not load catalog (${res.status}).`);
        return;
      }
      const json = await res.json() as { items?: unknown[] };
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
        setInventory([]);
        return;
      }
      const json = await res.json() as { items?: unknown[] };
      setInventory((json.items ?? []).map((item) => mapInventoryItem(item)));
    } catch {
      setInventory([]);
    }
  }, [offlineQueue, session]);

  const refreshCustomers = useCallback(async () => {
    if (!session) return;
    try {
      const res = await offlineQueue.authenticatedFetch(`/v1/customers?businessId=${encodeURIComponent(session.businessId)}`);
      if (!res.ok) return;
      const json = await res.json() as { customers: Customer[] };
      setCustomers(json.customers ?? []);
    } catch {
      // Customers are non-blocking.
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

  const signIn = useCallback((next: WebSession) => {
    offlineQueue.sessions.save(next);
    setSession(next);
    setFatal(null);
  }, [offlineQueue]);

  const signOut = useCallback(() => {
    offlineQueue.sessions.clear();
    // Do NOT erase business queues here. Unsynced work belongs to the business
    // and must survive logout/business switching on this device.
    setSession(null);
    setAccount(null);
    setMemberships([]);
    setBusinessContext(null);
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
  const indexedInventory = useMemo(() => Array.from(indexInventory(inventory).values()), [inventory]);

  const value: WorkspaceContextValue = {
    session,
    role,
    account,
    memberships,
    businessContext,
    contextBusy,
    catalog,
    inventory: indexedInventory,
    customers,
    queue: { pending, failed, online, lastFlushAt, lastError },
    booting,
    fatal,
    signIn,
    signOut,
    refreshWorkspaceContext,
    switchBusiness,
    switchBranch,
    refreshCatalog,
    refreshInventory,
    refreshCustomers,
    flushQueue,
    bump,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

function sessionsEquivalent(left: WebSession, right: WebSession): boolean {
  return left.accessToken === right.accessToken
    && left.refreshToken === right.refreshToken
    && left.clientId === right.clientId
    && left.businessId === right.businessId
    && left.branchId === right.branchId
    && left.staffId === right.staffId
    && left.currencyCode === right.currencyCode
    && left.timezone === right.timezone
    && left.businessName === right.businessName
    && left.role === right.role
    && left.displayName === right.displayName;
}
