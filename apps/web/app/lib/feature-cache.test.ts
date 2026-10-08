import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFeatureCaches, featureCacheKey, readFeatureCache, writeFeatureCache } from "./feature-cache";

class MemoryStorage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}

describe("scoped feature cache", () => {
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("isolates data by namespace, business, branch and item key", () => {
    writeFeatureCache("sales-list", "business-a", "branch-a", { rows: [1] }, "all");
    expect(readFeatureCache("sales-list", "business-a", "branch-a", "all")).toEqual({ rows: [1] });
    expect(readFeatureCache("sales-list", "business-b", "branch-a", "all")).toBeNull();
    expect(readFeatureCache("sales-list", "business-a", "branch-b", "all")).toBeNull();
    expect(readFeatureCache("sales-list", "business-a", "branch-a", "search")).toBeNull();
    expect(featureCacheKey("sales-list", "business-a", "branch-a", "all")).toContain("tradeos.featureCache.v1:");
  });

  it("rejects invalid cached shapes and clears every feature cache without touching unrelated storage", () => {
    writeFeatureCache("purchases-inventory", "business-a", "branch-a", { suppliers: [] });
    localStorage.setItem("unrelated", "keep");
    expect(readFeatureCache("purchases-inventory", "business-a", "branch-a", "root", (value): value is { suppliers: unknown[] } => Boolean(value && typeof value === "object" && Array.isArray((value as { suppliers?: unknown }).suppliers)))).toEqual({ suppliers: [] });
    expect(readFeatureCache("purchases-inventory", "business-a", "branch-a", "root", (value): value is { nope: true } => Boolean(value && typeof value === "object" && (value as { nope?: unknown }).nope === true))).toBeNull();
    clearFeatureCaches();
    expect(readFeatureCache("purchases-inventory", "business-a", "branch-a")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
});
