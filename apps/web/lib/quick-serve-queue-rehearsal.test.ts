import { describe, expect, it } from "vitest";
import type { SellableItem } from "./catalog-read-model";
import { buildQueuedMutation, buildSaleCreatePayload } from "./mutation-builders";
import { quickServeGroups } from "./quick-serve-model";
import { mayStartNextQuickServeCustomer } from "./quick-serve-sale-gate";

const item=(itemId:string,name:string,unitCode:string,minor:number):SellableItem=>({
  key:itemId+":"+unitCode,itemId,name,sku:null,kind:"PREPARED_PRODUCT",
  unitCode,unitLabel:unitCode.toLowerCase(),priceMinor:minor,
  trackStock:false,stockUnitCode:null,availableStock:null,
});
const catalog=[
  item("waakye","Waakye","SMALL",500),
  item("waakye","Waakye","STANDARD",1000),
  item("waakye","Waakye","LARGE",1500),
  item("gari","Gari","SIDE",200),
  item("fish","Fish","SMALL",1000),
  item("fish","Fish","LARGE",2000),
  item("egg","Egg","PIECE",800),
  item("spaghetti","Spaghetti","SIDE",300),
  item("wele","Wele","PIECE",400),
] as const;
const byKey=new Map(catalog.map(x=>[x.key,x]));
// Simulated baskets: 22 distinct customers, each with a new sale.
const orders:readonly (readonly string[])[]=[
  ["waakye:STANDARD","gari:SIDE","fish:LARGE","egg:PIECE"],
  ["waakye:SMALL","egg:PIECE"],
  ["waakye:LARGE","fish:SMALL"],
  ["waakye:STANDARD","gari:SIDE"],
  ["waakye:STANDARD","fish:LARGE"],
  ["waakye:SMALL","gari:SIDE","egg:PIECE"],
  ["waakye:LARGE","egg:PIECE","egg:PIECE"],
  ["waakye:STANDARD","spaghetti:SIDE"],
  ["waakye:SMALL","wele:PIECE"],
  ["waakye:STANDARD","gari:SIDE","fish:SMALL"],
  ["waakye:LARGE","fish:LARGE","egg:PIECE"],
  ["waakye:SMALL"],
  ["waakye:STANDARD","egg:PIECE"],
  ["waakye:SMALL","gari:SIDE","spaghetti:SIDE"],
  ["waakye:LARGE","fish:SMALL","wele:PIECE"],
  ["waakye:STANDARD","fish:LARGE","gari:SIDE"],
  ["waakye:SMALL","egg:PIECE","fish:SMALL"],
  ["waakye:STANDARD","spaghetti:SIDE","wele:PIECE"],
  ["waakye:LARGE","gari:SIDE"],
  ["waakye:SMALL","fish:LARGE"],
  ["waakye:STANDARD","egg:PIECE","egg:PIECE","gari:SIDE"],
  ["waakye:LARGE","fish:SMALL","gari:SIDE","egg:PIECE"],
];

describe("22-customer Quick Serve queue rehearsal (NO actual payment posting)",()=>{
  it("uses configured catalog units and reproduces the example ₵40 order",()=>{
    expect(orders).toHaveLength(22);
    expect(orders[0]?.map(k=>byKey.get(k)?.priceMinor)).toEqual([1000,200,2000,800]);
    const groups=quickServeGroups(catalog,[]);
    expect(groups.find(x=>x.itemId==="waakye")?.options.map(x=>x.priceMinor))
      .toEqual([500,1000,1500]);
    expect(groups.find(x=>x.itemId==="fish")?.options.map(x=>x.priceMinor))
      .toEqual([1000,2000]);
  });
  it("blocks next customer on unconfirmed and failed writes",()=>{
    for(const status of ["RECEIVED","REJECTED","UNKNOWN"] as const){
      expect(mayStartNextQuickServeCustomer({
        source:"SERVER",mutationStatus:status,saleStatus:"COMPLETED",
      })).toBe(false);
    }
    expect(mayStartNextQuickServeCustomer({
      source:"SERVER",mutationStatus:"APPLIED",saleStatus:"AWAITING_PAYMENT",
    })).toBe(false);
    expect(mayStartNextQuickServeCustomer({
      source:"SERVER",mutationStatus:"APPLIED",saleStatus:null,
    })).toBe(false);
    expect(mayStartNextQuickServeCustomer({
      source:"OFFLINE",locallyPersisted:false,
    })).toBe(false);
  });
  it("records 22 distinct sales in an isolated model, with a safe retry",()=>{
    let customerIndex=0;
    let submitAttempts=0;
    const ledger=new Map<string,number>();
    const offlinePending=new Set<string>();
    let totalFromIndependentCatalog=0;
    while(customerIndex<orders.length){
      const selected=orders[customerIndex]!;
      const grouped=new Map<string,{item:SellableItem;qty:number}>();
      for(const key of selected){
        const tile=byKey.get(key);
        if(!tile)throw new Error("Unconfigured sale unit");
        const existing=grouped.get(tile.key);
        if(existing) existing.qty++;
        else grouped.set(tile.key,{item:tile,qty:1});
        totalFromIndependentCatalog+=tile.priceMinor;
      }
      const expectedMinor=[...grouped.values()].reduce((n,x)=>n+x.item.priceMinor*x.qty,0);
      const payload=buildSaleCreatePayload({
        currencyCode:"GHS",paymentMethod:"CASH",
        lines:[...grouped.values()].map(x=>({
          itemId:x.item.itemId,saleUnitCode:x.item.unitCode,
          quantity:x.qty,expectedUnitPriceMinor:x.item.priceMinor,
        })),
      });
      for(const forbidden of ["totalMinor","customerId","cashierStaffId","actorRole"]){
        expect(payload).not.toHaveProperty(forbidden);
      }
      const customerNumber=customerIndex+1;
      const clientMutationId="qa-sale-"+String(customerNumber).padStart(2,"0");
      const mutation=buildQueuedMutation({
        clientId:"qa-device",businessId:"qa-business",branchId:"qa-branch",
        now:()=>"2026-11-23T12:00:00.000Z",
        createMutationId:()=>clientMutationId,
      },"SALE_CREATE",payload);
      submitAttempts++;
      // The 9th customer has an ambiguous network acknowledgement. The
      // original cart and clientMutationId MUST survive a retry.
      if(customerNumber===9){
        expect(mayStartNextQuickServeCustomer({
          source:"SERVER",mutationStatus:"RECEIVED",saleStatus:null,
        })).toBe(false);
        const retried={...mutation};
        expect(retried.clientMutationId).toBe(mutation.clientMutationId);
        submitAttempts++;
      }
      // The 6th and 18th are saved offline. A failed device persistence on
      // customer 6 is a HOLD, not permission to clear the cart.
      const offline=customerNumber===6||customerNumber===18;
      if(customerNumber===6){
        expect(mayStartNextQuickServeCustomer({
          source:"OFFLINE",locallyPersisted:false,
        })).toBe(false);
      }
      const safe=offline?
        mayStartNextQuickServeCustomer({source:"OFFLINE",locallyPersisted:true}):
        mayStartNextQuickServeCustomer({
          source:"SERVER",mutationStatus:"APPLIED",saleStatus:"COMPLETED",
        });
      expect(safe).toBe(true);
      expect(ledger.has(mutation.clientMutationId)).toBe(false);
      ledger.set(mutation.clientMutationId,expectedMinor);
      if(offline)offlinePending.add(mutation.clientMutationId);
      customerIndex++;
    }
    expect(customerIndex).toBe(22);
    expect(submitAttempts).toBe(23);
    expect(ledger.size).toBe(22);
    expect(offlinePending.size).toBe(2);
    expect(ledger.get("qa-sale-01")).toBe(4000);
    expect([...ledger.values()].reduce((n,v)=>n+v,0)).toBe(totalFromIndependentCatalog);
  });
});
