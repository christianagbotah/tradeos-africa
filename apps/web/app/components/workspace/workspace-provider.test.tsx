import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getWorkspaceGate,
  projectSellableItems,
  selectInitialBranch,
  selectWorkspaceMembership,
} from "./workspace-provider";
import type { BusinessContext, CatalogItem, MePayload } from "../../lib/workspace-types";

const session: MePayload = {
  user: { id: "u1", displayName: "Owner", email: "owner@example.com", phoneE164: null },
  client: { platform: "WEB", deviceKey: "d1", appVersion: "test" },
  memberships: [
    { id: "m1", businessId: "b1", businessName: "One", businessType: "FOOD", businessStatus: "ACTIVE", role: "OWNER", staffId: "s1" },
    { id: "m2", businessId: "b2", businessName: "Two", businessType: "DISTRIBUTION", businessStatus: "ACTIVE", role: "OWNER", staffId: "s2" },
  ],
};

const context: BusinessContext = {
  business: { id: "b2", name: "Two", businessType: "DISTRIBUTION", countryCode: "GH", currencyCode: "GHS", timezone: "Africa/Accra", status: "ACTIVE" },
  membership: { role: "OWNER", staffId: "s2" },
  branches: [
    { id: "branch-2", name: "Tema", code: "TEMA", timezone: "Africa/Accra", active: true },
    { id: "branch-main", name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true },
  ],
};

const catalog: CatalogItem[] = [{
  id: "item-1",
  sku: null,
  name: "Malt",
  kind: "PRODUCT",
  stockUnitCode: "bottle",
  trackStock: true,
  taxCategory: null,
  active: true,
  units: [
    { code: "bottle", label: "Bottle", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 1200 },
    { code: "crate", label: "Crate", canPurchase: true, canSell: false, canStock: false, defaultSalePriceMinor: null },
  ],
  conversions: [],
}];

describe("WorkspaceProvider contract", () => {
  it("redirects unauthenticated direct workspace access to root", () => {
    expect(getWorkspaceGate({ resolved: true, session: null, context: null, branchId: null })).toBe("redirect-root");
    expect(getWorkspaceGate({ resolved: false, session: null, context: null, branchId: null })).toBe("loading");
  });

  it("restores the remembered business and falls back to the first membership", () => {
    expect(selectWorkspaceMembership(session, "b2")?.businessId).toBe("b2");
    expect(selectWorkspaceMembership(session, "missing")?.businessId).toBe("b1");
  });

  it("selects MAIN branch first and preserves an existing active branch", () => {
    expect(selectInitialBranch(context, null)?.id).toBe("branch-main");
    expect(selectInitialBranch(context, "branch-2")?.id).toBe("branch-2");
  });

  it("projects sellable catalog units exactly once", () => {
    expect(projectSellableItems(catalog)).toEqual([{ key: "item-1:bottle", itemId: "item-1", name: "Malt", unitCode: "bottle", unitLabel: "Bottle", priceMinor: 1200 }]);
  });

  it("persists business and branch scope safely without refetching the session on branch changes", () => {
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "workspace-provider.tsx"), "utf8");
    expect(source).toMatch(/setBusiness[\s\S]*setActiveBusinessId\(businessId\)/);
    const branchCallback = source.match(/const setBranch = useCallback\([\s\S]*?\}, \[[^\]]*\]\);/)?.[0] ?? "";
    expect(branchCallback).toMatch(/setBranchId\(branchId\)/);
    expect(branchCallback).toContain("writeWorkspaceBootstrap");
    expect(branchCallback).not.toContain("/api/session/me");
  });
});
