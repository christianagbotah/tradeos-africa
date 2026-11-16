import {describe,it,expect} from "vitest";
import {searchPosCatalog} from "./pos-catalog-search";
import type {SellableItem} from "./catalog-read-model";
const entry=(key:string,name:string,sku:string):SellableItem=>({
  key,itemId:key,name,sku,kind:"PRODUCT",unitCode:"piece",
  unitLabel:"Piece",priceMinor:1000,trackStock:false,
  stockUnitCode:null,availableStock:null,
});
const catalog=[
  entry("a","Cement bag","CMT-50"),
  entry("b","Door number 058","058"),
  entry("c","Door number 326","326"),
  entry("d","Takeaway pack","TK-20"),
  entry("e","Metal nail","MTN-12"),
];
describe("POS catalog search remains grounded",()=>{
  it("preserves fast ordinary substring search",()=>{
    const found=searchPosCatalog(catalog,"cement");
    expect(found.approximate).toBe(false);
    expect(found.items.map(x=>x.key)).toEqual(["a"]);
  });
  it("offers familiar near-spellings instead of an empty result",()=>{
    const found=searchPosCatalog(catalog,"cemnt");
    expect(found.approximate).toBe(true);
    expect(found.items.map(x=>x.key)).toContain("a");
  });
  it("handles spelled-out numeric and mixed SKUs",()=>{
    const found=searchPosCatalog(catalog,"zero five eight");
    expect(found.approximate).toBe(true);
    expect(found.items.map(x=>x.key)).toContain("b");
  });
  it("never makes up inventory or guesses a different numeric SKU",()=>{
    expect(searchPosCatalog(catalog,"77777").items).toHaveLength(0);
    expect(searchPosCatalog(catalog,"3").approximate).toBe(false);
    expect(searchPosCatalog([], "cement").items).toEqual([]);
  });
  it("does not widen valid exact searches into unrelated products",()=>{
    const found=searchPosCatalog(catalog,"326");
    expect(found.approximate).toBe(false);
    expect(found.items.map(x=>x.key)).toEqual(["c"]);
  });
});
