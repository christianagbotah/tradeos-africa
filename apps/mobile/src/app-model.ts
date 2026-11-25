import type { QueueState } from "@tradeos/client-core/sync-runtime";
import { MobileApiError, SessionExpiredError } from "./api-client";
import {
  MobileRuntimeError,
  MobileRuntimeBusyError,
  type MobileBootstrapState,
  type MobileCommerceSnapshot,
  type MobileReadyState,
  type MobileRuntime,
} from "./runtime";
import {
  addCartItem,
  removeCartLine,
  setCartQuantity as updateCartQuantity,
  type MobileCartLine,
  type MobileImmediatePaymentMethod,
  type MobileSellableItem,
} from "./pos-model";
import { QueueStorageCorruptError } from "./storage";

type AppRuntime = Pick<MobileRuntime, "bootstrap" | "login" | "flush" | "loadCommerce" | "createSale" | "logout" | "getQueueState" | "switchWorkspace">;

export type MobileAppPhase = "BOOTING" | "SIGNED_OUT" | "NEEDS_BUSINESS" | "READY" | "ERROR";

export type MobileWorkspaceView = "SELL" | "SYNC";
export type MobileSaleNotice = { tone: "success" | "pending" | "review"; message: string; completedSaleId?:string };

export type MobileAppSnapshot = {
  phase: MobileAppPhase;
  bootstrap: MobileBootstrapState | null;
  error: string | null;
  online: boolean | null;
  syncing: boolean;
  view: MobileWorkspaceView;
  commerce: MobileCommerceSnapshot | null;
  commerceLoading: boolean;
  cart: MobileCartLine[];
  paymentMethod: MobileImmediatePaymentMethod;
  checkoutBusy: boolean;
  saleNotice: MobileSaleNotice | null;
};

const emptyQueue: QueueState = { pending: 0, blocked: 0, failed: 0 };

export class MobileAppModel {
  private commerceGeneration=0;
  private sessionGeneration=0;
  private transitionBusy=false;
  private sameScope(ready:MobileReadyState,generation:number):boolean{
    const active=this.state.bootstrap;
    return generation===this.sessionGeneration&&this.state.phase==="READY"&&active?.status==="READY"&&
      active.user.id===ready.user.id&&active.business.id===ready.business.id&&active.branch.id===ready.branch.id&&
      active.membership.staffId===ready.membership.staffId&&active.membership.role===ready.membership.role;
  }
  private state: MobileAppSnapshot = {
    phase: "BOOTING",
    bootstrap: null,
    error: null,
    online: null,
    syncing: false,
    view: "SELL",
    commerce: null,
    commerceLoading: false,
    cart: [],
    paymentMethod: "CASH",
    checkoutBusy: false,
    saleNotice: null,
  };

  constructor(private readonly runtime: AppRuntime) {}

  get snapshot(): MobileAppSnapshot {
    return { ...this.state };
  }

  async start(): Promise<MobileAppSnapshot> {
    if(this.transitionBusy||this.state.checkoutBusy||this.state.syncing)return this.snapshot;
    this.transitionBusy=true;++this.sessionGeneration;++this.commerceGeneration;
    this.state = { ...this.state, phase: "BOOTING", error: null, syncing: false };
    try {
      const next = this.applyBootstrap(await this.runtime.bootstrap());
      if (next.phase === "READY" && next.online !== null) return this.loadCommerce();
      return next;
    } catch (error) {
      this.state = { ...this.state, phase: "ERROR", bootstrap: null, error: safeMobileErrorMessage(error), syncing: false };
      return this.snapshot;
    } finally {this.transitionBusy=false;}
  }

  async switchWorkspace(businessId:string,branchId:string):Promise<MobileAppSnapshot>{
    if(this.transitionBusy||this.state.phase!=="READY"||this.state.bootstrap?.status!=="READY"||this.state.online!==true||this.state.checkoutBusy||this.state.syncing||this.state.cart.length)
      throw new MobileRuntimeError("Connect online, finish the current cart and wait for synchronization before switching.");
    const previous=this.state.bootstrap;
    if(previous.business.id===businessId&&previous.branch.id===branchId)return this.snapshot;
    this.transitionBusy=true;++this.sessionGeneration;++this.commerceGeneration;
    this.state={...this.state,phase:"BOOTING",commerce:null,commerceLoading:false,error:null,saleNotice:null};
    try{
      const next=await this.runtime.switchWorkspace(businessId,branchId);
      this.state={...this.state,cart:[],paymentMethod:"CASH",view:"SELL",saleNotice:null};
      this.applyBootstrap(next);
      return this.loadCommerce();
    }catch(error){
      this.state={...this.state,phase:error instanceof SessionExpiredError?"ERROR":"READY",bootstrap:error instanceof SessionExpiredError?null:previous,commerce:null,commerceLoading:false,error:safeMobileErrorMessage(error)};
      throw error;
    } finally {this.transitionBusy=false;}
  }

  async login(identifier: string, password: string): Promise<MobileAppSnapshot> {
    if(this.transitionBusy||this.state.checkoutBusy||this.state.syncing||this.state.phase==="READY")return this.snapshot;
    this.transitionBusy=true;++this.sessionGeneration;++this.commerceGeneration;
    this.state = { ...this.state, phase: "BOOTING", error: null, syncing: false };
    try {
      const next = this.applyBootstrap(await this.runtime.login(identifier, password));
      if (next.phase === "READY" && next.online !== null) return this.loadCommerce();
      return next;
    } catch (error) {
      const queue = await this.safeQueueState();
      this.state = {
        ...this.state,
        phase: "SIGNED_OUT",
        bootstrap: { status: "SIGNED_OUT", queue },
        error: safeMobileErrorMessage(error),
        syncing: false,
      };
      return this.snapshot;
    } finally {this.transitionBusy=false;}
  }

  async loadCommerce(): Promise<MobileAppSnapshot> {
    if (this.state.phase !== "READY" || this.state.bootstrap?.status !== "READY") return this.snapshot;
    const generation=++this.commerceGeneration;
    this.state = { ...this.state, commerceLoading: true, error: null };
    try {
      const commerce = await this.runtime.loadCommerce(this.state.online === true);
      if(generation===this.commerceGeneration&&this.state.phase==="READY")this.state = { ...this.state, commerce, commerceLoading: false };
    } catch (error) {
      if(generation===this.commerceGeneration&&this.state.phase==="READY")this.state = { ...this.state, commerceLoading: false, error: safeMobileErrorMessage(error) };
    }
    return this.snapshot;
  }

  setView(view: MobileWorkspaceView): MobileAppSnapshot {
    this.state = { ...this.state, view };
    return this.snapshot;
  }

  addCart(item: MobileSellableItem): MobileAppSnapshot {
    if(this.transitionBusy||this.state.phase!=="READY"||this.state.checkoutBusy)return this.snapshot;
    this.state = { ...this.state, cart: addCartItem(this.state.cart, item), saleNotice: null, error: null };
    return this.snapshot;
  }

  setCartQuantity(key: string, quantity: number): MobileAppSnapshot {
    if(this.transitionBusy||this.state.phase!=="READY"||this.state.checkoutBusy)return this.snapshot;
    this.state = { ...this.state, cart: updateCartQuantity(this.state.cart, key, quantity), saleNotice: null, error: null };
    return this.snapshot;
  }

  removeCart(key: string): MobileAppSnapshot {
    if(this.transitionBusy||this.state.phase!=="READY"||this.state.checkoutBusy)return this.snapshot;
    this.state = { ...this.state, cart: removeCartLine(this.state.cart, key), saleNotice: null, error: null };
    return this.snapshot;
  }

  selectPaymentMethod(paymentMethod: MobileImmediatePaymentMethod): MobileAppSnapshot {
    if(this.transitionBusy||this.state.phase!=="READY"||this.state.checkoutBusy)return this.snapshot;
    this.state = { ...this.state, paymentMethod, saleNotice: null, error: null };
    return this.snapshot;
  }

  async checkout(): Promise<MobileAppSnapshot> {
    if (this.transitionBusy || this.state.phase !== "READY" || this.state.bootstrap?.status !== "READY" || this.state.cart.length === 0 || this.state.checkoutBusy || this.state.syncing) {
      return this.snapshot;
    }
    const currentReady = this.state.bootstrap;
    const generation=this.sessionGeneration;
    const cart = this.state.cart;
    const paymentMethod = this.state.paymentMethod;
    this.state = { ...this.state, checkoutBusy: true, error: null, saleNotice: null };
    try {
      const result = await this.runtime.createSale(cart, paymentMethod, this.state.online === true);
      if(!this.sameScope(currentReady,generation))return this.snapshot;
      const ready: MobileReadyState = { ...this.state.bootstrap as MobileReadyState, queue: result.queue };
      const saleNotice: MobileSaleNotice = result.outcome === "SYNCED"
        ? { tone: "success", message: "Sale completed and synchronized.", ...(result.completedSaleId?{completedSaleId:result.completedSaleId}:{}) }
        : result.outcome === "PENDING"
          ? { tone: "pending", message: "Sale saved on this device · pending sync." }
          : { tone: "review", message: `Sale saved · needs review${result.errorMessage ? `: ${result.errorMessage}` : "."}` };
      this.state = {
        ...this.state,
        bootstrap: ready,
        cart: [],
        checkoutBusy: false,
        saleNotice,
        error: null,
      };
    } catch (error) {
      if(this.sameScope(currentReady,generation))this.state = { ...this.state, checkoutBusy: false, error: safeMobileErrorMessage(error) };
    }
    return this.snapshot;
  }

  /** Reflect durable queue evidence without issuing a second write request. */
  async refreshQueueState():Promise<MobileAppSnapshot>{
    const current=this.state.bootstrap;
    if(this.state.phase!=="READY"||current?.status!=="READY")return this.snapshot;
    const generation=this.sessionGeneration;
    const queue=await this.runtime.getQueueState();
    if(generation===this.sessionGeneration&&this.state.phase==="READY"&&this.state.bootstrap?.status==="READY"&&this.state.bootstrap.membership.businessId===current.membership.businessId&&this.state.bootstrap.branch.id===current.branch.id&&this.state.bootstrap.user.id===current.user.id){
      this.state={...this.state,bootstrap:{...this.state.bootstrap,queue}};
    }
    return this.snapshot;
  }

  async sync(): Promise<MobileAppSnapshot> {
    if (this.transitionBusy||this.state.syncing||this.state.checkoutBusy||this.state.phase !== "READY" || this.state.bootstrap?.status !== "READY") return this.snapshot;
    const currentReady = this.state.bootstrap;
    const generation=this.sessionGeneration;
    this.state = { ...this.state, syncing: true, error: null };
    try {
      const summary = await this.runtime.flush(this.state.online === true);
      if(!this.sameScope(currentReady,generation))return this.snapshot;
      const ready: MobileReadyState = {
        ...this.state.bootstrap as MobileReadyState,
        queue: { pending: summary.pending, blocked: summary.blocked, failed: summary.failed },
      };
      this.state = { ...this.state, phase: "READY", bootstrap: ready, syncing: false };
    } catch (error) {
      if(this.sameScope(currentReady,generation))this.state = { ...this.state, error: safeMobileErrorMessage(error), syncing: false };
    }
    return this.snapshot;
  }

  async connectivityChanged(online: boolean): Promise<MobileAppSnapshot> {
    const previous = this.state.online;
    this.state = { ...this.state, online };
    if (this.state.phase !== "READY") return this.snapshot;
    if (previous === false && online) {
      await this.sync();
      if (this.state.view === "SELL") return this.loadCommerce();
      return this.snapshot;
    }
    if (previous === null && this.state.commerce === null) return this.loadCommerce();
    return this.snapshot;
  }

  async logout(): Promise<MobileAppSnapshot> {
    if(this.transitionBusy||this.state.checkoutBusy||this.state.syncing){
      this.state={...this.state,error:"Wait for the current transaction or synchronization before signing out."};
      return this.snapshot;
    }
    const previous=this.state;
    let blocked=false;
    this.transitionBusy=true;++this.sessionGeneration;++this.commerceGeneration;
    this.state={...this.state,phase:"BOOTING",commerce:null,commerceLoading:false};
    try {
      await this.runtime.logout();
    } catch(error){
      if(error instanceof MobileRuntimeBusyError){
        blocked=true;this.state={...previous,error:error.message,commerceLoading:false};
      }
      // Runtime always clears the local session for a non-busy logout.
    } finally {
      if(!blocked){
      const queue = await this.safeQueueState();
      this.state = {
        ...this.state,
        phase: "SIGNED_OUT",
        bootstrap: { status: "SIGNED_OUT", queue },
        error: null,
        syncing: false,
        view: "SELL",
        commerce: null,
        commerceLoading: false,
        cart: [],
        paymentMethod: "CASH",
        checkoutBusy: false,
        saleNotice: null,
      };
      }
      this.transitionBusy=false;
    }
    return this.snapshot;
  }

  private applyBootstrap(bootstrap: MobileBootstrapState): MobileAppSnapshot {
    const old=this.state.bootstrap;
    if(old?.status==="READY"&&(bootstrap.status!=="READY"||old.user.id!==bootstrap.user.id||old.business.id!==bootstrap.business.id||old.branch.id!==bootstrap.branch.id||old.membership.role!==bootstrap.membership.role)){
      ++this.commerceGeneration;this.state={...this.state,commerce:null,commerceLoading:false,cart:[],paymentMethod:"CASH",saleNotice:null};
    }
    this.state = {
      ...this.state,
      phase: bootstrap.status,
      bootstrap,
      error: null,
      syncing: false,
    };
    return this.snapshot;
  }

  private async safeQueueState(): Promise<QueueState> {
    try {
      return await this.runtime.getQueueState();
    } catch {
      return emptyQueue;
    }
  }
}

export function safeMobileErrorMessage(error: unknown): string {
  if (error instanceof SessionExpiredError) return error.message;
  if (error instanceof QueueStorageCorruptError) return error.message;
  if (error instanceof MobileRuntimeError) return error.message;
  if (error instanceof MobileApiError) return error.message || "TradeOS could not complete the request.";
  return "TradeOS could not complete that action. Check your connection and try again.";
}