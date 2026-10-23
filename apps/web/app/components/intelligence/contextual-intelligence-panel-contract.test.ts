import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const panelPath = resolve(ROOT, "app/components/intelligence/contextual-intelligence-panel.tsx");
const cssPath = resolve(ROOT, "app/intelligence.css");
const source = (path: string) => existsSync(path) ? readFileSync(path, "utf8") : "";

describe("contextual intelligence panel contract", () => {
  it("loads the shared briefing for the current tenant and branch", () => {
    const panel = source(panelPath);
    expect(existsSync(panelPath)).toBe(true);
    expect(panel).toContain("/v1/intelligence/briefing");
    expect(panel).toContain("session.businessId");
    expect(panel).toContain("session.branchId");
    expect(panel).toContain("selectContextualIntelligence");
    expect(panel).toMatch(/surface\s*===\s*["']reports["']\s*\?\s*["']month["']\s*:\s*["']today["']/);
  });

  it("makes offline state explicit and prevents contextual Ask TradeOS dispatch", () => {
    const panel = source(panelPath);
    expect(panel).toMatch(/queue\.online/);
    expect(panel).toMatch(/offline|reconnect/i);
    expect(panel).toMatch(/disabled=\{!queue\.online/);
    expect(panel).toContain("tradeos:ask");
    expect(panel).toContain("CustomEvent");
  });

  it("keeps recommendation actions as workflow navigation only", () => {
    const panel = source(panelPath);
    expect(panel).toContain("contextualWorkflowHref");
    expect(panel).toMatch(/Open workflow|Review workflow|Open recommendation/);
    expect(panel).not.toMatch(/\/v1\/(?:payments|refunds|sales|purchases|inventory\/adjust|cashbook|memberships)/);
    expect(panel).not.toMatch(/authenticatedFetch\s*\(/);
  });

  it("ships responsive contextual intelligence styling", () => {
    const css = source(cssPath);
    expect(css).toContain(".tos-context-ai");
    expect(css).toContain(".tos-context-ai__grid");
    expect(css).toMatch(/@media[^]*max-width:\s*720px[^]*\.tos-context-ai/);
  });
});
