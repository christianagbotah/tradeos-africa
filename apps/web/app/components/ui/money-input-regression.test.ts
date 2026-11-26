import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./money-input.tsx", import.meta.url), "utf8");

describe("MoneyInput in-progress typing", () => {
  it("does not reformat controlled values while the user is focused in the field", () => {
    expect(source).toContain("const [isFocused, setIsFocused] = useState(false)");
    expect(source).toContain("if (isFocused) return;");
    expect(source).toContain("onFocus={() => setIsFocused(true)}");
    expect(source).toContain("onBlur={() => setIsFocused(false)}");
  });
});
