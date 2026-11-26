import type {BusinessRole,StaffDirectoryItem} from "@tradeos/contracts";
import type {MobileBranch} from "./api-client";
export const canManageBusiness=(role:string)=>["OWNER","ADMIN"].includes(role);
export const canReadStaff=(role:string)=>["OWNER","ADMIN","MANAGER"].includes(role);
export const assignableRoles=(role:string):BusinessRole[]=>role==="OWNER"?["ADMIN","MANAGER","CASHIER","POS_ATTENDANT","SALES","INVENTORY","ACCOUNTANT","STAFF","VIEWER"]:role==="ADMIN"?["MANAGER","CASHIER","POS_ATTENDANT","SALES","INVENTORY","ACCOUNTANT","STAFF","VIEWER"]:[];
export function canEditStaff(role:string,staff:StaffDirectoryItem,selfId:string|null){return staff.id!==selfId&&assignableRoles(role).includes(staff.role);}
export function validateName(value:string){const name=value.trim();if(name.length<2||name.length>120)throw new Error("Enter a name of 2–120 characters.");return name;}
export function validateBranchCode(value:string){const code=value.trim().toUpperCase();if(code&&!/^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(code))throw new Error("Use a branch code of 2–24 letters, numbers, hyphens or underscores.");return code;}
export function validateAssignments(branchIds:string[],branches:MobileBranch[]){if(branchIds.length>100||new Set(branchIds).size!==branchIds.length||branchIds.some(id=>!branches.some(b=>b.id===id&&b.active)))throw new Error("Choose active branches from this business only.");return branchIds;}
export function canDeactivateBranch(branch:MobileBranch,branches:MobileBranch[],activeBranchId:string){return branch.active&&branch.id!==activeBranchId&&branches.filter(b=>b.active).length>1;}
