import { describe, expect, it } from "vitest";
import type { FlushSummary, QueueState } from "@tradeos/client-core/sync-runtime";
import { MobileAppModel, safeMobileErrorMessage } from "./app-model";
import type { MobileBootstrapState } from "./runtime";

const emptyQueue: QueueState = { pending: 0, blocked: 0, failed: 0 };
const ready: MobileBootstrapState = {
  status: "READY",
  user: { id: "user-1", displayName: "Ama Owner", email: "ama@example.com", phoneE164: null },
  membership: { id: "m1", businessId: "11111111-1111-4111-8111-111111111111", businessName: "Ama Shop", businessType: "RETAIL_HARDWARE", businessStatus: "ACTIVE", role: "OWNER", staffId: "staff-1" },
  business: { id: "11111111-1111-4111-8111-111111111111", name: "Ama Shop", businessType: "RETAIL_HARDWARE", countryCode: "GH", currencyCode: "GHS", timezone: "Africa/Accra", status: "ACTIVE" },
  branch: { id: "22222222-2222-4222-8222-222222222222", name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true },
  queue: emptyQueue,
};

class FakeRuntime {
  bootstrapState: MobileBootstrapState = { status: "SIGNED_OUT", queue: emptyQueue };
  loginState: MobileBootstrapState = ready;
  flushCalls: boolean[] = [];
  logoutCalls = 0;
  queueState: QueueState = emptyQueue;
  flushSummary: FlushSummary = { ...emptyQueue, applied: 0, received: 0, rejected: 0, attempted: 0 };
  error: Error | null = null;

  async bootstrap() { if (this.error) throw this.error; return this.bootstrapState; }
  async login() { if (this.error) throw this.error; return this.loginState; }
  async flush(online: boolean) { this.flushCalls.push(online); return this.flushSummary; }
  async logout() { this.logoutCalls += 1; }
  async getQueueState() { return this.queueState; }
}

describe("MobileAppModel state transitions", () => {
  it("boots into signed-out and moves to ready after login", async () => {
    const runtime = new FakeRuntime();
    const model = new MobileAppModel(runtime);

    expect(model.snapshot.phase).toBe("BOOTING");
    expect((await model.start()).phase).toBe("SIGNED_OUT");
    const loggedIn = await model.login("ama@example.com", "password123");
    expect(loggedIn.phase).toBe("READY");
    expect(loggedIn.bootstrap).toEqual(ready);
  });

  it("represents authenticated users without a business as NEEDS_BUSINESS", async () => {
    const runtime = new FakeRuntime();
    runtime.bootstrapState = { status: "NEEDS_BUSINESS", user: ready.status === "READY" ? ready.user : never(), queue: emptyQueue };
    const model = new MobileAppModel(runtime);

    await expect(model.start()).resolves.toMatchObject({ phase: "NEEDS_BUSINESS" });
  });

  it("updates queue counts after a manual sync", async () => {
    const runtime = new FakeRuntime();
    runtime.bootstrapState = ready;
    runtime.flushSummary = { pending: 2, blocked: 1, failed: 1, applied: 3, received: 0, rejected: 1, attempted: 4 };
    const model = new MobileAppModel(runtime);
    await model.start();
    await model.connectivityChanged(true);

    const snapshot = await model.sync();

    expect(runtime.flushCalls).toEqual([true]);
    expect(snapshot.bootstrap).toMatchObject({ status: "READY", queue: { pending: 2, blocked: 1, failed: 1 } });
  });

  it("flushes automatically only when connectivity transitions from offline to reachable", async () => {
    const runtime = new FakeRuntime();
    runtime.bootstrapState = ready;
    const model = new MobileAppModel(runtime);
    await model.start();

    await model.connectivityChanged(true);
    await model.connectivityChanged(true);
    expect(runtime.flushCalls).toEqual([]);

    await model.connectivityChanged(false);
    await model.connectivityChanged(false);
    expect(runtime.flushCalls).toEqual([]);

    await model.connectivityChanged(true);
    expect(runtime.flushCalls).toEqual([true]);
  });

  it("signs out into a queue-aware local state", async () => {
    const runtime = new FakeRuntime();
    runtime.bootstrapState = ready;
    runtime.queueState = { pending: 2, blocked: 2, failed: 1 };
    const model = new MobileAppModel(runtime);
    await model.start();

    const snapshot = await model.logout();

    expect(runtime.logoutCalls).toBe(1);
    expect(snapshot).toMatchObject({ phase: "SIGNED_OUT", bootstrap: { status: "SIGNED_OUT", queue: runtime.queueState } });
  });
});

describe("safeMobileErrorMessage", () => {
  it("does not surface arbitrary exception text that may contain credentials", () => {
    const message = safeMobileErrorMessage(new Error("Bearer access-secret refresh-secret"));
    expect(message).not.toContain("access-secret");
    expect(message).not.toContain("refresh-secret");
    expect(message).toContain("TradeOS");
  });
});

function never(): never { throw new Error("unreachable"); }