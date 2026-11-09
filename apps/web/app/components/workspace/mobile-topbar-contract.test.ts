import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve(process.cwd(), "app/workspace-shell.css"), "utf8");

describe("mobile topbar sizing contract", () => {
  it("reserves the full 48px account touch target instead of flex-shrinking its wrapper", () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.tos-account-menu\s*\{[^}]*flex:\s*0\s+0\s+48px\s*;/);
  });
});
