import { afterEach, describe, expect, it, vi } from "vitest";
import { WebOfflineQueue, type WebSession } from "./offline-sync";

const QUEUE_KEY = "tradeos.web.mutationQueue.v1";

class FakeLocalStorage {
  private readonly values = new Map<string, string>();
  failQueueWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failQueueWrites && (key === QUEUE_KEY || key.startsWith("tradeos.web.mutationQueue.v2."))) {
      throw new Error("quota exceeded");
    }
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function session(businessId: string, accessToken = "token-1"): WebSession {
  return {
    accessToken,
    refreshToken: "refresh-1",
    clientId: "web-client-1",
    businessId,
    branchId: "branch-1",
    staffId: "staff-1",
    currencyCode: "GHS",
    timezone: "Africa/Accra",
    businessName: `Business ${businessId}`,
    role: "OWNER",
    displayName: "Owner",
  };
}

function makeQueue(): WebOfflineQueue {
  let mutationNumber = 0;
  return new WebOfflineQueue({
    now: () => "2026-10-13T14:00:00.000Z",
    createMutationId: () => `mutation-${++mutationNumber}`,
  });
}

function installWindow(storage: FakeLocalStorage): void {
  vi.stubGlobal("window", { localStorage: storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebOfflineQueue durable storage boundary", () => {
  it("rejects enqueue when the browser cannot durably persist the mutation", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a"));
    storage.failQueueWrites = true;

    const mutation = queue.build({
      businessId: "business-a",
      branchId: "branch-1",
      mutationType: "CUSTOMER_PAYMENT_CREATE",
      payload: { customerId: "customer-1", amountMinor: 1000, method: "CASH" },
    });

    await expect(queue.enqueue(mutation)).rejects.toThrow("Offline mutation persistence failed");
  });
});

describe("WebOfflineQueue business isolation", () => {
  it("preserves independent queues when the active session switches businesses", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a"));

    await queue.enqueue(queue.build({
      businessId: "business-a",
      branchId: "branch-a",
      mutationType: "CUSTOMER_PAYMENT_CREATE",
      payload: { customerId: "customer-a", amountMinor: 1000, method: "CASH" },
    }));
    expect((await queue.getSnapshot("business-a")).pending).toHaveLength(1);

    queue.sessions.save(session("business-b", "token-2"));
    expect((await queue.getSnapshot("business-b")).pending).toHaveLength(0);
    expect((await queue.getSnapshot("business-a")).pending).toHaveLength(1);

    await queue.enqueue(queue.build({
      businessId: "business-b",
      branchId: "branch-b",
      mutationType: "CUSTOMER_PAYMENT_CREATE",
      payload: { customerId: "customer-b", amountMinor: 2000, method: "CASH" },
    }));
    expect((await queue.getSnapshot("business-b")).pending).toHaveLength(1);

    queue.sessions.save(session("business-a", "token-3"));
    expect((await queue.getSnapshot()).pending[0]?.businessId).toBe("business-a");
    expect((await queue.getSnapshot("business-b")).pending[0]?.businessId).toBe("business-b");
  });

  it("preserves business-scoped queued work when the user signs out", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a"));

    await queue.enqueue(queue.build({
      businessId: "business-a",
      branchId: "branch-a",
      mutationType: "CUSTOMER_PAYMENT_CREATE",
      payload: { customerId: "customer-1", amountMinor: 1000, method: "CASH" },
    }));

    queue.sessions.clear();

    expect(queue.sessions.load()).toBeNull();
    expect(queue.sessions.loadLastContext()).toEqual({ businessId: "business-a", branchId: "branch-1" });
    expect((await queue.getSnapshot("business-a")).pending).toHaveLength(1);
  });

  it("migrates a legacy v1 snapshot into the matching business bucket", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    storage.setItem(QUEUE_KEY, JSON.stringify({
      pending: [{
        clientId: "legacy-client",
        clientMutationId: "legacy-mutation",
        businessId: "business-legacy",
        branchId: "branch-legacy",
        mutationType: "CUSTOMER_CREATE",
        occurredAt: "2026-10-13T12:00:00.000Z",
        payload: { name: "Legacy Customer" },
      }],
      failed: [],
    }));
    const queue = makeQueue();

    expect((await queue.getSnapshot("business-legacy")).pending[0]?.clientMutationId).toBe("legacy-mutation");
    expect(storage.getItem(QUEUE_KEY)).toBeNull();
  });

  it("flushes only the active business queue", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    const businessA = "11111111-1111-4111-8111-111111111111";
    const businessB = "22222222-2222-4222-8222-222222222222";
    queue.sessions.save(session(businessA, "token-a"));
    await queue.enqueue(queue.build({ businessId: businessA, mutationType: "SUPPLIER_CREATE", payload: { name: "A Supplier" } }));

    queue.sessions.save(session(businessB, "token-b"));
    await queue.enqueue(queue.build({ businessId: businessB, mutationType: "SUPPLIER_CREATE", payload: { name: "B Supplier" } }));

    const pushedBusinessIds: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { mutations: Array<{ businessId: string; clientMutationId: string }> };
      pushedBusinessIds.push(...body.mutations.map((mutation) => mutation.businessId));
      return new Response(JSON.stringify({
        mutationResults: body.mutations.map((mutation) => ({ clientMutationId: mutation.clientMutationId, status: "APPLIED" })),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const result = await queue.flush({ activeBusinessId: businessB, online: true });

    expect(result.applied).toBe(1);
    expect(pushedBusinessIds).toEqual([businessB]);
    expect((await queue.getSnapshot(businessA)).pending).toHaveLength(1);
    expect((await queue.getSnapshot(businessB)).pending).toHaveLength(0);
  });

  it("preserves queued mutations when the same business merely refreshes its session", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a"));

    await queue.enqueue(queue.build({
      businessId: "business-a",
      branchId: "branch-a",
      mutationType: "CUSTOMER_PAYMENT_CREATE",
      payload: { customerId: "customer-1", amountMinor: 1000, method: "CASH" },
    }));

    queue.sessions.save(session("business-a", "refreshed-token"));

    expect((await queue.getSnapshot()).pending).toHaveLength(1);
  });
});

describe("WebOfflineQueue access-token recovery", () => {
  it("refreshes an expired access token and retries an authenticated request once", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a", "expired-access"));
    const calls: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, auth: headers.get("authorization") });
      if (url === "/v1/auth/refresh") {
        return new Response(JSON.stringify({ session: { accessToken: "fresh-access", refreshToken: "fresh-refresh", clientId: "web-client-1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (headers.get("authorization") === "Bearer expired-access") {
        return new Response(JSON.stringify({ error: "ACCESS_REJECTED", message: "Access token is expired or revoked" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const response = await queue.authenticatedFetch("/v1/suppliers?businessId=business-a");

    expect(response.status).toBe(200);
    expect(queue.sessions.load()?.accessToken).toBe("fresh-access");
    expect(queue.sessions.load()?.refreshToken).toBe("fresh-refresh");
    expect(calls.filter((call) => call.url === "/v1/auth/refresh")).toHaveLength(1);
    expect(calls.at(-1)?.auth).toBe("Bearer fresh-access");
  });

  it("refreshes and retries the offline sync transport instead of rejecting queued work", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    const businessId = "11111111-1111-4111-8111-111111111111";
    queue.sessions.save(session(businessId, "expired-access"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url === "/v1/auth/refresh") {
        return new Response(JSON.stringify({ session: { accessToken: "fresh-access", refreshToken: "fresh-refresh", clientId: "web-client-1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (headers.get("authorization") === "Bearer expired-access") {
        return new Response(JSON.stringify({ error: "ACCESS_REJECTED", message: "Access token is expired or revoked" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ mutationResults: [{ clientMutationId: "mutation-1", status: "APPLIED", result: { supplierId: "supplier-1" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    await queue.enqueue(queue.build({ businessId, mutationType: "SUPPLIER_CREATE", payload: { name: "UAT Supplier" } }));

    const result = await queue.flush({ activeBusinessId: businessId, online: true });

    expect(result.applied).toBe(1);
    expect((await queue.getSnapshot()).pending).toHaveLength(0);
    expect(queue.sessions.load()?.accessToken).toBe("fresh-access");
  });

  it("never retries a rejected old request using a different cashier on the same device and business",async()=>{
    installWindow(new FakeLocalStorage());
    const queue=makeQueue();queue.sessions.save(session("business-a","old-access"));
    const replacement={...session("business-a","new-access"),staffId:"staff-2",refreshToken:"new-refresh"};
    const transport=vi.fn(async (_input:unknown,_init?:RequestInit)=>{
      queue.sessions.save(replacement);
      return new Response(JSON.stringify({error:"ACCESS_REJECTED"}),{status:401});
    });
    vi.stubGlobal("fetch",transport);
    await expect(queue.authenticatedFetch("/v1/sync",{method:"POST",body:"{}"})).rejects.toThrow("account or workspace changed");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(queue.sessions.load()).toEqual(replacement);
  });

  it("does not restore credentials after sign-out or branch switching during refresh",async()=>{
    for(const change of ["sign-out","branch-switch","account-switch"]){
      installWindow(new FakeLocalStorage());
      const queue=makeQueue();const original=session("business-a","old-access");queue.sessions.save(original);
      let release!:(value:Response)=>void;let started!:()=>void;
      const refreshStarted=new Promise<void>(resolve=>{started=resolve;});
      const deferred=new Promise<Response>(resolve=>{release=resolve;});
      const transport=vi.fn(async (input:unknown,_init?:RequestInit)=>{
        if(String(input)==="/v1/auth/refresh"){started();return deferred;}
        return new Response(JSON.stringify({error:"ACCESS_REJECTED"}),{status:401});
      });
      vi.stubGlobal("fetch",transport);
      const pending=queue.authenticatedFetch("/v1/sync",{method:"POST",body:"{}"});
      await refreshStarted;
      const replacement=change==="sign-out"?null:change==="branch-switch"?{...original,branchId:"branch-2"}:
        {...original,staffId:"staff-2",accessToken:"other-access",refreshToken:"other-refresh"};
      queue.sessions.save(replacement);
      release(new Response(JSON.stringify({session:{accessToken:"late-access",refreshToken:"late-refresh",clientId:original.clientId}}),{status:200}));
      await expect(pending).rejects.toThrow("account or workspace changed");
      expect(queue.sessions.load()).toEqual(replacement);
      expect(transport).toHaveBeenCalledTimes(2);
    }
  });

  it("shows a friendly session-expired error when the refresh token is also rejected", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    queue.sessions.save(session("business-a", "expired-access"));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input) === "/v1/auth/refresh") {
        return new Response(JSON.stringify({ error: "REFRESH_REJECTED", message: "Refresh token is expired or revoked" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "ACCESS_REJECTED", message: "Access token is expired or revoked" }), { status: 401, headers: { "content-type": "application/json" } });
    }));

    await expect(queue.authenticatedFetch("/v1/suppliers?businessId=business-a")).rejects.toThrow("Your session has expired. Please sign in again.");
  });
});

describe("WebOfflineQueue UI mutation rejection visibility", () => {
  it("throws the server rejection message while preserving the failed mutation for retry", async () => {
    const storage = new FakeLocalStorage();
    installWindow(storage);
    const queue = makeQueue();
    const businessId = "22222222-2222-4222-8222-222222222222";
    queue.sessions.save(session(businessId, "fresh-access"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      mutationResults: [{
        clientMutationId: "mutation-1",
        status: "REJECTED",
        errorCode: "SUPPLIER_INVALID",
        errorMessage: "Supplier phone number is invalid.",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    await queue.enqueue(queue.build({ businessId, mutationType: "SUPPLIER_CREATE", payload: { name: "Bad Supplier" } }));

    await expect(queue.flushOrThrow({ activeBusinessId: businessId, online: true }))
      .rejects.toThrow("Supplier phone number is invalid.");

    const snapshot = await queue.getSnapshot();
    expect(snapshot.pending).toHaveLength(0);
    expect(snapshot.failed).toHaveLength(1);
  });
});

describe("cash charge durable recovery",()=>{
  const businessId="11111111-1111-4111-8111-111111111111";
  const branchId="22222222-2222-4222-8222-222222222222";
  const saleId="33333333-3333-4333-8333-333333333333";
  function cash(queue:WebOfflineQueue){
    queue.sessions.save({...session(businessId),branchId});
    return queue.build({businessId,branchId,mutationType:"SALE_CREATE",
      payload:{paymentMethod:"CASH",currencyCode:"GHS",lines:[{itemId:"item",saleUnitCode:"piece",quantity:1,expectedUnitPriceMinor:1000}]}});
  }
  it("does not transmit cash when durable storage fails",async()=>{
    const storage=new FakeLocalStorage();installWindow(storage);
    const queue=makeQueue();const mutation=cash(queue);
    const transport=vi.fn();vi.stubGlobal("fetch",transport);
    storage.failQueueWrites=true;
    await expect(queue.submitDurableCashSale(mutation,true)).rejects.toThrow("Offline mutation persistence failed");
    expect(transport).not.toHaveBeenCalled();
  });
  it("persists before transport; a lost response and restart reuse the original identity and price",async()=>{
    const storage=new FakeLocalStorage();installWindow(storage);
    const queue=makeQueue();const mutation=cash(queue);
    const posted=new Set<string>();const requests:unknown[]=[];
    vi.stubGlobal("fetch",vi.fn(async (_input:unknown,init?:RequestInit)=>{
      const m=JSON.parse(String(init?.body)).mutations[0];
      expect(JSON.parse(storage.getItem("tradeos.web.mutationQueue.v2."+businessId)!).pending[0]).toEqual(m);
      requests.push(m);
      if(!posted.has(m.clientMutationId)){
        posted.add(m.clientMutationId);
        throw new TypeError("Network response lost after posting");
      }
      return new Response(JSON.stringify({mutationResults:[{clientMutationId:m.clientMutationId,status:"APPLIED",
        result:{saleId,status:"COMPLETED",totalMinor:1000}}]}),{status:200});
    }));
    expect(await queue.submitDurableCashSale(mutation,true)).toEqual({status:"pending"});
    expect((await queue.getSnapshot()).pending).toEqual([mutation]);
    const restarted=makeQueue();
    expect((await restarted.getSnapshot()).pending).toEqual([mutation]);
    expect(await restarted.submitDurableCashSale(mutation,true)).toEqual({status:"completed",saleId,totalMinor:1000});
    expect(requests).toEqual([mutation,mutation]);
    expect(posted.size).toBe(1);
    expect((await restarted.getSnapshot()).pending).toHaveLength(0);
  });
  it("does not claim a rejected or incomplete server response as a sale",async()=>{
    const storage=new FakeLocalStorage();installWindow(storage);
    const queue=makeQueue();const mutation=cash(queue);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({mutationResults:[{
      clientMutationId:mutation.clientMutationId,status:"REJECTED",errorCode:"SALE_PRICE_CHANGED_REVIEW_REQUIRED"}]}),{status:200})));
    expect(await queue.submitDurableCashSale(mutation,true)).toEqual({status:"rejected",message:"SALE_PRICE_CHANGED_REVIEW_REQUIRED"});
    expect((await queue.getSnapshot()).failed).toHaveLength(1);
  });
  it("rejects a cash submission in another branch and never sends it",async()=>{
    const storage=new FakeLocalStorage();installWindow(storage);
    const queue=makeQueue();const mutation=cash(queue);
    const transport=vi.fn();vi.stubGlobal("fetch",transport);
    await expect(queue.submitDurableCashSale({...mutation,branchId:"wrong"},true)).rejects.toThrow("scope");
    expect(transport).not.toHaveBeenCalled();
  });
});
