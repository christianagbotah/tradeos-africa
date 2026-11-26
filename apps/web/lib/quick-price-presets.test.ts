import { describe, expect, it } from "vitest";
import { addQuickPriceUnits, parseQuickPrices, quickPriceCode } from "./quick-price-presets";
import type { PriceButtonUnit } from "./quick-price-presets";

const placeholder: PriceButtonUnit = {
  code:"each",label:"Each (piece)",canSell:true,canPurchase:true,
  canStock:true,priceMinor:null,
};
const prepared = {
  kind:"PREPARED_PRODUCT" as const,
  currencyCode:"GHS",
  newItem:true,
  hasConversions:false,
};
const named = (minor:number):PriceButtonUnit => ({
  code:quickPriceCode(minor),label:"₵"+(minor/100)+" portion",
  canSell:true,canPurchase:false,canStock:false,priceMinor:minor,
});

describe("SME Quick Serve price shortcut owner setup",()=>{
  it("creates waakye price buttons ₵10/₵12/₵15/₵20/₵30",()=>{
    const original=[placeholder];
    const result=addQuickPriceUnits(original,"10, 12, 15, 20, 30",prepared);
    expect(result.added).toBe(5);
    expect(result.alreadyPresent).toBe(0);
    expect(result.units.map(u=>u.priceMinor)).toEqual([1000,1200,1500,2000,3000]);
    expect(result.units.map(u=>u.code)).toEqual([
      "price_1000","price_1200","price_1500","price_2000","price_3000",
    ]);
    expect(result.units[0]?.label).toBe("₵10 portion");
    expect(result.units.every(u=>u.canSell&&!u.canPurchase&&!u.canStock)).toBe(true);
    expect(original).toEqual([placeholder]);
  });

  it("supports fish ₵10 and ₵15, and repeat portions as normal cart quantities",()=>{
    const result=addQuickPriceUnits([placeholder],"10, 15",prepared);
    const first=result.units[0]!;
    const second=result.units[1]!;
    const cart=[
      {unit:first,quantity:1},
      {unit:second,quantity:2},
    ];
    expect(cart.reduce((total,row)=>total+row.unit.priceMinor!*row.quantity,0)).toBe(4000);
    expect(cart.map(row=>row.unit.code)).toEqual(["price_1000","price_1500"]);
  });

  it("parses decimal currencies exactly without floating-point cent drift",()=>{
    expect(parseQuickPrices("0.01; 12.50\n20, 10.05")).toEqual([1,1250,2000,1005]);
    expect(parseQuickPrices("10,10.00, 10, 12")).toEqual([1000,1200]);
  });

  it.each(["0","-2","NaN","Infinity","10.001","abc","₵12","0010","1e9",""])(
    "rejects malformed or unsafe price entry %j atomically",
    value=>{
      expect(()=>addQuickPriceUnits([placeholder],value,prepared)).toThrow();
    },
  );

  it("caps unbounded inputs and unit count",()=>{
    const values=Array.from({length:21},(_,i)=>i+1).join(",");
    expect(()=>parseQuickPrices(values)).toThrow("at most 20");
    expect(()=>addQuickPriceUnits(Array.from({length:50},(_,i)=>named((i+1)*100)),
      "100",prepared)).toThrow("too many units");
  });

  it("is repeatable and skips existing amounts, preserving non-shortcut units",()=>{
    const saved:PriceButtonUnit={
      code:"standard",label:"Standard",canSell:true,canPurchase:false,
      canStock:false,priceMinor:1000,
    };
    const first=addQuickPriceUnits([saved],"10, 12, 15",{
      ...prepared,newItem:false,
    });
    expect(first.added).toBe(2);
    expect(first.alreadyPresent).toBe(1);
    expect(first.units[0]).toEqual(saved);
    const twice=addQuickPriceUnits(first.units,"10, 12, 15",{
      ...prepared,newItem:false,
    });
    expect(twice.added).toBe(0);
    expect(twice.alreadyPresent).toBe(3);
    expect(twice.units).toEqual(first.units);
  });

  it("never replaces an edited product's configured physical unit",()=>{
    const modified={...placeholder,priceMinor:1500};
    const updated=addQuickPriceUnits([modified],"10",prepared);
    expect(updated.units[0]).toEqual(modified);
    const existingWithConversion=addQuickPriceUnits([placeholder],"10",{
      ...prepared,hasConversions:true,
    });
    expect(existingWithConversion.units[0]).toEqual(placeholder);
  });

  it("never alters stock-controlled physical products like cement or nails",()=>{
    expect(()=>addQuickPriceUnits([placeholder],"10,15",{
      ...prepared,kind:"PRODUCT",
    })).toThrow("real stock units");
  });

  it("preserves service-unit identity for barber or salon price options",()=>{
    const result=addQuickPriceUnits([placeholder],"30, 50",{
      ...prepared,kind:"SERVICE",
    });
    expect(result.units.map(u=>u.label)).toEqual(["₵30 service","₵50 service"]);
    expect(result.units.every(u=>!u.canStock)).toBe(true);
  });

  it("does not silently overwrite conflicting unit codes",()=>{
    expect(()=>addQuickPriceUnits([
      {...placeholder,code:"price_1000",priceMinor:1200},
    ],"10",{...prepared,newItem:false})).toThrow("exists with another price");
  });

  it("uses currency-appropriate labels for non-Ghana storefronts",()=>{
    const result=addQuickPriceUnits([placeholder],"5.50",{
      ...prepared,currencyCode:"USD",
    });
    expect(result.units[0]?.label).toBe("USD 5.50 portion");
  });
});
