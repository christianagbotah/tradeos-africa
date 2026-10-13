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

describe("WebOfflineQueue access-token recovery", () => {
  it("refreshes an expired access token and retries an authenticated request once", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a", "expired-access"));
    const calls: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, auth: headers.get("authorization") });
      if (url === "/v1/auth/refresh") {
        return new Response(JSON.stringify({ session: { accessToken: "fresh-access", refreshToken: "fresh-refresh", clientId: "web-client-1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (headers.get("authorization") === "Bearer expired-access") {
        return new Response(JSON.stringify({ error: "ACCESS_REJECTED", message: "Access token is expired or revoked" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const response = await queue.authenticatedFetch("/v1/suppliers?businessId=business-a");

    expect(response.status).toBe(200);
    expect(queue.sessions.load()?.accessToken).toBe("fresh-access");
    expect(queue.sessions.load()?.refreshToken).toBe("fresh-refresh");
    expect(calls.filter((call) => call.url === "/v1/auth/refresh")).toHaveLength(1);
    expect(calls.at(-1)?.auth).toBe("Bearer fresh-access");
  });

  it("refreshes and retries the offline sync transport instead of rejecting queued work", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    const businessId = "11111111-1111-4111-8111-111111111111";
    queue.sessions.save(session(businessId, "expired-access"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url === "/v1/auth/refresh") {
        return new Response(JSON.stringify({ session: { accessToken: "fresh-access", refreshToken: "fresh-refresh", clientId: "web-client-1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (headers.get("authorization") === "Bearer expired-access") {
        return new Response(JSON.stringify({ error: "ACCESS_REJECTED", message: "Access token is expired or revoked" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ mutationResults: [{ clientMutationId: "mutation-1", status: "APPLIED", result: { supplierId: "supplier-1" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    await queue.enqueue(queue.build({ businessId, mutationType: "SUPPLIER_CREATE", payload: { name: "UAT Supplier" } }));

    const result = await queue.flush({ activeBusinessId: businessId, online: true });

    expect(result.applied).toBe(1);
    expect((await queue.getSnapshot()).pending).toHaveLength(0);
    expect(queue.sessions.load()?.accessToken).toBe("fresh-access");
  });

  it("shows a friendly session-expired error when the refresh token is also rejected", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a", "expired-access"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input) === "/v1/auth/refresh") {
        return new Response(JSON.stringify({ error: "REFRESH_REJECTED", message: "Refresh token is expired or revoked" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "ACCESS_REJECTED", message: "Access token is expired or revoked" }), { status: 401, headers: { "content-type": "application/json" } });
    }));

    await expect(queue.authenticatedFetch("/v1/suppliers?businessId=business-a")).rejects.toThrow("Your session has expired. Please sign in again.");
  });
});

describe("WebOfflineQueue UI mutation rejection visibility", () => {
  it("throws the server rejection message while preserving the failed mutation for retry", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    const businessId = "22222222-2222-4222-8222-222222222222";
    queue.sessions.save(session(businessId, "fresh-access"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      mutationResults: [{
        clientMutationId: "mutation-1",
        status: "REJECTED",
        errorCode: "SUPPLIER_INVALID",
        errorMessage: "Supplier phone number is invalid.",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    await queue.enqueue(queue.build({ businessId, mutationType: "SUPPLIER_CREATE", payload: { name: "Bad Supplier" } }));

    await expect(queue.flushOrThrow({ activeBusinessId: businessId, online: true }))
      .rejects.toThrow("Supplier phone number is invalid.");

    const snapshot = await queue.getSnapshot();
    expect(snapshot.pending).toHaveLength(0);
    expect(snapshot.failed).toHaveLength(1);
  });
});
