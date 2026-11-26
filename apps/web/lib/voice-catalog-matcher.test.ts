import {describe,expect,it} from "vitest";
import type {SellableItem} from "./catalog-read-model";
import {draftVoiceTransaction} from "./voice-transaction-draft";
import {rankSpokenCatalogProducts} from "./voice-catalog-matcher";
const sku=(name:string,code:string,price=1000,unit="piece"):SellableItem=>({
  key:code+":"+unit,itemId:code,name,sku:code,priceMinor:price,
  kind:"PRODUCT",unitCode:unit,unitLabel:unit,trackStock:true,
  stockUnitCode:unit,availableStock:200,
});
const items=[
  sku("Door number 058","058",15000),
  sku("Door number 326","326",21000),
  sku("Door number 513","513",25000),
  sku("Cement bag","CMT-50",5500),
  sku("Ceramic floor tile 30 by 30","TIL-30",400),
  sku("Water bottle","WTR-10",300),
  sku("Door handle","D-HANDLE",2000),
  sku("Door lock","D-LOCK",1800),
  sku("Takeaway pack","TAKE-PACK",400),
  sku("Display sample","DR-102",3400),
  sku("Little bowl","BWL-2",900),
];

describe("spoken catalog recognition",()=>{
  it("recognizes zero-padded SKU as separated digits and as a number phrase",()=>{
    for(const text of [
      "sold SKU zero five eight",
      "sold school code oh five eight",
      "sold code 0 5 8",
      "sold door number zero fifty eight",
      "sold stock code 058",
      "sold skew is zero five eight",
      "sold S K U number 058",
    ]){
      const draft=draftVoiceTransaction(text,items,[]);
      expect(draft.lines.map(l=>l.item.sku),text).toContain("058");
    }
  });
  it("reads several spoken product codes in order, without treating a code as a quantity",()=>{
    const draft=draftVoiceTransaction(
      "customer bought two door number zero five eight and one door number three twenty six and one door number five one three, paid via MoMo",
      items,[]);
    expect(draft.lines.map(l=>[l.item.sku,l.quantity])).toEqual([
      ["058",2],["326",1],["513",1],
    ]);
  });
  it("matches separated letter-and-number SKU, without guessing a price",()=>{
    const recognized=draftVoiceTransaction(
      "Customer bought one SKU D R one oh two",items,[]);
    expect(recognized.lines.some(l=>l.item.sku==="DR-102")).toBe(true);
    expect(recognized.lines.find(l=>l.item.sku==="DR-102")?.item.priceMinor).toBe(3400);
  });
  it("uses fuzzy name matching for pronunciation and reordered words",()=>{
    const draft=draftVoiceTransaction(
      "customer bought one bag of sement and three take away packs",items,[]);
    expect(draft.lines.some(l=>l.item.sku==="CMT-50")).toBe(true);
    // A near miss must at least be available as a suggestion, never invented.
    expect(draft.lines.some(l=>l.item.sku==="TAKE-PACK")||
      draft.suggestions.some(l=>l.item.sku==="TAKE-PACK")).toBe(true);
  });
  it("suggests close catalog names without automatically posting uncertain words",()=>{
    const draft=draftVoiceTransaction(
      "the customer bought one door handel",items,[]);
    const names=[...draft.lines.map(l=>l.item.name),
      ...draft.suggestions.map(s=>s.item.name)];
    expect(names).toContain("Door handle");
    expect(draft.warnings.some(w=>w.includes("Catalog prices"))).toBe(true);
  });
  it("does not treat paid amounts as item codes or guess unknown SKUs",()=>{
    const products=[
      sku("Bag of tiles","100",500),
      sku("Floor board","150",1000),
    ];
    const draft=draftVoiceTransaction("Customer paid 100 cash, bought an unknown item",products,[]);
    expect(draft.lines).toHaveLength(0);
    const strange=draftVoiceTransaction("Customer bought SKU 7777",items,[]);
    expect(strange.lines).toHaveLength(0);
  });
  it("shows leading-zero loss only as a tentative match, requiring confirmation",()=>{
    const draft=draftVoiceTransaction("Sold SKU 58",items,[]);
    expect(draft.lines.map(l=>l.item.sku)).not.toContain("058");
    expect(draft.suggestions.map(s=>s.item.sku)).toContain("058");
  });
  it("does not mistake a named customer for a product",()=>{
    const inventory=[sku("Rose","R-1"),sku("Cement","CM-1")];
    const ranked=rankSpokenCatalogProducts(
      "Rose bought cement",inventory,["Rose"]);
    expect(ranked[0]?.item.name).toBe("Cement");
    expect(ranked.some(r=>r.item.name==="Rose")).toBe(false);
  });
});
