import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureSessionEpoch,
  clearLogoutPending,
  finalizePendingLogout,
  isLogoutPending,
  isSessionEpochCurrent,
  markLogoutPending,
} from "./session-lifecycle";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
  clearLogoutPending();
});

describe("session lifecycle", () => {
  it("marks logout pending and invalidates requests captured under the old session", () => {
    const before = captureSessionEpoch();
    markLogoutPending();
    expect(isLogoutPending()).toBe(true);
    expect(isSessionEpochCurrent(before)).toBe(false);
  });

  it("keeps logout pending when the browser cannot reach the session route", async () => {
    markLogoutPending();
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await finalizePendingLogout(fetcher as typeof fetch)).toBe("pending");
    expect(isLogoutPending()).toBe(true);
  });

  it("clears logout pending only after the session route confirms cookie invalidation", async () => {
    markLogoutPending();
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await finalizePendingLogout(fetcher as typeof fetch)).toBe("cleared");
    expect(isLogoutPending()).toBe(false);
  });
});
