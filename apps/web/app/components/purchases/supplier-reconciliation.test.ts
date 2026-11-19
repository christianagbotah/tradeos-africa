import { describe, expect, it } from "vitest";
import type { Supplier } from "./supplier-sheet";
import {
  registerSupplierMutation,
  reconcileSupplierRows,
  type SupplierGuard,
} from "./supplier-reconciliation";

const businessId = "business-a";
const oldSupplier: Supplier = {
  id: "supplier-1",
  name: "Original Supplier",
  phone: "0200000000",
  email: "old@example.com",
  address: "Original Address",
  paymentTermsDays: 14,
  active: true,
  balanceMinor: 2000,
  updatedAt: "2026-11-18T12:00:00.000Z",
};
const now = Date.parse("2026-11-19T09:00:00.000Z");

describe("supplier CRUD read-model reconciliation", () => {
  it("shows confirmed supplier rename immediately despite a stale server list", () => {
    const guard = new Map<string, SupplierGuard>();
    const event = {
      kind: "updated" as const,
      supplier: oldSupplier,
      changes: { name: "Renamed Supplier", phone: null, email: null, address: "New Address" },
    };
    registerSupplierMutation(guard, businessId, event, now);
    const first = reconcileSupplierRows([oldSupplier], businessId, guard, now + 200);
    expect(first[0]?.name).toBe("Renamed Supplier");
    expect(first[0]?.address).toBe("New Address");
    expect(first[0]?.phone).toBeNull();
    expect(guard.size).toBe(1);
    const subsequent = reconcileSupplierRows([oldSupplier], businessId, guard, now + 1500);
    expect(subsequent[0]?.name).toBe("Renamed Supplier");
  });

  it("stops guarding once the authoritative server list matches or is newer", () => {
    const guard = new Map<string, SupplierGuard>();
    registerSupplierMutation(guard, businessId, {
      kind: "updated", supplier: oldSupplier, changes: { name: "Renamed Supplier" },
    }, now);
    const updated = { ...oldSupplier, name: "Renamed Supplier",
      updatedAt: "2026-11-19T09:00:20.000Z" };
    expect(reconcileSupplierRows([updated], businessId, guard, now + 500)[0]?.name)
      .toBe("Renamed Supplier");
    expect(guard.size).toBe(0);
    registerSupplierMutation(guard, businessId, {
      kind: "updated", supplier: oldSupplier, changes: { name: "Renamed Supplier" },
    }, now);
    const external = { ...updated, name: "Changed by manager" };
    expect(reconcileSupplierRows([external], businessId, guard, now + 800)[0]?.name)
      .toBe("Changed by manager");
    expect(guard.size).toBe(0);
  });

  it("does not reinsert a supplier after confirmed deletion when GET is stale", () => {
    const guard = new Map<string, SupplierGuard>();
    registerSupplierMutation(guard, businessId, {
      kind: "deleted", supplier: oldSupplier,
    }, now);
    expect(reconcileSupplierRows([oldSupplier], businessId, guard, now + 200)).toEqual([]);
    expect(guard.size).toBe(1);
    expect(reconcileSupplierRows([], businessId, guard, now + 300)).toEqual([]);
    expect(guard.size).toBe(0);
  });

  it("keeps status updates and bulk changes visible during stale reloads", () => {
    const guard = new Map<string, SupplierGuard>();
    registerSupplierMutation(guard, businessId, {
      kind: "updated", supplier: oldSupplier, changes: { active: false },
    }, now);
    expect(reconcileSupplierRows([oldSupplier], businessId, guard, now + 50)[0]?.active).toBe(false);
    expect(reconcileSupplierRows([oldSupplier], businessId, guard, now + 150000)[0]?.active).toBe(true);
  });

  it("does not carry another business supplier's name into the selected business", () => {
    const guard = new Map<string, SupplierGuard>();
    registerSupplierMutation(guard, "business-b", {
      kind: "updated", supplier: oldSupplier, changes: { name: "Other Business" },
    }, now);
    expect(reconcileSupplierRows([oldSupplier], businessId, guard, now + 500)[0]?.name)
      .toBe("Original Supplier");
  });

  it("refresh-only events never create optimistic update guards", () => {
    const guard = new Map<string, SupplierGuard>();
    registerSupplierMutation(guard, businessId, { kind: "refresh" }, now);
    expect(guard.size).toBe(0);
  });
});
