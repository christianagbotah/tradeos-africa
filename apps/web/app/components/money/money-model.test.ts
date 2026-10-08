import { describe, expect, it } from "vitest";

async function loadModel() {
  const modulePath = "./money-model";
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch {
    return null;
  }
}

const summary = { inflowMinor: 250_000, outflowMinor: 90_000, netMinor: 160_000 };
const totals = [
  { method: "CASH", balanceMinor: 80_000, inflowMinor: 120_000, outflowMinor: 40_000 },
  { method: "MOMO", balanceMinor: 60_000, inflowMinor: 100_000, outflowMinor: 40_000 },
  { method: "BANK", balanceMinor: 20_000, inflowMinor: 30_000, outflowMinor: 10_000 },
];
const accounts = [
  { id: "a1", branchId: "b1", name: "Front till", method: "CASH", kind: "CASH_DRAWER", currencyCode: "GHS", active: true, allowNegative: false, balanceMinor: 72_000 },
  { id: "a2", branchId: "b1", name: "Merchant wallet", method: "MOMO", kind: "MOMO_WALLET", currencyCode: "GHS", active: true, allowNegative: false, balanceMinor: 51_000 },
  { id: "a3", branchId: null, name: "Main bank", method: "BANK", kind: "BANK_ACCOUNT", currencyCode: "GHS", active: true, allowNegative: true, balanceMinor: -4_000 },
  { id: "a4", branchId: "b1", name: "Old till", method: "CASH", kind: "CASH_DRAWER", currencyCode: "GHS", active: false, allowNegative: false, balanceMinor: 999_999 },
];

describe("Money presentation model", () => {
  it("passes through authoritative period totals without rebuilding accounting math", async () => {
    const model = await loadModel();
    expect(model?.buildMoneyOverview).toBeTypeOf("function");
    if (!model) return;

    const overview = model.buildMoneyOverview({ summary, totals, accounts, queued: 3, failed: 1 });
    expect(overview.period).toEqual(summary);
    expect(overview.period.inflowMinor).toBe(250_000);
    expect(overview.period.outflowMinor).toBe(90_000);
    expect(overview.period.netMinor).toBe(160_000);
  });

  it("groups only active posted account balances for the available-money view and preserves negatives", async () => {
    const model = await loadModel();
    expect(model?.buildMoneyOverview).toBeTypeOf("function");
    if (!model) return;

    const overview = model.buildMoneyOverview({ summary, totals, accounts, queued: 3, failed: 1 });
    expect(overview.activeAccountCount).toBe(3);
    expect(overview.availableMoneyMinor).toBe(119_000);
    expect(overview.accountBalancesByMethod).toEqual({ CASH: 72_000, MOMO: 51_000, BANK: -4_000 });
    expect(overview.accountBalancesByMethod.BANK).toBe(-4_000);
    expect(overview.cashbookMethodTotals).toEqual(totals);
  });

  it("surfaces synchronization pressure separately from financial values", async () => {
    const model = await loadModel();
    expect(model?.buildMoneyOverview).toBeTypeOf("function");
    if (!model) return;

    const overview = model.buildMoneyOverview({ summary, totals, accounts, queued: 3, failed: 1 });
    expect(overview.sync).toEqual({ queued: 3, failed: 1, needsAttention: true });
    const quiet = model.buildMoneyOverview({ summary, totals, accounts, queued: 0, failed: 0 });
    expect(quiet.sync.needsAttention).toBe(false);
  });

  it("formats GHS and non-GHS minor-unit values without assuming one currency", async () => {
    const model = await loadModel();
    expect(model?.formatMoneyMinor).toBeTypeOf("function");
    if (!model) return;

    expect(model.formatMoneyMinor(123_456, "GHS")).toContain("₵");
    expect(model.formatMoneyMinor(123_456, "USD")).toContain("USD");
    expect(model.formatMoneyMinor(-4_000, "USD")).toContain("40.00");
  });
});
