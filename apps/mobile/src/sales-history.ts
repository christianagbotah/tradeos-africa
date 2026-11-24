import type { MobileSaleDetail } from "./api-client";

// Matches the server read roles. POS attendants do not get branch-wide history.
const READ_ROLES=new Set(["OWNER","ADMIN","MANAGER","CASHIER","SALES","INVENTORY","ACCOUNTANT","STAFF","VIEWER"]);
export function canReadSalesHistory(role:string){return READ_ROLES.has(role);}
export function saleMatchesScope(sale:MobileSaleDetail,businessId:string,branchId:string,saleId:string){
  return sale.businessId===businessId&&sale.branchId===branchId&&sale.id===saleId;
}
export function displaySaleDate(value:string,timezone:string){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return "Date unavailable";
  try{return new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:timezone}).format(date);}
  catch{return date.toISOString();}
}
