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

export type CustomerContactDraft={name:string;phone:string;email:string};
export function normalizeCustomerContact(draft:CustomerContactDraft){
  const name=draft.name.trim(),phone=draft.phone.trim(),email=draft.email.trim().toLowerCase();
  if(!name||name.length>160)throw new Error("Enter a customer name of up to 160 characters.");
  if(phone.length>40)throw new Error("Phone number must be at most 40 characters.");
  if(email.length>254||(email&&!email.includes("@")))throw new Error("Enter a valid email address.");
  return {name,phone:phone||null,email:email||null};
}
export function insertConfirmedCustomer(rows:readonly MobileCustomer[],customer:MobileCustomer){
  return [customer,...rows.filter(row=>row.id!==customer.id)];
}
