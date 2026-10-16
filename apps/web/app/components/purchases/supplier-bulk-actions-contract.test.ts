import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./supplier-workspace.tsx", import.meta.url), "utf8");

describe("supplier bulk actions", () => {
  it("supports selecting visible suppliers on mobile and desktop", () => {
    expect(source).toContain("selectedIds");
    expect(source).toContain('aria-label="Select all visible suppliers"');
    expect(source).toContain('aria-label={`Select ${s.name}`}');
  });

  it("supports online status changes and safe permanent deletion", () => {
    expect(source).toContain("Deactivate selected");
    expect(source).toContain("Activate selected");
    expect(source).toContain("Delete selected");
    expect(source).toContain('method: "PATCH"');
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain("expectedUpdatedAt");
    expect(source).toContain("catch (error)");
    expect(source).toContain("Network request failed");
  });
});
