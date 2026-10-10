import { describe, expect, it } from "vitest";
import { isMutationServerReady } from "./sync-runtime.js";

const businessId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";

describe("isMutationServerReady", () => {
  it("allows branch-optional master-data mutations without a branch", () => {
    expect(isMutationServerReady({ businessId, mutationType: "CATALOG_ITEM_CREATE" })).toBe(true);
  });

  it("requires a valid branch for economic mutations", () => {
    expect(isMutationServerReady({ businessId, mutationType: "SALE_CREATE" })).toBe(false);
    expect(isMutationServerReady({ businessId, branchId, mutationType: "SALE_CREATE" })).toBe(true);
  });

  it("rejects an invalid business id", () => {
    expect(isMutationServerReady({ businessId: "not-a-uuid", branchId, mutationType: "SALE_CREATE" })).toBe(false);
  });

  it("rejects an invalid branch id", () => {
    expect(isMutationServerReady({ businessId, branchId: "not-a-uuid", mutationType: "SALE_CREATE" })).toBe(false);
  });
});

import type { QueueSnapshot, QueueSnapshotStorage } from "./sync-runtime.js";
import { OfflineMutationQueue } from "./sync-runtime.js";

class TestSnapshotStorage implements QueueSnapshotStorage {
  saved: QueueSnapshot | null;

  constructor(initial: QueueSnapshot | null = null) {
    this.saved = initial;
  }

  async load(): Promise<QueueSnapshot | null> {
    return this.saved;
  }

  async save(snapshot: QueueSnapshot): Promise<void> {
    this.saved = snapshot;
  }
}

function mutation(overrides: Partial<import("./sync-runtime.js").QueuedMutation> = {}) {
  return {
    clientId: "client-1",
    clientMutationId: "mutation-1",
    businessId,
    branchId,
    mutationType: "SALE_CREATE",
    occurredAt: "2026-10-10T08:00:00.000Z",
    payload: { totalMinor: 1000 },
    ...overrides,
  };
}

describe("OfflineMutationQueue lifecycle", () => {
  it("deduplicates enqueue by clientMutationId", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });

    expect(await queue.enqueue(mutation())).toBe(true);
    expect(await queue.enqueue(mutation({ payload: { totalMinor: 2000 } }))).toBe(false);
    expect((await queue.getSnapshot()).pending).toHaveLength(1);
  });

  it("returns defensive snapshots so callers cannot mutate persisted queue state", async () => {
    const storage = new TestSnapshotStorage();
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });
    await queue.enqueue(mutation());

    const first = await queue.getSnapshot();
    first.pending[0]!.mutationType = "MUTATED_BY_CALLER";
    (first.pending[0]!.payload as { totalMinor: number }).totalMinor = 9999;
    first.pending.push(mutation({ clientMutationId: "caller-added" }));

    const second = await queue.getSnapshot();
    expect(second.pending).toHaveLength(1);
    expect(second.pending[0]!.mutationType).toBe("SALE_CREATE");
    expect(second.pending[0]!.payload).toEqual({ totalMinor: 1000 });
  });

  it("counts pending, blocked and failed entries against the active business", async () => {
    const otherBusinessId = "33333333-3333-4333-8333-333333333333";
    const failedMutation = mutation({ clientMutationId: "failed-1" });
    const storage = new TestSnapshotStorage({
      pending: [
        mutation({ clientMutationId: "ready-1" }),
        mutation({ clientMutationId: "bad-branch", branchId: "invalid" }),
        mutation({ clientMutationId: "other-business", businessId: otherBusinessId }),
      ],
      failed: [{
        mutation: failedMutation,
        result: {
          clientMutationId: "failed-1",
          status: "REJECTED",
          serverReceivedAt: "2026-10-10T08:05:00.000Z",
          errorCode: "DENIED",
        },
        failedAt: "2026-10-10T08:06:00.000Z",
      }],
    });
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });

    expect(await queue.getState(businessId)).toEqual({ pending: 3, blocked: 2, failed: 1 });
    expect(await queue.getState(null)).toEqual({ pending: 3, blocked: 3, failed: 1 });
  });

  it("retries a failed mutation with a new stable identity and timestamp", async () => {
    const failedMutation = mutation({ clientMutationId: "failed-1", payload: { totalMinor: 2500 } });
    const storage = new TestSnapshotStorage({
      pending: [],
      failed: [{
        mutation: failedMutation,
        result: {
          clientMutationId: "failed-1",
          status: "REJECTED",
          serverReceivedAt: "2026-10-10T08:05:00.000Z",
          errorCode: "VALIDATION",
        },
        failedAt: "2026-10-10T08:06:00.000Z",
      }],
    });
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });

    expect(await queue.retryFailed("failed-1")).toBe(true);
    const snapshot = await queue.getSnapshot();
    expect(snapshot.failed).toEqual([]);
    expect(snapshot.pending).toEqual([{
      ...failedMutation,
      clientMutationId: "replacement-1",
      occurredAt: "2026-10-10T09:00:00.000Z",
    }]);
  });

  it("dismisses only the requested failed mutation", async () => {
    const toFailed = (id: string) => ({
      mutation: mutation({ clientMutationId: id }),
      result: {
        clientMutationId: id,
        status: "REJECTED" as const,
        serverReceivedAt: "2026-10-10T08:05:00.000Z",
      },
      failedAt: "2026-10-10T08:06:00.000Z",
    });
    const storage = new TestSnapshotStorage({ pending: [], failed: [toFailed("failed-1"), toFailed("failed-2")] });
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });

    expect(await queue.dismissFailed("failed-1")).toBe(true);
    expect((await queue.getSnapshot()).failed.map((entry) => entry.mutation.clientMutationId)).toEqual(["failed-2"]);
  });
});

import type { SyncTransport } from "./sync-runtime.js";

class RecordingTransport implements SyncTransport {
  readonly responseForTest: import("@tradeos/contracts").SyncResponse;
  calls: import("@tradeos/contracts").SyncPushRequest[] = [];
  constructor(private readonly response: import("@tradeos/contracts").SyncResponse) { this.responseForTest = response; }
  async push(request: import("@tradeos/contracts").SyncPushRequest) {
    this.calls.push(request);
    return this.response;
  }
}

describe("OfflineMutationQueue flush", () => {
  it("sends only ready mutations for the active business in source order and caps the batch at 100", async () => {
    const otherBusinessId = "33333333-3333-4333-8333-333333333333";
    const active = Array.from({ length: 101 }, (_, index) => mutation({ clientMutationId: `active-${index}` }));
    const storage = new TestSnapshotStorage({
      pending: [
        mutation({ clientMutationId: "other", businessId: otherBusinessId }),
        mutation({ clientMutationId: "blocked", branchId: "invalid" }),
        ...active,
      ],
      failed: [],
    });
    const transport = new RecordingTransport({ mutationResults: [], events: [] });
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });

    const summary = await queue.flush({ activeBusinessId: businessId, online: true, transport });

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.mutations).toHaveLength(100);
    expect(transport.calls[0]!.mutations.map((item) => item.clientMutationId)).toEqual(active.slice(0, 100).map((item) => item.clientMutationId));
    expect(summary.attempted).toBe(100);
    const pendingIds = (await queue.getSnapshot()).pending.map((item) => item.clientMutationId);
    expect(pendingIds).toContain("other");
    expect(pendingIds).toContain("blocked");
    expect(pendingIds).toContain("active-100");
  });

  it("does not call transport while offline or without an active business", async () => {
    const storage = new TestSnapshotStorage({ pending: [mutation()], failed: [] });
    const transport = new RecordingTransport({ mutationResults: [], events: [] });
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });

    expect((await queue.flush({ activeBusinessId: businessId, online: false, transport })).attempted).toBe(0);
    expect((await queue.flush({ activeBusinessId: null, online: true, transport })).attempted).toBe(0);
    expect(transport.calls).toHaveLength(0);
    expect((await queue.getSnapshot()).pending).toHaveLength(1);
  });

  it("removes applied, moves rejected to failed, and retains received or missing results", async () => {
    const entries = ["applied", "rejected", "received", "missing"].map((id) => mutation({ clientMutationId: id }));
    const storage = new TestSnapshotStorage({ pending: entries, failed: [] });
    const transport = new RecordingTransport({
      mutationResults: [
        { clientMutationId: "applied", status: "APPLIED", serverReceivedAt: "2026-10-10T08:10:00.000Z", result: { saleId: "sale-1" } },
        { clientMutationId: "rejected", status: "REJECTED", serverReceivedAt: "2026-10-10T08:10:01.000Z", errorCode: "VALIDATION", errorMessage: "Bad sale" },
        { clientMutationId: "received", status: "RECEIVED", serverReceivedAt: "2026-10-10T08:10:02.000Z" },
      ],
      events: [],
    });
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });

    const summary = await queue.flush({ activeBusinessId: businessId, online: true, transport });
    expect(summary).toMatchObject({ applied: 1, rejected: 1, received: 2, attempted: 4, pending: 2, failed: 1 });

    const snapshot = await queue.getSnapshot();
    expect(snapshot.pending.map((item) => item.clientMutationId).sort()).toEqual(["missing", "received"]);
    expect(snapshot.failed).toHaveLength(1);
    expect(snapshot.failed[0]).toEqual({
      mutation: entries[1],
      result: transport.responseForTest?.mutationResults?.[1],
      failedAt: "2026-10-10T09:00:00.000Z",
    });
  });
});

class RejectingTransport implements SyncTransport {
  calls = 0;
  async push(): Promise<never> {
    this.calls += 1;
    throw new Error("network unavailable");
  }
}

class FailingSaveStorage extends TestSnapshotStorage {
  failSaves = false;
  override async save(snapshot: QueueSnapshot): Promise<void> {
    if (this.failSaves) throw new Error("durable storage unavailable");
    await super.save(snapshot);
  }
}

class DeferredTransport implements SyncTransport {
  calls = 0;
  private resolveResponse!: (response: import("@tradeos/contracts").SyncResponse) => void;
  readonly pending = new Promise<import("@tradeos/contracts").SyncResponse>((resolve) => {
    this.resolveResponse = resolve;
  });

  async push() {
    this.calls += 1;
    return this.pending;
  }

  resolve(response: import("@tradeos/contracts").SyncResponse) {
    this.resolveResponse(response);
  }
}

describe("OfflineMutationQueue flush failure safety", () => {
  it("leaves the durable snapshot unchanged when transport fails", async () => {
    const initial = { pending: [mutation()], failed: [] };
    const storage = new TestSnapshotStorage(initial);
    const transport = new RejectingTransport();
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });

    await expect(queue.flush({ activeBusinessId: businessId, online: true, transport })).rejects.toThrow("network unavailable");
    expect(transport.calls).toBe(1);
    expect(await queue.getSnapshot()).toEqual(initial);
  });

  it("keeps the original mutation identity when local save fails after the server applies it", async () => {
    const initial = { pending: [mutation()], failed: [] };
    const storage = new FailingSaveStorage(initial);
    const transport = new RecordingTransport({
      mutationResults: [{
        clientMutationId: "mutation-1",
        status: "APPLIED",
        serverReceivedAt: "2026-10-10T08:10:00.000Z",
      }],
      events: [],
    });
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });
    storage.failSaves = true;

    await expect(queue.flush({ activeBusinessId: businessId, online: true, transport })).rejects.toThrow("durable storage unavailable");
    storage.failSaves = false;
    expect((await queue.getSnapshot()).pending[0]).toMatchObject({
      clientId: "client-1",
      clientMutationId: "mutation-1",
      businessId,
    });
  });

  it("coalesces concurrent flush calls so one batch is transmitted once", async () => {
    const storage = new TestSnapshotStorage({ pending: [mutation()], failed: [] });
    const transport = new DeferredTransport();
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });

    const first = queue.flush({ activeBusinessId: businessId, online: true, transport });
    const second = queue.flush({ activeBusinessId: businessId, online: true, transport });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(transport.calls).toBe(1);

    transport.resolve({
      mutationResults: [{
        clientMutationId: "mutation-1",
        status: "APPLIED",
        serverReceivedAt: "2026-10-10T08:10:00.000Z",
      }],
      events: [],
    });
    const [firstSummary, secondSummary] = await Promise.all([first, second]);
    expect(firstSummary).toEqual(secondSummary);
    expect(transport.calls).toBe(1);
  });
});

describe("OfflineMutationQueue concurrent local writes", () => {
  it("preserves a mutation enqueued while a flush is waiting on the network", async () => {
    const storage = new TestSnapshotStorage({ pending: [mutation()], failed: [] });
    const transport = new DeferredTransport();
    const queue = new OfflineMutationQueue(storage, {
      now: () => "2026-10-10T09:00:00.000Z",
      createMutationId: () => "replacement-1",
    });

    const flushing = queue.flush({ activeBusinessId: businessId, online: true, transport });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(transport.calls).toBe(1);

    await queue.enqueue(mutation({ clientMutationId: "queued-during-flush" }));
    transport.resolve({
      mutationResults: [{
        clientMutationId: "mutation-1",
        status: "APPLIED",
        serverReceivedAt: "2026-10-10T08:10:00.000Z",
      }],
      events: [],
    });
    await flushing;

    expect((await queue.getSnapshot()).pending.map((entry) => entry.clientMutationId)).toEqual(["queued-during-flush"]);
  });
});
