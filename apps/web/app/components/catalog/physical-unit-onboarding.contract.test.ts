import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const page=readFileSync(resolve(__dirname,"catalog-item-sheet.tsx"),"utf8");
const css=readFileSync(resolve(__dirname,"physical-unit-presets.module.css"),"utf8");
const helper=readFileSync(resolve(__dirname,"../../../lib/physical-unit-presets.ts"),"utf8");
describe("physical unit setup for nails, coils, cement and drinks",()=>{
  it("is owner-catalog controlled and not shown to unstocked items",()=>{
    expect(page).toContain('kind === "PRODUCT" ? (');
    expect(page).toContain("addPhysicalUnitPreset(units,conversions,presetId,presetFactor");
    expect(page).toContain('disabled={!canWrite || busy || !presetFactor.trim()}');
    expect(page).toContain('role="alert" className={presetStyles.error}');
  });
  it("requires explicit factor and existing canonical conversions/units",()=>{
    expect(page).toContain('Set your own sale prices');
    expect(page).toContain('conversions: toPayloadConversions()');
    expect(page).toContain('units: toPayloadUnits()');
    expect(helper).toContain('const factor=parsePhysicalFactor(factorText);');
    expect(helper).not.toContain('factor:"24"');
  });
  it("fits narrow mobile sheets",()=>{
    expect(css).toContain("@media (max-width: 768px)");
    expect(css).toContain(".fields > button { width: 100%; }");
  });
});
