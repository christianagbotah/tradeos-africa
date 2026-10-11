/**
 * Test: the production desktop NEVER silently falls back to sample data.
 *
 * Without VITE_TRADEOS_DEMO=true, the DesktopApiClient throws on every call
 * when there is no session (NoSessionError), and the demo-mode gate
 * (DEMO_MODE_ENABLED) is false. This guarantees that an auth/connectivity
 * failure surfaces a truthful state instead of populating the UI with sample
 * business data.
 */
import { describe, expect, it } from "vitest";
import {
  DesktopApiClient,
  NoSessionError,
  SessionExpiredError,
} from "./desktop-api-client.js";
import {
  LocalStorageSessionStore,
  RefusingSessionStore,
} from "./session-store.js";
import { DEMO_MODE_ENABLED, isDemoMode } from "./sample-data.js";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly length: number = 0;
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(_index: number): string | null { return null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  [Symbol.iterator]() { return this.values.keys(); }
}

describe("DEMO_MODE_ENABLED gate", () => {
  it("is false when VITE_TRADEOS_DEMO is not set", () => {
    // This test file runs without VITE_TRADEOS_DEMO so the gate must be false.
    // If a developer sets VITE_TRADEOS_DEMO=true at build time, this test
    // would need to be adjusted — the production build must never ship with
    // demo mode on by accident.
    expect(DEMO_MODE_ENABLED).toBe(false);
    expect(isDemoMode()).toBe(false);
  });
});

describe("DesktopApiClient — no sample-data fallback", () => {
  it("throws NoSessionError on getMe when no tokens are stored", async () => {
    const storage = new MemoryStorage();
    const sessionStore = new LocalStorageSessionStore(storage);
    const client = new DesktopApiClient({
      baseUrl: "http://127.0.0.1:8080",
      sessionStore,
      platform: "WINDOWS",
      appVersion: "0.0.1",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    await expect(client.getMe()).rejects.toBeInstanceOf(NoSessionError);
  });

  it("throws NoSessionError on getCatalog when no tokens are stored", async () => {
    const storage = new MemoryStorage();
    const sessionStore = new LocalStorageSessionStore(storage);
    const client = new DesktopApiClient({
      baseUrl: "http://127.0.0.1:8080",
      sessionStore,
      platform: "WINDOWS",
      appVersion: "0.0.1",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    await expect(client.getCatalog("any-business-id")).rejects.toBeInstanceOf(NoSessionError);
  });

  it("throws NoSessionError on push (sync) when no tokens are stored", async () => {
    const storage = new MemoryStorage();
    const sessionStore = new LocalStorageSessionStore(storage);
    const client = new DesktopApiClient({
      baseUrl: "http://127.0.0.1:8080",
      sessionStore,
      platform: "WINDOWS",
      appVersion: "0.0.1",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    await expect(
      client.push({ mutations: [] }),
    ).rejects.toBeInstanceOf(NoSessionError);
  });

  it("throws NoSessionError on getSales when no tokens are stored", async () => {
    const storage = new MemoryStorage();
    const sessionStore = new LocalStorageSessionStore(storage);
    const client = new DesktopApiClient({
      baseUrl: "http://127.0.0.1:8080",
      sessionStore,
      platform: "WINDOWS",
      appVersion: "0.0.1",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    await expect(client.getSales("biz", "branch")).rejects.toBeInstanceOf(NoSessionError);
  });

  it("throws NoSessionError on getInventory when no tokens are stored", async () => {
    const storage = new MemoryStorage();
    const sessionStore = new LocalStorageSessionStore(storage);
    const client = new DesktopApiClient({
      baseUrl: "http://127.0.0.1:8080",
      sessionStore,
      platform: "WINDOWS",
      appVersion: "0.0.1",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    await expect(client.getInventory("biz", "branch")).rejects.toBeInstanceOf(NoSessionError);
  });

  it("throws NoSessionError on getCustomers when no tokens are stored", async () => {
    const storage = new MemoryStorage();
    const sessionStore = new LocalStorageSessionStore(storage);
    const client = new DesktopApiClient({
      baseUrl: "http://127.0.0.1:8080",
      sessionStore,
      platform: "WINDOWS",
      appVersion: "0.0.1",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    await expect(client.getCustomers("biz")).rejects.toBeInstanceOf(NoSessionError);
  });

  it("throws SessionExpiredError on 401 (after refresh also fails)", async () => {
    const storage = new MemoryStorage();
    const sessionStore = new LocalStorageSessionStore(storage);
    await sessionStore.setTokens({
      accessToken: "expired",
      refreshToken: "expired-refresh",
      accessExpiresAt: "2026-10-11T00:00:00.000Z",
      refreshExpiresAt: "2026-11-11T00:00:00.000Z",
    });
    // Every request returns 401 — the refresh fails too.
    const fetchImpl = async () => new Response(
      JSON.stringify({ message: "session expired" }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
    const client = new DesktopApiClient({
      baseUrl: "http://127.0.0.1:8080",
      sessionStore,
      platform: "WINDOWS",
      appVersion: "0.0.1",
      fetchImpl,
    });

    // Override fetchImpl to always return 401.
    const client401 = new DesktopApiClient({
      baseUrl: "http://127.0.0.1:8080",
      sessionStore,
      platform: "WINDOWS",
      appVersion: "0.0.1",
      fetchImpl: async () => new Response(
        JSON.stringify({ message: "unauthorized" }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    });

    await expect(client401.getMe()).rejects.toBeInstanceOf(SessionExpiredError);
    // The session must be cleared after a session-expired event.
    expect(await sessionStore.getTokens()).toBeNull();
  });

  it("throws on network failure (no silent sample-data fallback)", async () => {
    const storage = new MemoryStorage();
    const sessionStore = new LocalStorageSessionStore(storage);
    await sessionStore.setTokens({
      accessToken: "valid",
      refreshToken: "valid-refresh",
      accessExpiresAt: "2026-10-11T00:00:00.000Z",
      refreshExpiresAt: "2026-11-11T00:00:00.000Z",
    });
    const client = new DesktopApiClient({
      baseUrl: "http://127.0.0.1:8080",
      sessionStore,
      platform: "WINDOWS",
      appVersion: "0.0.1",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });

    await expect(client.getMe()).rejects.toThrow(/network down/);
  });

  it("does NOT expose any sample-data-returning method", () => {
    const storage = new MemoryStorage();
    const sessionStore = new LocalStorageSessionStore(storage);
    const client = new DesktopApiClient({
      baseUrl: "http://127.0.0.1:8080",
      sessionStore,
      platform: "WINDOWS",
      appVersion: "0.0.1",
    });

    // The client must not have any method that returns sample data. The old
    // api.ts had fetchProducts() that returned SAMPLE_PRODUCTS on no-session;
    // the new client must not have any such surface.
    expect((client as unknown as { fetchProducts?: unknown }).fetchProducts).toBeUndefined();
    expect((client as unknown as { fetchInventory?: unknown }).fetchInventory).toBeUndefined();
    expect((client as unknown as { fetchSales?: unknown }).fetchSales).toBeUndefined();
    expect((client as unknown as { fetchCustomers?: unknown }).fetchCustomers).toBeUndefined();
  });
});

describe("RefusingSessionStore integration", () => {
  it("client throws NoSessionError when the session store refuses to persist", async () => {
    const refusingStore = new RefusingSessionStore("secure storage unavailable");
    const client = new DesktopApiClient({
      baseUrl: "http://127.0.0.1:8080",
      sessionStore: refusingStore,
      platform: "WINDOWS",
      appVersion: "0.0.1",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });

    // The refusing store returns null for getTokens, so every call throws NoSessionError.
    await expect(client.getMe()).rejects.toBeInstanceOf(NoSessionError);
  });
});
