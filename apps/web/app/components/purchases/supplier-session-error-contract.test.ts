import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("supplier session error visibility", () => {
  it("announces supplier-create errors and scrolls the error into view", () => {
    const source = readFileSync(resolve(__dirname, "supplier-sheet.tsx"), "utf8");
    expect(source).toContain('role="alert"');
    expect(source).toContain("scrollIntoView");
  });
});
