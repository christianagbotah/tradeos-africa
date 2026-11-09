/**
 * TradeOS Web — className contract test.
 *
 * Verifies that every `className` literal used in the public-entry + workspace
 * components has a corresponding CSS definition in one of the canonical
 * TradeOS stylesheets, including the dedicated intelligence surface.
 *
 * This catches the common bug of referencing a CSS class that was never
 * defined — which would silently render unstyled in production.
 *
 * The test scans `.tsx` files under app/components/ for className="..." and
 * className={`...`} string literals, then checks each token appears as a CSS
 * selector (`.token {` or `.token,`) in any canonical CSS file.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const CSS_FILES = [
  "app/globals.css",
  "app/tradeos-tokens.css",
  "app/ui-primitives.css",
  "app/workspace-shell.css",
  "app/intelligence.css",
] as const;

const COMPONENT_DIRS = [
  "app/components/public-entry.tsx",
  "app/components/workspace",
  "app/components/ui",
  "app/components/business",
  "app/components/pos",
  "app/components/dashboard",
  "app/components/intelligence",
  "app/components/sales",
  "app/components/customers",
  "app/components/catalog",
  "app/components/inventory",
  "app/components/returns",
  "app/components/purchases",
  "app/components/cashbook",
  "app/components/treasury",
  "app/components/reports",
  "app/components/operations",
] as const;

/** Collects every `className="..."` and `className={\`...\`}` token from a tsx source string. */
function extractClassNames(source: string): string[] {
  const names: string[] = [];
  // Match className="literal tokens"
  const literalRe = /className="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = literalRe.exec(source)) !== null) {
    for (const tok of m[1]!.split(/\s+/)) {
      const trimmed = tok.trim();
      if (trimmed) names.push(trimmed);
    }
  }
  // Match className={`template literal tokens`}
  const tplRe = /className=\{`([^`]+)`\}/g;
  while ((m = tplRe.exec(source)) !== null) {
    // Strip ${...} interpolations and split the rest.
    const stripped = m[1]!.replace(/\$\{[^}]+\}/g, " ");
    for (const tok of stripped.split(/\s+/)) {
      const trimmed = tok.trim();
      if (trimmed && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(trimmed)) {
        names.push(trimmed);
      }
    }
  }
  return names;
}

/** Walks a directory (or single file) and returns all .tsx paths. */
function walk(target: string): string[] {
  const abs = join(ROOT, target);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) return abs.endsWith(".tsx") ? [abs] : [];
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const p = join(abs, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Collects every CSS class selector defined in the canonical stylesheets. */
function collectDefinedClasses(): Set<string> {
  const defined = new Set<string>();
  for (const rel of CSS_FILES) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) continue;
    const css = readFileSync(p, "utf8");
    // Match `.classname` followed by `{`, `,`, `:`, `.`, or whitespace.
    // This catches `.foo {`, `.foo,`, `.foo.bar`, `.foo:hover`, `.foo .bar`.
    const re = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      defined.add(m[1]!);
    }
  }
  return defined;
}

describe("className contract", () => {
  const defined = collectDefinedClasses();
  const componentFiles = COMPONENT_DIRS.flatMap(walk).filter((p) => !p.includes(".test."));

  it("found the canonical CSS files", () => {
    expect(defined.size).toBeGreaterThan(100);
  });

  it("found component files to scan", () => {
    expect(componentFiles.length).toBeGreaterThan(10);
  });

  it.each(
    componentFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const names = extractClassNames(source);
      // De-duplicate per file.
      const unique = Array.from(new Set(names));
      return unique.map((name) => ({ file: file.replace(ROOT + "/", ""), name }));
    }),
  )("$file uses className \"$name\" which must be defined in CSS", ({ name }) => {
    const definedDirectly = defined.has(name);
    const definedAsDynamicVariant = name.endsWith("--")
      && Array.from(defined).some((candidate) => candidate.startsWith(name) && candidate.length > name.length);
    expect(
      definedDirectly || definedAsDynamicVariant,
      `className "${name}" is not defined in any CSS file`,
    ).toBe(true);
  });
});
