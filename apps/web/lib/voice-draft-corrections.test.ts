import {describe,it,expect} from "vitest";
import {parseVoiceDraftCorrection as parse} from "./voice-draft-corrections";
describe("safe spoken draft corrections",()=>{
  it("recognizes item-position replacements",()=>{
    expect(parse("change item two to door number zero five eight",3)).toEqual({
      ok:true,value:{kind:"REPLACE",index:1,productQuery:"door number zero five eight"},
    });
    expect(parse("replace line number 1 with SKU 326",2)).toEqual({
      ok:true,value:{kind:"REPLACE",index:0,productQuery:"sku 326"},
    });
  });
  it("supports removals and ordinal numbers",()=>{
    expect(parse("remove item first",2)).toEqual({
      ok:true,value:{kind:"REMOVE",index:0},
    });
    expect(parse("delete the product number two",2)).toEqual({
      ok:true,value:{kind:"REMOVE",index:1},
    });
  });
  it("supports quantity edits, not unauthorized discounts",()=>{
    expect(parse("change the quantity of item 2 to three",3)).toEqual({
      ok:true,value:{kind:"QUANTITY",index:1,quantity:3},
    });
    expect(parse("change item 1 quantity to 20",3)).toEqual({
      ok:true,value:{kind:"QUANTITY",index:0,quantity:20},
    });
    expect(parse("change item 1 quantity to 600",3).ok).toBe(false);
    expect(parse("give item 2 special price",3).ok).toBe(false);
  });
  it("rejects vague, out-of-scope and unknown instructions",()=>{
    expect(parse("change item 20 to Cement Bag",2).ok).toBe(false);
    expect(parse("change that wrong product to door",2).ok).toBe(false);
    expect(parse("change item 2 to",2).ok).toBe(false);
    expect(parse("remove item 0",2).ok).toBe(false);
    expect(parse("",2).ok).toBe(false);
  });
});
