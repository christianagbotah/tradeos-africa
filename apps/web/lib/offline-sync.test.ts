import { afterEach, describe, expect, it, vi } from "vitest";
import { WebOfflineQueue, type WebSession } from "./offline-sync";

const QUEUE_KEY = "tradeos.web.mutationQueue.v1";

class FakeLocalStorage {
  private readonly values = new Map<string, string>();
  failQueueWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failQueueWrites && key === QUEUE_KEY) {
      throw new Error("quota exceeded");
    }
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function session(businessId: string, accessToken = "token-1"): WebSession {
  return {
    accessToken,
    refreshToken: "refresh-1",
    clientId: "web-client-1",
    businessId,
    branchId: "branch-1",
    staffId: "staff-1",
    currencyCode: "GHS",
    timezone: "Africa/Accra",
    businessName: `Business ${businessId}`,
    role: "OWNER",
    displayName: "Owner",
  };
}

function makeQueue(): WebOfflineQueue {
  let mutationNumber = 0;
  return new WebOfflineQueue({
    now: () => "2026-10-13T14:00:00.000Z",
    createMutationId: () => `mutation-${++mutationNumber}`,
  });
}

function installWindow(storage: FakeLocalStorage): void {
  vi.stubGlobal("window", { localStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebOfflineQueue durable storage boundary", () => {
  it("rejects enqueue when the browser cannot durably persist the mutation", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a"));
    storage.failQueueWrites = true;

    const mutation = queue.build({
      businessId: "business-a",
      branchId: "branch-1",
      mutationType: "CUSTOMER_PAYMENT_CREATE",
      payload: { customerId: "customer-1", amountMinor: 1000, method: "CASH" },
    });

    await expect(queue.enqueue(mutation)).rejects.toThrow("Offline mutation persistence failed");
  });
});

describe("WebOfflineQueue business isolation", () => {
  it("clears queued mutations when a session for a different business replaces the current session", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a"));

    await queue.enqueue(queue.build({
      businessId: "business-a",
      branchId: "branch-a",
      mutationType: "CUSTOMER_PAYMENT_CREATE",
      payload: { customerId: "customer-1", amountMinor: 1000, method: "CASH" },
    }));
    expect((await queue.getSnapshot()).pending).toHaveLength(1);

    queue.sessions.save(session("business-b", "token-2"));

    const snapshot = await queue.getSnapshot();
    expect(snapshot.pending).toHaveLength(0);
    expect(snapshot.failed).toHaveLength(0);
  });

  it("clears queued mutations without requiring a durable write during sign-out cleanup", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a"));

    await queue.enqueue(queue.build({
      businessId: "business-a",
      branchId: "branch-a",
      mutationType: "CUSTOMER_PAYMENT_CREATE",
      payload: { customerId: "customer-1", amountMinor: 1000, method: "CASH" },
    }));
    storage.failQueueWrites = true;

    await expect(queue.clear()).resolves.toBeUndefined();
    expect((await queue.getSnapshot()).pending).toHaveLength(0);
  });

  it("preserves queued mutations when the same business merely refreshes its session", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a"));

    await queue.enqueue(queue.build({
      businessId: "business-a",
      branchId: "branch-a",
      mutationType: "CUSTOMER_PAYMENT_CREATE",
      payload: { customerId: "customer-1", amountMinor: 1000, method: "CASH" },
    }));

    queue.sessions.save(session("business-a", "refreshed-token"));

    expect((await queue.getSnapshot()).pending).toHaveLength(1);
  });
});
