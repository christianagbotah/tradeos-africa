import {describe,it,expect} from "vitest";
import {canManageCatalog,canBrowseStock,simpleCatalogDraft,catalogContactPatch,reconcileCatalog,matchesCatalogQuery,matchesStockAvailability} from "./catalog-workspace";
import type {MobileCatalogItem} from "./api-client";
describe("native catalog",()=>{
 it("matches management permissions and excludes attendants",()=>{expect(canManageCatalog("INVENTORY")).toBe(true);expect(canManageCatalog("CASHIER")).toBe(false);expect(canBrowseStock("POS_ATTENDANT")).toBe(false);});
 it("creates services without stock and tracked products with a valid stock unit",()=>{const base={name:"Item",sku:"",unitLabel:"Each",price:"12.30",trackStock:true};expect(simpleCatalogDraft({...base,kind:"SERVICE"})).toMatchObject({trackStock:false,stockUnitCode:null});expect(simpleCatalogDraft({...base,kind:"PRODUCT"})).toMatchObject({trackStock:true,stockUnitCode:"unit",units:[{defaultSalePriceMinor:1230,canStock:true}]});});
 it("preserves unit identities and revision when changing prices",()=>{const item={...simpleCatalogDraft({name:"Item",sku:"A",unitLabel:"Each",price:"1",kind:"PRODUCT",trackStock:true}),id:"a",updatedAt:"revision"} as MobileCatalogItem;const patch=catalogContactPatch(item,"New","A",{unit:"2.50"});expect(patch).toMatchObject({expectedUpdatedAt:"revision",units:[{code:"unit",canStock:true,defaultSalePriceMinor:250}]});expect(patch).not.toHaveProperty("conversions");expect(reconcileCatalog([item],{...item,name:"New"})).toHaveLength(1);});
});

describe("native catalog and stock display filters",()=>{
 it("matches item name or SKU without changing catalog records",()=>{
  const item={name:"Fried Fish",sku:"FISH-20"};
  expect(matchesCatalogQuery(item," fish ")).toBe(true);
  expect(matchesCatalogQuery(item,"FISH-20")).toBe(true);
  expect(matchesCatalogQuery(item,"rice")).toBe(false);
  expect(matchesCatalogQuery({name:"Service",sku:null}," ")).toBe(true);
  expect(item).toEqual({name:"Fried Fish",sku:"FISH-20"});
 });
 it("separates available and non-positive stock without changing stock quantities",()=>{
  const rows=[{available:1.5},{available:0},{available:-1}];
  expect(rows.filter(r=>matchesStockAvailability(r,"all"))).toEqual(rows);
  expect(rows.filter(r=>matchesStockAvailability(r,"available"))).toEqual([rows[0]]);
  expect(rows.filter(r=>matchesStockAvailability(r,"out"))).toEqual([rows[1],rows[2]]);
 });
});
