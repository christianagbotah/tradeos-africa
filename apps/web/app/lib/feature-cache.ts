const featureCachePrefix = "tradeos.featureCache.v1:";

type FeatureCacheEnvelope<T> = {
  version: 1;
  namespace: string;
  businessId: string;
  branchId: string;
  itemKey: string;
  savedAt: string;
  data: T;
};

export function featureCacheKey(namespace: string, businessId: string, branchId: string, itemKey = "root"): string {
  return `${featureCachePrefix}${encodeURIComponent(namespace)}:${encodeURIComponent(businessId)}:${encodeURIComponent(branchId)}:${encodeURIComponent(itemKey)}`;
}

export function writeFeatureCache<T>(namespace: string, businessId: string, branchId: string, data: T, itemKey = "root"): void {
  if (typeof localStorage === "undefined") return;
  const envelope: FeatureCacheEnvelope<T> = {
    version: 1,
    namespace,
    businessId,
    branchId,
    itemKey,
    savedAt: new Date().toISOString(),
    data,
  };
  try { localStorage.setItem(featureCacheKey(namespace, businessId, branchId, itemKey), JSON.stringify(envelope)); } catch { /* Offline read caching is best effort. */ }
}

export function readFeatureCache<T>(
  namespace: string,
  businessId: string,
  branchId: string,
  itemKey = "root",
  accept?: (value: unknown) => value is T,
): T | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(featureCacheKey(namespace, businessId, branchId, itemKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FeatureCacheEnvelope<unknown>>;
    if (parsed.version !== 1 || parsed.namespace !== namespace || parsed.businessId !== businessId || parsed.branchId !== branchId || parsed.itemKey !== itemKey) return null;
    if (accept && !accept(parsed.data)) return null;
    return parsed.data as T;
  } catch {
    return null;
  }
}

export function clearFeatureCaches(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(featureCachePrefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch { /* Storage can be unavailable in privacy modes. */ }
}
