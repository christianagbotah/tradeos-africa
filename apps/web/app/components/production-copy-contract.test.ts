import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return files(path);
    return path.endsWith(".tsx") && !path.endsWith(".test.tsx") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("production-facing copy", () => {
  it("does not expose backend/client implementation terminology to business users", () => {
    const banned = [
      "server-authoritative",
      "computed server-side",
      "the client never",
      "The client never",
      "the client only",
      "The client only",
      "client-side variance",
      "through the server",
      "mutation(s) pending",
      "Queued mutations",
    ];
    const offenders: string[] = [];
    for (const file of files(root)) {
      const source = withoutComments(readFileSync(file, "utf8")).toLowerCase();
      for (const phrase of banned) {
        if (source.includes(phrase.toLowerCase())) offenders.push(`${file.replace(root, "components")}: ${phrase}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
