import {describe,it,expect,vi} from "vitest";
import {expensePayload,postExpense} from "./expense-posting";
import type {WebOfflineQueue} from "./offline-sync";
const scope={businessId:"b",branchId:"a"};
const input={category:{id:"cat",name:"Rent",active:true},amountMinor:2500,description:" Rent ",payee:"",method:"CASH" as const,moneyAccountId:""};
const payload=expensePayload(input);
function setup(mode:"APPLIED"|"PENDING"|"REVIEW"|"REJECTED"){
 const m={...scope,mutationType:"EXPENSE_CREATE",clientMutationId:"unique",payload};
 const queue={sessions:{load:()=>scope},getSnapshot:vi.fn().mockResolvedValueOnce({pending:[],failed:[]}).mockResolvedValue({pending:mode==="PENDING"?[m]:[],failed:mode==="REJECTED"?[{mutation:m,result:{errorMessage:"Rejected"}}]:[]}),build:vi.fn(()=>m),enqueue:vi.fn(async()=>true),flushOrThrow:vi.fn(async()=>{if(mode==="PENDING")throw Error("network")}),hasAppliedAcknowledgement:vi.fn(()=>mode==="APPLIED")};
 return {queue,typed:queue as unknown as WebOfflineQueue,m};
}
describe("expense posting",()=>{
 it("uses the API category id and description, never legacy category/note",()=>{expect(payload).toEqual({categoryId:"cat",amountMinor:2500,method:"CASH",description:"Rent"});});
 it("rejects inactive category, missing text and invalid amount",()=>{
  expect(()=>expensePayload({...input,category:{...input.category,active:false}})).toThrow();
  expect(()=>expensePayload({...input,description:" "})).toThrow();
  expect(()=>expensePayload({...input,amountMinor:0})).toThrow();
 });
 it("accepts payee alone without null fields",()=>expect(expensePayload({...input,description:"",payee:"Supplier"})).toEqual({categoryId:"cat",amountMinor:2500,method:"CASH",payee:"Supplier"}));
 for(const mode of ["APPLIED","PENDING","REVIEW","REJECTED"] as const){
  it("distinguishes "+mode,async()=>{const f=setup(mode);expect((await postExpense(f.typed,scope,payload,true)).state).toBe(mode);expect(f.queue.enqueue).toHaveBeenCalledTimes(1);});
 }
 it("blocks another expense while an earlier one is pending",async()=>{const f=setup("PENDING");f.queue.getSnapshot.mockReset().mockResolvedValue({pending:[f.m],failed:[]});await expect(postExpense(f.typed,scope,payload,true)).rejects.toThrow(/awaiting sync/);expect(f.queue.enqueue).not.toHaveBeenCalled();});
});
