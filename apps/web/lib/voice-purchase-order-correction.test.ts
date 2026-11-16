import {describe,it,expect} from "vitest";
import {parseVoicePOCorrection as parse} from "./voice-purchase-order-correction";

describe("safe purchase-order voice edit parsing",()=>{
  it("targets quantities precisely",()=>{
    expect(parse("change item two quantity to five",3)).toEqual({
      ok:true,value:{kind:"QUANTITY",index:1,quantity:5},
    });
    expect(parse("set quantity of item one to 500",3)).toEqual({
      ok:true,value:{kind:"QUANTITY",index:0,quantity:500},
    });
    expect(parse("set item 2 qty to 2000",3)).toEqual({
      ok:true,value:{kind:"QUANTITY",index:1,quantity:2000},
    });
    expect(parse("change item 1 quantity to 0",3).ok).toBe(false);
    expect(parse("change item 1 quantity to 1.5",3).ok).toBe(false);
  });
  it("recognizes explicit supplier purchasing cost with cedi decimals",()=>{
    expect(parse("change item 2 cost to ₵120.50",3)).toEqual({
      ok:true,value:{kind:"COST",index:1,unitCostMinor:12050,perUnit:null},
    });
    expect(parse("set item one unit cost to 1,250.05 cedis per bag",3)).toEqual({
      ok:true,value:{kind:"COST",index:0,unitCostMinor:125005,perUnit:"bag"},
    });
    expect(parse("set item 1 cost to 120.500",3).ok).toBe(false);
    expect(parse("set item 1 cost to 500 and item 2 cost to 700",3).ok).toBe(false);
    expect(parse("set item 1 cost to 50 discount",3).ok).toBe(false);
  });
  it("recognizes purchase-unit, replacement, removal and supplier commands",()=>{
    expect(parse("set item two unit to carton",3)).toEqual({
      ok:true,value:{kind:"UNIT",index:1,unitQuery:"carton"},
    });
    expect(parse("replace item 2 with SKU 058",3)).toEqual({
      ok:true,value:{kind:"REPLACE",index:1,itemQuery:"sku 058"},
    });
    expect(parse("remove item three",3)).toEqual({
      ok:true,value:{kind:"REMOVE",index:2},
    });
    expect(parse("change supplier to Comfort Supplies",3)).toEqual({
      ok:true,value:{kind:"SUPPLIER",supplierQuery:"comfort supplies"},
    });
  });
  it("rejects vague, unsupported or financial actions",()=>{
    expect(parse("change item 20 quantity to five",3).ok).toBe(false);
    expect(parse("change something",3).ok).toBe(false);
    expect(parse("issue purchase order",3).ok).toBe(false);
    expect(parse("receive item 1",3).ok).toBe(false);
    expect(parse("remove item two and item three",3).ok).toBe(false);
    expect(parse("",3).ok).toBe(false);
  });
});
