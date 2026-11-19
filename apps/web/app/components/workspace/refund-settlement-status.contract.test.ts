import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const screen = read("../returns/return-refund-workspace.tsx");
const provider = read("./workspace-provider.tsx");
const money = read("../business/money-value.tsx");
const salesApi = read("../../../../api/src/sales-read.ts");

describe("refund settlement presentation contracts", () => {
  it("never labels accepted returns as paid-out refunds", () => {
    expect(screen).toContain('label="Returns accepted"');
    expect(screen).toContain('label="Refunds awaiting payout"');
    expect(screen).toContain('Refund paid:');
    expect(screen).toContain('Pending payout:');
    expect(screen).toContain('Return value:');
    expect(screen).not.toContain('label="Refunds issued"');
    expect(screen).not.toContain('label="Refund value"');
  });
  it("filters paid, pending and failed refunds independently from returns", () => {
    expect(screen).toContain('s.refundSettledMinor <= 0');
    expect(screen).toContain('s.refundPendingMinor <= 0');
    expect(screen).toContain('s.refundFailedMinor <= 0');
    expect(screen).toContain('s.refundTotalMinor <= 0');
    expect(screen).toContain('label: "Payout pending"');
    expect(screen).toContain('label: "Needs review"');
  });
  it("exposes separate server-backed payout status amounts", () => {
    for (const field of ["refundTotalMinor", "refundSettledMinor", "refundPendingMinor", "refundFailedMinor"]) {
      expect(provider).toContain(field + ": number;");
      expect(screen).toContain("sale." + field);
    }
    expect(screen).toContain("Pending provider refunds remain outstanding until verified");
    expect(screen).toContain("refundAmountsVerified");
    expect(screen).toContain("Payout totals unavailable");
    expect(screen).toContain("No missing refund amount has been treated as a confirmed payout.");
    expect(money).toContain('!Number.isFinite(minor)');
    for (const field of ["refundTotalMinor", "refundSettledMinor", "refundPendingMinor", "refundFailedMinor"]) {
      expect(salesApi).toContain(field + ": Number(sale.");
    }
  });
});
