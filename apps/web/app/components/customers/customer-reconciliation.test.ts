import { describe, expect, it } from "vitest";
import type { Customer } from "../workspace/workspace-provider";
import {
  reconcileConfirmedCustomers,
  registerConfirmedCustomerUpdate,
  type ConfirmedCustomerRevision,
} from "./customer-reconciliation";

const original: Customer = {
  id: "cust-1", name: "Customer One", phone: "0240000000", email: "old@example.com",
  active: true, creditLimitMinor: null, creditTermsDays: null,
  balanceMinor: 0, updatedAt: "2026-11-18T12:00:00.000Z",
};
const now = Date.parse("2026-11-19T09:55:00Z");

describe("customer list refresh after completed offline-sync mutation", () => {
  it("preserves confirmed customer name, phone and email when GET is stale", () => {
    const map = new Map<string, ConfirmedCustomerRevision>();
    registerConfirmedCustomerUpdate(map, "shop-one", original, {
      name: "Customer One Updated", phone: null, email: "new@example.com",
    }, now);
    const first = reconcileConfirmedCustomers([original], "shop-one", map, now + 500)[0];
    expect(first).toMatchObject({
      name: "Customer One Updated", phone: null, email: "new@example.com",
    });
    expect(map.size).toBe(1);
    expect(original.name).toBe("Customer One");
  });
  it("stops guarding after server catches up, even if it returns a newer update", () => {
    const map = new Map<string, ConfirmedCustomerRevision>();
    registerConfirmedCustomerUpdate(map, "shop-one", original, {
      name: "Customer One Updated",
    }, now);
    const newer = { ...original, name: "Other manager changed name",
      updatedAt: "2026-11-19T09:56:00Z" };
    expect(reconcileConfirmedCustomers([newer], "shop-one", map, now + 800)[0]?.name)
      .toBe("Other manager changed name");
    expect(map.size).toBe(0);
  });
  it("never applies another tenant's customer change", () => {
    const map = new Map<string, ConfirmedCustomerRevision>();
    registerConfirmedCustomerUpdate(map, "shop-two", original, { name: "Hidden" }, now);
    expect(reconcileConfirmedCustomers([original], "shop-one", map, now + 200)[0]?.name)
      .toBe("Customer One");
  });
  it("expires an unmatched local guard instead of hiding external changes indefinitely", () => {
    const map = new Map<string, ConfirmedCustomerRevision>();
    registerConfirmedCustomerUpdate(map, "shop-one", original, { name: "Updated" }, now);
    expect(reconcileConfirmedCustomers([original], "shop-one", map, now + 130000)[0]?.name)
      .toBe("Customer One");
    expect(map.size).toBe(0);
  });
});
