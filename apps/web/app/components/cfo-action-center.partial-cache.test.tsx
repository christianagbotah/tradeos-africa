import { describe, expect, it } from "vitest";
import type { CfoAction } from "@tradeos/contracts";
import { buildCfoActionCenterItems, type CreditAgingSnapshot } from "./cfo-action-center";

const healthActions: CfoAction[] = [{
  code: "ACTION_PAYABLE_COVERAGE",
  sourceInsightCode: "PAYABLE_COVERAGE",
  priority: "HIGH",
  area: "CASH",
  title: "Supplier balances pressure cash",
  reason: "Cash does not fully cover supplier balances.",
  action: "Review supplier balances.",
  href: "#purchases",
  navigationLabel: "Review supplier balances",
  evidence: [],
}];

const emptySide = {
  totalOpenMinor: 0,
  notDueMinor: 0,
  dueWithin7DaysMinor: 0,
  dueWithin30DaysMinor: 0,
  overdue1To30DaysMinor: 0,
  overdue31To60DaysMinor: 0,
  overdue61To90DaysMinor: 0,
  overdueOver90DaysMinor: 0,
  obligationCount: 0,
  oldestDueAt: null,
};

const aging: CreditAgingSnapshot = {
  businessId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  currencyCode: "GHS",
  generatedAt: "2026-10-07T09:00:00.000Z",
  receivables: emptySide,
  payables: {
    ...emptySide,
    totalOpenMinor: 25_000,
    overdue1To30DaysMinor: 12_000,
    obligationCount: 2,
    oldestDueAt: "2026-09-20T00:00:00.000Z",
  },
};

describe("CFO Action Center partial offline evidence", () => {
  it("does not invent zero cash or urgent supplier pressure when forecast cash evidence is unavailable", () => {
    const items = buildCfoActionCenterItems({ healthActions, aging, forecast: null });
    const supplier = items.find((item) => item.code === "ACTION_SUPPLIER_PAYMENT_PRESSURE");

    expect(supplier?.priority).toBe("HIGH");
    expect(supplier?.evidence.map((row) => row.key)).not.toContain("openingCash");
    expect(items.map((item) => item.code)).not.toContain("ACTION_PAYABLE_COVERAGE");
  });
});
