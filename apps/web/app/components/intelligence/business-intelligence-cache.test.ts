import { describe, expect, it } from "vitest";

const MODULE_PATH = "./business-intelligence-cache";

type CacheModule = {
  businessIntelligenceCacheKey(scope: { userId: string; businessId: string; branchId: string | null }): string;
  writeBusinessIntelligenceCache(
    storage: StorageLike,
    scope: { userId: string; businessId: string; branchId: string | null },
    envelope: Record<string, unknown>,
  ): void;
  readBusinessIntelligenceCache(
    storage: StorageLike,
    scope: { userId: string; businessId: string; branchId: string | null },
  ): Record<string, unknown> | null;
  isBusinessIntelligenceCacheStale(envelope: { generatedAt: string }, maxAgeMs: number, nowMs?: number): boolean;
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

async function loadCache(): Promise<CacheModule> {
  return await import(/* @vite-ignore */ MODULE_PATH) as CacheModule;
}

const scope = {
  userId: "user-11111111",
  businessId: "business-22222222",
  branchId: "branch-33333333",
};

const envelope = {
  generatedAt: "2026-10-17T12:00:00.000Z",
  sourceRoute: "/v1/intelligence/briefing",
  range: "today",
  data: { headline: "Sales are steady", evidence: [{ source: "sales" }] },
};

describe("business intelligence offline cache", () => {
  it("uses the exact user + business + branch scoped v1 key", async () => {
    const cache = await loadCache();
    expect(cache.businessIntelligenceCacheKey(scope)).toBe(
      "tradeos.intelligence.v1:user-11111111:business-22222222:branch-33333333",
    );
    expect(cache.businessIntelligenceCacheKey({ ...scope, branchId: null })).toBe(
      "tradeos.intelligence.v1:user-11111111:business-22222222:all",
    );
  });

  it("never leaks cached intelligence across users, businesses, or branches", async () => {
    const cache = await loadCache();
    const storage = new MemoryStorage();
    cache.writeBusinessIntelligenceCache(storage, scope, envelope);

    expect(cache.readBusinessIntelligenceCache(storage, scope)).toEqual(envelope);
    expect(cache.readBusinessIntelligenceCache(storage, { ...scope, userId: "other-user" })).toBeNull();
    expect(cache.readBusinessIntelligenceCache(storage, { ...scope, businessId: "other-business" })).toBeNull();
    expect(cache.readBusinessIntelligenceCache(storage, { ...scope, branchId: "other-branch" })).toBeNull();
  });

  it("rejects sensitive session material instead of persisting it", async () => {
    const cache = await loadCache();
    const storage = new MemoryStorage();
    expect(() => cache.writeBusinessIntelligenceCache(storage, scope, {
      ...envelope,
      data: { headline: "Unsafe", accessToken: "must-not-be-cached" },
    })).toThrow(/sensitive/i);
    expect(cache.readBusinessIntelligenceCache(storage, scope)).toBeNull();
  });

  it("drops malformed cache envelopes and marks old successful data stale", async () => {
    const cache = await loadCache();
    const storage = new MemoryStorage();
    storage.setItem(cache.businessIntelligenceCacheKey(scope), "{broken-json");
    expect(cache.readBusinessIntelligenceCache(storage, scope)).toBeNull();

    cache.writeBusinessIntelligenceCache(storage, scope, envelope);
    expect(cache.isBusinessIntelligenceCacheStale(
      { generatedAt: envelope.generatedAt },
      60 * 60 * 1000,
      Date.parse("2026-10-17T14:00:00.000Z"),
    )).toBe(true);
    expect(cache.isBusinessIntelligenceCacheStale(
      { generatedAt: envelope.generatedAt },
      3 * 60 * 60 * 1000,
      Date.parse("2026-10-17T14:00:00.000Z"),
    )).toBe(false);
  });
});
