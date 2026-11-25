import type { PaymentMethod } from "./mutation-builders";
import type { WebOfflineQueue } from "./offline-sync";
export interface ExpenseCategoryOption {id:string;name:string;active:boolean}
export function expensePayload(input:{category:ExpenseCategoryOption|undefined;amountMinor:number|null;description:string;payee:string;method:PaymentMethod;moneyAccountId:string}){
 const {category,amountMinor,method,moneyAccountId}=input;
 const description=input.description.trim(),payee=input.payee.trim();
 if(!category?.active)throw Error("Select an active expense category.");
 if(amountMinor===null||!Number.isSafeInteger(amountMinor)||amountMinor<=0)throw Error("Enter a positive expense amount.");
 if(!description&&!payee)throw Error("Enter a description or payee.");
 if(description.length>1000||payee.length>1000)throw Error("Description and payee must be at most 1,000 characters.");
 return {categoryId:category.id,amountMinor,method,...(description?{description}:{}),...(payee?{payee}:{}),...(moneyAccountId?{moneyAccountId}:{})};
}
export type ExpensePostingState={state:"APPLIED"|"PENDING"|"REVIEW"|"REJECTED";message:string};
export async function postExpense(queue:WebOfflineQueue,scope:{businessId:string;branchId:string},payload:ReturnType<typeof expensePayload>,online:boolean):Promise<ExpensePostingState>{
 const verifyScope=()=>{const session=queue.sessions.load();if(session?.businessId!==scope.businessId||session.branchId!==scope.branchId)throw Error("Workspace changed. Reopen the expense form.");};
 verifyScope();
 const prior=await queue.getSnapshot(scope.businessId);
 verifyScope();
 const matches=(m:{branchId?:string;mutationType:string})=>m.branchId===scope.branchId&&m.mutationType==="EXPENSE_CREATE";
 if(prior.pending.some(matches)||prior.failed.some(f=>matches(f.mutation)))throw Error("An expense is awaiting sync or review in this branch. Resolve it in Sync status before recording another.");
 const mutation=queue.build({...scope,mutationType:"EXPENSE_CREATE",payload});
 if(!await queue.enqueue(mutation))throw Error("Expense already queued.");
 // After persisting, never encourage a second submission when transport fails.
 try{verifyScope();await queue.flushOrThrow({activeBusinessId:scope.businessId,online});}catch{}
 try{
  const after=await queue.getSnapshot(scope.businessId);
  const failed=after.failed.find(f=>f.mutation.clientMutationId===mutation.clientMutationId);
  if(failed)return {state:"REJECTED",message:failed.result.errorMessage??"Expense rejected. Review it in Sync status."};
  if(after.pending.some(m=>m.clientMutationId===mutation.clientMutationId))return {state:"PENDING",message:"Expense saved on this device. Awaiting server confirmation; do not submit it again."};
  if(queue.hasAppliedAcknowledgement(mutation.clientMutationId,scope.businessId,scope.branchId))return {state:"APPLIED",message:"Expense recorded successfully."};
 }catch{}
 return {state:"REVIEW",message:"Expense confirmation could not be verified. Check server history and Sync status before recording it again."};
}
