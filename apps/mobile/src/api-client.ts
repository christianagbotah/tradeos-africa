import type { SyncPushRequest, SyncResponse } from "@tradeos/client-core/sync-runtime";
import type { BusinessNotificationsResponse, BusinessNotificationKind, BusinessQuestionResponse, CustomerCreateInput, CustomerUpdateInput, StaffDirectoryItem, CreateStaffRequest, UpdateStaffRequest, StaffInvitationResponse, FinancialSummaryReport, CreditAgingReport, CashForecastResponse } from "@tradeos/contracts";
import { type MobileSessionTokens, MobilePersistence } from "./storage";

export type MobilePlatform = "ANDROID" | "IOS";

export type MobileUser = {
  id: string;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
};

export type MobileMembership = {
  id: string;
  businessId: string;
  businessName: string;
  businessType: string;
  businessStatus: string;
  role: string;
  staffId: string | null;
};

export type MobileMe = {
  user: MobileUser;
  client: { platform: string; deviceKey: string; appVersion: string };
  memberships: MobileMembership[];
};

export type MobileContactProfile={email?:string|null;phone?:string|null;addressLine1?:string|null;addressLine2?:string|null;city?:string|null;region?:string|null;postalCode?:string|null};
export type MobileBusinessProfile=MobileContactProfile&{id:string;name:string;legalName?:string|null;businessType:string;registrationNumber?:string|null;taxId?:string|null;countryCode:string;currencyCode:string;timezone:string;status:string;logoUrl?:string|null};
export type MobileBranch=MobileContactProfile&{id:string;name:string;code:string;timezone:string;active:boolean;updatedAt?:string};
export type MobileBusinessContext={business:MobileBusinessProfile;membership:{role:string;staffId:string|null};branches:MobileBranch[]};
export type MobileBusinessPatch=Partial<Pick<MobileBusinessProfile,"name"|"legalName"|"businessType"|"registrationNumber"|"taxId"|"email"|"phone"|"addressLine1"|"addressLine2"|"city"|"region"|"postalCode"|"timezone">>;
export type MobileBranchPatch=MobileContactProfile&{name?:string;timezone?:string;code?:string};


export type MobileCatalogUnit = {
  code: string;
  label: string;
  canPurchase: boolean;
  canSell: boolean;
  canStock: boolean;
  defaultSalePriceMinor: number | null;
};

export type MobileCatalogItem = {
  id: string;
  businessId: string;
  sku: string | null;
  name: string;
  kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  stockUnitCode: string | null;
  trackStock: boolean;
  taxCategory: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  units: MobileCatalogUnit[];
  conversions: Array<{ fromUnitCode: string; toUnitCode: string; factor: number }>;
};

export type MobileCatalogDraft=Pick<MobileCatalogItem,"name"|"sku"|"kind"|"trackStock"|"stockUnitCode"|"units"|"conversions">;
export type MobileCatalogPatch=Partial<Pick<MobileCatalogItem,"name"|"sku"|"units"|"active">>&{expectedUpdatedAt:string};
export type MobileInventoryDetail={item:Omit<MobileInventoryItem,"latestStockUnitCostMinor">&{active:boolean};movements:Array<{id:string;stockUnitCode:string;quantityDelta:number;location:string;reason:string;actorName:string|null;occurredAt:string}>};
export type MobileDocumentKind="QUOTATION"|"PROFORMA";
export type MobileDocumentSummary={id:string;businessId:string;branchId:string;documentNumber:string;kind:MobileDocumentKind;status:"DRAFT"|"ISSUED"|"CANCELLED";customerId:string|null;customerName:string;customerPhone:string|null;customerEmail:string|null;currencyCode:string;notes:string;totalMinor:number;expiresAt:string|null;updatedAt:string};
export type MobileDocument=MobileDocumentSummary&{lines:Array<{id:string;itemId:string;itemName:string;saleUnitCode:string;quantity:number;unitNetMinor:number;lineTotalMinor:number}>};
export type MobileDocumentInput={businessId:string;branchId:string;clientRequestId:string;kind:MobileDocumentKind;customerId?:string;customerName:string;customerPhone:string;customerEmail:string;notes:string;expiresAt?:string;lines:Array<{itemId:string;saleUnitCode:string;quantity:number}>};
export type MobileSupplier={id:string;name:string;phone:string|null;email:string|null;address:string|null;paymentTermsDays:number;active:boolean;balanceMinor:number;updatedAt:string};
export type MobileSupplierDetail={supplier:MobileSupplier;obligations:Array<{id:string;purchaseId:string;originalMinor:number;openMinor:number;dueAt:string}>;ledger:Array<{id:string;currencyCode:string;balanceDeltaMinor:number;method:string;sourceType:string;occurredAt:string}>};
export type MobileSupplierInput={name:string;phone:string|null;email:string|null;address:string|null;paymentTermsDays?:number};
export type MobilePurchase={id:string;supplierId:string;supplierName:string;supplierReference:string|null;totalMinor:number;currencyCode:string;settlementMethod:string;receivedAt:string|null};
export type MobilePurchaseDetail={purchase:MobilePurchase&{businessId:string;branchId:string};lines:Array<{id:string;itemName:string;purchaseQuantity:number;purchaseUnitCode:string;stockQuantity:number;stockUnitCode:string;unitCostMinor:number;lineCostMinor:number;returnedQuantity:number}>};
export type MobilePurchaseOrderSummary={id:string;businessId:string;branchId:string;supplierId:string;supplierName:string;orderNumber:string;status:"DRAFT"|"ISSUED"|"CANCELLED";currencyCode:string;totalMinor:number;notes:string;expectedDeliveryDate:string|null;updatedAt:string};
export type MobilePurchaseOrder=MobilePurchaseOrderSummary&{fulfillmentStatus:"NOT_RECEIVED"|"PARTIAL"|"RECEIVED";canReceive:boolean;receivedTotalMinor:number;priceVarianceMinor:number;lines:Array<{id:string;itemId:string;itemName:string;purchaseUnitCode:string;purchaseUnitLabel:string;quantity:number;remainingQuantity:number;receivedQuantity:number;unitCostMinor:number;lineTotalMinor:number}>;receipts:Array<{id:string;receivedAt:string;totalMinor:number;settlementMethod:string}>};
export type MobilePurchaseOrderInput={businessId:string;branchId:string;clientRequestId:string;supplierId:string;notes:string;expectedDeliveryDate?:string;lines:Array<{itemId:string;purchaseUnitCode:string;quantity:number;unitCostMinor:number}>};
export type MobileTreasuryAccount=MobileMoneyAccount&{kind:string;balanceMinor:number;allowNegative:boolean;provider:string|null;referenceLabel:string|null;updatedAt:string};
export type MobileReconciliation={id:string;branchId:string;moneyAccountId:string;accountName:string;type:"CASH_COUNT"|"STATEMENT";periodStart:string;periodEnd:string;expectedBalanceMinor:number;observedBalanceMinor:number;differenceMinor:number;status:"MATCHED"|"VARIANCE"|"RESOLVED";note:string|null;occurredAt:string;resolutionNote:string|null};
export type MobileAccountDraft={name:string;method:CustomerPaymentMethod;kind:"CASH_DRAWER"|"MOMO_WALLET"|"CARD_CLEARING"|"BANK_ACCOUNT"|"OTHER";provider:string|null;referenceLabel:string|null;allowNegative:boolean;branchId:string|null;currencyCode:string};
export type MobileExpenseCategory={id:string;name:string;active:boolean;system:boolean;updatedAt:string};
export type MobileCashbookEntry={id:string;moneyAccountId:string;branchId:string;currencyCode:string;method:string;amountDeltaMinor:number;entryType:string;occurredAt:string};
export type MobileExpense={id:string;branchId:string;moneyAccountId:string;currencyCode:string;amountMinor:number;categoryName:string;description:string|null;payee:string|null;method:string;status:string;occurredAt:string};
export type MobileCashbook={entries:MobileCashbookEntry[];summary:{inflowMinor:number;outflowMinor:number;netMinor:number};totals:Array<{currencyCode:string;method:string;balanceMinor:number;inflowMinor:number;outflowMinor:number}>};
export type MobileCatalogResponse = { items: MobileCatalogItem[] };

export type MobileInventoryItem = {
  id: string;
  sku: string | null;
  name: string;
  stockUnitCode: string;
  available: number;
  quarantine: number;
  damaged: number;
  waste: number;
  inventoryValueMinor: number;
  averageStockUnitCostMinor: number | null;
  latestStockUnitCostMinor: number | null;
};

export type MobileInventoryResponse = { items: MobileInventoryItem[] };

export type CustomerPaymentMethod="CASH"|"MOMO"|"CARD"|"BANK"|"OTHER";
export type MobileMoneyAccount={id:string;businessId:string;branchId:string|null;name:string;method:string;currencyCode:string;active:boolean};
export type MobileMoneyDefault={branchId:string;method:string;moneyAccountId:string;updatedAt?:string};
export type MobileCustomer={
  id:string;name:string;phone:string|null;email:string|null;active:boolean;
  balanceMinor:number;creditEnabled:boolean;creditLimitMinor:number|null;availableCreditMinor:number|null;
  creditTermsDays:number;createdAt:string;updatedAt:string;
};
export type MobileCustomerDetail={
  customer:MobileCustomer;
  obligations:Array<{id:string;saleId:string;originalMinor:number;openMinor:number;issuedAt:string;dueAt:string}>;
  ledger:Array<{id:string;branchId:string;currencyCode:string;entryType:string;balanceDeltaMinor:number;occurredAt:string}>;
};
export type MobileSaleSummary={
  id:string; status:string; currencyCode:string; totalMinor:number;
  refundTotalMinor:number; refundSettledMinor:number; refundPendingMinor:number; refundFailedMinor:number;
  createdAt:string; completedAt:string|null;
  customer:{name:string|null;phone:string|null}|null; cashierName:string|null;
  payments:Array<{method:string;amountMinor:number;status:string}>;
};
export type MobileSaleDetail={
  reversalAmountGuard?:boolean;
  id:string;businessId:string;branchId:string;status:string;currencyCode:string;totalMinor:number;
  completedAt:string|null;createdAt:string;
  customer:{id:string;name:string|null;phone:string|null}|null;cashierName:string|null;
  lines:Array<{id:string;itemName:string;itemKind?:"PRODUCT"|"SERVICE"|"PREPARED_PRODUCT";quantity:number;saleUnitCode:string;unitNetMinor:number;unitTaxMinor?:number;lineTotalMinor:number;quantityReturned:number;quantityReturnable?:number}>;
  payments:Array<{id:string;method:string;amountMinor:number;status:string;refundedMinor:number}>;
};


/** Restricted POS attendant view from /v1/operations/current.
 * Only own CASH is present; no business-day balances or other staff details.
 */
export type MobileOperationBalance={method:string;openingCountedMinor:number;movementMinor:number;expectedClosingMinor:number;closingCountedMinor:number|null;varianceMinor:number|null};
export type MobileOperationInterval={id:string;businessId:string;branchId:string;currencyCode:string;status:"OPEN"|"CLOSED";openedAt:string;closedAt:string|null;note:string|null;openedByStaffId:string;closedByStaffId:string|null;balances:MobileOperationBalance[];businessDate?:string;staffId?:string;operatingDayId?:string};
export type MobileOperationsCurrent={operatingDay:MobileOperationInterval|null;shift:MobileOperationInterval|null;openShiftCount:number};
export type MobileShiftPolicy={required:boolean;revision:string|null;changedAt:string|null};
export type MobileOwnCashShiftStatus = {
  operatingDay: { id:string; status:"OPEN"|"CLOSED"; openedAt:string } | null;
  shift: { id:string; status:"OPEN"|"CLOSED"; openedAt:string;
    balances:readonly {method:"CASH";openingCountedMinor:number;
      movementMinor:number;expectedClosingMinor:number}[];
  } | null;
  openShiftCount:number;
};

export type MobileApiClientOptions = {
  baseUrl: string;
  persistence: MobilePersistence;
  fetchImpl?: typeof fetch;
  platform: MobilePlatform;
  appVersion: string;
};

type ApiErrorPayload = { error?: string; message?: string };
type SessionResponse = { session?: MobileSessionTokens };

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

export class SessionExpiredError extends MobileApiError {
  constructor(message = "Your TradeOS session has expired. Please sign in again.") {
    super(message, 401, "SESSION_EXPIRED");
    this.name = "SessionExpiredError";
  }
}

export class MobileApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private refreshInFlight: Promise<MobileSessionTokens> | null = null;

  constructor(private readonly options: MobileApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async login(identifier: string, password: string): Promise<MobileUser> {
    const deviceKey = await this.options.persistence.getOrCreateDeviceKey();
    const response = await this.fetchImpl(`${this.baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: identifier.trim(),
        password,
        platform: this.options.platform,
        deviceKey,
        appVersion: this.options.appVersion,
      }),
    });
    const payload = await readJson<{ user?: MobileUser; session?: MobileSessionTokens } & ApiErrorPayload>(response);
    if (!response.ok) throw apiError(response.status, payload);
    if (!payload.user || !isSessionTokens(payload.session)) {
      throw new MobileApiError("Authentication service returned an invalid session.", 502, "INVALID_AUTH_RESPONSE");
    }
    await this.options.persistence.saveSession(payload.session);
    return payload.user;
  }

  getMe(): Promise<MobileMe> {
    return this.authorizedJson<MobileMe>("/v1/me", { method: "GET" });
  }

  getBusinessContext(businessId: string): Promise<MobileBusinessContext> {
    return this.authorizedJson<MobileBusinessContext>(`/v1/businesses/${encodeURIComponent(businessId)}/context`, { method: "GET" });
  }

  getCatalog(businessId: string): Promise<MobileCatalogResponse> {
    const query = new URLSearchParams({ businessId });
    return this.authorizedJson<MobileCatalogResponse>(`/v1/catalog/items?${query.toString()}`, { method: "GET" });
  }

  createCatalogItem(businessId:string,draft:MobileCatalogDraft):Promise<{item:MobileCatalogItem}>{
    return this.authorizedJson("/v1/catalog/items",{method:"POST",body:JSON.stringify({businessId,...draft})});
  }
  updateCatalogItem(businessId:string,itemId:string,patch:MobileCatalogPatch):Promise<{item:MobileCatalogItem}>{
    return this.authorizedJson("/v1/catalog/items/"+encodeURIComponent(itemId),{method:"PATCH",body:JSON.stringify({businessId,...patch})});
  }
  getInventoryDetail(businessId:string,branchId:string,itemId:string):Promise<MobileInventoryDetail>{
    return this.authorizedJson("/v1/inventory/"+encodeURIComponent(itemId)+"?"+new URLSearchParams({businessId,branchId,limit:"50"}).toString(),{method:"GET"});
  }
  getDocuments(businessId:string,branchId:string):Promise<{documents:MobileDocumentSummary[]}>{
    return this.authorizedJson("/v1/commercial-documents?"+new URLSearchParams({businessId,branchId,limit:"100"}).toString(),{method:"GET"});
  }
  getDocument(businessId:string,id:string):Promise<{document:MobileDocument}>{
    return this.authorizedJson("/v1/commercial-documents/"+encodeURIComponent(id)+"?"+new URLSearchParams({businessId}).toString(),{method:"GET"});
  }
  saveDocument(input:MobileDocumentInput,revision?:{id:string;expectedUpdatedAt:string}):Promise<{document:MobileDocument}>{
    return this.authorizedJson("/v1/commercial-documents"+(revision?"/"+encodeURIComponent(revision.id):""),{method:revision?"PATCH":"POST",body:JSON.stringify({...input,...(revision?{expectedUpdatedAt:revision.expectedUpdatedAt}:{})})});
  }
  changeDocumentStatus(businessId:string,id:string,action:"issue"|"cancel"):Promise<{document:MobileDocument}>{
    return this.authorizedJson("/v1/commercial-documents/"+encodeURIComponent(id)+"/"+action,{method:"POST",body:JSON.stringify({businessId})});
  }
  getSuppliers(businessId:string,query=""):Promise<{suppliers:MobileSupplier[]}>{
    return this.authorizedJson("/v1/suppliers?"+new URLSearchParams({businessId,query,limit:"200"}).toString(),{method:"GET"});
  }
  getSupplier(businessId:string,id:string):Promise<MobileSupplierDetail>{
    return this.authorizedJson("/v1/suppliers/"+encodeURIComponent(id)+"?"+new URLSearchParams({businessId}).toString(),{method:"GET"});
  }
  saveSupplier(businessId:string,input:MobileSupplierInput,revision?:{id:string;expectedUpdatedAt:string}):Promise<{supplier:MobileSupplier}>{
    return this.authorizedJson("/v1/suppliers"+(revision?"/"+encodeURIComponent(revision.id):""),{method:revision?"PATCH":"POST",body:JSON.stringify({businessId,...input,...(revision?{expectedUpdatedAt:revision.expectedUpdatedAt}:{})})});
  }
  getPurchases(businessId:string,branchId:string):Promise<{purchases:MobilePurchase[]}>{
    return this.authorizedJson("/v1/purchases?"+new URLSearchParams({businessId,branchId,limit:"100"}).toString(),{method:"GET"});
  }
  getPurchase(businessId:string,id:string):Promise<MobilePurchaseDetail>{
    return this.authorizedJson("/v1/purchases/"+encodeURIComponent(id)+"?"+new URLSearchParams({businessId}).toString(),{method:"GET"});
  }
  getPurchaseOrders(businessId:string,branchId:string):Promise<{orders:MobilePurchaseOrderSummary[]}>{
    return this.authorizedJson("/v1/purchase-orders?"+new URLSearchParams({businessId,branchId,limit:"100"}).toString(),{method:"GET"});
  }
  getPurchaseOrder(businessId:string,id:string):Promise<{order:MobilePurchaseOrder}>{
    return this.authorizedJson("/v1/purchase-orders/"+encodeURIComponent(id)+"?"+new URLSearchParams({businessId}).toString(),{method:"GET"});
  }
  savePurchaseOrder(input:MobilePurchaseOrderInput,revision?:{id:string;expectedUpdatedAt:string}):Promise<{order:MobilePurchaseOrder}>{
    return this.authorizedJson("/v1/purchase-orders"+(revision?"/"+encodeURIComponent(revision.id):""),{method:revision?"PATCH":"POST",body:JSON.stringify({...input,...(revision?{expectedUpdatedAt:revision.expectedUpdatedAt}:{})})});
  }
  changePurchaseOrderStatus(businessId:string,id:string,action:"issue"|"cancel"):Promise<{order:MobilePurchaseOrder}>{
    return this.authorizedJson("/v1/purchase-orders/"+encodeURIComponent(id)+"/"+action,{method:"POST",body:JSON.stringify({businessId})});
  }
  createTreasuryAccount(businessId:string,input:MobileAccountDraft):Promise<{account:MobileTreasuryAccount}>{
    return this.authorizedJson("/v1/money-accounts",{method:"POST",body:JSON.stringify({businessId,...input})});
  }
  updateTreasuryAccount(businessId:string,id:string,input:{expectedUpdatedAt:string;name:string;provider:string|null;referenceLabel:string|null;allowNegative:boolean;active:boolean}):Promise<{account:MobileTreasuryAccount}>{
    return this.authorizedJson("/v1/money-accounts/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({businessId,...input})});
  }
  setMoneyDefault(businessId:string,branchId:string,method:string,moneyAccountId:string,expectedUpdatedAt:string):Promise<MobileMoneyDefault>{
    return this.authorizedJson("/v1/money-account-defaults",{method:"PUT",body:JSON.stringify({businessId,branchId,method,moneyAccountId,expectedUpdatedAt})});
  }
  getReconciliations(businessId:string,branchId:string):Promise<{reconciliations:MobileReconciliation[]}>{
    return this.authorizedJson("/v1/money-reconciliations?"+new URLSearchParams({businessId,branchId,limit:"100"}).toString(),{method:"GET"});
  }
  getTreasuryAccounts(businessId:string,branchId:string):Promise<{accounts:MobileTreasuryAccount[];totalBalanceMinor:number}>{
    return this.authorizedJson("/v1/money-accounts?"+new URLSearchParams({businessId,branchId}).toString(),{method:"GET"});
  }
  getCashbook(businessId:string,branchId:string):Promise<MobileCashbook>{
    return this.authorizedJson("/v1/cashbook?"+new URLSearchParams({businessId,branchId,limit:"100"}).toString(),{method:"GET"});
  }
  getExpenses(businessId:string,branchId:string):Promise<{expenses:MobileExpense[]}>{
    return this.authorizedJson("/v1/expenses?"+new URLSearchParams({businessId,branchId,limit:"100"}).toString(),{method:"GET"});
  }
  getExpenseCategories(businessId:string):Promise<{categories:MobileExpenseCategory[]}>{
    return this.authorizedJson("/v1/expense-categories?"+new URLSearchParams({businessId}).toString(),{method:"GET"});
  }
  saveExpenseCategory(businessId:string,input:{name:string;active?:boolean},revision?:{id:string;expectedUpdatedAt:string}):Promise<{category:MobileExpenseCategory}>{
    return this.authorizedJson("/v1/expense-categories"+(revision?"/"+encodeURIComponent(revision.id):""),{method:revision?"PATCH":"POST",body:JSON.stringify({businessId,...input,...(revision?{expectedUpdatedAt:revision.expectedUpdatedAt}:{})})});
  }
  updateBusinessProfile(businessId:string,input:MobileBusinessPatch):Promise<{business:MobileBusinessProfile}>{
    return this.authorizedJson("/v1/businesses/"+encodeURIComponent(businessId),{method:"PATCH",body:JSON.stringify(input)});
  }
  saveBranch(businessId:string,input:MobileBranchPatch,branchId?:string):Promise<{branch:MobileBranch}>{
    return this.authorizedJson("/v1/businesses/"+encodeURIComponent(businessId)+"/branches"+(branchId?"/"+encodeURIComponent(branchId):""),{method:branchId?"PATCH":"POST",body:JSON.stringify(input)});
  }
  changeBranchActive(businessId:string,branchId:string,active:boolean):Promise<{branch:MobileBranch}>{
    return this.authorizedJson("/v1/businesses/"+encodeURIComponent(businessId)+"/branches/"+encodeURIComponent(branchId)+"/"+(active?"reactivate":"deactivate"),{method:"POST"});
  }
  getStaff(businessId:string):Promise<{staff:StaffDirectoryItem[]}>{
    return this.authorizedJson("/v1/staff?"+new URLSearchParams({businessId}).toString(),{method:"GET"});
  }
  saveStaff(input:CreateStaffRequest|UpdateStaffRequest,staffId?:string):Promise<{staff:StaffDirectoryItem}>{
    return this.authorizedJson("/v1/staff"+(staffId?"/"+encodeURIComponent(staffId):""),{method:staffId?"PATCH":"POST",body:JSON.stringify(input)});
  }
  changeStaffActive(businessId:string,staffId:string,active:boolean):Promise<{staff:StaffDirectoryItem}>{
    return this.authorizedJson("/v1/staff/"+encodeURIComponent(staffId)+"/"+(active?"reactivate":"suspend"),{method:"POST",body:JSON.stringify({businessId})});
  }
  inviteStaff(businessId:string,staffId:string):Promise<StaffInvitationResponse>{
    return this.authorizedJson("/v1/staff/"+encodeURIComponent(staffId)+"/invitations",{method:"POST",body:JSON.stringify({businessId})});
  }
  getStaffBranches(businessId:string,staffId:string):Promise<{branchIds:string[]}>{
    return this.authorizedJson("/v1/staff/"+encodeURIComponent(staffId)+"/branches?"+new URLSearchParams({businessId}).toString(),{method:"GET"});
  }
  setStaffBranches(businessId:string,staffId:string,branchIds:string[]):Promise<{branchIds:string[]}>{
    return this.authorizedJson("/v1/staff/"+encodeURIComponent(staffId)+"/branches",{method:"PUT",body:JSON.stringify({businessId,branchIds})});
  }
  getFinancialReport(businessId:string,branchId:string|null,range:string):Promise<FinancialSummaryReport>{
    return this.authorizedJson("/v1/reports/financial-summary?"+new URLSearchParams({businessId,...(branchId?{branchId}:{}),range}).toString(),{method:"GET"});
  }
  getCreditAging(businessId:string,branchId:string|null):Promise<CreditAgingReport>{
    return this.authorizedJson("/v1/reports/credit-aging?"+new URLSearchParams({businessId,...(branchId?{branchId}:{})}).toString(),{method:"GET"});
  }
  getCashForecast(businessId:string,branchId:string|null,days:number):Promise<CashForecastResponse>{
    return this.authorizedJson("/v1/reports/cash-forecast?"+new URLSearchParams({businessId,...(branchId?{branchId}:{}),days:String(days)}).toString(),{method:"GET"});
  }
  getOperationsCurrent(businessId:string,branchId:string):Promise<MobileOperationsCurrent>{
    return this.authorizedJson("/v1/operations/current?"+new URLSearchParams({businessId,branchId}).toString(),{method:"GET"});
  }
  getOperatingDays(businessId:string,branchId:string):Promise<{days:MobileOperationInterval[]}>{
    return this.authorizedJson("/v1/operations/days?"+new URLSearchParams({businessId,branchId,limit:"30"}).toString(),{method:"GET"});
  }
  getStaffShifts(businessId:string,branchId:string,dayId?:string):Promise<{shifts:MobileOperationInterval[]}>{
    return this.authorizedJson("/v1/operations/shifts?"+new URLSearchParams({businessId,branchId,limit:"100",...(dayId?{dayId}:{})}).toString(),{method:"GET"});
  }
  getShiftPolicy(businessId:string,branchId:string):Promise<{policy:MobileShiftPolicy}>{
    return this.authorizedJson("/v1/operations/sale-shift-policy?"+new URLSearchParams({businessId,branchId}).toString(),{method:"GET"});
  }
  updateShiftPolicy(businessId:string,branchId:string,input:{required:boolean;expectedRevision:string|null;reason:string}):Promise<{policy:MobileShiftPolicy}>{
    return this.authorizedJson("/v1/operations/sale-shift-policy?"+new URLSearchParams({businessId,branchId}).toString(),{method:"PATCH",body:JSON.stringify(input)});
  }
  getOwnCashShift(businessId:string,branchId:string):Promise<MobileOwnCashShiftStatus>{
    const query=new URLSearchParams({businessId,branchId});
    return this.authorizedJson<MobileOwnCashShiftStatus>(
      "/v1/operations/current?"+query.toString(),{method:"GET"},
    );
  }

  getInventory(businessId: string, branchId: string, search = ""): Promise<MobileInventoryResponse> {
    const query = new URLSearchParams({ businessId, branchId });
    const normalized = search.trim();
    if (normalized) query.set("query", normalized);
    return this.authorizedJson<MobileInventoryResponse>(`/v1/inventory?${query.toString()}`, { method: "GET" });
  }

  getMoneyAccounts(businessId:string,branchId:string):Promise<{accounts:MobileMoneyAccount[]}>{
    return this.authorizedJson("/v1/money-accounts?"+new URLSearchParams({businessId,branchId}).toString(),{method:"GET"});
  }
  getMoneyDefaults(businessId:string,branchId:string):Promise<{defaults:MobileMoneyDefault[]}>{
    return this.authorizedJson("/v1/money-account-defaults?"+new URLSearchParams({businessId,branchId}).toString(),{method:"GET"});
  }
  updateCustomerCredit(businessId:string,customerId:string,input:Pick<CustomerUpdateInput,"expectedUpdatedAt"|"creditLimitMinor"|"creditTermsDays"|"active">):Promise<{customer:MobileCustomer}>{
    return this.authorizedJson("/v1/customers/"+encodeURIComponent(customerId),{method:"PATCH",body:JSON.stringify({businessId,expectedUpdatedAt:input.expectedUpdatedAt,creditLimitMinor:input.creditLimitMinor,creditTermsDays:input.creditTermsDays,active:input.active})});
  }
  getCustomers(businessId:string,search=""):Promise<{customers:MobileCustomer[]}>{
    const query=new URLSearchParams({businessId,limit:"200"});
    if(search.trim())query.set("query",search.trim());
    return this.authorizedJson<{customers:MobileCustomer[]}>("/v1/customers?"+query.toString(),{method:"GET"});
  }
  getCustomer(businessId:string,customerId:string):Promise<MobileCustomerDetail>{
    const query=new URLSearchParams({businessId,limit:"100"});
    return this.authorizedJson<MobileCustomerDetail>("/v1/customers/"+encodeURIComponent(customerId)+"?"+query.toString(),{method:"GET"});
  }
  createCustomerContact(businessId:string,input:Pick<CustomerCreateInput,"name"|"phone"|"email">):Promise<{customer:MobileCustomer}>{
    return this.authorizedJson<{customer:MobileCustomer}>("/v1/customers",{
      method:"POST",body:JSON.stringify({businessId,name:input.name,phone:input.phone,email:input.email}),
    });
  }
  updateCustomerContact(businessId:string,customerId:string,input:Pick<CustomerUpdateInput,"name"|"phone"|"email"|"expectedUpdatedAt">):Promise<{customer:MobileCustomer}>{
    return this.authorizedJson<{customer:MobileCustomer}>("/v1/customers/"+encodeURIComponent(customerId),{
      method:"PATCH",body:JSON.stringify({businessId,name:input.name,phone:input.phone,email:input.email,expectedUpdatedAt:input.expectedUpdatedAt}),
    });
  }
  getSales(businessId:string,branchId:string,search=""):Promise<{sales:MobileSaleSummary[]}>{
    const query=new URLSearchParams({businessId,branchId,limit:"100"});
    if(search.trim())query.set("query",search.trim());
    return this.authorizedJson<{sales:MobileSaleSummary[]}>("/v1/sales?"+query.toString(),{method:"GET"});
  }
  getSale(businessId:string,saleId:string):Promise<{sale:MobileSaleDetail}>{
    const query=new URLSearchParams({businessId});
    return this.authorizedJson<{sale:MobileSaleDetail}>("/v1/sales/"+encodeURIComponent(saleId)+"?"+query.toString(),{method:"GET"});
  }

  askBusinessQuestion(
    businessId: string, branchId: string, question: string,
  ): Promise<BusinessQuestionResponse> {
    return this.authorizedJson<BusinessQuestionResponse>("/v1/intelligence/question", {
      method: "POST",
      body: JSON.stringify({ businessId, branchId, question }),
    });
  }

  getBusinessNotifications(businessId: string, branchId: string): Promise<BusinessNotificationsResponse> {
    const query = new URLSearchParams({ businessId, branchId });
    return this.authorizedJson<BusinessNotificationsResponse>(
      `/v1/intelligence/notifications?${query.toString()}`, { method: "GET" },
    );
  }

  acknowledgeBusinessNotification(
    businessId: string, branchId: string, kind: BusinessNotificationKind, notificationId: string,
  ): Promise<{ readAt: string }> {
    const query = new URLSearchParams({ businessId, branchId });
    const id = encodeURIComponent(notificationId);
    return this.authorizedJson<{ readAt: string }>(
      `/v1/intelligence/notifications/${encodeURIComponent(kind)}/${id}/read?${query.toString()}`,
      { method: "POST" },
    );
  }

  push(request: SyncPushRequest): Promise<SyncResponse> {
    return this.authorizedJson<SyncResponse>("/v1/sync", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async logout(): Promise<void> {
    const session = await this.options.persistence.loadSession();
    try {
      if (session) {
        await this.fetchImpl(`${this.baseUrl}/v1/auth/logout`, {
          method: "POST",
          headers: { authorization: `Bearer ${session.accessToken}` },
        });
      }
    } catch {
      // Local sign-out is authoritative for this device even when the network is down.
    } finally {
      await this.options.persistence.clearSession();
    }
  }

  private async authorizedJson<T>(path: string, init: RequestInit): Promise<T> {
    const session = await this.options.persistence.loadSession();
    if (!session) throw new SessionExpiredError();

    let response = await this.fetchAuthorized(path, init, session.accessToken);
    if (response.status === 401) {
      const refreshed = await this.refreshAfterUnauthorized(session.accessToken);
      response = await this.fetchAuthorized(path, init, refreshed.accessToken);
      if (response.status === 401) {
        await this.options.persistence.clearSession();
        throw new SessionExpiredError();
      }
    }

    const payload = await readJson<T & ApiErrorPayload>(response);
    if (!response.ok) throw apiError(response.status, payload);
    return payload;
  }

  private fetchAuthorized(path: string, init: RequestInit, accessToken: string): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    return this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
  }

  private async refreshAfterUnauthorized(rejectedAccessToken: string): Promise<MobileSessionTokens> {
    const current = await this.options.persistence.loadSession();
    if (!current) throw new SessionExpiredError();
    if (current.accessToken !== rejectedAccessToken) return current;
    if (this.refreshInFlight) return this.refreshInFlight;

    const refresh = this.performRefresh(current.refreshToken).finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null;
    });
    this.refreshInFlight = refresh;
    return refresh;
  }

  private async performRefresh(refreshToken: string): Promise<MobileSessionTokens> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const payload = await readJson<SessionResponse & ApiErrorPayload>(response);
    if (!response.ok || !isSessionTokens(payload.session)) {
      await this.options.persistence.clearSession();
      throw new SessionExpiredError(payload.message);
    }
    await this.options.persistence.saveSession(payload.session);
    return payload.session;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MobileApiError("TradeOS returned an unreadable response.", 502, "INVALID_API_RESPONSE");
  }
}

function apiError(statusCode: number, payload: ApiErrorPayload): MobileApiError {
  return new MobileApiError(
    payload.message ?? "TradeOS could not complete the request.",
    statusCode,
    payload.error ?? "API_REQUEST_FAILED",
  );
}

function isSessionTokens(value: unknown): value is MobileSessionTokens {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<MobileSessionTokens>;
  return typeof row.accessToken === "string" && row.accessToken.length > 0
    && typeof row.refreshToken === "string" && row.refreshToken.length > 0
    && typeof row.accessExpiresAt === "string" && row.accessExpiresAt.length > 0
    && typeof row.refreshExpiresAt === "string" && row.refreshExpiresAt.length > 0;
}