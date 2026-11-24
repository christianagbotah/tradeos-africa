import type { MobileCustomer } from "./api-client";
export type CustomerFilter="ALL"|"ACTIVE"|"INACTIVE"|"OWES";
const readRoles=new Set(["OWNER","ADMIN","MANAGER","CASHIER","SALES","INVENTORY","ACCOUNTANT","STAFF","VIEWER"]);
const writeRoles=new Set(["OWNER","ADMIN","MANAGER","CASHIER","SALES","ACCOUNTANT"]);
export const canReadCustomers=(role:string)=>readRoles.has(role);
export const canEditCustomer=(role:string)=>writeRoles.has(role);
export function filterCustomers(rows:readonly MobileCustomer[],filter:CustomerFilter){
  return rows.filter(row=>filter==="ALL"||(filter==="ACTIVE"&&row.active)||(filter==="INACTIVE"&&!row.active)||(filter==="OWES"&&row.balanceMinor>0));
}
export function confirmedCustomerRows(rows:readonly MobileCustomer[],customer:MobileCustomer){
  return rows.map(row=>row.id===customer.id?customer:row);
}
