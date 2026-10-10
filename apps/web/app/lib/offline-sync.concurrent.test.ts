import { afterEach, describe, expect, it, vi } from "vitest";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const businessId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";

function sale(clientMutationId: string) {
  return {
    clientId: "web-device",
    clientMutationId,
    businessId,
    branchId,
    mutationType: "SALE_CREATE",
    occurredAt: "2026-10-10T09:00:00.000Z",
    payload: { totalMinor: 1000 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("offline sync concurrent enqueue", () => {
  it("preserves a sale queued while an in-flight sync is waiting on the network", async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("CustomEvent", class {
      constructor(
        public readonly type: string,
        public readonly init?: { detail?: unknown },
      ) {}
    });

    let resolveFetch!: (response: Response) => void;
    const fetchStarted = new Promise<void>((resolve) => {
      vi.stubGlobal("fetch", vi.fn(() => {
        resolve();
        return new Promise<Response>((resolveResponse) => {
          resolveFetch = resolveResponse;
        });
      }));
    });

    const sync = await import("./offline-sync");
    sync.setActiveBusinessId(businessId);
    sync.enqueueMutation(sale("sale-before-flush"));

    const flushing = sync.flushPendingMutations();
    await fetchStarted;

    sync.enqueueMutation(sale("sale-during-flush"));

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({
        mutationResults: [{
          clientMutationId: "sale-before-flush",
          status: "APPLIED",
          serverReceivedAt: "2026-10-10T09:00:01.000Z",
        }],
        events: [],
      }),
    } as Response);

    await flushing;

    expect(sync.getPendingMutations().map((mutation) => mutation.clientMutationId)).toEqual([
      "sale-during-flush",
    ]);
  });
});
