import { describe,expect,it } from "vitest";
import type { SellableItem } from "./catalog-read-model";
import {draftVoiceTransaction} from "./voice-transaction-draft";

const item=(name:string,sku:string,key:string,priceMinor:number):SellableItem=>({
  key,itemId:key,name,sku,priceMinor,kind:"PRODUCT",unitCode:"piece",
  unitLabel:"Piece",trackStock:true,stockUnitCode:"piece",availableStock:100,
});
const items=[
  item("Door number 058","058","a",15000),
  item("Door number 326","326","b",22000),
  item("Door number 513","513","c",28000),
  item("Takeaway pack","TAKE-PACK","d",300),
];
const customers=[{id:"c1",name:"Comfort Mensah"},{id:"c2",name:"Michael Dapaah"}];

describe("voice-assisted draft, never an actual posting",()=>{
  it("matches real catalog items by spoken name and quantity",()=>{
    const x=draftVoiceTransaction("Record a sale. Comfort Mensah bought two door number 058 and one door number 326. She paid by MoMo.",items,customers);
    expect(x.intent).toBe("SALE");
    expect(x.lines.map(l=>[l.item.sku,l.quantity])).toEqual([["058",2],["326",1]]);
    expect(x.customerId).toBe("c1");
    expect(x.paymentMethod).toBe("MOMO");
  });
  it("reads multiple SKUs without inventing quantities or prices",()=>{
    const x=draftVoiceTransaction("A walk-in customer bought door number 058, door number 326 and door number 513 in cash",items,customers);
    expect(x.lines.map(l=>l.item.priceMinor)).toEqual([15000,22000,28000]);
    expect(x.lines.every(l=>l.quantity===1)).toBe(true);
    expect(x.customerId).toBe(null);
  });
  it("warns about credit and ambiguous unknown items",()=>{
    const x=draftVoiceTransaction("Comfort Mensah took two unknown gates and paid part by cash",items,customers);
    expect(x.lines).toHaveLength(0);
    expect(x.paymentState).toBe("PARTIAL");
    expect(x.warnings.some(w=>w.includes("Credit and part-payments"))).toBe(true);
  });
  it("recognizes everyday reordered item phrases but never silently discounts",()=>{
    const x=draftVoiceTransaction(
      "Comfort Mensah bought one pack of takeaway, I gave it at a special price and she paid cash",
      items,customers);
    expect(x.lines.map(l=>[l.item.sku,l.quantity])).toEqual([["TAKE-PACK",1]]);
    expect(x.warnings.some(w=>w.includes("Spoken discounts"))).toBe(true);
  });
  it("keeps supplier purchase order a review-only intent",()=>{
    const x=draftVoiceTransaction("Create a purchase order for door number 513",items,customers);
    expect(x.intent).toBe("PURCHASE_ORDER");
    expect(x.warnings.some(w=>w.includes("Purchase-order voice drafts"))).toBe(true);
  });
});
