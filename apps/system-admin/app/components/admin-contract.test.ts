import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(__dirname, "..");

describe("system-admin class-contract", () => {
  it("every className used in admin pages has a CSS definition", () => {
    const pageFiles = ["page.tsx", "console/page.tsx", "console/tenants/page.tsx", "console/devices/page.tsx", "console/audit/page.tsx", "console/releases/page.tsx", "console/flags/page.tsx"];
    const cssFiles = ["admin-tokens.css", "admin-shell.css", "admin-components-base.css", "admin-components.css", "admin-auth.css"];
    const css = cssFiles.map((f) => fs.readFileSync(path.join(appRoot, f), "utf8")).join("\n");
    const classNames = new Set<string>();
    const regex = /className="([^"]+)"/g;
    for (const file of pageFiles) {
      const src = fs.readFileSync(path.join(appRoot, file), "utf8");
      let match;
      while ((match = regex.exec(src)) !== null) {
        for (const cls of match[1]!.split(/\s+/)) {
          if (cls && !cls.startsWith("{")) classNames.add(cls);
        }
      }
    }
    const missing: string[] = [];
    for (const cls of classNames) {
      if (!cls.includes("{") && !css.includes(`.${cls}`)) missing.push(cls);
    }
    expect(missing).toEqual([]);
  });
});
