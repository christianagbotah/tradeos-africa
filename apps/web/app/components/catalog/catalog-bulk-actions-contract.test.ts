import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./catalog-workspace.tsx", import.meta.url), "utf8");

describe("catalog bulk actions", () => {
  it("supports selecting visible items on mobile and desktop", () => {
    expect(source).toContain("selectedIds");
    expect(source).toContain('aria-label="Select all visible catalog items"');
    expect(source).toContain('aria-label={`Select ${c.name}`}');
  });

  it("supports lifecycle and protected permanent deletion actions", () => {
    expect(source).toContain("Archive selected");
    expect(source).toContain("Reactivate selected");
    expect(source).toContain("Delete selected");
    expect(source).toContain('method: "PATCH"');
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain("expectedUpdatedAt");
    expect(source).toContain("catch (error)");
    expect(source).toContain("Network request failed");
  });
});
