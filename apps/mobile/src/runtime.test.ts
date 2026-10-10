import { describe, expect, it } from "vitest";
import type { SyncPushRequest, SyncResponse } from "@tradeos/client-core";
import { MobileRuntime } from "./runtime";
import type { MobileBusinessContext, MobileMe, MobileUser } from "./api-client";
import { AsyncQueueSnapshotStorage, MobilePersistence, type SecureStringStorage, type StringStorage } from "./storage";

class MemoryStorage implements StringStorage, SecureStringStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

const business1 = "11111111-1111-4111-8111-111111111111";
const branch1 = "22222222-2222-4222-8222-222222222222";
const business2 = "33333333-3333-4333-8333-333333333333";
const branch2 = "44444444-4444-4444-8444-444444444444";
const staleBusiness = "55555555-5555-4555-8555-555555555555";
const staleBranch = "66666666-6666-4666-8666-666666666666";

const user: MobileUser = { id: "user-1", displayName: "Ama Owner", email: "ama@example.com", phoneE164: null };
const session = {
  accessToken: "access",
  refreshToken: "refresh",
  accessExpiresAt: "2026-10-11T00:00:00.000Z",
  refreshExpiresAt: "2026-11-11T00:00:00.000Z",
};

function membership(id: string, businessId: string, businessName: string) {
  return { id, businessId, businessName, businessType: "RETAIL_HARDWARE", businessStatus: "ACTIVE", role: "OWNER", staffId: "staff-1" };
}

const me: MobileMe = {
  user,
  client: { platform: "ANDROID", deviceKey: "mobile-device", appVersion: "0.0.1" },
  memberships: [membership("membership-1", business1, "Ama Shop"), membership("membership-2", business2, "Second Shop")],
};

function context(businessId: string, name: string, branches: MobileBusinessContext["branches"]): MobileBusinessContext {
  return {
    business: { id: businessId, name, businessType: "RETAIL_HARDWARE", countryCode: "GH", currencyCode: "GHS", timezone: "Africa/Accra", status: "ACTIVE" },
    membership: { role: "OWNER", staffId: "staff-1" },
    branches,
  };
}

class FakeApi {
  me: MobileMe = me;
  readonly contexts = new Map<string, MobileBusinessContext>([
    [business1, context(business1, "Ama Shop", [{ id: branch1, name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true }])],
    [business2, context(business2, "Second Shop", [{ id: branch2, name: "Tema", code: "MAIN", timezone: "Africa/Accra", active: true }])],
  ]);
  readonly pushes: SyncPushRequest[] = [];
  loginCalls = 0;
  logoutCalls = 0;

  async login(): Promise<MobileUser> { this.loginCalls += 1; return user; }
  async getMe(): Promise<MobileMe> { return this.me; }
  async getBusinessContext(businessId: string): Promise<MobileBusinessContext> {
    const value = this.contexts.get(businessId);
    if (!value) throw new Error(`missing context ${businessId}`);
    return value;
  }
  async push(request: SyncPushRequest): Promise<SyncResponse> {
    this.pushes.push(request);
    return {
      mutationResults: request.mutations.map((mutation) => ({
        clientMutationId: mutation.clientMutationId,
        status: "APPLIED" as const,
        serverReceivedAt: "2026-10-10T22:10:00.000Z",
      })),
      events: [],
    };
  }
  async logout(): Promise<void> { this.logoutCalls += 1; }
}

function createHarness(api = new FakeApi()) {
  const plain = new MemoryStorage();
  const secure = new MemoryStorage();
  const persistence = new MobilePersistence(plain, secure, () => "77777777-7777-4777-8777-777777777777");
  const queueStorage = new AsyncQueueSnapshotStorage(plain);
  let mutationCounter = 0;
  const runtime = new MobileRuntime({
    api,
    persistence,
    queueStorage,
    now: () => "2026-10-10T22:30:00.000Z",
    createMutationId: () => `retry-${++mutationCounter}`,
  });
  return { api, plain, secure, persistence, queueStorage, runtime };
}

function saleMutation(id: string, businessId: string, branchId: string) {
  return {
    clientId: "mobile-device",
    clientMutationId: id,
    businessId,
    branchId,
    mutationType: "SALE_CREATE",
    occurredAt: "2026-10-10T22:00:00.000Z",
    payload: { lines: [] },
  };
}

describe("MobileRuntime bootstrap", () => {
  it("returns SIGNED_OUT without calling tenant APIs when credentials are absent", async () => {
    const { runtime } = createHarness();
    await expect(runtime.bootstrap()).resolves.toMatchObject({ status: "SIGNED_OUT", queue: { pending: 0, blocked: 0, failed: 0 } });
  });

  it("restores an authorized saved business and active branch", async () => {
    const { runtime, persistence } = createHarness();
    await persistence.saveSession(session);
    await persistence.saveWorkspaceSelection({ businessId: business2, branchId: branch2 });

    const state = await runtime.bootstrap();

    expect(state).toMatchObject({ status: "READY", membership: { businessId: business2 }, branch: { id: branch2 }, business: { id: business2 } });
  });

  it("falls back from a stale business and stale/inactive branch to authorized active MAIN", async () => {
    const api = new FakeApi();
    api.contexts.set(business1, context(business1, "Ama Shop", [
      { id: staleBranch, name: "Old", code: "OLD", timezone: "Africa/Accra", active: false },
      { id: branch1, name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true },
    ]));
    const { runtime, persistence } = createHarness(api);
    await persistence.saveSession(session);
    await persistence.saveWorkspaceSelection({ businessId: staleBusiness, branchId: staleBranch });

    const state = await runtime.bootstrap();

    expect(state).toMatchObject({ status: "READY", membership: { businessId: business1 }, branch: { id: branch1 } });
    expect(await persistence.loadWorkspaceSelection()).toEqual({ businessId: business1, branchId: branch1 });
  });

  it("returns NEEDS_BUSINESS when no active business membership remains", async () => {
    const api = new FakeApi();
    api.me = { ...me, memberships: [{ ...membership("membership-disabled", business1, "Closed Shop"), businessStatus: "SUSPENDED" }] };
    const { runtime, persistence } = createHarness(api);
    await persistence.saveSession(session);

    await expect(runtime.bootstrap()).resolves.toMatchObject({ status: "NEEDS_BUSINESS", user });
  });

  it("login delegates authentication then resolves the ready workspace", async () => {
    const { runtime, persistence, api } = createHarness();
    await persistence.saveSession(session);

    const state = await runtime.login("ama@example.com", "password123");

    expect(api.loginCalls).toBe(1);
    expect(state).toMatchObject({ status: "READY", membership: { businessId: business1 } });
  });
});

describe("MobileRuntime durable sync", () => {
  it("flushes only ready mutations belonging to the active business and no-ops offline", async () => {
    const { runtime, persistence, api } = createHarness();
    await persistence.saveSession(session);
    await runtime.bootstrap();
    await runtime.queue.enqueue(saleMutation("active-1", business1, branch1));
    await runtime.queue.enqueue(saleMutation("other-1", business2, branch2));

    const offline = await runtime.flush(false);
    expect(offline.attempted).toBe(0);
    expect(api.pushes).toHaveLength(0);

    const online = await runtime.flush(true);
    expect(online).toMatchObject({ attempted: 1, applied: 1, pending: 1, blocked: 1 });
    expect(api.pushes).toHaveLength(1);
    expect(api.pushes[0]!.mutations.map((mutation) => mutation.clientMutationId)).toEqual(["active-1"]);
    expect((await runtime.queue.getSnapshot()).pending.map((mutation) => mutation.clientMutationId)).toEqual(["other-1"]);
  });

  it("signs out without deleting pending offline queue evidence", async () => {
    const { runtime, persistence, api } = createHarness();
    await persistence.saveSession(session);
    await runtime.bootstrap();
    await runtime.queue.enqueue(saleMutation("pending-sale", business1, branch1));

    await runtime.logout();

    expect(api.logoutCalls).toBe(1);
    expect((await runtime.queue.getSnapshot()).pending.map((mutation) => mutation.clientMutationId)).toEqual(["pending-sale"]);
    expect((await runtime.bootstrap()).status).toBe("SIGNED_OUT");
  });
});