/**
 * Test: session-store token storage + clear.
 *
 * Verifies the LocalStorageSessionStore correctly stores, retrieves and
 * clears session tokens; that the RefusingSessionStore refuses to persist;
 * and that resolveSessionStore returns the right backend for the current
 * runtime.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalStorageSessionStore,
  RefusingSessionStore,
  getSyncSessionStore,
  resolveSessionStore,
  type SessionStore,
  type SessionTokens,
} from "./session-store.js";

const TOKENS_A: SessionTokens = {
  accessToken: "access-a",
  refreshToken: "refresh-a",
  accessExpiresAt: "2026-10-11T00:00:00.000Z",
  refreshExpiresAt: "2026-11-11T00:00:00.000Z",
};

const TOKENS_B: SessionTokens = {
  accessToken: "access-b",
  refreshToken: "refresh-b",
  accessExpiresAt: "2026-10-12T00:00:00.000Z",
  refreshExpiresAt: "2026-11-12T00:00:00.000Z",
};

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

describe("LocalStorageSessionStore", () => {
  let storage: MemoryStorage;
  let store: SessionStore;

  beforeEach(() => {
    storage = new MemoryStorage();
    store = new LocalStorageSessionStore(storage);
  });

  it("returns null when no tokens are stored", async () => {
    expect(await store.getTokens()).toBeNull();
  });

  it("stores and retrieves tokens", async () => {
    await store.setTokens(TOKENS_A);
    expect(await store.getTokens()).toEqual(TOKENS_A);
  });

  it("overwrites previously stored tokens", async () => {
    await store.setTokens(TOKENS_A);
    await store.setTokens(TOKENS_B);
    expect(await store.getTokens()).toEqual(TOKENS_B);
  });

  it("clears tokens", async () => {
    await store.setTokens(TOKENS_A);
    await store.clearTokens();
    expect(await store.getTokens()).toBeNull();
  });

  it("ignores corrupt stored data (returns null)", async () => {
    storage.setItem("tradeos.desktop.session.v1", "{not json");
    expect(await store.getTokens()).toBeNull();
  });

  it("ignores stored data missing required fields (returns null)", async () => {
    storage.setItem(
      "tradeos.desktop.session.v1",
      JSON.stringify({ accessToken: "x" }), // missing refreshToken + expires
    );
    expect(await store.getTokens()).toBeNull();
  });

  it("clearTokens is idempotent when nothing is stored", async () => {
    await expect(store.clearTokens()).resolves.toBeUndefined();
    expect(await store.getTokens()).toBeNull();
  });
});

describe("RefusingSessionStore", () => {
  it("returns null for getTokens", async () => {
    const store = new RefusingSessionStore("no storage");
    expect(await store.getTokens()).toBeNull();
  });

  it("throws on setTokens with the configured reason", async () => {
    const store = new RefusingSessionStore("secure storage unavailable");
    await expect(store.setTokens(TOKENS_A)).rejects.toThrow(/secure storage unavailable/);
  });

  it("clearTokens is a no-op (does not throw)", async () => {
    const store = new RefusingSessionStore("secure storage unavailable");
    await expect(store.clearTokens()).resolves.toBeUndefined();
  });
});

describe("resolveSessionStore", () => {
  beforeEach(() => {
    // Ensure no Tauri runtime flags are set.
    if (typeof window !== "undefined") {
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      delete (window as { __TAURI__?: unknown }).__TAURI__;
    }
  });

  afterEach(() => {
    if (typeof window !== "undefined") {
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      delete (window as { __TAURI__?: unknown }).__TAURI__;
    }
  });

  it("returns a LocalStorageSessionStore when window.localStorage is available", async () => {
    // Vitest's default node environment has no window/localStorage. Stub a
    // minimal window + localStorage so the resolver takes the browser path.
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const fakeStorage = new MemoryStorage();
    (globalThis as { window?: unknown }).window = {
      localStorage: fakeStorage,
    } as unknown;
    try {
      const store = await resolveSessionStore();
      expect(store).toBeInstanceOf(LocalStorageSessionStore);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "window", originalDescriptor);
      } else {
        delete (globalThis as { window?: unknown }).window;
      }
      (globalThis as { window?: unknown }).window = originalWindow as unknown;
    }
  });

  it("returns a RefusingSessionStore when no window/localStorage exists", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    delete (globalThis as { window?: unknown }).window;
    try {
      const store = await resolveSessionStore();
      expect(store).toBeInstanceOf(RefusingSessionStore);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "window", originalDescriptor);
      } else {
        // No-op: window was undefined originally.
      }
      (globalThis as { window?: unknown }).window = originalWindow as unknown;
    }
  });
});

describe("getSyncSessionStore", () => {
  it("returns a LocalStorageSessionStore when window.localStorage is available", () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const fakeStorage = new MemoryStorage();
    (globalThis as { window?: unknown }).window = {
      localStorage: fakeStorage,
    } as unknown;
    try {
      const store = getSyncSessionStore();
      expect(store).toBeInstanceOf(LocalStorageSessionStore);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "window", originalDescriptor);
      } else {
        delete (globalThis as { window?: unknown }).window;
      }
      (globalThis as { window?: unknown }).window = originalWindow as unknown;
    }
  });

  it("returns a RefusingSessionStore when no window/localStorage exists", () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    delete (globalThis as { window?: unknown }).window;
    try {
      const store = getSyncSessionStore();
      expect(store).toBeInstanceOf(RefusingSessionStore);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "window", originalDescriptor);
      } else {
        // No-op: window was undefined originally.
      }
      (globalThis as { window?: unknown }).window = originalWindow as unknown;
    }
  });
});
