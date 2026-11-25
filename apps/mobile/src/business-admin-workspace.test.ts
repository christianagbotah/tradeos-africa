import {describe,it,expect} from "vitest";
import type {StaffDirectoryItem} from "@tradeos/contracts";
import type {MobileBranch} from "./api-client";
import {canManageBusiness,canReadStaff,assignableRoles,canEditStaff,validateName,validateBranchCode,validateAssignments,canDeactivateBranch} from "./business-admin-workspace";
const a={id:"a",active:true} as MobileBranch,b={id:"b",active:true} as MobileBranch;
describe("native business administration",()=>{
 it("preserves role boundaries and prevents self-access changes",()=>{
  expect(canManageBusiness("MANAGER")).toBe(false);expect(canReadStaff("MANAGER")).toBe(true);
  expect(assignableRoles("ADMIN")).not.toContain("OWNER");expect(assignableRoles("ADMIN")).not.toContain("ADMIN");
  expect(assignableRoles("OWNER")).toContain("ADMIN");
  expect(canEditStaff("ADMIN",{id:"s",role:"OWNER"} as StaffDirectoryItem,"self")).toBe(false);
  expect(canEditStaff("OWNER",{id:"self",role:"ADMIN"} as StaffDirectoryItem,"self")).toBe(false);
 });
 it("keeps the current and last active branch",()=>{
  expect(canDeactivateBranch(a,[a,b],"a")).toBe(false);
  expect(canDeactivateBranch(b,[a,b],"a")).toBe(true);
  expect(canDeactivateBranch(a,[a,{...b,active:false}],"b")).toBe(false);
 });
 it("validates branch assignments and codes",()=>{
  expect(validateAssignments(["a"],[a,b])).toEqual(["a"]);
  expect(()=>validateAssignments(["a","a"],[a,b])).toThrow();
  expect(()=>validateAssignments(["other"],[a,b])).toThrow();
  expect(()=>validateAssignments(["b"],[a,{...b,active:false}])).toThrow();
  expect(validateBranchCode("acc-01")).toBe("ACC-01");expect(()=>validateBranchCode("a!")).toThrow();
  expect(validateName("  Main branch ")).toBe("Main branch");
 });
});
