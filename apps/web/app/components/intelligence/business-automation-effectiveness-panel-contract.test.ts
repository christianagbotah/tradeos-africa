import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const panelPath = path.join(here, "business-automation-effectiveness-panel.tsx");
const automationPanelPath = path.join(here, "business-automations-panel.tsx");
const cssPath = path.resolve(here, "../../intelligence.css");
const source = (file: string) => fs.readFileSync(file, "utf8");

describe("automation effectiveness panel contract", () => {
  it("uses one online-only read endpoint and never adds an intelligence mutation", () => {
    const panel = source(panelPath);
    expect(panel).toContain("/v1/intelligence/automation-effectiveness?");
    expect(panel).toContain("useApiFetch<BusinessAutomationEffectiveness>");
    expect(panel).toMatch(/session\s*&&\s*queue\.online/);
    expect(panel).not.toMatch(/method:\s*["'](?:POST|PATCH|DELETE)["']/);
    expect(panel).not.toContain("authenticatedFetch");
  });

  it("shows the four KPIs, outcomes and explicit degraded states", () => {
    const panel = source(panelPath);
    for (const label of ["Tasks created", "Completion rate", "Relevant outcomes", "Median review time"]) expect(panel).toContain(label);
    for (const label of ["Resolved", "Already handled", "Not relevant", "No action needed"]) expect(panel).toContain(label);
    expect(panel).toContain("Effectiveness unavailable offline");
    expect(panel).toContain("Loading AI effectiveness");
    expect(panel).toContain("Effectiveness could not be loaded");
    expect(panel).toContain("automationEffectivenessPolicyState");
  });


  it("renders server-owned tuning suggestions and only delegates review for explicitly reviewable policy ids", () => {
    const panel = source(panelPath);
    expect(panel).toContain("data.tuningRecommendations");
    expect(panel).toContain("Tuning suggestions");
    expect(panel).toContain("Review policy");
    expect(panel).toContain("reviewablePolicyIds");
    expect(panel).toContain("onReviewPolicy");
    expect(panel).toMatch(/reviewablePolicyIds\?\.has\(recommendation\.policyId\)/);
    expect(panel).toMatch(/onReviewPolicy\?\.\(recommendation\.policyId\)/);
    expect(panel).not.toMatch(/method:\s*["'](?:POST|PATCH|DELETE)["']/);
    expect((panel.match(/useApiFetch</g) ?? [])).toHaveLength(1);
  });

  it("is mounted before automation editor/policy controls and has responsive styling", () => {
    const parent = source(automationPanelPath);
    const mount = parent.indexOf("<BusinessAutomationEffectivenessPanel");
    const editor = parent.indexOf("{editor && selectedTemplate");
    expect(mount).toBeGreaterThan(0);
    expect(editor).toBeGreaterThan(mount);
    const css = source(cssPath);
    expect(css).toContain(".tos-ai-effectiveness");
    expect(css).toContain(".tos-ai-effectiveness__kpis");
    expect(css).toContain(".tos-ai-effectiveness-tuning");
    expect(css).toContain(".tos-ai-effectiveness-tuning__item");
    expect(css).toContain("var(--tos-text-meta)");
    expect(css).toContain("var(--tos-text-section)");
    expect(css).not.toContain("var(--tos-text-xs)");
    expect(css).not.toContain("var(--tos-text-xl)");
    expect(css).toMatch(/@media[^}]+max-width/s);
  });
});
