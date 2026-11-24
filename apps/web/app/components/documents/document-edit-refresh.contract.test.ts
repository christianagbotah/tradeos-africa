import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
describe("commercial document editing and confirmed refresh",()=>{
  const ui=read("./document-workspace.tsx");
  it("reconciles the returned document before showing success and keeps list visible during reload",()=>{
    expect(ui.indexOf("applyDocument(result.document)")).toBeLessThan(ui.indexOf('setNotice(`${result.document.documentNumber}'));
    expect(ui).toContain("loading&&!data");
    expect(ui).toContain('method:editing?"PATCH":"POST"');
    expect(ui).toContain("expectedUpdatedAt:editing.updatedAt");
    expect(ui).toContain('onClick={()=>void edit(doc.id)}>Edit');
  });
  it("invalidates reads after a committed write and ignores an older response",()=>{
    const hook=read("../../../lib/use-api-fetch.ts");
    const queue=read("../../../lib/offline-sync.ts");
    expect(hook).toContain("MUTATION_INVALIDATION_EVENT");
    expect(hook).toContain("generation.current !== requestGeneration");
    expect(queue).toContain('response.ok && ["POST","PUT","PATCH","DELETE"]');
    expect(queue).toContain("if(summary.applied>0)publishMutationInvalidation");
  });
  it("uses an accessible styled confirmation instead of browser confirmation",()=>{
    const dialog=read("../ui/action-dialog.ts");
    expect(dialog).toContain("dialog.showModal()");
    expect(dialog).toContain("cancel.onclick");
    expect(dialog).toContain("previouslyFocused?.focus()");
    expect(ui).not.toContain("window.confirm(");
  });
});
