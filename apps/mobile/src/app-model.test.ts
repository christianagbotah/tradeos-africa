import { describe, expect, it } from "vitest";
import type { FlushSummary, QueueState } from "@tradeos/client-core/sync-runtime";
import { MobileAppModel, safeMobileErrorMessage, canSubmitMobileSale } from "./app-model";
import type { MobileBootstrapState, MobileCommerceSnapshot, MobileSaleCaptureResult } from "./runtime";
import type { MobileCartLine, MobileImmediatePaymentMethod, MobileSellableItem } from "./pos-model";

const emptyQueue: QueueState = { pending: 0, blocked: 0, failed: 0 };
const ready: MobileBootstrapState = {
  status: "READY",
  user: { id: "user-1", displayName: "Ama Owner", email: "ama@example.com", phoneE164: null },
  membership: { id: "m1", businessId: "11111111-1111-4111-8111-111111111111", businessName: "Ama Shop", businessType: "RETAIL_HARDWARE", businessStatus: "ACTIVE", role: "OWNER", staffId: "staff-1" },
  business: { id: "11111111-1111-4111-8111-111111111111", name: "Ama Shop", businessType: "RETAIL_HARDWARE", countryCode: "GH", currencyCode: "GHS", timezone: "Africa/Accra", status: "ACTIVE" },
  branch: { id: "22222222-2222-4222-8222-222222222222", name: "Main", code: "MAIN", timezone: "Africa/Accra", active: true },
  queue: emptyQueue,
};

class FakeRuntime {
  bootstrapState: MobileBootstrapState = { status: "SIGNED_OUT", queue: emptyQueue };
  loginState: MobileBootstrapState = ready;
  flushCalls: boolean[] = [];
  commerceCalls: boolean[] = [];
  saleCalls: Array<{ cart: readonly MobileCartLine[]; paymentMethod: MobileImmediatePaymentMethod; online: boolean }> = [];
  logoutCalls = 0;
  logoutError: Error | null = null;
  queueState: QueueState = emptyQueue;
  commerceSnapshot: MobileCommerceSnapshot = {
    source: "LIVE", fetchedAt: "2026-10-10T23:50:00.000Z", warning: null,
    items: [{ key: "item-1:bag", itemId: "item-1", name: "Cement 50kg", sku: "CEM-50", kind: "PRODUCT", unitCode: "bag", unitLabel: "Bag", priceMinor: 12000, trackStock: true, stockUnitCode: "bag", availableStock: 28 }],
  };
  saleResult: MobileSaleCaptureResult = { clientMutationId: "sale-1", outcome: "SYNCED", queue: emptyQueue };
  flushSummary: FlushSummary = { ...emptyQueue, applied: 0, received: 0, rejected: 0, attempted: 0 };
  error: Error | null = null;

  async switchWorkspace() { if(this.error)throw this.error; if(this.loginState.status!=="READY")throw new Error("Not ready");return this.loginState; }
  async bootstrap() { if (this.error) throw this.error; return this.bootstrapState; }
  async login() { if (this.error) throw this.error; return this.loginState; }
  async flush(online: boolean) { this.flushCalls.push(online); return this.flushSummary; }
  async loadCommerce(online: boolean) { this.commerceCalls.push(online); if (this.error) throw this.error; return this.commerceSnapshot; }
  async createSale(cart: readonly MobileCartLine[], paymentMethod: MobileImmediatePaymentMethod, online: boolean) {
    this.saleCalls.push({ cart, paymentMethod, online });
    if (this.error) throw this.error;
    return this.saleResult;
  }
  async logout() { this.logoutCalls += 1; if(this.logoutError)throw this.logoutError; }
  async getQueueState() { return this.queueState; }
}

describe("MobileAppModel state transitions", () => {
  it("boots into signed-out and moves to ready after login", async () => {
    const runtime = new FakeRuntime();
    const model = new MobileAppModel(runtime);

    expect(model.snapshot.phase).toBe("BOOTING");
    expect((await model.start()).phase).toBe("SIGNED_OUT");
    const loggedIn = await model.login("ama@example.com", "password123");
    expect(loggedIn.phase).toBe("READY");
    expect(loggedIn.bootstrap).toEqual(ready);
  });

  it("represents authenticated users without a business as NEEDS_BUSINESS", async () => {
    const runtime = new FakeRuntime();
    runtime.bootstrapState = { status: "NEEDS_BUSINESS", user: ready.status === "READY" ? ready.user : never(), queue: emptyQueue };
    const model = new MobileAppModel(runtime);

    await expect(model.start()).resolves.toMatchObject({ phase: "NEEDS_BUSINESS" });
  });

  it("updates queue counts after a manual sync", async () => {
    const runtime = new FakeRuntime();
    runtime.bootstrapState = ready;
    runtime.flushSummary = { pending: 2, blocked: 1, failed: 1, applied: 3, received: 0, rejected: 1, attempted: 4 };
    const model = new MobileAppModel(runtime);
    await model.start();
    await model.connectivityChanged(true);

    const snapshot = await model.sync();

    expect(runtime.flushCalls).toEqual([true]);
    expect(snapshot.bootstrap).toMatchObject({ status: "READY", queue: { pending: 2, blocked: 1, failed: 1 } });
  });

  it("flushes automatically only when connectivity transitions from offline to reachable", async () => {
    const runtime = new FakeRuntime();
    runtime.bootstrapState = ready;
    const model = new MobileAppModel(runtime);
    await model.start();

    await model.connectivityChanged(true);
    await model.connectivityChanged(true);
    expect(runtime.flushCalls).toEqual([]);

    await model.connectivityChanged(false);
    await model.connectivityChanged(false);
    expect(runtime.flushCalls).toEqual([]);

    await model.connectivityChanged(true);
    expect(runtime.flushCalls).toEqual([true]);
  });

  it("requires retry when local sign-out fails and does not reopen the previous account", async()=>{
    const runtime=new FakeRuntime();
    runtime.bootstrapState=ready;
    runtime.logoutError=new Error("private storage error");
    const model=new MobileAppModel(runtime);
    await model.start();
    await model.loadCommerce();
    model.addCart(runtime.commerceSnapshot.items[0]!);
    const failed=await model.logout();
    expect(failed).toMatchObject({phase:"ERROR",bootstrap:null,commerce:null,cart:[]});
    expect(failed.error).toContain("Retry");
    expect(failed.error).not.toContain("private storage error");
    expect((await model.login("other","secret")).phase).toBe("ERROR");
    expect((await model.start()).phase).toBe("ERROR");
    runtime.logoutError=null;
    runtime.queueState={pending:1,blocked:1,failed:0};
    expect(await model.start()).toMatchObject({phase:"SIGNED_OUT",bootstrap:{status:"SIGNED_OUT",queue:runtime.queueState}});
    expect(runtime.logoutCalls).toBe(3);
  });

  it("signs out into a queue-aware local state", async () => {
    const runtime = new FakeRuntime();
    runtime.bootstrapState = ready;
    runtime.queueState = { pending: 2, blocked: 2, failed: 1 };
    const model = new MobileAppModel(runtime);
    await model.start();

    const snapshot = await model.logout();

    expect(runtime.logoutCalls).toBe(1);
    expect(snapshot).toMatchObject({ phase: "SIGNED_OUT", bootstrap: { status: "SIGNED_OUT", queue: runtime.queueState } });
  });
});

describe("safeMobileErrorMessage", () => {
  it("does not surface arbitrary exception text that may contain credentials", () => {
    const message = safeMobileErrorMessage(new Error("Bearer access-secret refresh-secret"));
    expect(message).not.toContain("access-secret");
    expect(message).not.toContain("refresh-secret");
    expect(message).toContain("TradeOS");
  });
});

function never(): never { throw new Error("unreachable"); }

describe("MobileAppModel commerce and cart", () => {
  async function readyModel(runtime = new FakeRuntime()) {
    runtime.bootstrapState = ready;
    const model = new MobileAppModel(runtime);
    await model.start();
    return { runtime, model };
  }

  it("loads live commerce and preserves a cached-data warning when runtime falls back", async () => {
    const { runtime, model } = await readyModel();
    let snapshot = await model.connectivityChanged(true);
    expect(runtime.commerceCalls).toEqual([true]);
    expect(snapshot.commerce).toMatchObject({ source: "LIVE", items: [{ key: "item-1:bag" }] });
    snapshot = await model.loadCommerce();
    expect(runtime.commerceCalls).toEqual([true, true]);
    expect(snapshot.commerce).toMatchObject({ source: "LIVE", items: [{ key: "item-1:bag" }] });

    runtime.commerceSnapshot = { ...runtime.commerceSnapshot, source: "CACHE", warning: "Live refresh failed. Showing last-known catalog and stock." };
    snapshot = await model.loadCommerce();
    expect(snapshot.commerce?.source).toBe("CACHE");
    expect(snapshot.commerce?.warning).toMatch(/last-known/i);
  });

  it("manages cart quantities and immediate payment selection in model state", async () => {
    const { model } = await readyModel();
    await model.loadCommerce();
    const item = model.snapshot.commerce!.items[0]!;

    model.addCart(item);
    model.addCart(item);
    expect(model.snapshot.cart).toMatchObject([{ key: "item-1:bag", quantity: 2 }]);
    model.setCartQuantity("item-1:bag", 3);
    expect(model.snapshot.cart[0]!.quantity).toBe(3);
    model.selectPaymentMethod("MOMO");
    expect(model.snapshot.paymentMethod).toBe("MOMO");
    model.removeCart("item-1:bag");
    expect(model.snapshot.cart).toEqual([]);
  });

  it("clears the cart after durable pending capture and updates queue counts", async () => {
    const { runtime, model } = await readyModel();
    await model.connectivityChanged(false);
    await model.loadCommerce();
    model.addCart(model.snapshot.commerce!.items[0]!);
    runtime.saleResult = { clientMutationId: "sale-pending", outcome: "PENDING", queue: { pending: 1, blocked: 0, failed: 0 } };

    const snapshot = await model.checkout();

    expect(runtime.saleCalls).toHaveLength(1);
    expect(runtime.saleCalls[0]).toMatchObject({ paymentMethod: "CASH", online: false });
    expect(snapshot.cart).toEqual([]);
    expect(snapshot.bootstrap).toMatchObject({ status: "READY", queue: { pending: 1 } });
    expect(snapshot.saleNotice).toMatchObject({ tone: "pending" });
  });

  it("shows a review notice for a server-rejected durably captured sale and still clears the cart", async () => {
    const { runtime, model } = await readyModel();
    await model.connectivityChanged(true);
    await model.loadCommerce();
    model.addCart(model.snapshot.commerce!.items[0]!);
    runtime.saleResult = {
      clientMutationId: "sale-review", outcome: "NEEDS_REVIEW", queue: { pending: 0, blocked: 0, failed: 1 },
      errorCode: "INSUFFICIENT_STOCK", errorMessage: "Stock changed before sync",
    };

    const snapshot = await model.checkout();

    expect(snapshot.cart).toEqual([]);
    expect(snapshot.bootstrap).toMatchObject({ status: "READY", queue: { failed: 1 } });
    expect(snapshot.saleNotice).toMatchObject({ tone: "review" });
    expect(snapshot.saleNotice?.message).toMatch(/stock changed/i);
  });

  it("keeps the cart when checkout fails before durable capture", async () => {
    const { runtime, model } = await readyModel();
    await model.loadCommerce();
    model.addCart(model.snapshot.commerce!.items[0]!);
    runtime.error = new Error("Bearer secret should not leak");

    const snapshot = await model.checkout();

    expect(snapshot.cart).toHaveLength(1);
    expect(snapshot.error).toContain("TradeOS");
    expect(snapshot.error).not.toContain("secret");
  });

  it("switches between Sell and Sync workspace views", async () => {
    const { model } = await readyModel();
    expect(model.snapshot.view).toBe("SELL");
    model.setView("SYNC");
    expect(model.snapshot.view).toBe("SYNC");
    model.setView("SELL");
    expect(model.snapshot.view).toBe("SELL");
  });
});

describe("workspace switch model",()=>{
 it("resets commerce and tender and rejects switching with an unsold cart",async()=>{
  const runtime=new FakeRuntime();runtime.bootstrapState=ready;
  const model=new MobileAppModel(runtime);await model.start();await model.connectivityChanged(true);
  model.addCart(runtime.commerceSnapshot.items[0]!);
  await expect(model.switchWorkspace("other","branch")).rejects.toThrow();
  model.removeCart(model.snapshot.cart[0]!.key);
  if(ready.status!=="READY")throw new Error("invalid fixture");
  runtime.loginState={...ready,business:{...ready.business,id:"other"},membership:{...ready.membership,businessId:"other"},branch:{...ready.branch,id:"branch"}};
  model.selectPaymentMethod("MOMO");
  const next=await model.switchWorkspace("other","branch");
  expect(next).toMatchObject({phase:"READY",cart:[],paymentMethod:"CASH",bootstrap:{business:{id:"other"},branch:{id:"branch"}}});
 });
});

describe("in-flight mobile scope guards",()=>{
  it("does not switch, restart or sign out during a delayed sync",async()=>{
    const runtime=new FakeRuntime();runtime.bootstrapState=ready;
    const model=new MobileAppModel(runtime);await model.start();await model.connectivityChanged(true);
    let finish!: (value:FlushSummary)=>void;
    runtime.flush=async()=>new Promise<FlushSummary>(resolve=>{finish=resolve});
    const operation=model.sync();
    expect(model.snapshot.syncing).toBe(true);
    await expect(model.switchWorkspace("other","branch")).rejects.toThrow();
    expect((await model.start()).phase).toBe("READY");
    expect((await model.logout()).phase).toBe("READY");
    expect(runtime.logoutCalls).toBe(0);
    finish(runtime.flushSummary);await operation;
    expect(model.snapshot.syncing).toBe(false);
    expect((await model.logout()).phase).toBe("SIGNED_OUT");
  });
  it("keeps a prepared cart during synchronization and resumes checkout exactly once",async()=>{
    const runtime=new FakeRuntime();runtime.bootstrapState=ready;
    const model=new MobileAppModel(runtime);await model.start();await model.connectivityChanged(true);
    model.addCart(runtime.commerceSnapshot.items[0]!);
    expect(canSubmitMobileSale(model.snapshot)).toBe(true);
    let finish!:(value:FlushSummary)=>void;
    runtime.flush=async()=>new Promise<FlushSummary>(resolve=>{finish=resolve});
    const pending=model.sync();
    expect(canSubmitMobileSale(model.snapshot)).toBe(false);
    const blocked=await model.checkout();
    expect(blocked.cart).toHaveLength(1);
    expect(blocked.saleNotice).toBeNull();
    expect(runtime.saleCalls).toHaveLength(0);
    finish(runtime.flushSummary);await pending;
    expect(canSubmitMobileSale(model.snapshot)).toBe(true);
    await model.checkout();
    expect(runtime.saleCalls).toHaveLength(1);
    expect(canSubmitMobileSale(model.snapshot)).toBe(false);
  });
  it("freezes cart and tender during checkout and prevents a duplicate submission",async()=>{
    const runtime=new FakeRuntime();runtime.bootstrapState=ready;
    const model=new MobileAppModel(runtime);await model.start();await model.connectivityChanged(true);
    const item=runtime.commerceSnapshot.items[0]!;
    model.addCart(item);
    let finish!:(value:MobileSaleCaptureResult)=>void;
    let calls=0;
    runtime.createSale=async()=>{calls++;return new Promise(resolve=>{finish=resolve});};
    const operation=model.checkout();
    model.addCart(item);model.setCartQuantity(item.key,4);model.selectPaymentMethod("MOMO");model.removeCart(item.key);
    expect(model.snapshot.cart[0]?.quantity).toBe(1);
    expect(model.snapshot.paymentMethod).toBe("CASH");
    await model.checkout();expect(calls).toBe(1);
    finish(runtime.saleResult);await operation;
    expect(model.snapshot.cart).toEqual([]);
  });
});


it("shows immediate receipt only for a confirmed completed sale",async()=>{
 const runtime=new FakeRuntime();runtime.bootstrapState=ready;
 const model=new MobileAppModel(runtime);await model.start();await model.connectivityChanged(true);
 const item=runtime.commerceSnapshot.items[0]!;
 model.addCart(item);
 runtime.saleResult={...runtime.saleResult,completedSaleId:"12345678-1234-4123-8123-123456789012"};
 expect((await model.checkout()).saleNotice).toMatchObject({tone:"success",completedSaleId:runtime.saleResult.completedSaleId});
 model.addCart(item);expect(model.snapshot.saleNotice).toBeNull();
 runtime.saleResult={...runtime.saleResult,outcome:"PENDING"};
 expect((await model.checkout()).saleNotice?.completedSaleId).toBeUndefined();
});
