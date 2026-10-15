import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./catalog-item-sheet.tsx", import.meta.url), "utf8");

describe("catalog create usability", () => {
  it("does not silently disable Create for a validation problem and shows the reason", () => {
    expect(source).not.toContain("disabled={!name.trim() || !canWrite || busy || Boolean(validationError)}");
    expect(source).toContain("validationError ?");
    expect(source).toContain("Fix before saving");
  });

  it("automatically disables direct stock tracking for non-product kinds", () => {
    expect(source).toContain('const effectiveTrackStock = kind === "PRODUCT" ? trackStock : false;');
  });
});
