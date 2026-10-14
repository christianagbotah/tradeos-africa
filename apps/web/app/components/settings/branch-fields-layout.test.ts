import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const branchFieldsSource = readFileSync(new URL("./branch-fields.tsx", import.meta.url), "utf8");

describe("branch settings layout", () => {
  it("keeps branch create and edit fields in one column at every viewport", () => {
    expect(branchFieldsSource).toContain('className="tos-settings__grid tos-settings__grid--single"');
    expect(branchFieldsSource).not.toContain('className="tos-settings__grid tos-settings__grid--2"');
  });
});
