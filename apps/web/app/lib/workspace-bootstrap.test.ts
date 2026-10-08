import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessContext, CatalogItem, MePayload } from "./workspace-types";
import { clearWorkspaceBootstrap, readWorkspaceBootstrap, writeWorkspaceBootstrap } from "./workspace-bootstrap";

const session: MePayload = {
  user: { id: "u1", displayName: "Owner", email: "owner@example.com", phoneE164: "+233000000000" },
  client: { platform: "WEB", deviceKey: "device-secretish", appVersion: "test" },
  memberships: [{ id: "m1", businessId: "b1", businessName: "Demo", businessType: "FOOD", businessStatus: "ACTIVE", role: "OWNER", staffId: "s1" }],
};
const context: BusinessContext = {
  business: { id: "b1", name: "Demo", businessType: "FOOD", countryCode: "GH", currencyCode: "GHS", timezone: "Africa/Accra", status: "ACTIVE" },
  membership: { role: "OWNER", staffId: "s1" },
  branches: [{ id: "branch-1", name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true }],
};
const catalog: CatalogItem[] = [];

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

describe("workspace offline bootstrap", () => {
  beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("persists a sanitized active workspace without contact details or device credentials", () => {
    writeWorkspaceBootstrap({ session, context, branchId: "branch-1", catalog });
    const restored = readWorkspaceBootstrap();
    expect(restored?.session.user).toEqual({ id: "u1", displayName: "Owner", email: null, phoneE164: null });
    expect(restored?.session.client.deviceKey).toBe("");
    expect(restored?.context.business.id).toBe("b1");
    expect(restored?.branchId).toBe("branch-1");
  });

  it("rejects malformed or scope-inconsistent cached workspaces and can clear the snapshot", () => {
    localStorage.setItem("tradeos.workspaceBootstrap.v1", JSON.stringify({ version: 1, session, context, branchId: "other-branch", catalog }));
    expect(readWorkspaceBootstrap()).toBeNull();
    writeWorkspaceBootstrap({ session, context, branchId: "branch-1", catalog });
    clearWorkspaceBootstrap();
    expect(readWorkspaceBootstrap()).toBeNull();
  });
});
