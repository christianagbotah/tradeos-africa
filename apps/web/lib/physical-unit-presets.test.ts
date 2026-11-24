import { describe, expect, it } from "vitest";
import {
  addPhysicalUnitPreset, parsePhysicalFactor, PHYSICAL_UNIT_PRESETS,
} from "./physical-unit-presets";
import type { PhysicalUnit, PhysicalConversion } from "./physical-unit-presets";

const defaultUnit:PhysicalUnit={
  code:"each",label:"Each (piece)",canPurchase:true,canSell:true,
  canStock:true,priceMinor:null,
};
const newProduct={kind:"PRODUCT" as const,newItem:true};
const names=(units:readonly PhysicalUnit[])=>units.map(u=>u.code);

describe("SME physical units must use real product-specific factors",()=>{
  it("creates Concrete Nails 3-inch box/pound pair without a fabricated rate",()=>{
    const source=[defaultUnit];
    const result=addPhysicalUnitPreset(source,[],"NAILS_BOX_POUND","25.5",newProduct);
    expect(names(result.units)).toEqual(["box","pound"]);
    expect(result.units.find(u=>u.code==="pound")?.canStock).toBe(true);
    expect(result.units.find(u=>u.code==="box")?.canStock).toBe(false);
    expect(result.units.every(u=>u.priceMinor===null)).toBe(true);
    expect(result.units.every(u=>u.canSell)).toBe(true);
    expect(result.conversions).toEqual([{fromUnitCode:"box",toUnitCode:"pound",factor:"25.5"}]);
    expect(source).toEqual([defaultUnit]);
  });
  it("allows explicitly measured 30-yard sandpaper coils",()=>{
    const result=addPhysicalUnitPreset([defaultUnit],[],"SANDPAPER_COIL_YARD","30",newProduct);
    expect(names(result.units)).toEqual(["coil","yard"]);
    expect(result.conversions[0]?.factor).toBe("30");
    expect(2 + 1 * Number(result.conversions[0]!.factor)).toBe(32);
  });
  it("supports a drinks stock chain crate-to-bottle, then bottle-to-shot",()=>{
    const crate=addPhysicalUnitPreset([defaultUnit],[],"DRINKS_CRATE_BOTTLE","24",newProduct);
    const next=addPhysicalUnitPreset(crate.units,crate.conversions,
      "DRINKS_BOTTLE_SHOT","20",newProduct);
    expect(names(next.units)).toEqual(["crate","bottle","shot"]);
    expect(next.conversions.map(c=>c.factor)).toEqual(["24","20"]);
    expect(next.units.filter(u=>u.canStock).map(u=>u.code)).toEqual(["bottle"]);
    expect(next.units.every(u=>u.priceMinor===null)).toBe(true);
  });
  it("requires a product-specific iron rod tonne-to-piece factor",()=>{
    const rod=addPhysicalUnitPreset([defaultUnit],[],"ROD_TON_PIECE","83.333",newProduct);
    expect(rod.conversions).toEqual([
      {fromUnitCode:"tonne",toUnitCode:"piece",factor:"83.333"},
    ]);
    expect(rod.units.find(u=>u.code==="piece")?.canStock).toBe(true);
    expect(PHYSICAL_UNIT_PRESETS).toHaveLength(8);
  });
  it.each(["", "0", "-2", "1e6", "Infinity", "NaN", "1.1234567", "abc", "001", "10000000"])(
    "rejects unsafe missing or guessed factor %j",input=>{
      expect(()=>parsePhysicalFactor(input)).toThrow();
    },
  );
  it("accepts measured fractional factors but never defaults to 1",()=>{
    expect(parsePhysicalFactor("0.5")).toBe(0.5);
    expect(parsePhysicalFactor("1")).toBe(1);
    expect(()=>addPhysicalUnitPreset([defaultUnit],[],
      "CEMENT_BAG_KG","",newProduct)).toThrow();
  });
  it("never treats services or prepared food as physical stock",()=>{
    for(const kind of ["SERVICE","PREPARED_PRODUCT"] as const){
      expect(()=>addPhysicalUnitPreset([defaultUnit],[],"PACK_PIECE","12",
        {kind,newItem:true})).toThrow("stocked products");
    }
  });
  it("is repeatable and refuses silent overwrite of a different factor",()=>{
    const initial=addPhysicalUnitPreset([defaultUnit],[],"PACK_PIECE","12",newProduct);
    const again=addPhysicalUnitPreset(initial.units,initial.conversions,
      "PACK_PIECE","12",newProduct);
    expect(again).toMatchObject({addedUnits:0,addedConversion:false});
    expect(again.conversions).toEqual(initial.conversions);
    expect(()=>addPhysicalUnitPreset(initial.units,initial.conversions,
      "PACK_PIECE","24",newProduct)).toThrow("different factor");
    expect(initial.conversions[0]?.factor).toBe("12");
  });
  it("preserves existing physical unit metadata during edit, with no price rewrite",()=>{
    const existing:PhysicalUnit={
      code:"pound",label:"Pound",canPurchase:false,canSell:true,
      canStock:true,priceMinor:1000,
    };
    const existingConv:PhysicalConversion={
      fromUnitCode:"sack",toUnitCode:"pound",factor:"45",
    };
    const result=addPhysicalUnitPreset([existing],[existingConv],
      "NAILS_BOX_POUND","20",{kind:"PRODUCT",newItem:false});
    expect(result.units[0]).toEqual(existing);
    expect(result.conversions[0]).toEqual(existingConv);
    expect(result.units.find(u=>u.code==="box")?.priceMinor).toBeNull();
    expect(result.units.find(u=>u.code==="pound")?.priceMinor).toBe(1000);
  });
  it("rejects unsupported conversion IDs",()=>{
    expect(()=>addPhysicalUnitPreset([defaultUnit],[],
      "FAKE" as never,"3",newProduct)).toThrow("Unknown");
  });
});
