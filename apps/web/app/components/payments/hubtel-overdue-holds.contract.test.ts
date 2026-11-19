import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (url: string) => readFileSync(new URL(url, import.meta.url), "utf8");
const ui = read("./hubtel-reconciliation-workspace.tsx");
const monitor = read("../../../../api/src/commerce/hubtel-pos-monitor.ts");
const route = read("../../../../api/src/commerce/hubtel-pos-routes.ts");

describe("unverified Hubtel payment hold visibility", () => {
  it("counts whole-branch overdue unpaid checkouts without mixing currencies", () => {
    expect(monitor).toContain("pendingCheckoutsByCurrency");
    expect(monitor).toContain("overdueUnverified24h");
    expect(monitor).toContain("GROUP BY a.currency_code ORDER BY a.currency_code");
    expect(monitor).toContain("s.status='OPEN' AND p.status='PENDING'");
    expect(monitor).toContain("interval '24 hours'");
    expect(monitor).toContain("DESC,a.created_at DESC,a.id DESC");
    expect(ui).toContain("Unverified checkout hold totals could not be loaded");
    expect(monitor).toContain("Number.isSafeInteger(parsed)");
    expect(route).toContain('"Cache-Control","private, no-store, max-age=0"');
  });
  it("shows accurate merchant review language and no automatic stock reversal control", () => {
    expect(ui).toContain("Unverified over 24 hours");
    expect(ui).toContain("pendingCheckoutsByCurrency");
    expect(ui).toContain("not stock valuation or received cash");
    expect(ui).toContain("Age alone is not cancellation proof");
    expect(ui).toContain("item.overdue24h");
    expect(ui).not.toContain("Cancel checkout");
    expect(ui).not.toContain("Release reserved stock");
  });
});
