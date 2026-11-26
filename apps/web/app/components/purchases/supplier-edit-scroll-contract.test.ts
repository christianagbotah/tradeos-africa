import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./supplier-sheet.tsx", import.meta.url), "utf8");

describe("supplier edit navigation", () => {
  it("scrolls the newly opened edit form into the sheet viewport and focuses its first field", () => {
    expect(source).toContain("editFormRef");
    expect(source).toContain('scrollIntoView({ behavior: "smooth", block: "start" })');
    expect(source).toContain('querySelector<HTMLInputElement>("input")');
    expect(source).toContain("focus({ preventScroll: true })");
  });
});
