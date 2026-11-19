import { afterEach, describe, expect, it, vi } from "vitest";
import { WebOfflineQueue, type WebSession } from "./offline-sync";

const businessId="11111111-1111-4111-8111-111111111111";
class Storage {
  private values=new Map<string,string>();
  getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){this.values.set(key,value);}
  removeItem(key:string){this.values.delete(key);}
}
function createQueue() {
  const seen:Array<{tone:string;message:string}>=[];
  vi.stubGlobal("window", {
    localStorage: new Storage(),
    dispatchEvent: (event:CustomEvent<{tone:string;message:string}>)=>{
      seen.push(event.detail);
      return true;
    }
  });
  // Node environments do not always provide CustomEvent.
  vi.stubGlobal("CustomEvent", class CustomEventStub {
    detail:unknown;
    constructor(_name:string, options:{detail:unknown}){this.detail=options.detail;}
  });
  let next=0;
  const queue=new WebOfflineQueue({
    now:()=>new Date("2026-11-19T00:00:00Z").toISOString(),
    createMutationId:()=>`mutation-${++next}`,
  });
  const session:WebSession={
    accessToken:"test-token",refreshToken:"refresh-token",
    businessId,branchId:"22222222-2222-4222-8222-222222222222",
    clientId:"test-device",staffId:"staff-1",
    currencyCode:"GHS",timezone:"Africa/Accra",
    businessName:"UAT Test",role:"OWNER",displayName:"Owner",
  };
  queue.sessions.save(session);
  return {queue,seen};
}
async function enqueue(queue:WebOfflineQueue,name:string) {
  await queue.enqueue(queue.build({
    businessId,mutationType:"SUPPLIER_CREATE",payload:{name},
  }));
}
afterEach(()=>vi.unstubAllGlobals());

describe("interactive offline mutation notifications must reflect actual server status",()=>{
  it("reports APPLIED as saved only once the server confirms it",async()=>{
    const {queue,seen}=createQueue();
    await enqueue(queue,"Applied Supplier");
    vi.stubGlobal("fetch",vi.fn(async (_url:string,init?:RequestInit)=>{
      const {mutations}=JSON.parse(String(init?.body)) as {mutations:Array<{clientMutationId:string}>};
      return new Response(JSON.stringify({
        mutationResults:mutations.map(m=>({
          clientMutationId:m.clientMutationId,status:"APPLIED",result:{supplierId:"sup-1"}
        }))
      }),{status:200,headers:{"content-type":"application/json"}});
    }));
    const summary=await queue.flushOrThrow({activeBusinessId:businessId,online:true});
    expect(summary.applied).toBe(1);
    expect(summary.pending).toBe(0);
    expect(seen).toEqual([{tone:"success",message:"Changes saved successfully."}]);
  });

  it("does not imply that RECEIVED is posted or paid",async()=>{
    const {queue,seen}=createQueue();
    await enqueue(queue,"Pending Supplier");
    vi.stubGlobal("fetch",vi.fn(async (_url:string,init?:RequestInit)=>{
      const {mutations}=JSON.parse(String(init?.body)) as {mutations:Array<{clientMutationId:string}>};
      return new Response(JSON.stringify({
        mutationResults:mutations.map(m=>({clientMutationId:m.clientMutationId,status:"RECEIVED"}))
      }),{status:200,headers:{"content-type":"application/json"}});
    }));
    const summary=await queue.flushOrThrow({activeBusinessId:businessId,online:true});
    expect(summary.applied).toBe(0);
    expect(summary.received).toBe(1);
    expect(summary.pending).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tone).toBe("warning");
    expect(seen[0]?.message).toMatch(/has not confirmed this change as applied/i);
    expect(seen[0]?.message).not.toMatch(/saved successfully|paid|posted/i);
  });

  it("reports offline persistence as pending rather than completed",async()=>{
    const {queue,seen}=createQueue();
    await enqueue(queue,"Offline Supplier");
    const summary=await queue.flushOrThrow({activeBusinessId:businessId,online:false});
    expect(summary.pending).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tone).toBe("warning");
    expect(seen[0]?.message).toMatch(/saved on this device/i);
  });

  it("shows a warning when some changes apply but others stay pending",async()=>{
    const {queue,seen}=createQueue();
    await enqueue(queue,"Applied Supplier");
    await enqueue(queue,"Pending Supplier");
    vi.stubGlobal("fetch",vi.fn(async (_url:string,init?:RequestInit)=>{
      const {mutations}=JSON.parse(String(init?.body)) as {mutations:Array<{clientMutationId:string}>};
      return new Response(JSON.stringify({
        mutationResults:mutations.map((m,i)=>({
          clientMutationId:m.clientMutationId,status:i===0?"APPLIED":"RECEIVED",
        }))
      }),{status:200,headers:{"content-type":"application/json"}});
    }));
    const summary=await queue.flushOrThrow({activeBusinessId:businessId,online:true});
    expect(summary.applied).toBe(1);
    expect(summary.received).toBe(1);
    expect(summary.pending).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tone).toBe("warning");
    expect(seen[0]?.message).toMatch(/still awaiting server processing or sync/i);
  });
});
