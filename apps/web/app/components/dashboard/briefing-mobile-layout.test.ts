import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(__dirname, "business-briefing-panel.module.css"), "utf8");

describe("business briefing phone layout", () => {
  it("keeps the headline in a full-width column instead of shrinking beside a timestamp", () => {
    expect(styles).toMatch(/\.summary\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/s);
    expect(styles).toMatch(/@media\(max-width:\s*900px\)\s*\{\s*\.summary\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\)/);
    expect(styles).toMatch(/\.summaryText\s*\{\s*min-width:\s*0;/);
    expect(styles).toContain(".timestamp { text-align: left; }");
  });
});
