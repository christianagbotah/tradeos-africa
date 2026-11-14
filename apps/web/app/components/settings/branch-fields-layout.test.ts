import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./branch-fields.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../workspace-shell.css", import.meta.url), "utf8");

// Both the create and edit forms reuse BranchFields. Keep their desktop grid
// and mobile single-column behavior covered to prevent UI regressions.
describe("branch settings layout", () => {
  it("uses the same responsive branch grid for add and edit", () => {
    expect(source).toContain('className="tos-settings__grid tos-settings__grid--branch"');
    expect(source).toContain("data-has-code={includeCode}");
    expect(source).not.toContain('className="tos-settings__grid tos-settings__grid--single"');
  });

  it("uses two equal-width columns at desktop sizes and one on smaller screens", () => {
    expect(styles).toMatch(/\.tos-settings__grid--branch\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
    expect(styles).toMatch(/@media \(min-width: 960px\)[\s\S]*?\.tos-settings__grid--branch\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(styles).toContain('.tos-settings__grid--branch :is(.tos-input, .tos-select)');
  });

  it("keeps the branch name full width when editing without a branch-code input", () => {
    expect(styles).toContain('.tos-settings__grid--branch[data-has-code="false"] > .tos-field:first-child');
    expect(styles).toContain('grid-column: 1 / -1;');
  });

  it("preserves all branch fields and conditional create-only branch code", () => {
    for (const field of ["name", "timezone", "email", "phone", "address1", "address2", "city", "region", "postal"]) {
      expect(source).toContain('`${prefix}-' + field + '`');
    }
    expect(source).toContain('includeCode ? <Field label="Branch code"');
  });
});
