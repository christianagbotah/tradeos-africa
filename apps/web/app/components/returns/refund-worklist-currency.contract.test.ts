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
    expect(api).toContain("rt.created_at < NOW() - INTERVAL '24 hours'");
    expect(api).toContain("rt.created_at < NOW() - INTERVAL '7 days'");
    expect(api).toContain("pending24hMinor: safeMinor(row.pending_24h_minor)");
    expect(api).toContain("pending7dMinor: safeMinor(row.pending_7d_minor)");
    expect(api).toContain("($3='PENDING_24H' AND rt.status='PENDING'");
    expect(api).toContain("($3='PENDING_7D' AND rt.status='PENDING'");
    expect(api).toContain("ORDER BY rt.created_at ASC,rt.id ASC LIMIT $4 OFFSET $5");
  });
  it("shows separate totals, not a mixed currency aggregate or a fabricated zero", () => {
    expect(worklist).toContain("data?.summaryByCurrency");
    expect(worklist).toContain("Array.isArray(rawBalances)");
    expect(worklist).toContain("Number.isSafeInteger(value) && value >= 0");
    expect(worklist).toContain("key={summary.currencyCode}");
    expect(worklist).toContain("currencyCode={summary.currencyCode}");
    expect(worklist).toContain("Refund summaries are unavailable");
    expect(worklist).toContain("Pending 24h+ ({summary.pending24hCount})");
    expect(worklist).toContain("Pending 7d+ ({summary.pending7dCount})");
    expect(worklist).toContain('{ value: "PENDING_24H", label: "Pending 24h+" }');
    expect(worklist).toContain('{ value: "PENDING_7D", label: "Pending 7d+" }');
    expect(worklist).toContain('aria-label="Refund review priority filters"');
    expect(worklist).toContain('setFilter(option.value); setOffset(0);');
    expect(worklist).toContain("balance.pending7dMinor <= balance.pending24hMinor");
    expect(worklist).toContain("subsets of pending payouts, not additional liabilities");
    expect(worklist).not.toContain("data?.summary;");
    expect(worklist).not.toContain("currencyCode={currencyCode} />");
  });
});
