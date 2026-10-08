import { describe, expect, it } from "vitest";
import { isMutationServerReady } from "./offline-sync";

const businessId = "11111111-1111-4111-8111-111111111111";

describe("master-data offline sync readiness", () => {
  it("treats customer and supplier profile mutations as branchless server-ready work", () => {
    for (const mutationType of ["CUSTOMER_CREATE", "CUSTOMER_UPDATE", "SUPPLIER_CREATE", "SUPPLIER_UPDATE"]) {
      expect(isMutationServerReady({ businessId, mutationType })).toBe(true);
    }
    expect(isMutationServerReady({ businessId, mutationType: "SALE_CREATE" })).toBe(false);
  });
});
