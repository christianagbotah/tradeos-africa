"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "./admin-shell";

const STORAGE_KEY = "tradeos.system-admin.session.v1";
const API_BASE = (process.env.NEXT_PUBLIC_TRADEOS_API_BASE_URL ?? "").replace(/\/$/, "");

export interface PlatformAdminUserView {
  id: string;
  email: string;
  displayName: string;
  role: string;
  lastLoginAt: string | null;
}

interface StoredAdminSession {
  adminUser: PlatformAdminUserView;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

type AdminSessionPhase = "loading" | "signed-out" | "authenticated";

interface AdminSessionContextValue {
  phase: AdminSessionPhase;
  adminUser: PlatformAdminUserView | null;
  login(identifier: string, password: string): Promise<void>;
  logout(): Promise<void>;
  apiFetch(path: string, init?: RequestInit): Promise<Response>;
}

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export function PlatformAdminProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AdminSessionPhase>("loading");
  const [session, setSession] = useState<StoredAdminSession | null>(null);

  const persist = useCallback((next: StoredAdminSession | null) => {
    setSession(next);
    setPhase(next ? "authenticated" : "signed-out");
    if (typeof window === "undefined") return;
    if (next) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const refresh = useCallback(async (current: StoredAdminSession): Promise<StoredAdminSession> => {
    const response = await fetch(apiUrl("/api/admin/session/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (!response.ok) throw new Error("Administrator session expired");
    const body = await response.json() as {
      adminUser: PlatformAdminUserView;
      session: Omit<StoredAdminSession, "adminUser">;
    };
    const next = { adminUser: body.adminUser, ...body.session };
    persist(next);
    return next;
  }, [persist]);

  const authenticatedFetch = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const current = session;
    if (!current) throw new Error("Administrator sign-in is required");
    const first = await fetch(apiUrl(path), withBearer(init, current.accessToken));
    if (first.status !== 401) return first;
    try {
      const next = await refresh(current);
      return fetch(apiUrl(path), withBearer(init, next.accessToken));
    } catch (error) {
      persist(null);
      throw error;
    }
  }, [persist, refresh, session]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setPhase("signed-out");
      return;
    }
    let stored: StoredAdminSession;
    try {
      stored = JSON.parse(raw) as StoredAdminSession;
      if (!stored.accessToken || !stored.refreshToken || !stored.adminUser?.id) throw new Error("invalid");
    } catch {
      persist(null);
      return;
    }
    setSession(stored);
    void fetch(apiUrl("/api/admin/session/me"), withBearer(undefined, stored.accessToken))
      .then(async (response) => {
        if (response.ok) {
          const body = await response.json() as { adminUser: PlatformAdminUserView };
          persist({ ...stored, adminUser: body.adminUser });
          return;
        }
        if (response.status !== 401) throw new Error("Administrator session could not be verified");
        await refresh(stored);
      })
      .catch(() => persist(null));
  }, [persist, refresh]);

  const login = useCallback(async (identifier: string, password: string) => {
    const response = await fetch(apiUrl("/api/admin/session/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password, platform: "WEB", deviceKey: browserDeviceKey() }),
    });
    const body = await response.json().catch(() => ({})) as {
      adminUser?: PlatformAdminUserView;
      session?: Omit<StoredAdminSession, "adminUser">;
      message?: string;
    };
    if (!response.ok || !body.adminUser || !body.session) {
      throw new Error(body.message ?? "Administrator sign-in failed");
    }
    persist({ adminUser: body.adminUser, ...body.session });
  }, [persist]);

  const logout = useCallback(async () => {
    const current = session;
    if (current) {
      await fetch(apiUrl("/api/admin/session/logout"), withBearer({ method: "POST" }, current.accessToken)).catch(() => undefined);
    }
    persist(null);
  }, [persist, session]);

  const value = useMemo<AdminSessionContextValue>(() => ({
    phase,
    adminUser: session?.adminUser ?? null,
    login,
    logout,
    apiFetch: authenticatedFetch,
  }), [authenticatedFetch, login, logout, phase, session?.adminUser]);

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function usePlatformAdminSession(): AdminSessionContextValue {
  const value = useContext(AdminSessionContext);
  if (!value) throw new Error("PlatformAdminProvider is missing");
  return value;
}

export function PlatformAdminConsoleGate({ children }: { children: ReactNode }) {
  const { phase, adminUser, logout } = usePlatformAdminSession();
  const router = useRouter();
  useEffect(() => {
    if (phase === "signed-out") router.replace("/");
  }, [phase, router]);

  if (phase !== "authenticated" || !adminUser) {
    return <div className="admin-auth-state" role="status">Verifying administrator session…</div>;
  }

  return (
    <AdminShell
      adminName={adminUser.displayName}
      adminRole={humanizeRole(adminUser.role)}
      adminInitials={initials(adminUser.displayName)}
      onSignOut={() => void logout().finally(() => router.replace("/"))}
    >
      {children}
    </AdminShell>
  );
}

export function useAdminResource<T>(path: string) {
  const { apiFetch } = usePlatformAdminSession();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(path);
      const body = await response.json().catch(() => ({})) as T & { message?: string };
      if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
      setData(body);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function withBearer(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

function browserDeviceKey(): string {
  if (typeof window === "undefined") return "system-admin-web";
  const key = "tradeos.system-admin.device.v1";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = `system-admin-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, created);
  return created;
}

function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "AD";
}

function humanizeRole(role: string): string {
  return role.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
