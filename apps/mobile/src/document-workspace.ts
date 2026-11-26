import type {MobileCatalogItem,MobileDocument,MobileDocumentInput,MobileDocumentKind,MobileDocumentSummary} from "./api-client";
export const canReadDocuments=(role:string)=>["OWNER","ADMIN","MANAGER","CASHIER","SALES","ACCOUNTANT","INVENTORY","STAFF","VIEWER"].includes(role);
export const canWriteDocuments=(role:string)=>["OWNER","ADMIN","MANAGER","CASHIER","SALES"].includes(role);
export const canCancelDocuments=(role:string)=>["OWNER","ADMIN","MANAGER"].includes(role);
export type DocumentDraft={requestId:string;kind:MobileDocumentKind;customerId:string|null;name:string;phone:string;email:string;notes:string;expiry:string;lines:Array<{itemId:string;saleUnitCode:string;quantity:string}>;revision?:{id:string;expectedUpdatedAt:string}};
export function editDocumentDraft(doc:MobileDocument,requestId:string):DocumentDraft{
 return {requestId,kind:doc.kind,customerId:doc.customerId,name:doc.customerName,phone:doc.customerPhone??"",email:doc.customerEmail??"",notes:doc.notes,expiry:doc.expiresAt??"",lines:doc.lines.map(l=>({itemId:l.itemId,saleUnitCode:l.saleUnitCode,quantity:String(l.quantity)})),revision:{id:doc.id,expectedUpdatedAt:doc.updatedAt}};
}
export function buildDocumentInput(d:DocumentDraft,businessId:string,branchId:string,catalog:readonly MobileCatalogItem[]):MobileDocumentInput{
 if((!d.customerId&&!d.name.trim())||d.name.length>180||d.phone.length>40||d.email.length>180||d.notes.length>2000)throw new Error("Check customer details and notes.");
 if(d.lines.length<1||d.lines.length>50)throw new Error("Add between 1 and 50 items.");
 const lines=d.lines.map(l=>{
   const quantity=Number(l.quantity),item=catalog.find(i=>i.id===l.itemId&&i.businessId===businessId&&i.active);
   if(!item?.units.some(u=>u.canSell&&u.code===l.saleUnitCode&&u.defaultSalePriceMinor!==null))throw new Error("Select a currently available sale unit for each line.");
   if(!/^\d+(?:\.\d{1,8})?$/.test(l.quantity.trim())||!Number.isFinite(quantity)||quantity<=0||quantity>1e6)throw new Error("Enter a valid positive quantity.");
   return {itemId:l.itemId,saleUnitCode:l.saleUnitCode,quantity};
 });
 const expiry=d.expiry.trim();
 if(expiry&&(!Number.isFinite(Date.parse(expiry))||Date.parse(expiry)<=Date.now()))throw new Error("Choose a future expiry date or leave it blank.");
 return {businessId,branchId,clientRequestId:d.requestId,kind:d.kind,...(d.customerId?{customerId:d.customerId}:{}),customerName:d.name.trim(),customerPhone:d.phone.trim(),customerEmail:d.email.trim(),notes:d.notes.trim(),...(expiry?{expiresAt:new Date(expiry).toISOString()}:{}),lines};
}
export function documentMatchesScope(d:MobileDocumentSummary,businessId:string,branchId:string){return d.businessId===businessId&&d.branchId===branchId;}
export function reconcileDocuments(rows:readonly MobileDocumentSummary[],d:MobileDocumentSummary){return [d,...rows.filter(r=>r.id!==d.id)];}
