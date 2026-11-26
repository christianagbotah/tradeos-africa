import { afterEach, describe, expect, it, vi } from "vitest";
import { WebOfflineQueue, type WebSession } from "./offline-sync";
import {
  enqueueAndConfirmMutation,
  findPendingTarget,
  PendingMutationConfirmationError,
  FinancialMutationInFlightError,
  type MutationTarget,
} from "./confirmed-financial-mutation";

const businessId="11111111-1111-4111-8111-111111111111";
const branchId="22222222-2222-4222-8222-222222222222";
const saleId="33333333-3333-4333-8333-333333333333";
class Storage {
  values=new Map<string,string>();
  getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){this.values.set(key,value);}
  removeItem(key:string){this.values.delete(key);}
}
function create() {
  const localStorage=new Storage();
  vi.stubGlobal("window",{localStorage,dispatchEvent:()=>true});
  vi.stubGlobal("CustomEvent",class CustomEventMock { constructor(_name:string,_options:unknown){} });
  let id=0;
  const queue=new WebOfflineQueue({
    now:()=> "2026-11-19T11:45:00.000Z",
    createMutationId:()=> "mutation-"+(++id),
  });
  const session:WebSession={
    accessToken:"mock-access",refreshToken:"mock-refresh",
    businessId,branchId,clientId:"test-client",staffId:"staff-test",
    currencyCode:"GHS",timezone:"Africa/Accra",businessName:"Test Shop",
    role:"OWNER",displayName:"Cashier",
  };
  queue.sessions.save(session);
  const mutation=()=>queue.build({businessId,branchId,mutationType:"RETURN_CREATE",payload:{
    originalSaleId:saleId,reason:"Wrong item supplied",refundMethod:"CASH",lines:[],
  }});
  const target:MutationTarget={businessId,branchId,targetField:"originalSaleId",targetId:saleId,
    mutationTypes:["RETURN_CREATE","REFUND_CREATE","EXCHANGE_CREATE"]};
  return {queue,mutation,target};
}
afterEach(()=>vi.unstubAllGlobals());
describe("transaction confirmation protects refunds, returns and exchanges",()=>{
  it("completes only when this exact mutation was APPLIED",async()=>{
    const {queue,mutation,target}=create();
    vi.stubGlobal("fetch",vi.fn(async(_url:string,init?:RequestInit)=>{
      const {mutations}=JSON.parse(String(init?.body)) as {mutations:Array<{clientMutationId:string;mutationType:string}>};
      return new Response(JSON.stringify({mutationResults:mutations.map(m=>({
        clientMutationId:m.clientMutationId,status:"APPLIED"}))}),{status:200});
    }));
    await expect(enqueueAndConfirmMutation(queue,mutation(),target,true)).resolves.toBeUndefined();
    expect((await queue.getSnapshot(businessId)).pending).toHaveLength(0);
  });
  it("does not label RECEIVED as posted or allow a duplicate return/exchange",async()=>{
    const {queue,mutation,target}=create();
    let requests=0;
    vi.stubGlobal("fetch",vi.fn(async(_url:string,init?:RequestInit)=>{
      ++requests;
      const {mutations}=JSON.parse(String(init?.body)) as {mutations:Array<{clientMutationId:string;mutationType:string}>};
      return new Response(JSON.stringify({mutationResults:mutations.map(m=>({
        clientMutationId:m.clientMutationId,status:"RECEIVED"}))}),{status:200});
    }));
    await expect(enqueueAndConfirmMutation(queue,mutation(),target,true))
      .rejects.toBeInstanceOf(PendingMutationConfirmationError);
    const exchange=queue.build({businessId,branchId,mutationType:"EXCHANGE_CREATE",payload:{originalSaleId:saleId}});
    await expect(enqueueAndConfirmMutation(queue,exchange,target,true))
      .rejects.toMatchObject({code:"MUTATION_AWAITING_CONFIRMATION",existing:true});
    expect(requests).toBe(1);
    expect((await queue.getSnapshot(businessId)).pending).toHaveLength(1);
  });
  it("preserves offline operation but never closes the form as successful",async()=>{
    const {queue,mutation,target}=create();
    await expect(enqueueAndConfirmMutation(queue,mutation(),target,false))
      .rejects.toBeInstanceOf(PendingMutationConfirmationError);
    expect((await queue.getSnapshot(businessId)).pending).toHaveLength(1);
  });
  it("surfaces a specific server rejection without claiming a posted refund",async()=>{
    const {queue,mutation,target}=create();
    vi.stubGlobal("fetch",vi.fn(async(_url:string,init?:RequestInit)=>{
      const {mutations}=JSON.parse(String(init?.body)) as {mutations:Array<{clientMutationId:string;mutationType:string}>};
      return new Response(JSON.stringify({mutationResults:mutations.map(m=>({
        clientMutationId:m.clientMutationId,status:"REJECTED",
        errorCode:"RETURNABLE_QUANTITY_EXCEEDED",errorMessage:"Quantity already returned.",
      }))}),{status:200});
    }));
    await expect(enqueueAndConfirmMutation(queue,mutation(),target,true))
      .rejects.toThrow("Quantity already returned.");
    expect((await queue.getSnapshot(businessId)).failed).toHaveLength(1);
  });
  it("rechecks the same queued mutation without creating a second financial transaction",async()=>{
    const {queue,mutation,target}=create();
    let responses=0;
    vi.stubGlobal("fetch",vi.fn(async(_url:string,init?:RequestInit)=>{
      const {mutations}=JSON.parse(String(init?.body)) as {mutations:Array<{clientMutationId:string;mutationType:string}>};
      ++responses;
      return new Response(JSON.stringify({mutationResults:mutations.map(m=>({
        clientMutationId:m.clientMutationId,status:responses===1?"RECEIVED":"APPLIED",
      }))}),{status:200});
    }));
    const first=mutation();
    await expect(enqueueAndConfirmMutation(queue,first,target,true))
      .rejects.toMatchObject({mutationId:first.clientMutationId});
    const repeatedClick=mutation(); // newly constructed, but must NOT enqueue
    await expect(enqueueAndConfirmMutation(queue,repeatedClick,target,true,first.clientMutationId))
      .resolves.toBeUndefined();
    expect(responses).toBe(2);
    expect((await queue.getSnapshot(businessId)).pending).toHaveLength(0);
  });

  it("recognizes prior background sync completion without posting a second sale correction",async()=>{
    const {queue,mutation,target}=create();
    let status:"RECEIVED"|"APPLIED"="RECEIVED";
    let requests=0;
    vi.stubGlobal("fetch",vi.fn(async(_url:string,init?:RequestInit)=>{
      ++requests;
      const {mutations}=JSON.parse(String(init?.body)) as {mutations:Array<{clientMutationId:string;mutationType:string}>};
      return new Response(JSON.stringify({mutationResults:mutations.map(m=>({
        clientMutationId:m.clientMutationId,status,
      }))}),{status:200});
    }));
    const original=mutation();
    await expect(enqueueAndConfirmMutation(queue,original,target,true))
      .rejects.toBeInstanceOf(PendingMutationConfirmationError);
    status="APPLIED";
    await queue.flush({activeBusinessId:businessId,online:true});
    const after=mutation();
    await expect(enqueueAndConfirmMutation(queue,after,target,true,original.clientMutationId))
      .resolves.toBeUndefined();
    expect(requests).toBe(2); // no third sync or enqueue after background completion
    expect((await queue.getSnapshot(businessId)).pending).toHaveLength(0);
  });

  it("rejects overlapping submissions before the first durable queue write finishes",async()=>{
    const {queue,mutation,target}=create();
    let started!:()=>void;
    let release!:()=>void;
    const startedPromise=new Promise<void>(resolve=>{started=resolve;});
    const releasePromise=new Promise<void>(resolve=>{release=resolve;});
    let requests=0;
    vi.stubGlobal("fetch",vi.fn(async(_url:string,init?:RequestInit)=>{
      requests++;
      started();
      await releasePromise;
      const {mutations}=JSON.parse(String(init?.body)) as {mutations:Array<{clientMutationId:string}>};
      return new Response(JSON.stringify({mutationResults:mutations.map(m=>({
        clientMutationId:m.clientMutationId,status:"APPLIED",
      }))}),{status:200});
    }));
    const first=enqueueAndConfirmMutation(queue,mutation(),target,true);
    await startedPromise;
    await expect(enqueueAndConfirmMutation(queue,mutation(),target,true))
      .rejects.toBeInstanceOf(FinancialMutationInFlightError);
    expect((await queue.getSnapshot(businessId)).pending).toHaveLength(1);
    release();
    await first;
    expect(requests).toBe(1);
    expect((await queue.getSnapshot(businessId)).pending).toHaveLength(0);
  });
  it("releases in-flight protection after an offline attempt or rejection",async()=>{
    const {queue,mutation,target}=create();
    const first=mutation();
    await expect(enqueueAndConfirmMutation(queue,first,target,false))
      .rejects.toBeInstanceOf(PendingMutationConfirmationError);
    const next=mutation();
    await expect(enqueueAndConfirmMutation(queue,next,target,false))
      .rejects.toMatchObject({existing:true});
    expect((await queue.getSnapshot(businessId)).pending).toHaveLength(1);
  });

  it("scopes conflict checks by both business and branch",()=>{
    const {mutation,target}=create();
    const m=mutation();
    expect(findPendingTarget([m],target)?.clientMutationId).toBe(m.clientMutationId);
    expect(findPendingTarget([m],{...target,branchId:"different"})).toBeUndefined();
    expect(findPendingTarget([m],{...target,businessId:"different"})).toBeUndefined();
    expect(findPendingTarget([m],{...target,targetId:"another-sale"})).toBeUndefined();
  });
  it("handles a batch where a different queued transaction is rejected",async()=>{
    const {queue,mutation,target}=create();
    const unrelated=queue.build({businessId,branchId,mutationType:"CUSTOMER_CREATE",payload:{name:"Other"}});
    await queue.enqueue(unrelated);
    vi.stubGlobal("fetch",vi.fn(async(_url:string,init?:RequestInit)=>{
      const {mutations}=JSON.parse(String(init?.body)) as {mutations:Array<{clientMutationId:string;mutationType:string}>};
      return new Response(JSON.stringify({mutationResults:mutations.map(m=>({
        clientMutationId:m.clientMutationId,
        status:m.mutationType==="CUSTOMER_CREATE"?"REJECTED":"APPLIED",
        ...(m.mutationType==="CUSTOMER_CREATE"?{errorMessage:"Unrelated customer error"}:{}),
      }))}),{status:200});
    }));
    await expect(enqueueAndConfirmMutation(queue,mutation(),target,true)).resolves.toBeUndefined();
    expect((await queue.getSnapshot(businessId)).failed).toHaveLength(1);
  });
});
