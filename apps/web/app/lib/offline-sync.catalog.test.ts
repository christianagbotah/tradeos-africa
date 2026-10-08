import { describe, expect, it } from "vitest";

async function loadOfflineSync() {
  const modulePath = "./offline-sync";
  return import(/* @vite-ignore */ modulePath) as Promise<Record<string, unknown>>;
}

describe("catalog offline-sync readiness", () => {
  it("allows branchless catalog lifecycle mutations but still requires branchId for economic mutations", async () => {
    const module = await loadOfflineSync();
    expect(module.isMutationServerReady).toBeTypeOf("function");
    const ready = module.isMutationServerReady as ((mutation: Record<string, unknown>) => boolean) | undefined;
    if (!ready) return;

    const base = {
      clientId: "web-device",
      clientMutationId: "mutation-1",
      businessId: "11111111-1111-4111-8111-111111111111",
      occurredAt: new Date().toISOString(),
      payload: {},
    };
    expect(ready({ ...base, mutationType: "CATALOG_ITEM_CREATE" })).toBe(true);
    expect(ready({ ...base, mutationType: "CATALOG_ITEM_UPDATE" })).toBe(true);
    expect(ready({ ...base, mutationType: "CATALOG_ITEM_ARCHIVE" })).toBe(true);
    expect(ready({ ...base, mutationType: "CATALOG_ITEM_REACTIVATE" })).toBe(true);
    expect(ready({ ...base, mutationType: "SALE_CREATE" })).toBe(false);
    expect(ready({ ...base, mutationType: "SALE_CREATE", branchId: "22222222-2222-4222-8222-222222222222" })).toBe(true);
  });
});
