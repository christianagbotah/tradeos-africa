export interface BusinessIntelligenceCacheScope {
  userId: string;
  businessId: string;
  branchId: string | null;
}

export interface BusinessIntelligenceCacheEnvelope<T = unknown> {
  generatedAt: string;
  sourceRoute: string;
  range: string;
  data: T;
}

export interface BusinessIntelligenceCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const CACHE_PREFIX = "tradeos.intelligence.v1";
const SENSITIVE_KEY = /^(?:access[_-]?token|refresh[_-]?token|authorization|password|passcode|secret|api[_-]?key|token)$/i;

export function businessIntelligenceCacheKey(scope: BusinessIntelligenceCacheScope): string {
  return `${CACHE_PREFIX}:${scope.userId}:${scope.businessId}:${scope.branchId ?? "all"}`;
}

export function writeBusinessIntelligenceCache<T>(
  storage: BusinessIntelligenceCacheStorage,
  scope: BusinessIntelligenceCacheScope,
  envelope: BusinessIntelligenceCacheEnvelope<T>,
): void {
  if (!validEnvelope(envelope)) throw new Error("Intelligence cache requires a successful data envelope");
  if (containsSensitiveMaterial(envelope)) {
    throw new Error("Sensitive session material cannot be stored in the intelligence cache");
  }
  storage.setItem(businessIntelligenceCacheKey(scope), JSON.stringify(envelope));
}

export function readBusinessIntelligenceCache<T = unknown>(
  storage: BusinessIntelligenceCacheStorage,
  scope: BusinessIntelligenceCacheScope,
): BusinessIntelligenceCacheEnvelope<T> | null {
  const key = businessIntelligenceCacheKey(scope);
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!validEnvelope(parsed) || containsSensitiveMaterial(parsed)) {
      storage.removeItem(key);
      return null;
    }
    return parsed as BusinessIntelligenceCacheEnvelope<T>;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function isBusinessIntelligenceCacheStale(
  envelope: Pick<BusinessIntelligenceCacheEnvelope, "generatedAt">,
  maxAgeMs: number,
  nowMs = Date.now(),
): boolean {
  const generated = Date.parse(envelope.generatedAt);
  if (!Number.isFinite(generated) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return true;
  return nowMs - generated > maxAgeMs;
}

function validEnvelope(value: unknown): value is BusinessIntelligenceCacheEnvelope {
  if (!isObject(value)) return false;
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) return false;
  if (typeof value.sourceRoute !== "string" || !value.sourceRoute.startsWith("/v1/intelligence/")) return false;
  if (typeof value.range !== "string" || value.range.length === 0) return false;
  if (!("data" in value) || value.data === undefined) return false;
  if ("error" in value) return false;
  return true;
}

function containsSensitiveMaterial(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) return value.some((item) => containsSensitiveMaterial(item, seen));
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) return true;
    if (containsSensitiveMaterial(child, seen)) return true;
  }
  return false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
