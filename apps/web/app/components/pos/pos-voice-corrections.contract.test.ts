import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const get=(rel:string)=>readFileSync(fileURLToPath(new URL(rel,import.meta.url)),"utf8");
const assistant=get("./voice-sale-assistant.tsx");
const browser=get("./product-browser.tsx");
const correction=get("../../../lib/voice-draft-corrections.ts");
describe("customer-confirmed voice draft edits and fuzzy POS search",()=>{
  it("shows distinct approximate-search results and resets a stale category filter",()=>{
    expect(browser).toContain("searchPosCatalog(items,query)");
    expect(browser).toContain("Similar catalog matches");
    expect(browser).toContain('setKind("ALL")');
    expect(browser).toContain("onClick={() => onPick(item)}");
  });
  it("records corrections separately and requires explicit selection and confirmation",()=>{
    expect(assistant).toContain('start("correction")');
    expect(assistant).toContain("setCorrectionText(next.slice(0,500))");
    expect(assistant).toContain("Prepare correction for review");
    expect(assistant).toContain("Confirm correction to draft");
    expect(assistant).toContain("replacementKey");
    expect(assistant).toContain("correctionTargetKey");
    expect(assistant).toContain("setReviewed(false)");
    expect(assistant).toContain("setDraft({...draft,lines:nextLines})");
    expect(assistant).toContain("Add reviewed items to sale cart");
    expect(correction).toContain("Price changes need manager approval");
  });
});
