import { describe, expect, it } from "vitest";
import type { SellableItem } from "./catalog-read-model";
import { quickServeStorageKey, cleanQuickServeFavourites, quickServeTiles } from "./quick-serve-model";

const create=(name:string,priceMinor:number,kind:SellableItem["kind"]="PREPARED_PRODUCT"):SellableItem=>({
  key:name+":PORTION", itemId:name, name, sku:null, kind, unitCode:"PORTION",
  unitLabel:"portion", priceMinor, trackStock:false,stockUnitCode:null,availableStock:null,
});
const waakye=create("Waakye",1000);
const gari=create("Gari",200);
const fish=create("Fish",2000);
const egg=create("Egg",800);

describe("Quick Serve: fast food-vendor catalogue",()=>{
  it("preserves all prices as integer minor units and the ₵40 example",()=>{
    const cart=[waakye,gari,fish,egg];
    expect(cart.reduce((total,item)=>total+item.priceMinor,0)).toBe(4000);
    expect(quickServeTiles(cart,[])).toEqual([egg,fish,gari,waakye]);
    expect(cart.map(item=>item.priceMinor)).toEqual([1000,200,2000,800]);
  });
  it("keeps pinned favorites first, in operator-selected order",()=>{
    const products=[create("Soap",500,"PRODUCT"),gari,fish,egg,waakye];
    const order=quickServeTiles(products,[fish.key,waakye.key]);
    expect(order.slice(0,2).map(item=>item.key)).toEqual([fish.key,waakye.key]);
    expect(order).toHaveLength(5);
    expect(products[0]?.name).toBe("Soap");
  });
  it("rejects foreign or malicious pin storage payloads",()=>{
    const valid=new Set([waakye.key,egg.key]);
    expect(cleanQuickServeFavourites([waakye.key,waakye.key,77,{},egg.key,"foreign"],valid))
      .toEqual([waakye.key,egg.key]);
    expect(cleanQuickServeFavourites({__proto__:[waakye.key]},valid)).toEqual([]);
    expect(cleanQuickServeFavourites("fish",valid)).toEqual([]);
  });
  it("limits favorites and isolates the active business and branch",()=>{
    const keys=Array.from({length:36},(_,i)=>"item-"+i);
    expect(cleanQuickServeFavourites(keys,new Set(keys))).toHaveLength(30);
    expect(quickServeStorageKey("biz-1","branch-a")).not.toBe(quickServeStorageKey("biz-1","branch-b"));
    expect(quickServeStorageKey("biz-1","branch-a")).not.toBe(quickServeStorageKey("biz-2","branch-a"));
    expect(()=>quickServeStorageKey("","branch-a")).toThrow();
  });
  it("supports the same item with multiple priced units without collapsing keys",()=>{
    const small={...waakye,key:"waakye:SMALL",unitCode:"SMALL",priceMinor:500};
    const large={...waakye,key:"waakye:LARGE",unitCode:"LARGE",priceMinor:1000};
    expect(quickServeTiles([small,large],[])).toHaveLength(2);
    expect(new Set([small.key,large.key]).size).toBe(2);
  });
});
