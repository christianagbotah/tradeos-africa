import {
  OfflineMutationQueue,
  type FlushSummary,
  type QueueSnapshotStorage,
  type QueueState,
  type SyncTransport,
  type QueuedMutation,
} from "@tradeos/client-core/sync-runtime";
import {
  SessionExpiredError,
  type MobileApiClient,
  type MobileBusinessContext,
  type MobileMembership,
  type MobileMe,
  type MobileUser,
  type MobileOwnCashShiftStatus,
} from "./api-client";
import {
  buildSaleMutation,
  projectSellableItems,
  type MobileCartLine,
  type MobileImmediatePaymentMethod,
  type MobileSellableItem,
} from "./pos-model";
import {canManageDays,canManageOwnShift,type OperationTransaction} from "./operations-workspace";
import type {TreasuryTransaction} from "./treasury-workspace";
import {canManageTreasury,canRecordExpense,type FinanceTransaction} from "./finance-workspace";
import {canManageSuppliers,canPaySuppliers,type SupplierTransaction} from "./supplier-workspace";
import {canReverseSale,type SaleReversal} from "./sale-reversal";
import {buildStockAdjustment,type StockAdjustment} from "./inventory-adjustment";
import {canManageCatalog} from "./catalog-workspace";
import {canCollectCustomerPayment,paymentMethods,type CustomerReceiptInput,type ReceiptOutcome} from "./customer-payment";
import { MobilePersistence } from "./storage";

type RuntimeApi = Pick<
  MobileApiClient,
  "login" | "getMe" | "getBusinessContext" | "getCatalog" | "getInventory" | "push" | "logout"
> & SyncTransport;

export type MobileReadyState = {
  status: "READY";
  user: MobileUser;
  membership: MobileMembership;
  business: MobileBusinessContext["business"];
  branch: MobileBusinessContext["branches"][number];
  queue: QueueState;
};

export type MobileBootstrapState =
  | { status: "SIGNED_OUT"; queue: QueueState }
  | { status: "NEEDS_BUSINESS"; user: MobileUser; queue: QueueState }
  | MobileReadyState;

export type MobileCommerceSnapshot = {
  source: "LIVE" | "CACHE";
  fetchedAt: string;
  warning: string | null;
  items: MobileSellableItem[];
};

export type MobileSaleCaptureResult = {
  clientMutationId: string;
  completedSaleId?:string;
  outcome: "SYNCED" | "PENDING" | "NEEDS_REVIEW";
  queue: QueueState;
  errorCode?: string;
  errorMessage?: string;
};

const saleRoles = new Set(["OWNER", "ADMIN", "MANAGER", "CASHIER", "POS_ATTENDANT", "SALES", "STAFF"]);

export type MobileRuntimeOptions = {
  api: RuntimeApi;
  persistence: MobilePersistence;
  queueStorage: QueueSnapshotStorage;
  now: () => string;
  createMutationId: () => string;
};

export class MobileRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MobileRuntimeError";
  }
}

export class MobileRuntimeBusyError extends MobileRuntimeError {}

export class MobileRuntime {
  readonly queue: OfflineMutationQueue;
  private current: MobileReadyState | null = null;
  private workspaceSwitching=false;
  private activeFlushes=0;
  private saleBusy=false;
  private shiftBusy=false;
  private transactionBusy():boolean{return this.saleBusy||this.shiftBusy||this.customerReceiptBusy||this.stockAdjustmentBusy||this.supplierTransactionBusy||this.financeBusy||this.operationsBusy||this.saleReversalBusy||this.activeFlushes>0;}
  private sameReadyScope(a:MobileReadyState|null,b:MobileReadyState|null):boolean{return !!a&&!!b&&a.user.id===b.user.id&&a.business.id===b.business.id&&a.branch.id===b.branch.id&&a.membership.staffId===b.membership.staffId&&a.membership.role===b.membership.role;}
  private customerReceiptBusy=false;
  private stockAdjustmentBusy=false;
  private supplierTransactionBusy=false;
  private financeBusy=false;
  private operationsBusy=false;
  private saleReversalBusy=false;

  constructor(private readonly options: MobileRuntimeOptions) {
    this.queue = new OfflineMutationQueue(options.queueStorage, {
      now: options.now,
      createMutationId: options.createMutationId,
    });
  }

  async bootstrap(): Promise<MobileBootstrapState> {
    const session = await this.options.persistence.loadSession();
    if (!session) return this.signedOut();

    let me: MobileMe;
    try {
      me = await this.options.api.getMe();
    } catch (error) {
      if (error instanceof SessionExpiredError) return this.signedOut();
      throw error;
    }

    const memberships = me.memberships.filter((membership) => membership.businessStatus === "ACTIVE");
    if (memberships.length === 0) {
      this.current = null;
      return {
        status: "NEEDS_BUSINESS",
        user: me.user,
        queue: await this.queue.getState(null),
      };
    }

    const saved = await this.options.persistence.loadWorkspaceSelection();
    const membership = memberships.find((candidate) => candidate.businessId === saved?.businessId) ?? memberships[0]!;
    const context = await this.options.api.getBusinessContext(membership.businessId);
    const activeBranches = context.branches.filter((branch) => branch.active);
    const branch = (saved?.businessId === membership.businessId
      ? activeBranches.find((candidate) => candidate.id === saved.branchId)
      : undefined)
      ?? activeBranches.find((candidate) => candidate.code === "MAIN")
      ?? activeBranches[0];

    if (!branch) {
      this.current = null;
      throw new MobileRuntimeError("This TradeOS business has no active branch available on mobile.");
    }

    await this.options.persistence.saveWorkspaceSelection({ businessId: membership.businessId, branchId: branch.id });
    const ready: MobileReadyState = {
      status: "READY",
      user: me.user,
      membership,
      business: context.business,
      branch,
      queue: await this.queue.getState(membership.businessId),
    };
    this.current = ready;
    return ready;
  }

  /** Select only a currently authorized business and active visible branch.
   * Never mutate a queued transaction's tenant or branch.
   */
  async getCurrentBusinessPendingCount():Promise<number>{
    const ready=this.requireReady();return (await this.queue.getSnapshot()).pending.filter(m=>m.businessId===ready.business.id).length;
  }

  async switchWorkspace(businessId:string,branchId:string):Promise<MobileReadyState>{
    const previous=this.requireReady();
    if(this.transactionBusy())throw new MobileRuntimeError("Wait for the current transaction or synchronization to finish.");
    if(previous.membership.role==="POS_ATTENDANT")throw new MobileRuntimeError("Ask an administrator to change your POS workspace.");
    this.workspaceSwitching=true;
    try{
    const session=await this.options.persistence.loadSession();
    if(!session)throw new SessionExpiredError();
    const pendingHere=()=>this.queue.getSnapshot().then(q=>q.pending.some(m=>m.businessId===previous.business.id));
    if(await pendingHere())throw new MobileRuntimeError("Sync pending transactions in your current business before switching.");
    const me=await this.options.api.getMe();
    if(me.user.id!==previous.user.id)throw new SessionExpiredError("Account changed. Sign in again.");
    const membership=me.memberships.find(m=>m.businessId===businessId&&m.businessStatus==="ACTIVE");
    if(!membership)throw new MobileRuntimeError("You no longer have access to this business.");
    const context=await this.options.api.getBusinessContext(businessId);
    const branch=context.branches.find(b=>b.id===branchId&&b.active);
    if(context.business.id!==businessId||context.business.status!=="ACTIVE"||!branch||context.membership.role!==membership.role||context.membership.staffId!==membership.staffId)
      throw new MobileRuntimeError("The selected workspace is no longer available.");
    const targetQueue=await this.queue.getState(businessId);
    const active=await this.options.persistence.loadSession();
    if(this.current!==previous||!active||active.accessToken!==session.accessToken||active.refreshToken!==session.refreshToken)
      throw new MobileRuntimeError("Session changed. Refresh before switching.");
    if(await pendingHere())throw new MobileRuntimeError("Sync pending transactions before switching.");
    await this.options.persistence.saveWorkspaceSelection({businessId,branchId});
    const ready:MobileReadyState={status:"READY",user:me.user,membership,business:context.business,branch,queue:targetQueue};
    this.current=ready;return ready;
    }finally{this.workspaceSwitching=false;}
  }

  async login(identifier: string, password: string): Promise<MobileBootstrapState> {
    await this.options.api.login(identifier, password);
    return this.bootstrap();
  }

  async loadCommerce(online: boolean): Promise<MobileCommerceSnapshot> {
    const ready = this.requireReady();
    if (online) {
      try {
        const [catalog, inventory] = await Promise.all([
          this.options.api.getCatalog(ready.membership.businessId),
          this.options.api.getInventory(ready.membership.businessId, ready.branch.id),
        ]);
        const fetchedAt = this.options.now();
        await Promise.all([
          this.options.persistence.saveCatalogCache(ready.membership.businessId, { fetchedAt, items: catalog.items }),
          this.options.persistence.saveInventoryCache(ready.membership.businessId, ready.branch.id, { fetchedAt, items: inventory.items }),
        ]);
        return {
          source: "LIVE",
          fetchedAt,
          warning: null,
          items: projectSellableItems(catalog.items, inventory.items),
        };
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        return this.loadCachedCommerce(ready, "Live catalog refresh failed. Showing last-known catalog and stock.");
      }
    }
    return this.loadCachedCommerce(ready, "Offline · showing last-known catalog and stock.");
  }

  async createSale(
    cart: readonly MobileCartLine[],
    paymentMethod: MobileImmediatePaymentMethod,
    online: boolean,
  ): Promise<MobileSaleCaptureResult> {
    const ready = this.requireReady();
    if (!saleRoles.has(ready.membership.role)) {
      throw new MobileRuntimeError("Your current role does not have permission to create sales.");
    }
    if (ready.membership.role === "POS_ATTENDANT" && paymentMethod !== "CASH") {
      throw new MobileRuntimeError("POS attendants can record cash only; ask a cashier or supervisor for other tenders.");
    }

    if(this.saleBusy)throw new MobileRuntimeError("A sale is already being recorded.");
    this.saleBusy=true;
    try{
    const clientMutationId = this.options.createMutationId();
    const mutation = buildSaleMutation({
      clientId: await this.options.persistence.getOrCreateDeviceKey(),
      clientMutationId,
      businessId: ready.membership.businessId,
      branchId: ready.branch.id,
      currencyCode: ready.business.currencyCode,
      paymentMethod,
      occurredAt: this.options.now(),
      cart,
    });
    const enqueued = await this.queue.enqueue(mutation);
    if (!enqueued) throw new MobileRuntimeError("This sale is already present in the offline queue.");

    if (online) {
      try {
        await this.flush(true);
      } catch {
        // The economic mutation is already durable. Network failure leaves it pending.
      }
    }

    const snapshot = await this.queue.getSnapshot();
    const failed = snapshot.failed.find((entry) => entry.mutation.clientMutationId === clientMutationId);
    const queue = await this.queue.getState(ready.membership.businessId);
    if(this.sameReadyScope(this.current,ready))this.current = { ...this.current!, queue };
    if (failed) {
      return {
        clientMutationId,
        outcome: "NEEDS_REVIEW",
        queue,
        ...(failed.result.errorCode ? { errorCode: failed.result.errorCode } : {}),
        ...(failed.result.errorMessage ? { errorMessage: failed.result.errorMessage } : {}),
      };
    }
    if (snapshot.pending.some((entry) => entry.clientMutationId === clientMutationId)) {
      return { clientMutationId, outcome: "PENDING", queue };
    }
    return this.queue.hasAppliedAcknowledgement(clientMutationId,ready.business.id,ready.branch.id)
      ?{clientMutationId,outcome:"SYNCED",queue,completedSaleId:this.queue.getCompletedSaleId(clientMutationId,ready.business.id,ready.branch.id)}
      :{clientMutationId,outcome:"NEEDS_REVIEW",queue,errorCode:"ACKNOWLEDGEMENT_UNVERIFIED",errorMessage:"Posting could not be verified. Check server history before recording another sale."};
    }finally{this.saleBusy=false;}
  }

  /**
   * A financial custody mutation is never a silent offline success. Persist it
   * in the native queue, flush with the authenticated device, and report success
   * only after the mutation was removed by an APPLIED server acknowledgement.
   */
  async recordOwnCashShift(
    status:MobileOwnCashShiftStatus, countedMinor:number,note:string,online:boolean,
  ):Promise<{closed:boolean;clientMutationId:string}>{
    const ready=this.requireReady();
    if(ready.membership.role!=="POS_ATTENDANT")
      throw new MobileRuntimeError("This cash-only drawer control is for POS attendants.");
    if(!online)
      throw new MobileRuntimeError("Connect online to verify opening or closing your cash drawer.");
    if(!Number.isSafeInteger(countedMinor)||countedMinor<0)
      throw new MobileRuntimeError("Enter a valid, nonnegative cash amount.");
    if(note.length>1000)
      throw new MobileRuntimeError("Keep the handover note within 1,000 characters.");
    if(!status.operatingDay || status.operatingDay.status!=="OPEN")
      throw new MobileRuntimeError("The supervisor must open the trading day first.");
    const closed=Boolean(status.shift);
    const id=closed?status.shift?.id:status.operatingDay.id;
    if(!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new MobileRuntimeError("Refresh to verify the current day or shift ID.");
    if(this.shiftBusy)throw new MobileRuntimeError("A shift action is already in progress.");
    this.shiftBusy=true;
    try{
    const existing=await this.queue.getSnapshot();
    if([...existing.pending,...existing.failed.map(x=>x.mutation)].some(m=>m.businessId===ready.business.id&&m.branchId===ready.branch.id&&["SHIFT_OPEN_CREATE","SHIFT_CLOSE_CREATE"].includes(m.mutationType)))throw new MobileRuntimeError("Resolve the previous shift action before submitting another.");
    const cash={method:"CASH",countedMinor};
    const payload=closed
      ? {shiftId:id,closingBalances:[cash,...(["MOMO","CARD","BANK","OTHER"] as const)
          .map(method=>({method,countedMinor:0}))],...(note.trim()?{note:note.trim()}:{})}
      : {dayId:id,openingBalances:[cash],...(note.trim()?{note:note.trim()}:{})};
    const clientMutationId=this.options.createMutationId();
    const mutation:QueuedMutation={
      clientId:await this.options.persistence.getOrCreateDeviceKey(),
      clientMutationId,businessId:ready.membership.businessId,
      branchId:ready.branch.id,mutationType:closed?"SHIFT_CLOSE_CREATE":"SHIFT_OPEN_CREATE",
      occurredAt:this.options.now(),payload,
    };
    if(!await this.queue.enqueue(mutation))throw new MobileRuntimeError(
      "This shift submission was already queued.");
    try {await this.flush(true);}
    catch { /* Durable pending mutation remains for retry at the same ID. */ }
    const snapshot=await this.queue.getSnapshot();
    const failed=snapshot.failed.find(row=>row.mutation.clientMutationId===clientMutationId);
    if(failed)throw new MobileRuntimeError(
      "Shift change rejected: "+(failed.result.errorMessage??"Review the queued error."));
    if(snapshot.pending.some(row=>row.clientMutationId===clientMutationId))
      throw new MobileRuntimeError(
        "Shift change saved on this device but NOT confirmed. Sync the pending action before submitting another.");
    if(!this.queue.hasAppliedAcknowledgement(clientMutationId,ready.business.id,ready.branch.id))throw new MobileRuntimeError("Shift posting could not be verified. Check the server before retrying.");
    return {closed,clientMutationId};
    }finally{this.shiftBusy=false;}
  }

  /** Record money already received, not initiate a provider charge. Durable
   * mutation IDs survive transport failure; never re-submit a pending receipt. */
  async recordCustomerReceipt(input:CustomerReceiptInput,online:boolean):Promise<ReceiptOutcome>{
    if(this.customerReceiptBusy)throw new MobileRuntimeError("A customer receipt is already being submitted.");
    const ready=this.requireReady();
    if(!online||!canCollectCustomerPayment(ready.membership.role))throw new MobileRuntimeError("Connect with an authorized cashier or manager to record a receipt.");
    if(!input.customerId||!input.moneyAccountId||!paymentMethods.includes(input.method)||!Number.isSafeInteger(input.amountMinor)||input.amountMinor<=0)
      throw new MobileRuntimeError("Check the amount, customer and receiving account.");
    this.customerReceiptBusy=true;
    try{
      const existing=await this.queue.getSnapshot();
      if([...existing.pending,...existing.failed.map(row=>row.mutation)].some(row=>row.businessId===ready.business.id&&row.mutationType==="CUSTOMER_PAYMENT_CREATE"&&(row.payload as Partial<CustomerReceiptInput>)?.customerId===input.customerId))
        throw new MobileRuntimeError("A receipt for this customer is pending or rejected. Resolve it in the sync queue before recording another.");
      const clientMutationId=this.options.createMutationId();
      const mutation:QueuedMutation={
        clientId:await this.options.persistence.getOrCreateDeviceKey(),clientMutationId,
        businessId:ready.business.id,branchId:ready.branch.id,mutationType:"CUSTOMER_PAYMENT_CREATE",
        occurredAt:this.options.now(),payload:{customerId:input.customerId,amountMinor:input.amountMinor,method:input.method,moneyAccountId:input.moneyAccountId},
      };
      if(!await this.queue.enqueue(mutation))throw new MobileRuntimeError("Receipt already queued.");
      try{await this.flush(true);}catch{/* Retain original ID and pending evidence. */}
      const state=await this.queue.getSnapshot();
      if(state.failed.some(row=>row.mutation.clientMutationId===clientMutationId))return "NEEDS_REVIEW";
      if(state.pending.some(row=>row.clientMutationId===clientMutationId))return "PENDING";
      return this.queue.hasAppliedAcknowledgement(clientMutationId,ready.business.id,ready.branch.id)?"SYNCED":"NEEDS_REVIEW";
    }finally{this.customerReceiptBusy=false;}
  }

  async recordStockAdjustment(input:StockAdjustment,online:boolean):Promise<ReceiptOutcome>{
    const ready=this.requireReady();
    if(!online||!canManageCatalog(ready.membership.role)||this.stockAdjustmentBusy)throw new MobileRuntimeError("Connect with an authorized inventory manager.");
    const payload=buildStockAdjustment(input.itemId,String(input.quantity),input.sourceLocation??"NONE",input.destinationLocation??"NONE",input.note);
    this.stockAdjustmentBusy=true;
    try{
      const existing=await this.queue.getSnapshot();
      if([...existing.pending,...existing.failed.map(x=>x.mutation)].some(x=>x.businessId===ready.business.id&&x.mutationType==="INVENTORY_ADJUSTMENT_CREATE"&&(x.payload as Partial<StockAdjustment>)?.itemId===input.itemId))throw new MobileRuntimeError("Resolve the previous adjustment in the sync queue first.");
      const clientMutationId=this.options.createMutationId();
      if(!await this.queue.enqueue({clientId:await this.options.persistence.getOrCreateDeviceKey(),clientMutationId,businessId:ready.business.id,branchId:ready.branch.id,mutationType:"INVENTORY_ADJUSTMENT_CREATE",occurredAt:this.options.now(),payload}))throw new MobileRuntimeError("Adjustment already queued.");
      try{await this.flush(true);}catch{/* Preserve durable submission. */}
      const state=await this.queue.getSnapshot();
      if(state.failed.some(x=>x.mutation.clientMutationId===clientMutationId))return "NEEDS_REVIEW";
      if(state.pending.some(x=>x.clientMutationId===clientMutationId))return "PENDING";
      return this.queue.hasAppliedAcknowledgement(clientMutationId,ready.business.id,ready.branch.id)?"SYNCED":"NEEDS_REVIEW";
    }finally{this.stockAdjustmentBusy=false;}
  }

  async recordSupplierTransaction(input:SupplierTransaction,online:boolean):Promise<ReceiptOutcome>{
    const ready=this.requireReady();
    if(!online||this.supplierTransactionBusy||!(input.type==="SUPPLIER_PAYMENT_CREATE"?canPaySuppliers(ready.membership.role):canManageSuppliers(ready.membership.role)))throw new MobileRuntimeError("An authorized online purchasing session is required.");
    this.supplierTransactionBusy=true;
    try{
      const state=await this.queue.getSnapshot();
      if([...state.pending,...state.failed.map(x=>x.mutation)].some(x=>x.businessId===ready.business.id&&["PURCHASE_RECEIVE_CREATE","SUPPLIER_PAYMENT_CREATE","PURCHASE_RETURN_CREATE"].includes(x.mutationType)&&(x.payload as {supplierId?:string})?.supplierId===input.payload.supplierId))throw new MobileRuntimeError("Resolve the previous supplier transaction in the sync queue first.");
      const clientMutationId=this.options.createMutationId();
      if(!await this.queue.enqueue({clientId:await this.options.persistence.getOrCreateDeviceKey(),clientMutationId,businessId:ready.business.id,branchId:ready.branch.id,mutationType:input.type,occurredAt:this.options.now(),payload:input.payload}))throw new MobileRuntimeError("Transaction already queued.");
      try{await this.flush(true);}catch{/* Preserve the original durable submission. */}
      const result=await this.queue.getSnapshot();
      if(result.failed.some(x=>x.mutation.clientMutationId===clientMutationId))return "NEEDS_REVIEW";
      if(result.pending.some(x=>x.clientMutationId===clientMutationId))return "PENDING";
      return this.queue.hasAppliedAcknowledgement(clientMutationId,ready.business.id,ready.branch.id)?"SYNCED":"NEEDS_REVIEW";
    }finally{this.supplierTransactionBusy=false;}
  }

  async recordFinanceTransaction(input:FinanceTransaction|TreasuryTransaction,online:boolean):Promise<ReceiptOutcome>{
    const ready=this.requireReady();
    if(!online||this.financeBusy||!((input.type==="EXPENSE_CREATE"||input.type==="MONEY_RECONCILIATION_CREATE")?canRecordExpense(ready.membership.role):["MONEY_TRANSFER_CREATE","MONEY_RECONCILIATION_RESOLVE"].includes(input.type)&&canManageTreasury(ready.membership.role)))throw new MobileRuntimeError("An authorized online finance session is required.");
    if((input.type==="EXPENSE_CREATE"||input.type==="MONEY_TRANSFER_CREATE")&&(!Number.isSafeInteger(input.payload.amountMinor)||input.payload.amountMinor<=0))throw new MobileRuntimeError("Invalid financial amount.");
    this.financeBusy=true;
    try{
      const state=await this.queue.getSnapshot();
      if([...state.pending,...state.failed.map(x=>x.mutation)].some(x=>x.businessId===ready.business.id&&["EXPENSE_CREATE","MONEY_TRANSFER_CREATE","MONEY_RECONCILIATION_CREATE","MONEY_RECONCILIATION_RESOLVE"].includes(x.mutationType)))throw new MobileRuntimeError("Reconcile the previous finance transaction in the sync queue before submitting another.");
      const clientMutationId=this.options.createMutationId();
      if(!await this.queue.enqueue({clientId:await this.options.persistence.getOrCreateDeviceKey(),clientMutationId,businessId:ready.business.id,branchId:ready.branch.id,mutationType:input.type,occurredAt:this.options.now(),payload:input.payload}))throw new MobileRuntimeError("Transaction already queued.");
      try{await this.flush(true);}catch{/* Preserve original submission. */}
      const result=await this.queue.getSnapshot();
      if(result.failed.some(x=>x.mutation.clientMutationId===clientMutationId))return "NEEDS_REVIEW";
      if(result.pending.some(x=>x.clientMutationId===clientMutationId))return "PENDING";
      return this.queue.hasAppliedAcknowledgement(clientMutationId,ready.business.id,ready.branch.id)?"SYNCED":"NEEDS_REVIEW";
    }finally{this.financeBusy=false;}
  }

  async recordSaleReversal(input:SaleReversal,online:boolean):Promise<ReceiptOutcome>{
    const ready=this.requireReady();
    if(!online||!canReverseSale(ready.membership.role)||this.saleReversalBusy)throw new MobileRuntimeError("Connect as an authorized cashier or manager.");
    if(!["RETURN_CREATE","EXCHANGE_CREATE"].includes(input.type)||!input.payload.originalSaleId)throw new MobileRuntimeError("Choose a valid original sale.");
    if(!Number.isSafeInteger(input.type==="RETURN_CREATE"?input.payload.expectedRefundTotalMinor:input.payload.expectedNetDifferenceMinor))throw new MobileRuntimeError("Review and confirm the financial amount before submitting.");
    this.saleReversalBusy=true;
    try{
      const state=await this.queue.getSnapshot();
      if([...state.pending,...state.failed.map(x=>x.mutation)].some(x=>x.businessId===ready.business.id&&["RETURN_CREATE","REFUND_CREATE","EXCHANGE_CREATE"].includes(x.mutationType)&&(x.payload as {originalSaleId?:string})?.originalSaleId===input.payload.originalSaleId))throw new MobileRuntimeError("An earlier return or exchange requires reconciliation in the local sync queue.");
      const clientMutationId=this.options.createMutationId();
      if(!await this.queue.enqueue({clientId:await this.options.persistence.getOrCreateDeviceKey(),clientMutationId,businessId:ready.business.id,branchId:ready.branch.id,mutationType:input.type,occurredAt:this.options.now(),payload:input.payload}))throw new MobileRuntimeError("Return already queued.");
      try{await this.flush(true);}catch{/* Retain the original durable submission. */}
      const after=await this.queue.getSnapshot();
      if(after.failed.some(x=>x.mutation.clientMutationId===clientMutationId))return "NEEDS_REVIEW";
      if(after.pending.some(x=>x.clientMutationId===clientMutationId))return "PENDING";
      return this.queue.hasAppliedAcknowledgement(clientMutationId,ready.business.id,ready.branch.id)?"SYNCED":"NEEDS_REVIEW";
    }finally{this.saleReversalBusy=false;}
  }

  async recordOperation(input:OperationTransaction,online:boolean):Promise<ReceiptOutcome>{
    const ready=this.requireReady();
    const allowed=["OPERATING_DAY_OPEN_CREATE","OPERATING_DAY_CLOSE_CREATE","SHIFT_OPEN_CREATE","SHIFT_CLOSE_CREATE"];
    if(!online||this.operationsBusy||!allowed.includes(input.type)||!(input.type.startsWith("OPERATING_DAY")?canManageDays(ready.membership.role):canManageOwnShift(ready.membership.role)))throw new MobileRuntimeError("An authorized online operations session is required.");
    const closing=input.type.includes("CLOSE"),balances=closing?input.payload.closingBalances:input.payload.openingBalances;
    if(!balances||balances.length!==5||new Set(balances.map(b=>b.method)).size!==5||balances.some(b=>!paymentMethods.includes(b.method)||!Number.isSafeInteger(b.countedMinor)||b.countedMinor<0))throw new MobileRuntimeError("Enter all five counted balances.");
    this.operationsBusy=true;
    try{
      const state=await this.queue.getSnapshot();
      if([...state.pending,...state.failed.map(x=>x.mutation)].some(x=>x.businessId===ready.business.id&&x.branchId===ready.branch.id&&(closing||allowed.includes(x.mutationType))))throw new MobileRuntimeError("Resolve pending or rejected branch transactions before changing this interval.");
      const clientMutationId=this.options.createMutationId();
      if(!await this.queue.enqueue({clientId:await this.options.persistence.getOrCreateDeviceKey(),clientMutationId,businessId:ready.business.id,branchId:ready.branch.id,mutationType:input.type,occurredAt:this.options.now(),payload:input.payload}))throw new MobileRuntimeError("Operation already queued.");
      try{await this.flush(true);}catch{/* Preserve original submission. */}
      const result=await this.queue.getSnapshot();
      if(result.failed.some(x=>x.mutation.clientMutationId===clientMutationId))return "NEEDS_REVIEW";
      if(result.pending.some(x=>x.clientMutationId===clientMutationId))return "PENDING";
      return this.queue.hasAppliedAcknowledgement(clientMutationId,ready.business.id,ready.branch.id)?"SYNCED":"NEEDS_REVIEW";
    }finally{this.operationsBusy=false;}
  }

  async flush(online: boolean): Promise<FlushSummary> {
    if(this.workspaceSwitching)throw new MobileRuntimeError("Workspace is changing. Wait before synchronizing.");
    const ready=this.current;
    const activeBusinessId=ready?.membership.businessId??null;
    this.activeFlushes++;
    try{
      const summary=await this.queue.flush({activeBusinessId,online,transport:this.options.api});
      if(this.sameReadyScope(this.current,ready))this.current={...this.current!,queue:{pending:summary.pending,blocked:summary.blocked,failed:summary.failed}};
      return summary;
    }finally{this.activeFlushes--;}
  }

  getCurrentReadyState(): MobileReadyState | null {
    return this.current;
  }

  async getQueueState(): Promise<QueueState> {
    return this.queue.getState(this.current?.membership.businessId ?? null);
  }

  async logout(): Promise<void> {
    if(this.workspaceSwitching||this.transactionBusy())throw new MobileRuntimeBusyError("Wait for the current transaction or synchronization before signing out.");
    try {
      await this.options.api.logout();
    } finally {
      await this.options.persistence.clearSession();
      this.current = null;
    }
  }

  private requireReady(): MobileReadyState {
    if(this.workspaceSwitching)throw new MobileRuntimeError("Workspace is changing. Wait before continuing.");
    if (!this.current) throw new MobileRuntimeError("Open an active TradeOS business before using mobile commerce.");
    return this.current;
  }

  private async loadCachedCommerce(ready: MobileReadyState, warning: string): Promise<MobileCommerceSnapshot> {
    const [catalog, inventory] = await Promise.all([
      this.options.persistence.loadCatalogCache(ready.membership.businessId),
      this.options.persistence.loadInventoryCache(ready.membership.businessId, ready.branch.id),
    ]);
    if (!catalog || !inventory) {
      throw new MobileRuntimeError("Connect online once to load this branch catalog before selling offline.");
    }
    const fetchedAt = catalog.fetchedAt <= inventory.fetchedAt ? catalog.fetchedAt : inventory.fetchedAt;
    return {
      source: "CACHE",
      fetchedAt,
      warning,
      items: projectSellableItems(catalog.items, inventory.items),
    };
  }

  private async signedOut(): Promise<MobileBootstrapState> {
    this.current = null;
    return { status: "SIGNED_OUT", queue: await this.queue.getState(null) };
  }
}