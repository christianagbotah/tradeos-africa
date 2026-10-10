import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("professional treasury lifecycle composition", () => {
  it("uses the account sheet instead of browser prompts and submits default revisions", () => {
    const source = fs.readFileSync(path.join(root, "treasury.tsx"), "utf8");
    expect(source).toContain("MoneyAccountSheet");
    expect(source).not.toContain("window.prompt(");
    expect(source).toContain("expectedUpdatedAt");
    expect(source).toContain("money-account-defaults");
    expect(source).toContain("ACCOUNT_IS_DEFAULT");
    expect(source).toContain("MobileRecordCard");
    expect(source).toContain("StatePanel");
    expect(source).toContain("StatusBadge");
    expect(source).toContain("MONEY_RECONCILIATION_RESOLVE");
  });
});
