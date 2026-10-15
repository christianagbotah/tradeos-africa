import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./supplier-sheet.tsx", import.meta.url), "utf8");

describe("supplier permanent delete UX", () => {
  it("offers permanent deletion only to OWNER/ADMIN and calls the revision-protected API", () => {
    expect(source).toContain('const canDelete = ["OWNER", "ADMIN"].includes(role)');
    expect(source).toContain('Delete supplier');
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain('expectedUpdatedAt=${encodeURIComponent(supplier.updatedAt)}');
  });

  it("surfaces protected-history failures instead of pretending deletion succeeded", () => {
    expect(source).toContain('Supplier could not be deleted');
    expect(source).toContain('setDeleteError');
  });
});
