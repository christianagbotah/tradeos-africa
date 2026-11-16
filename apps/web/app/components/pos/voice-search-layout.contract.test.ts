import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const file=(rel:string)=>readFileSync(fileURLToPath(new URL(rel,import.meta.url)),"utf8");
const pos=file("./pos-workspace.tsx");
const browser=file("./product-browser.tsx");
const css=file("../../workspace-shell.css");
const assistant=file("./voice-sale-assistant.tsx");
describe("POS search and spoken sale UX",()=>{
  it("keeps voice directly beside the search input, not in the distant page header",()=>{
    expect(browser).toContain('className="tos-pos-search-row"');
    expect(browser).toContain('className="tos-pos-voice-button"');
    expect(browser).toContain('onClick={onSpeak}');
    expect(pos).toContain("onSpeak={()=>setVoiceOpen(true)}");
    expect(pos).not.toContain('style={{marginTop:12,padding:"11px 17px"');
  });
  it("prevents search from growing vertically and keeps product results below",()=>{
    expect(css).toContain(".tos-pos-search-row {");
    expect(css).toContain("flex: 0 0 auto;");
    expect(css).toContain(".tos-pos__browser {\n  /* Search and the first matching tile must remain adjacent on desktop. */");
    expect(css).toContain("gap: var(--tos-space-2);");
    expect(browser.indexOf('className="tos-pos-search-row"')).toBeLessThan(
      browser.indexOf('className="tos-product-grid"'));
  });
  it("surfaces similar catalog results and allows manual correction before posting",()=>{
    expect(assistant).toContain("Possible matching products");
    expect(assistant).toContain("No catalog match");
    expect(assistant).toContain("Can't find the spoken product?");
    expect(assistant).toContain("rankSpokenCatalogProducts");
    expect(assistant).toContain("Add reviewed items to sale cart");
    expect(assistant).toContain("Adding the cart does not take payment or post a sale.");
    expect(assistant).toContain('draft.intent!=="SALE"');
  });
});
