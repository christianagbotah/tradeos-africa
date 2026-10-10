import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(dir, "../..");
const read = (file: string) => fs.readFileSync(path.join(appRoot, file), "utf8");

describe("public-entry class-contract", () => {
  it("does not use obsolete class names that have no CSS definition", () => {
    const source = read("components/public-entry.tsx");
    const obsolete = ["stack-form", "setup-shell", "setup-topbar", "setup-card", "setup-copy", "wide", "brand-lockup", "auth-brand", "auth-points", "security-note", "auth-shell", "auth-story", "auth-form-side", "auth-form-body"];
    for (const cls of obsolete) {
      expect(source).not.toContain(`"${cls}"`);
      expect(source).not.toContain(` ${cls} `);
      expect(source).not.toContain(` ${cls}"`);
    }
  });

  it("every className used in public-entry has a CSS definition", () => {
    const source = read("components/public-entry.tsx");
    const css = read("public-entry.css") + read("ui-primitives.css");
    const classNames = new Set<string>();
    const regex = /className="([^"]+)"/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
      for (const cls of match[1]!.split(/\s+/)) {
        if (cls && !cls.startsWith("{")) classNames.add(cls);
      }
    }
    const missing: string[] = [];
    for (const cls of classNames) {
      if (!cls.includes("{") && !css.includes(`.${cls}`)) {
        missing.push(cls);
      }
    }
    expect(missing).toEqual([]);
  });
});
