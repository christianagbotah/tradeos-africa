import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const explanationPath = path.join(root, "app/components/intelligence/business-action-explanation.tsx");
const briefingPath = path.join(root, "app/components/intelligence/business-briefing.tsx");
const cssPath = path.join(root, "app/intelligence.css");

function source(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

describe("business action explanation UI contract", () => {
  it("mounts one reusable explanation control in Dashboard action cards", () => {
    const briefing = source(briefingPath);
    expect(briefing).toContain("BusinessActionExplanation");
    expect(briefing).toMatch(/<BusinessActionExplanation[^>]*item=\{item\}[^>]*businessId=\{briefing\.businessId\}[^>]*online=\{queue\.online\}/s);
  });

  it("keeps explanation lazy, read-only and useful offline", () => {
    const panel = source(explanationPath);
    expect(panel).toContain("Why this task?");
    expect(panel).toContain('type="button"');
    expect(panel).toContain("item.reason");
    expect(panel).toContain("fetchBusinessActionItemExplanation");
    expect(panel).toMatch(/if \(nextOpen && online && !explanation/);
    expect(panel).toContain("Reconnect to see the automation source and fresh evidence.");
    expect(panel).not.toMatch(/mutateBusinessActionItem|method:\s*["'](?:POST|PATCH|DELETE)["']/);
  });

  it("renders provenance, bounded evidence, timestamps and retry states", () => {
    const panel = source(explanationPath);
    expect(panel).toContain("sourceKindLabel");
    expect(panel).toContain("explanation.automation?.policyName");
    expect(panel).toContain("explanation.attention");
    expect(panel).toMatch(/explanation\.evidence\.slice\(0, 5\)/);
    expect(panel).toContain("formatTimestamp");
    expect(panel).toContain("Try again");
  });

  it("ships dedicated responsive spacing for explanation details", () => {
    const css = source(cssPath);
    expect(css).toContain(".tos-ai-action-explanation");
    expect(css).toContain(".tos-ai-action-explanation__details");
  });
});
