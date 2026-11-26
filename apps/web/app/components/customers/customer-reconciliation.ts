import type { Customer } from "../workspace/workspace-provider";

export type CustomerConfirmedFields = Partial<Pick<Customer, "name" | "phone" | "email">>;
export type CustomerMutationEvent =
  | { kind: "updated"; customer: Customer; fields: CustomerConfirmedFields }
  | { kind: "refresh" };
export interface ConfirmedCustomerRevision {
  fields: CustomerConfirmedFields;
  beforeUpdatedAt: string;
  confirmedAt: number;
}
const GUARD_MS = 120_000;

export function registerConfirmedCustomerUpdate(
  guards: Map<string, ConfirmedCustomerRevision>,
  businessId: string,
  customer: Customer,
  fields: CustomerConfirmedFields,
  now = Date.now(),
): void {
  guards.set(businessId + ":" + customer.id, {
    fields, beforeUpdatedAt: customer.updatedAt, confirmedAt: now,
  });
}

export function reconcileConfirmedCustomers(
  rows: Customer[],
  businessId: string,
  guards: Map<string, ConfirmedCustomerRevision>,
  now = Date.now(),
): Customer[] {
  return rows.map((row) => {
    const key = businessId + ":" + row.id;
    const confirmed = guards.get(key);
    if (!confirmed) return row;
    const matched = Object.entries(confirmed.fields)
      .every(([name, value]) => row[name as keyof Customer] === value);
    const before = Date.parse(confirmed.beforeUpdatedAt);
    const current = Date.parse(row.updatedAt);
    if (matched || now - confirmed.confirmedAt >= GUARD_MS ||
      (Number.isFinite(before) && Number.isFinite(current) && current > before)) {
      guards.delete(key);
      return row;
    }
    return { ...row, ...confirmed.fields };
  });
}
