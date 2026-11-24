import {describe,it,expect} from "vitest";
import {canManageCatalog,canBrowseStock,simpleCatalogDraft,catalogContactPatch,reconcileCatalog} from "./catalog-workspace";
import type {MobileCatalogItem} from "./api-client";
describe("native catalog",()=>{
 it("matches management permissions and excludes attendants",()=>{expect(canManageCatalog("INVENTORY")).toBe(true);expect(canManageCatalog("CASHIER")).toBe(false);expect(canBrowseStock("POS_ATTENDANT")).toBe(false);});
 it("creates services without stock and tracked products with a valid stock unit",()=>{const base={name:"Item",sku:"",unitLabel:"Each",price:"12.30",trackStock:true};expect(simpleCatalogDraft({...base,kind:"SERVICE"})).toMatchObject({trackStock:false,stockUnitCode:null});expect(simpleCatalogDraft({...base,kind:"PRODUCT"})).toMatchObject({trackStock:true,stockUnitCode:"unit",units:[{defaultSalePriceMinor:1230,canStock:true}]});});
 it("preserves unit identities and revision when changing prices",()=>{const item={...simpleCatalogDraft({name:"Item",sku:"A",unitLabel:"Each",price:"1",kind:"PRODUCT",trackStock:true}),id:"a",updatedAt:"revision"} as MobileCatalogItem;const patch=catalogContactPatch(item,"New","A",{unit:"2.50"});expect(patch).toMatchObject({expectedUpdatedAt:"revision",units:[{code:"unit",canStock:true,defaultSalePriceMinor:250}]});expect(patch).not.toHaveProperty("conversions");expect(reconcileCatalog([item],{...item,name:"New"})).toHaveLength(1);});
});
