"use client";

import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { QuickSaleItem } from "../quick-sale";
import { getActiveBusinessId, setActiveBusinessId } from "../../lib/offline-sync";
import { clearWorkspaceBootstrap, readWorkspaceBootstrap, writeWorkspaceBootstrap } from "../../lib/workspace-bootstrap";
import type { BusinessContext, CatalogItem, MePayload, Membership } from "../../lib/workspace-types";

export type WorkspaceContextValue = {
  session: MePayload;
  context: BusinessContext;
  branchId: string;
  activeBranch: BusinessContext["branches"][number];
  catalog: CatalogItem[];
  sellableItems: QuickSaleItem[];
  setBusiness: (businessId: string) => Promise<void>;
  setBranch: (branchId: string) => void;
  refreshBusiness: () => Promise<void>;
  logout: () => Promise<void>;
};

export type WorkspaceStore = {
  resolved: boolean;
  session: MePayload | null;
  context: BusinessContext | null;
  branchId: string | null;
  catalog: CatalogItem[];
  sellableItems: QuickSaleItem[];
  error: string | null;
  setBusiness: (businessId: string) => Promise<void>;
  setBranch: (branchId: string) => void;
  refreshBusiness: () => Promise<void>;
  logout: () => Promise<void>;
};

export const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);

export function selectWorkspaceMembership(session: MePayload, rememberedBusinessId: string | null): Membership | null {
  return session.memberships.find((item) => item.businessId === rememberedBusinessId) ?? session.memberships[0] ?? null;
}

export function selectInitialBranch(context: BusinessContext, currentBranchId: string | null) {
  const active = context.branches.filter((branch) => branch.active);
  return active.find((branch) => branch.id === currentBranchId)
    ?? active.find((branch) => branch.code === "MAIN")
    ?? active[0]
    ?? null;
}

export function projectSellableItems(catalog: CatalogItem[]): QuickSaleItem[] {
  return catalog.flatMap((item) => item.units
    .filter((unit) => item.active && unit.canSell && unit.defaultSalePriceMinor !== null)
    .map((unit) => ({
      key: `${item.id}:${unit.code}`,
      itemId: item.id,
      name: item.name,
      unitCode: unit.code,
      unitLabel: unit.label,
      priceMinor: unit.defaultSalePriceMinor!,
    })));
}

export function getWorkspaceGate(input: {
  resolved: boolean;
  session: MePayload | null;
  context: BusinessContext | null;
  branchId: string | null;
}): "loading" | "redirect-root" | "ready" {
  if (!input.resolved) return "loading";
  if (!input.session || input.session.memberships.length === 0) return "redirect-root";
  if (!input.context || !input.branchId) return "loading";
  return "ready";
}

export function isCurrentWorkspaceRequest(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [resolved, setResolved] = useState(false);
  const [session, setSession] = useState<MePayload | null>(null);
  const [context, setContext] = useState<BusinessContext | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const businessIntent = useRef<string | null>(null);

  const loadBusiness = useCallback(async (businessId: string, preferredBranchId: string | null = null) => {
    const generation = ++requestGenerationRef.current;
    const [business, catalogData] = await Promise.all([
      api<BusinessContext>(`/api/tradeos/v1/businesses/${businessId}/context`),
      api<{ items: CatalogItem[] }>(`/api/tradeos/v1/catalog/items?businessId=${businessId}`),
    ]);
    if (generation !== requestGenerationRef.current) return null;
    const selectedBranch = selectInitialBranch(business, preferredBranchId);
    if (!selectedBranch) throw new Error("This business has no active branch.");
    setContext(business);
    setCatalog(catalogData.items);
    setBranchId(selectedBranch.id);
    return { context: business, branchId: selectedBranch.id, catalog: catalogData.items };
  }, []);

  const loadSession = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/session/me", { cache: "no-store" });
      if (response.status === 401) {
        requestGenerationRef.current += 1;
        businessIntent.current = null;
        clearWorkspaceBootstrap();
        setSession(null);
        setContext(null);
        setCatalog([]);
        setBranchId(null);
        setActiveBusinessId(null);
        return;
      }
      const data = await readResponse<MePayload>(response);
      setSession(data);
      const membership = selectWorkspaceMembership(data, getActiveBusinessId());
      if (!membership) {
        businessIntent.current = null;
        clearWorkspaceBootstrap();
        setContext(null);
        setCatalog([]);
        setBranchId(null);
        setActiveBusinessId(null);
        return;
      }
      businessIntent.current = membership.businessId;
      const loaded = await loadBusiness(membership.businessId);
      if (loaded) {
        setActiveBusinessId(membership.businessId);
        writeWorkspaceBootstrap({ session: data, ...loaded });
      }
    } catch (reason) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const cached = readWorkspaceBootstrap();
        if (cached) {
          requestGenerationRef.current += 1;
          businessIntent.current = cached.context.business.id;
          setSession(cached.session);
          setContext(cached.context);
          setCatalog(cached.catalog);
          setBranchId(cached.branchId);
          setActiveBusinessId(cached.context.business.id);
          return;
        }
      }
      setError(messageFrom(reason));
    } finally {
      setResolved(true);
    }
  }, [loadBusiness]);

  useEffect(() => { void loadSession(); }, [loadSession]);

  const setBusiness = useCallback(async (businessId: string) => {
    if (!session?.memberships.some((membership) => membership.businessId === businessId)) throw new Error("Business is not available to this session.");
    setError(null);
    businessIntent.current = businessId;
    const loaded = await loadBusiness(businessId);
    if (loaded) {
      setActiveBusinessId(businessId);
      writeWorkspaceBootstrap({ session, ...loaded });
    }
  }, [loadBusiness, session]);

  const setBranch = useCallback((branchId: string) => {
    if (!context?.branches.some((branch) => branch.id === branchId && branch.active)) return;
    setBranchId(branchId);
    if (session) writeWorkspaceBootstrap({ session, context, branchId, catalog });
  }, [catalog, context, session]);

  const refreshBusiness = useCallback(async () => {
    if (!context) return;
    if (businessIntent.current && businessIntent.current !== context.business.id) return;
    const loaded = await loadBusiness(context.business.id, branchId);
    if (loaded && session) writeWorkspaceBootstrap({ session, ...loaded });
  }, [branchId, context, loadBusiness, session]);

  const logout = useCallback(async () => {
    try { await fetch("/api/session/logout", { method: "POST" }); } finally {
      requestGenerationRef.current += 1;
      businessIntent.current = null;
      clearWorkspaceBootstrap();
      setActiveBusinessId(null);
      setSession(null);
      setContext(null);
      setCatalog([]);
      setBranchId(null);
      setResolved(true);
    }
  }, []);

  const sellableItems = useMemo(() => projectSellableItems(catalog), [catalog]);
  const value = useMemo<WorkspaceStore>(() => ({
    resolved, session, context, branchId, catalog, sellableItems, error,
    setBusiness, setBranch, refreshBusiness, logout,
  }), [resolved, session, context, branchId, catalog, sellableItems, error, setBusiness, setBranch, refreshBusiness, logout]);

  return <WorkspaceStoreContext.Provider value={value}>{children}</WorkspaceStoreContext.Provider>;
}

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", headers: { "content-type": "application/json" } });
  return readResponse<T>(response);
}

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) {
    const candidate = body as { message?: unknown } | null;
    throw new Error(typeof candidate?.message === "string" ? candidate.message : `Request failed (${response.status})`);
  }
  return body as T;
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Something went wrong. Please try again.";
}
