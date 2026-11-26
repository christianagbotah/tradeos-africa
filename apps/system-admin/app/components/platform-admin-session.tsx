"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AdminShell } from "./admin-shell";

export interface PlatformAdminUserView {
  id: string;
  email: string;
  displayName: string;
  role: string;
  lastLoginAt: string | null;
}

type AdminSessionPhase = "loading" | "signed-out" | "authenticated";

interface AdminSessionContextValue {
  phase: AdminSessionPhase;
  adminUser: PlatformAdminUserView | null;
  login(identifier: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshAdminUser(): Promise<void>;
  apiFetch(path: string, init?: RequestInit): Promise<Response>;
}

const ADMIN_MUTATION_EVENT = "tradeos:admin-mutation-confirmed";
const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export function PlatformAdminProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AdminSessionPhase>("loading");
  const [adminUser, setAdminUser] = useState<PlatformAdminUserView | null>(null);

  const markSignedOut = useCallback(() => {
    setAdminUser(null);
    setPhase("signed-out");
  }, []);

  const refreshAdminUser = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/admin/session/me", { credentials: "include" });
    if (!response.ok) {
      if (response.status === 401) markSignedOut();
      throw new Error("Administrator session could not be refreshed");
    }
    const body = await response.json() as { adminUser: PlatformAdminUserView };
    setAdminUser(body.adminUser);
    setPhase("authenticated");
  }, [markSignedOut]);

  useEffect(() => {
    let active = true;
    void refreshAdminUser().catch(() => {
      if (active) markSignedOut();
    });
    return () => {
      active = false;
    };
  }, [markSignedOut, refreshAdminUser]);

  const login = useCallback(async (identifier: string, password: string) => {
    const response = await fetch("/api/admin/session/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password, platform: "WEB", deviceKey: browserDeviceKey() }),
    });
    const body = await response.json().catch(() => ({})) as {
      adminUser?: PlatformAdminUserView;
      message?: string;
    };
    if (!response.ok || !body.adminUser) {
      throw new Error(body.message ?? "Administrator sign-in failed");
    }
    setAdminUser(body.adminUser);
    setPhase("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/admin/session/logout", { method: "POST", credentials: "include" });
    } finally {
      markSignedOut();
    }
  }, [markSignedOut]);

  const authenticatedFetch = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const response = await fetch(path, { cache: "no-store", ...init, credentials: "include" });
    if (response.ok && ["POST","PUT","PATCH","DELETE"].includes((init?.method??"GET").toUpperCase())) {
      window.dispatchEvent(new Event(ADMIN_MUTATION_EVENT));
    }
    if (response.status === 401) markSignedOut();
    return response;
  }, [markSignedOut]);

  const value = useMemo<AdminSessionContextValue>(() => ({
    phase,
    adminUser,
    login,
    logout,
    refreshAdminUser,
    apiFetch: authenticatedFetch,
  }), [adminUser, authenticatedFetch, login, logout, phase, refreshAdminUser]);

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
  const { apiFetch,adminUser } = usePlatformAdminSession();
  const scope = (adminUser?.id??"signed-out")+":"+path;
  const scopeRef = useRef(scope);
  scopeRef.current=scope;
  const [sourceScope,setSourceScope]=useState(scope);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation=useRef(0);

  const reload = useCallback(async () => {
    const requestId=++generation.current;
    const current=()=>generation.current===requestId&&scopeRef.current===scope;
    setSourceScope(scope);
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(path,{cache:"no-store"});
      const body = await response.json().catch(() => ({})) as T & { message?: string };
      if(!current())return;
      if (!response.ok) throw new Error(body.message ?? `Request failed (${response.status})`);
      setData(body);
    } catch (requestError) {
      if(current())setError(requestError instanceof Error ? requestError.message : "Request failed");
    } finally {
      if(current())setLoading(false);
    }
  }, [apiFetch, path, scope]);

  useEffect(() => {
    setData(null);
    void reload();
    const onMutation=()=>{void reload();};
    window.addEventListener(ADMIN_MUTATION_EVENT,onMutation);
    return ()=>{
      ++generation.current;
      window.removeEventListener(ADMIN_MUTATION_EVENT,onMutation);
    };
  }, [reload]);

  return { data:sourceScope===scope?data:null, loading:sourceScope!==scope||loading, error:sourceScope===scope?error:null, reload };
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
