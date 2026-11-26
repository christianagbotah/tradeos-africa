import {describe,it,expect} from "vitest";
import {multiUnitDraft} from "./catalog-workspace";
import {buildStockAdjustment} from "./inventory-adjustment";
import {buildDocumentInput,canWriteDocuments,canCancelDocuments} from "./document-workspace";
import type {MobileCatalogItem} from "./api-client";
describe("advanced native trading",()=>{
 it("maps bulk units to stock and independently priced portions",()=>{
   const base={name:"Rice",sku:"",kind:"PRODUCT" as const,unitLabel:"Kg",price:"10",trackStock:true};
   expect(multiUnitDraft(base,[{label:"Bag",price:"90",factor:"10"}]).conversions).toEqual([{fromUnitCode:"sale_1",toUnitCode:"unit",factor:10}]);
   expect(multiUnitDraft({...base,kind:"PREPARED_PRODUCT"},[{label:"Large",price:"20",factor:""}]).conversions).toEqual([]);
   expect(()=>multiUnitDraft(base,[{label:"Bag",price:"90",factor:"0"}])).toThrow();
 });
 it("requires a reason and maps stock corrections and movements",()=>{
   expect(buildStockAdjustment("i","2","AVAILABLE","DAMAGED","broken")).toMatchObject({reasonCode:"DAMAGE",quantity:2});
   expect(buildStockAdjustment("i","2","NONE","AVAILABLE","count")).toMatchObject({reasonCode:"COUNT_CORRECTION"});
   expect(()=>buildStockAdjustment("i","2","AVAILABLE","AVAILABLE","count")).toThrow();
   expect(()=>buildStockAdjustment("i","2","AVAILABLE","WASTE","")).toThrow();
 });
 it("uses catalog sale units and sends no client-calculated totals",()=>{
   const item={...multiUnitDraft({name:"Rice",sku:"",kind:"PRODUCT",unitLabel:"Kg",price:"10",trackStock:true},[]),id:"i",businessId:"b",active:true} as MobileCatalogItem;
   const d=buildDocumentInput({requestId:"r",kind:"PROFORMA",customerId:null,name:"Ama",phone:"",email:"",notes:"",expiry:"",lines:[{itemId:"i",saleUnitCode:"unit",quantity:"2"}]},"b","br",[item]);
   expect(d.lines).toEqual([{itemId:"i",saleUnitCode:"unit",quantity:2}]);expect(d).not.toHaveProperty("totalMinor");
   expect(canWriteDocuments("POS_ATTENDANT")).toBe(false);expect(canCancelDocuments("CASHIER")).toBe(false);
 });
});
