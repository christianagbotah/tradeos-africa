import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe,it,expect} from "vitest";
const file=(path:string)=>readFileSync(fileURLToPath(
  new URL(path,import.meta.url)),"utf8");
const assistant=file("./voice-purchase-order-assistant.tsx");
const order=file("./purchase-order-workspace.tsx");
const parser=file("../../../lib/voice-purchase-order-draft.ts");
describe("speech never silently authorizes a supplier cost",()=>{
  it("does not populate the editable cost until a user clicks Use suggested cost",()=>{
    expect(assistant).toContain("costMinor:null,");
    expect(assistant).toContain("suggestedCostMinor:line.suggestedUnitCostMinor");
    expect(assistant).toContain("row.suggestedCostMinor!==null&&row.costMinor===null");
    expect(assistant).toContain("Use suggested cost");
    expect(assistant).toContain("costMinor:row.suggestedCostMinor");
    expect(assistant).toContain("row.costMinor!==null");
    expect(assistant).toContain("disabled={!valid||!reviewed||Boolean(correction)}");
  });
  it("invalidates old price on product or purchasing unit change",()=>{
    expect(assistant).toContain("costMinor:null,suggestedCostMinor:null");
    expect(assistant).toContain("setReviewed(false)");
    expect(assistant).toContain('label="Supplier unit cost · required"');
    expect(parser).toContain("spokenItemCostHint");
  });
  it("only fills the original order form, never issues, pays, or receives",()=>{
    expect(assistant).not.toContain("authenticatedFetch");
    expect(assistant).toContain("Use reviewed details in order form");
    expect(order).toContain("setLines(reviewed.map(");
    expect(order).toContain('onClick={()=>void create()}');
    expect(order).toContain('onClick={()=>void transition(order,"issue")}');
    expect(order).toContain("No stock or money is recorded");
  });
});
