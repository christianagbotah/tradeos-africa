import { describe, expect, it } from "vitest";
import { MobileApiClient, SessionExpiredError } from "./api-client";
import { MobilePersistence, type SecureStringStorage, type StringStorage } from "./storage";

class MemoryStorage implements StringStorage, SecureStringStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

const oldSession = {
  accessToken: "access-old",
  refreshToken: "refresh-old",
  accessExpiresAt: "2026-10-10T23:00:00.000Z",
  refreshExpiresAt: "2026-11-10T23:00:00.000Z",
};
const newSession = {
  accessToken: "access-new",
  refreshToken: "refresh-new",
  accessExpiresAt: "2026-10-11T00:00:00.000Z",
  refreshExpiresAt: "2026-11-11T00:00:00.000Z",
};
const mePayload = {
  user: { id: "user-1", displayName: "Ama Owner", email: "ama@example.com", phoneE164: null },
  client: { platform: "ANDROID", deviceKey: "mobile-device", appVersion: "0.0.1" },
  memberships: [{ id: "membership-1", businessId: "11111111-1111-4111-8111-111111111111", businessName: "Ama Shop", businessType: "RETAIL_HARDWARE", businessStatus: "ACTIVE", role: "OWNER", staffId: "staff-1" }],
};

function harness(fetchImpl: typeof fetch) {
  const plain = new MemoryStorage();
  const secure = new MemoryStorage();
  const persistence = new MobilePersistence(plain, secure, () => "11111111-1111-4111-8111-111111111111");
  const client = new MobileApiClient({
    baseUrl: "https://tradeos.example/api/mobile",
    persistence,
    fetchImpl,
    platform: "ANDROID",
    appVersion: "0.0.1",
  });
  return { client, persistence, plain, secure };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

describe("MobileApiClient authentication", () => {
  it("logs in with stable device identity and persists the returned session securely", async () => {
    let body: Record<string, unknown> | null = null;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://tradeos.example/api/mobile/v1/auth/login");
      expect(init?.method).toBe("POST");
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ user: mePayload.user, session: oldSession });
    }) as typeof fetch;
    const { client, persistence } = harness(fetchImpl);

    const user = await client.login("ama@example.com", "password123");

    expect(user).toEqual(mePayload.user);
    expect(body).toEqual({
      identifier: "ama@example.com",
      password: "password123",
      platform: "ANDROID",
      deviceKey: "mobile-11111111-1111-4111-8111-111111111111",
      appVersion: "0.0.1",
    });
    expect(await persistence.loadSession()).toEqual(oldSession);
  });

  it("sends the bearer token on authenticated reads", async () => {
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://tradeos.example/api/mobile/v1/me");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer access-old");
      return jsonResponse(mePayload);
    }) as typeof fetch;
    const { client, persistence } = harness(fetchImpl);
    await persistence.saveSession(oldSession);

    await expect(client.getMe()).resolves.toEqual(mePayload);
  });

  it("refreshes once after a 401, persists rotation, and retries with the new access token", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? "none";
      seen.push(`${url}:${auth}`);
      if (url.endsWith("/v1/auth/refresh")) return jsonResponse({ session: newSession });
      if (auth === "Bearer access-old") return jsonResponse({ error: "AUTH_REQUIRED" }, 401);
      return jsonResponse(mePayload);
    }) as typeof fetch;
    const { client, persistence } = harness(fetchImpl);
    await persistence.saveSession(oldSession);

    await expect(client.getMe()).resolves.toEqual(mePayload);

    expect(seen).toEqual([
      "https://tradeos.example/api/mobile/v1/me:Bearer access-old",
      "https://tradeos.example/api/mobile/v1/auth/refresh:none",
      "https://tradeos.example/api/mobile/v1/me:Bearer access-new",
    ]);
    expect(await persistence.loadSession()).toEqual(newSession);
  });

  it("coalesces concurrent unauthorized requests into one refresh-token rotation", async () => {
    let refreshCalls = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (url.endsWith("/v1/auth/refresh")) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return jsonResponse({ session: newSession });
      }
      if (auth === "Bearer access-old") return jsonResponse({ error: "AUTH_REQUIRED" }, 401);
      return jsonResponse(mePayload);
    }) as typeof fetch;
    const { client, persistence } = harness(fetchImpl);
    await persistence.saveSession(oldSession);

    const [first, second] = await Promise.all([client.getMe(), client.getMe()]);

    expect(first).toEqual(mePayload);
    expect(second).toEqual(mePayload);
    expect(refreshCalls).toBe(1);
  });

  it("clears local credentials when refresh fails", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/v1/auth/refresh")) return jsonResponse({ error: "SESSION_EXPIRED", message: "Expired" }, 401);
      return jsonResponse({ error: "AUTH_REQUIRED" }, 401);
    }) as typeof fetch;
    const { client, persistence } = harness(fetchImpl);
    await persistence.saveSession(oldSession);

    await expect(client.getMe()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(await persistence.loadSession()).toBeNull();
  });

  it("always clears local credentials when remote logout is unreachable", async () => {
    const fetchImpl = (async () => { throw new Error("network down"); }) as typeof fetch;
    const { client, persistence } = harness(fetchImpl);
    await persistence.saveSession(oldSession);

    await expect(client.logout()).resolves.toBeUndefined();
    expect(await persistence.loadSession()).toBeNull();
  });
});

describe("MobileApiClient sync transport", () => {
  it("posts the canonical sync envelope with bearer authorization", async () => {
    const request = { mutations: [{
      clientId: "mobile-device",
      clientMutationId: "mutation-1",
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      mutationType: "SALE_CREATE",
      occurredAt: "2026-10-10T22:00:00.000Z",
      payload: { lines: [] },
    }] };
    const expected = { mutationResults: [{ clientMutationId: "mutation-1", status: "APPLIED", serverReceivedAt: "2026-10-10T22:01:00.000Z" }], events: [] };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://tradeos.example/api/mobile/v1/sync");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer access-old");
      expect(JSON.parse(String(init?.body))).toEqual(request);
      return jsonResponse(expected);
    }) as typeof fetch;
    const { client, persistence } = harness(fetchImpl);
    await persistence.saveSession(oldSession);

    await expect(client.push(request)).resolves.toEqual(expected);
  });
});
describe("MobileApiClient commerce reads", () => {
  it("loads the authorized business catalog through the native gateway", async () => {
    const expected = { items: [{
      id: "item-1",
      businessId: "11111111-1111-4111-8111-111111111111",
      sku: "CEM-50",
      name: "Cement 50kg",
      kind: "PRODUCT",
      stockUnitCode: "bag",
      trackStock: true,
      taxCategory: null,
      active: true,
      createdAt: "2026-10-10T00:00:00.000Z",
      updatedAt: "2026-10-10T00:00:00.000Z",
      units: [{ code: "bag", label: "Bag", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 12000 }],
      conversions: [],
    }] };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://tradeos.example/api/mobile/v1/catalog/items?businessId=11111111-1111-4111-8111-111111111111");
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer access-old");
      return jsonResponse(expected);
    }) as typeof fetch;
    const { client, persistence } = harness(fetchImpl);
    await persistence.saveSession(oldSession);

    await expect(client.getCatalog("11111111-1111-4111-8111-111111111111")).resolves.toEqual(expected);
  });

  it("loads branch inventory and safely encodes an optional search query", async () => {
    const expected = { items: [{
      id: "item-1", sku: "CEM-50", name: "Cement 50kg", stockUnitCode: "bag",
      available: 28, quarantine: 1, damaged: 0, waste: 0,
      inventoryValueMinor: 280000, averageStockUnitCostMinor: 10000, latestStockUnitCostMinor: 10000,
    }] };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://tradeos.example/api/mobile/v1/inventory?businessId=11111111-1111-4111-8111-111111111111&branchId=22222222-2222-4222-8222-222222222222&query=cement+%26+blocks");
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer access-old");
      return jsonResponse(expected);
    }) as typeof fetch;
    const { client, persistence } = harness(fetchImpl);
    await persistence.saveSession(oldSession);

    await expect(client.getInventory(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "cement & blocks",
    )).resolves.toEqual(expected);
  });
});
