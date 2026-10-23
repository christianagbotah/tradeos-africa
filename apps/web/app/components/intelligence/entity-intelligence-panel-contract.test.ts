import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const panelPath = resolve(ROOT, "app/components/intelligence/entity-intelligence-panel.tsx");
const cssPath = resolve(ROOT, "app/intelligence.css");
const source = (path: string) => existsSync(path) ? readFileSync(path, "utf8") : "";

describe("entity intelligence panel contract", () => {
  it("fetches one entity intelligence payload for the active tenant and branch", () => {
    const panel = source(panelPath);
    expect(existsSync(panelPath)).toBe(true);
    expect(panel).toContain("BusinessEntityIntelligence");
    expect(panel).toContain("BusinessEntityType");
    expect(panel).toContain("/v1/intelligence/entity");
    expect(panel).toContain("session.businessId");
    expect(panel).toContain("session.branchId");
    expect(panel).toContain("entityType");
    expect(panel).toContain("entityId");
    expect(panel).toContain("useApiFetch<BusinessEntityIntelligence>");
    expect(panel).toMatch(/queue\.online/);
  });

  it("renders explicit loading, error, offline, evidence and attention states", () => {
    const panel = source(panelPath);
    expect(panel).toMatch(/offline|reconnect/i);
    expect(panel).toMatch(/loading|aria-busy/i);
    expect(panel).toMatch(/Could not load entity intelligence/i);
    expect(panel).toContain("data.evidence");
    expect(panel).toContain("data.attentionItems");
    expect(panel).toContain("data.recommendations");
  });

  it("dispatches structured Ask TradeOS context from a non-submitting button", () => {
    const panel = source(panelPath);
    expect(panel).toContain('type="button"');
    expect(panel).toContain("tradeos:ask");
    expect(panel).toContain("CustomEvent");
    expect(panel).toMatch(/detail:\s*\{[^}]*question:\s*data\.askPrompt[^}]*context:\s*\{\s*entityType,\s*entityId\s*\}/s);
    expect(panel).toMatch(/disabled=\{!queue\.online/);
  });

  it("keeps recommendations as navigation-only workflow links", () => {
    const panel = source(panelPath);
    expect(panel).toContain("contextualWorkflowHref");
    expect(panel).toContain("<Link");
    expect(panel).not.toMatch(/authenticatedFetch\s*\(/);
    expect(panel).not.toMatch(/method:\s*["'](?:POST|PATCH|DELETE)["']/);
  });

  it("formats explicit minor-unit money evidence using its currency metadata", () => {
    const panel = source(panelPath);
    expect(panel).toContain("BusinessEvidenceReference");
    expect(panel).toContain('metadata?.kind === "money_minor"');
    expect(panel).toContain("metadata?.currencyCode");
    expect(panel).toContain("Intl.NumberFormat");
    expect(panel).toMatch(/minor[^]*\/\s*100/);
    expect(panel).toMatch(/formatEvidenceValue\(item\)/);
  });

  it("ships responsive entity intelligence styling", () => {
    const css = source(cssPath);
    expect(css).toContain(".tos-entity-ai");
    expect(css).toContain(".tos-entity-ai__facts");
    expect(css).toContain(".tos-entity-ai__attention");
    expect(css).toMatch(/@media[^]*max-width:\s*720px[^]*\.tos-entity-ai/);
  });
});
