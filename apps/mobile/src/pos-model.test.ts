import { describe, expect, it } from "vitest";
import {
  addCartItem,
  buildSaleMutation,
  displayCartTotalMinor,
  filterSellableItems,
  groupMobileQuickServeItems,
  visibleQuickServeGroups,
  QUICK_SERVE_PAGE_SIZE,
  projectSellableItems,
  removeCartLine,
  setCartQuantity,
  type MobileCartLine,
} from "./pos-model";
import type { MobileCatalogItem, MobileInventoryItem } from "./api-client";

const catalog: MobileCatalogItem[] = [
  {
    id: "item-1",
    businessId: "11111111-1111-4111-8111-111111111111",
    sku: "CEM-50",
    name: "Cement 50kg",
    kind: "PRODUCT",
    stockUnitCode: "bag",
    trackStock: true,
    taxCategory: null,
    active: true,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    units: [
      { code: "bag", label: "Bag", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 12000 },
      { code: "ton", label: "Tonne", canPurchase: true, canSell: true, canStock: false, defaultSalePriceMinor: 240000 },
      { code: "pallet", label: "Pallet", canPurchase: true, canSell: false, canStock: false, defaultSalePriceMinor: 500000 },
    ],
    conversions: [{ fromUnitCode: "ton", toUnitCode: "bag", factor: 20 }],
  },
  {
    id: "item-2",
    businessId: "11111111-1111-4111-8111-111111111111",
    sku: null,
    name: "Delivery service",
    kind: "SERVICE",
    stockUnitCode: null,
    trackStock: false,
    taxCategory: null,
    active: true,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    units: [{ code: "trip", label: "Trip", canPurchase: false, canSell: true, canStock: false, defaultSalePriceMinor: 3500 }],
    conversions: [],
  },
  {
    id: "item-3",
    businessId: "11111111-1111-4111-8111-111111111111",
    sku: "OLD",
    name: "Archived product",
    kind: "PRODUCT",
    stockUnitCode: "piece",
    trackStock: true,
    taxCategory: null,
    active: false,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    units: [{ code: "piece", label: "Piece", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 1000 }],
    conversions: [],
  },
];

const inventory: MobileInventoryItem[] = [
  {
    id: "item-1", sku: "CEM-50", name: "Cement 50kg", stockUnitCode: "bag",
    available: 28, quarantine: 1, damaged: 0, waste: 0,
    inventoryValueMinor: 280000, averageStockUnitCostMinor: 10000, latestStockUnitCostMinor: 10000,
  },
];

describe("mobile POS sellable projection", () => {
  it("projects only active sellable priced units and joins last-known inventory for display", () => {
    const items = projectSellableItems(catalog, inventory);

    expect(items.map((item) => item.key)).toEqual(["item-1:bag", "item-1:ton", "item-2:trip"]);
    expect(items[0]).toMatchObject({ name: "Cement 50kg", unitLabel: "Bag", priceMinor: 12000, availableStock: 28, stockUnitCode: "bag" });
    expect(items[1]).toMatchObject({ unitLabel: "Tonne", availableStock: 28 });
    expect(items[2]).toMatchObject({ name: "Delivery service", trackStock: false, availableStock: null });
  });

  it("searches by name, SKU and unit label case-insensitively", () => {
    const items = projectSellableItems(catalog, inventory);
    expect(filterSellableItems(items, "cem").map((item) => item.key)).toEqual(["item-1:bag", "item-1:ton"]);
    expect(filterSellableItems(items, "CEM-50").map((item) => item.key)).toEqual(["item-1:bag", "item-1:ton"]);
    expect(filterSellableItems(items, "tonne").map((item) => item.key)).toEqual(["item-1:ton"]);
  });
});

describe("mobile POS cart", () => {
  it("adds and increments the same item/unit, supports positive quantity changes and removal", () => {
    const [bag] = projectSellableItems(catalog, inventory);
    let cart: MobileCartLine[] = [];
    cart = addCartItem(cart, bag!);
    cart = addCartItem(cart, bag!);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ key: "item-1:bag", quantity: 2 });

    cart = setCartQuantity(cart, "item-1:bag", 1.5);
    expect(cart[0]!.quantity).toBe(1.5);
    expect(() => setCartQuantity(cart, "item-1:bag", 0)).toThrow(/greater than zero/i);
    expect(() => setCartQuantity(cart, "item-1:bag", Number.NaN)).toThrow(/finite/i);

    cart = removeCartLine(cart, "item-1:bag");
    expect(cart).toEqual([]);
  });

  it("computes a display-only total from cached catalog prices", () => {
    const [bag, tonne, trip] = projectSellableItems(catalog, inventory);
    let cart: MobileCartLine[] = [];
    cart = addCartItem(cart, bag!);
    cart = addCartItem(cart, tonne!);
    cart = addCartItem(cart, trip!);
    cart = setCartQuantity(cart, "item-2:trip", 2);
    expect(displayCartTotalMinor(cart)).toBe(12000 + 240000 + 7000);
  });
});

describe("mobile POS SALE_CREATE mutation", () => {
  it("builds the server-authoritative sale shape without client prices or totals", () => {
    const [bag, , trip] = projectSellableItems(catalog, inventory);
    let cart: MobileCartLine[] = [];
    cart = addCartItem(cart, bag!);
    cart = addCartItem(cart, trip!);
    cart = setCartQuantity(cart, "item-2:trip", 2);

    const mutation = buildSaleMutation({
      clientId: "mobile-device-1",
      clientMutationId: "mutation-1",
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      currencyCode: "GHS",
      paymentMethod: "MOMO",
      occurredAt: "2026-10-10T23:50:00.000Z",
      cart,
    });

    expect(mutation).toEqual({
      clientId: "mobile-device-1",
      clientMutationId: "mutation-1",
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      mutationType: "SALE_CREATE",
      occurredAt: "2026-10-10T23:50:00.000Z",
      payload: {
        currencyCode: "GHS",
        paymentMethod: "MOMO",
        lines: [
          { itemId: "item-1", saleUnitCode: "bag", quantity: 1 },
          { itemId: "item-2", saleUnitCode: "trip", quantity: 2 },
        ],
      },
    });
    const serialized = JSON.stringify(mutation);
    expect(serialized).not.toContain("priceMinor");
    expect(serialized).not.toContain("totalMinor");
  });

  it("rejects empty carts, invalid quantities and unsupported payment methods", () => {
    const base = {
      clientId: "mobile-device-1", clientMutationId: "mutation-1",
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      currencyCode: "GHS", occurredAt: "2026-10-10T23:50:00.000Z",
    };
    expect(() => buildSaleMutation({ ...base, paymentMethod: "CASH", cart: [] })).toThrow(/at least one/i);
    const [bag] = projectSellableItems(catalog, inventory);
    const badCart = [{ ...addCartItem([], bag!)[0]!, quantity: -1 }];
    expect(() => buildSaleMutation({ ...base, paymentMethod: "CASH", cart: badCart })).toThrow(/greater than zero/i);
    expect(() => buildSaleMutation({ ...base, paymentMethod: "CUSTOMER_CREDIT" as never, cart: addCartItem([], bag!) })).toThrow(/payment method/i);
  });
});

describe("native Quick Serve grouped portion amounts",()=>{
  const make=(itemId:string,name:string,unit:string,amount:number,
    kind:"PRODUCT"|"PREPARED_PRODUCT"="PREPARED_PRODUCT")=>({
    key:itemId+":"+unit,itemId,name,sku:null,kind,unitCode:unit,
    unitLabel:unit,priceMinor:amount,trackStock:false,
    stockUnitCode:null,availableStock:null,
  });
  it("shows Waakye five/ten/fifteen as one grouped food",()=>{
    const small=make("waakye","Waakye","SMALL",500);
    const standard=make("waakye","Waakye","STANDARD",1000);
    const large=make("waakye","Waakye","LARGE",1500);
    const egg=make("egg","Egg","PIECE",800);
    const original=[large,egg,small,standard];
    const grouped=groupMobileQuickServeItems(original);
    expect(grouped).toHaveLength(2);
    expect(grouped.find(g=>g.itemId==="waakye")?.options.map(p=>p.priceMinor))
      .toEqual([500,1000,1500]);
    expect(grouped.find(g=>g.itemId==="egg")?.options.map(p=>p.priceMinor))
      .toEqual([800]);
    expect(original.map(p=>p.priceMinor)).toEqual([1500,800,500,1000]);
  });
  it("never merges two distinct items with identical names",()=>{
    const groups=groupMobileQuickServeItems([
      make("a","Fish","SMALL",1000),
      make("b","Fish","LARGE",2000),
    ]);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map(g=>g.itemId)).size).toBe(2);
  });
  it("prioritizes prepared foods ahead of nonfood items",()=>{
    const items=[
      make("soap","Soap","PIECE",500,"PRODUCT"),
      make("egg","Egg","PIECE",800),
    ];
    expect(groupMobileQuickServeItems(items).map(g=>g.name)).toEqual(["Egg","Soap"]);
  });
});
describe("Quick Serve catalog expansion",()=>{
  it("keeps every group and its portion choices reachable beyond the initial page",()=>{
    const source=projectSellableItems(catalog,inventory)[0]!;
    const items=Array.from({length:65},(_,i)=>({
      ...source,itemId:"food-"+i,key:"food-"+i+":small",
      name:"Food "+String(i).padStart(3,"0"),unitCode:"small",
      kind:"PREPARED_PRODUCT" as const,priceMinor:1000
    }));
    const extra={...items[64]!,key:"food-64:large",unitCode:"large",priceMinor:2000};
    const first=visibleQuickServeGroups([...items,extra]);
    expect(first.groups).toHaveLength(QUICK_SERVE_PAGE_SIZE);
    expect(first.totalGroups).toBe(65);
    expect(first.hasMore).toBe(true);
    const all=visibleQuickServeGroups([...items,extra],90);
    expect(all.groups).toHaveLength(65);
    expect(all.hasMore).toBe(false);
    expect(all.groups[64]?.options.map(x=>x.priceMinor)).toEqual([1000,2000]);
    expect(new Set(all.groups.map(g=>g.itemId)).size).toBe(65);
  });
  it("handles an empty or filtered catalog and invalid limits",()=>{
    expect(visibleQuickServeGroups([],NaN)).toEqual({groups:[],totalGroups:0,hasMore:false});
    const items=projectSellableItems(catalog,inventory);
    const page=visibleQuickServeGroups(filterSellableItems(items,"cement"),-1);
    expect(page.totalGroups).toBe(1);
    expect(page.hasMore).toBe(false);
  });
});
