import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../../../../api/src/sales-read.ts", import.meta.url), "utf8");
const worklist = readFileSync(new URL("./refund-settlement-worklist.tsx", import.meta.url), "utf8");

describe("refund worklist currency isolation", () => {
  it("groups all unresolved liabilities by exact original currency", () => {
    expect(api).toContain('"/v1/refunds/settlement-queue"');
    expect(api).toContain("summaryByCurrency: summaryByCurrency.rows.map");
    expect(api).toContain("GROUP BY rt.currency_code ORDER BY rt.currency_code");
    expect(api).toContain("rc.branch_id=$2");
    expect(api).toContain("rt.status IN ('PENDING','FAILED')");
    expect(api).toContain("!Number.isSafeInteger(value)");
  });
  it("shows separate totals, not a mixed currency aggregate or a fabricated zero", () => {
    expect(worklist).toContain("data?.summaryByCurrency");
    expect(worklist).toContain("Array.isArray(rawBalances)");
    expect(worklist).toContain("Number.isSafeInteger(value) && value >= 0");
    expect(worklist).toContain("key={summary.currencyCode}");
    expect(worklist).toContain("currencyCode={summary.currencyCode}");
    expect(worklist).toContain("Refund summaries are unavailable");
    expect(worklist).not.toContain("data?.summary;");
    expect(worklist).not.toContain("currencyCode={currencyCode} />");
  });
});
