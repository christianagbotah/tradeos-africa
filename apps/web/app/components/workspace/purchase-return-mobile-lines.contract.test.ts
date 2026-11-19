import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const css=readFileSync(new URL("../../workspace-shell.css",import.meta.url),"utf8");
const purchase=readFileSync(new URL("../purchases/purchase-detail-sheet.tsx",import.meta.url),"utf8");
const returns=readFileSync(new URL("../returns/return-refund-sheet.tsx",import.meta.url),"utf8");

describe("readable mobile purchase and return line cards",()=>{
  it("keeps complete product names instead of one-line ellipses",()=>{
    for(const selector of [".tos-purchase-line__title", ".tos-return-line__title"]){
      const block=css.slice(css.indexOf(selector+" {"),css.indexOf("}",css.indexOf(selector+" {")));
      expect(block).toContain("white-space: normal;");
      expect(block).toContain("overflow-wrap: anywhere;");
      expect(block).not.toContain("text-overflow: ellipsis");
    }
    expect(purchase).toContain('className="tos-purchase-line__title"');
    expect(returns).toContain('className="tos-return-line__title"');
  });
  it("stacks the monetary column under details only on narrow phones",()=>{
    expect(css).toContain("@media (max-width: 380px)");
    expect(css).toContain(".tos-purchase-line__cost,");
    expect(css).toContain(".tos-return-line__total {");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr);");
  });
  it("retains quantity stepper and return quantity controls",()=>{
    expect(returns).toContain("tos-return-line__stepper");
    expect(returns).toContain("quantityReturnable");
  });
});
