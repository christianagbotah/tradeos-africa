"use client";

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getOfflineQueue, MUTATION_INVALIDATION_EVENT, type WebSession } from "../../../lib/offline-sync";
import {
  mapCatalogItem,
  mapInventoryItem,
  indexInventory,
  type CatalogItem,
  type InventoryItem,
} from "../../../lib/catalog-read-model";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import {
  reconcileConfirmedCustomers,
  registerConfirmedCustomerUpdate,
  type ConfirmedCustomerRevision,
  type CustomerConfirmedFields,
} from "../customers/customer-reconciliation";
import {
  reconcileConfirmedCatalog,
  registerConfirmedCatalogUpdate,
  registerConfirmedCatalogDeletion,
  type ConfirmedCatalogDeletion,
  type ConfirmedCatalogRevision,
  type ConfirmedCatalogFields,
} from "../catalog/catalog-reconciliation";
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
  /** Total accepted return/correction value; may include exchange credit. */
  refundTotalMinor: number;
  /** Refund payments with confirmed settlement, not mere return acceptance. */
  refundSettledMinor: number;
  /** Provider-side payments not yet confirmed settled. */
  refundPendingMinor: number;
  /** Failed refund payment attempts needing review. */
  refundFailedMinor: number;
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
  applyConfirmedBranch: (businessId: string, branch: WorkspaceBranch) => void;
  applyConfirmedBusiness: (business: WorkspaceBusinessProfile) => void;
  switchBusiness: (businessId: string) => Promise<void>;
  switchBranch: (branchId: string) => Promise<void>;
  refreshCatalog: () => Promise<void>;
  applyConfirmedCatalogUpdate: (businessId: string, item: CatalogItem, fields: ConfirmedCatalogFields) => void;
  applyConfirmedCatalogDeletion: (businessId: string, itemId: string) => void;
  refreshInventory: () => Promise<void>;
  refreshCustomers: () => Promise<void>;
  applyConfirmedCustomerUpdate: (businessId: string, customer: Customer, fields: CustomerConfirmedFields) => void;
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

/** Merge a server-confirmed CRUD response immediately into the same read model
 * that supplies the branch list and topbar. Never cross tenant boundaries. */
export function mergeConfirmedBranch(
  current: WorkspaceBusinessContext | null,
  businessId: string,
  branch: WorkspaceBranch,
): WorkspaceBusinessContext | null {
  if (!current || current.business.id !== businessId) return current;
  const exists = current.branches.some((item) => item.id === branch.id);
  return { ...current, branches: exists
    ? current.branches.map((item) => item.id === branch.id ? branch : item)
    : [...current.branches, branch] };
}

export function mergeConfirmedBusiness(
  current: WorkspaceBusinessContext | null,
  business: WorkspaceBusinessProfile,
): WorkspaceBusinessContext | null {
  return current?.business.id === business.id ? { ...current, business } : current;
}

/** Keep a confirmed mutation from being overwritten by an older GET.
 * The update response comes from the primary transaction. A subsequent
 * context GET can arrive out of order or be temporarily stale in a webview.
 * Compare server revisions, not just request completion order.
 */
export interface ConfirmedBranchRevision {
  branch: WorkspaceBranch;
  confirmedAt: number;
}
const BRANCH_CONFIRMATION_GUARD_MS = 120_000;

export function reconcileConfirmedBranchContext(
  context: WorkspaceBusinessContext,
  confirmed: Map<string, ConfirmedBranchRevision>,
  now = Date.now(),
): WorkspaceBusinessContext {
  const seen = new Set<string>();
  let changed = false;
  const branches = context.branches.map((incoming) => {
    const key = context.business.id + ":" + incoming.id;
    seen.add(key);
    const latest = confirmed.get(key);
    if (!latest) return incoming;
    const confirmedTime = Date.parse(latest.branch.updatedAt);
    const incomingTime = Date.parse(incoming.updatedAt);
    const expired = now - latest.confirmedAt >= BRANCH_CONFIRMATION_GUARD_MS;
    const serverCaughtUp = incomingTime >= confirmedTime
      && incoming.name === latest.branch.name
      && incoming.active === latest.branch.active;
    const newerMutation = Number.isFinite(incomingTime)
      && Number.isFinite(confirmedTime) && incomingTime > confirmedTime;
    if (expired || serverCaughtUp || newerMutation) {
      confirmed.delete(key);
      return incoming;
    }
    changed = true;
    return latest.branch;
  });
  // A newly created branch can also be omitted by a stale context response.
  for (const [key, latest] of confirmed) {
    if (!key.startsWith(context.business.id + ":") || seen.has(key)) continue;
    if (now - latest.confirmedAt >= BRANCH_CONFIRMATION_GUARD_MS) {
      confirmed.delete(key);
      continue;
    }
    branches.push(latest.branch);
    changed = true;
  }
  return changed ? { ...context, branches } : context;
}

/** Business profiles currently have no updatedAt in the public API.
 * A short-lived confirmed response wins over an older reload; discard the
 * guard once the server agrees or after expiry to allow external changes.
 */
export interface ConfirmedBusinessRevision {
  business: WorkspaceBusinessProfile;
  confirmedAt: number;
}
export function reconcileConfirmedBusinessContext(
  context: WorkspaceBusinessContext,
  confirmed: Map<string, ConfirmedBusinessRevision>,
  now = Date.now(),
): WorkspaceBusinessContext {
  const latest = confirmed.get(context.business.id);
  if (!latest) return context;
  if (now - latest.confirmedAt >= BRANCH_CONFIRMATION_GUARD_MS
    || context.business.name === latest.business.name) {
    confirmed.delete(context.business.id);
    return context;
  }
  return { ...context, business: latest.business };
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
  // Only the newest context request may update workspace labels and branch lists.
  // This prevents a slow pre-mutation request replacing the refreshed response.
  const contextRequestSeq = useRef(0);
  const hasLoadedWorkspace = useRef(false);
  const confirmedBranches = useRef(new Map<string, ConfirmedBranchRevision>());
  const confirmedBusinesses = useRef(new Map<string, ConfirmedBusinessRevision>());
  const confirmedCustomers = useRef(new Map<string, ConfirmedCustomerRevision>());
  const customersRequestSeq = useRef(0);
  const catalogRequestSeq = useRef(0);
  const inventoryRequestSeq = useRef(0);
  const confirmedCatalog = useRef(new Map<string, ConfirmedCatalogRevision>());
  const confirmedCatalogDeletions = useRef(new Map<string, ConfirmedCatalogDeletion>());
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
    const response = await offlineQueue.authenticatedFetch("/v1/me", { cache: "no-store" });
    if (!response.ok) throw new Error(await readApiErrorMessage(response, "Account context could not be loaded"));
    const value = await response.json() as WorkspaceIdentityResponse;
    if (!value.user || !Array.isArray(value.memberships)) throw new Error("Server returned incomplete account context.");
    return value;
  }, [offlineQueue]);

  const loadBusiness = useCallback(async (businessId: string): Promise<WorkspaceBusinessContext> => {
    const response = await offlineQueue.authenticatedFetch(
      `/v1/businesses/${encodeURIComponent(businessId)}/context`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error(await readApiErrorMessage(response, "Business context could not be loaded"));
    const value = await response.json() as WorkspaceBusinessContext;
    if (!value.business || !value.membership || !Array.isArray(value.branches)) {
      throw new Error("Server returned incomplete business context.");
    }
    return reconcileConfirmedBusinessContext(
      reconcileConfirmedBranchContext(value, confirmedBranches.current),
      confirmedBusinesses.current,
    );
  }, [offlineQueue]);

  const refreshWorkspaceContext = useCallback(async () => {
    const current = offlineQueue.sessions.load() ?? session;
    if (!current) throw new Error("You are signed out.");
    const requestId = ++contextRequestSeq.current;
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
      // A slow earlier request must never overwrite newer committed CRUD data.
      if (requestId !== contextRequestSeq.current) return;
      setAccount(identity.user);
      setMemberships(identity.memberships);
      setBusinessContext(context);
      hasLoadedWorkspace.current = true;
      setFatal(null);
      if (!sessionsEquivalent(current, normalized)) {
        offlineQueue.sessions.save(normalized);
        setSession(normalized);
      }
    } catch (error) {
      if (requestId !== contextRequestSeq.current) return;
      if (!hasLoadedWorkspace.current) {
        // Only an initial access failure is fatal. A transient reload failure
        // after a confirmed CRUD write must not blank the entire workspace.
        setFatal(error instanceof Error ? error.message : "Workspace context could not be loaded.");
      }
      // Never report a successful settings refresh when the authoritative
      // server reload actually failed. CRUD handlers must see the failure.
      throw error;
    } finally {
      if (requestId === contextRequestSeq.current) setContextBusy(false);
    }
  }, [loadBusiness, loadIdentity, offlineQueue, session]);

  useEffect(() => {
    if (session) void refreshWorkspaceContext().catch(() => {
      // The provider already recorded the error for WorkspaceBoundary.
    });
    else {
      setAccount(null);
      setMemberships([]);
      setBusinessContext(null);
    }
  // refreshWorkspaceContext intentionally changes when session changes; the
  // normalizer avoids re-saving an equivalent session and therefore loops.
  }, [session, refreshWorkspaceContext]);

  // Server writes return the confirmed entity. Apply it to the shared
  // workspace immediately; the subsequent no-store context read reconciles
  // permissions, branch lists and other server-derived fields.
  const applyConfirmedBranch = useCallback((businessId: string, branch: WorkspaceBranch) => {
    // Register synchronously before the POST/PATCH handler requests a reload.
    // State-setting alone is insufficient: the reload could immediately
    // replace the confirmed record with a stale branch name.
    confirmedBranches.current.set(businessId + ":" + branch.id, {
      branch, confirmedAt: Date.now(),
    });
    setBusinessContext((current) => mergeConfirmedBranch(current, businessId, branch));
  }, []);

  const applyConfirmedBusiness = useCallback((business: WorkspaceBusinessProfile) => {
    confirmedBusinesses.current.set(business.id, {
      business, confirmedAt: Date.now(),
    });
    setBusinessContext((current) => mergeConfirmedBusiness(current, business));
    const currentSession = offlineQueue.sessions.load();
    if (currentSession?.businessId === business.id && currentSession.businessName !== business.name) {
      const nextSession = { ...currentSession, businessName: business.name };
      offlineQueue.sessions.save(nextSession);
      setSession(nextSession);
    }
  }, [offlineQueue]);

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
      ++customersRequestSeq.current;
      ++catalogRequestSeq.current;
      ++inventoryRequestSeq.current;
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
    ++inventoryRequestSeq.current;
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
    const requestId = ++catalogRequestSeq.current;
    const businessId = session.businessId;
    const isCurrent = () => requestId === catalogRequestSeq.current
      && offlineQueue.sessions.load()?.businessId === businessId;
    try {
      const res = await offlineQueue.authenticatedFetch(
        `/v1/catalog/items?businessId=${encodeURIComponent(businessId)}`,
        { cache: "no-store" },
      );
      if (!isCurrent()) return;
      if (!res.ok) {
        setFatal(`Could not load catalog (${res.status}).`);
        return;
      }
      const json = await res.json() as { items?: unknown[] };
      if (!isCurrent()) return;
      setCatalog(reconcileConfirmedCatalog(
        (json.items ?? []).map((item) => mapCatalogItem(item)),
        businessId, confirmedCatalog.current, Date.now(), confirmedCatalogDeletions.current,
      ));
    } catch (error) {
      if (isCurrent()) setFatal(error instanceof Error ? error.message : "Could not load catalog.");
    }
  }, [offlineQueue, session]);

  const applyConfirmedCatalogUpdate = useCallback((
    businessId: string, item: CatalogItem, fields: ConfirmedCatalogFields,
  ) => {
    if (offlineQueue.sessions.load()?.businessId !== businessId) return;
    registerConfirmedCatalogUpdate(confirmedCatalog.current, businessId, item, fields);
    ++catalogRequestSeq.current;
    setCatalog((previous) => previous.map((entry) =>
      entry.id === item.id ? { ...entry, ...fields } : entry));
  }, [offlineQueue]);

  const applyConfirmedCatalogDeletion = useCallback((businessId: string, itemId: string) => {
    if (offlineQueue.sessions.load()?.businessId !== businessId) return;
    registerConfirmedCatalogDeletion(confirmedCatalogDeletions.current, businessId, itemId);
    confirmedCatalog.current.delete(businessId + ":" + itemId);
    ++catalogRequestSeq.current;
    setCatalog((previous) => previous.filter((item) => item.id !== itemId));
  }, [offlineQueue]);

  const refreshInventory = useCallback(async () => {
    if (!session) return;
    const requestId = ++inventoryRequestSeq.current;
    const businessId = session.businessId;
    const branchId = session.branchId;
    const isCurrent = () => {
      const active = offlineQueue.sessions.load();
      return requestId === inventoryRequestSeq.current
        && active?.businessId === businessId && active?.branchId === branchId;
    };
    try {
      const res = await offlineQueue.authenticatedFetch(
        `/v1/inventory?businessId=${encodeURIComponent(businessId)}&branchId=${encodeURIComponent(branchId)}`,
        { cache: "no-store" },
      );
      if (!isCurrent()) return;
      if (!res.ok) {
        setInventory([]);
        return;
      }
      const json = await res.json() as { items?: unknown[] };
      if (isCurrent()) setInventory((json.items ?? []).map((item) => mapInventoryItem(item)));
    } catch {
      if (isCurrent()) setInventory([]);
    }
  }, [offlineQueue, session]);

  const refreshCustomers = useCallback(async () => {
    if (!session) return;
    const requestId = ++customersRequestSeq.current;
    const businessId = session.businessId;
    try {
      const res = await offlineQueue.authenticatedFetch(
        `/v1/customers?businessId=${encodeURIComponent(businessId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = await res.json() as { customers: Customer[] };
      // A slow response from a prior business, or from a pre-update request,
      // must not replace a confirmed customer rename.
      if (requestId !== customersRequestSeq.current
        || offlineQueue.sessions.load()?.businessId !== businessId) return;
      setCustomers(reconcileConfirmedCustomers(
        json.customers ?? [], businessId, confirmedCustomers.current,
      ));
    } catch {
      // Customers are non-blocking.
    }
  }, [offlineQueue, session]);

  const applyConfirmedCustomerUpdate = useCallback((
    businessId: string, customer: Customer, fields: CustomerConfirmedFields,
  ) => {
    if (offlineQueue.sessions.load()?.businessId !== businessId) return;
    registerConfirmedCustomerUpdate(confirmedCustomers.current, businessId, customer, fields);
    ++customersRequestSeq.current;
    setCustomers((previous) => previous.map((item) =>
      item.id === customer.id ? { ...item, ...fields } : item));
  }, [offlineQueue]);

  useEffect(() => {
    if(!session||!online)return;
    const listener=(event:Event)=>{
      const detail=(event as CustomEvent<{businessId:string;path?:string}>).detail;
      if(detail?.businessId!==session.businessId)return;
      const path=detail.path??"";
      if(!path||/\/v1\/catalog\//.test(path))void refreshCatalog();
      if(!path||/\/v1\/(catalog|inventory|sales|returns|purchases|purchase-orders|supplier-invoices)/.test(path))void refreshInventory();
      if(!path||/\/v1\/(customers|sales|returns|payments)/.test(path))void refreshCustomers();
      if(/\/v1\/(businesses|account|staff|branches)\//.test(path))void refreshWorkspaceContext().catch(()=>{});
    };
    window.addEventListener(MUTATION_INVALIDATION_EVENT,listener);
    return ()=>window.removeEventListener(MUTATION_INVALIDATION_EVENT,listener);
  },[session,online,refreshCatalog,refreshInventory,refreshCustomers,refreshWorkspaceContext]);

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
    ++catalogRequestSeq.current;
    ++inventoryRequestSeq.current;
    ++customersRequestSeq.current;
    offlineQueue.sessions.save(next);
    setSession(next);
    setFatal(null);
  }, [offlineQueue]);

  const signOut = useCallback(() => {
    ++customersRequestSeq.current;
    ++catalogRequestSeq.current;
    ++inventoryRequestSeq.current;
    confirmedCatalog.current.clear();
    confirmedCatalogDeletions.current.clear();
    confirmedBranches.current.clear();
    confirmedBusinesses.current.clear();
    confirmedCustomers.current.clear();
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
    applyConfirmedBranch,
    applyConfirmedBusiness,
    switchBusiness,
    switchBranch,
    refreshCatalog,
    applyConfirmedCatalogUpdate,
    applyConfirmedCatalogDeletion,
    refreshInventory,
    refreshCustomers,
    applyConfirmedCustomerUpdate,
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
