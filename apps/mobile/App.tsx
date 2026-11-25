import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import { Platform, StatusBar, View } from "react-native";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { WorkspaceHeader } from "./src/components/WorkspaceHeader";
import { MobileApiClient,type MobileOwnCashShiftStatus } from "./src/api-client";
import { MobileAppModel, type MobileAppSnapshot } from "./src/app-model";
import { ActionDialog } from "./src/components/ActionDialog";
import { saleActionFeedback, signOutFeedback, type MobileActionFeedback } from "./src/action-feedback";
import { BottomNav, type BottomNavTab } from "./src/components/BottomNav";
import { createNativeMobilePersistence, createNativeQueueStorage } from "./src/native-storage";
import { MobileRuntime } from "./src/runtime";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MoreScreen } from "./src/screens/MoreScreen";
import { NotificationsScreen } from "./src/screens/NotificationsScreen";
import { BusinessQuestionsScreen } from "./src/screens/BusinessQuestionsScreen";
import { PosScreen } from "./src/screens/PosScreen";
import type { SaleReversal } from "./src/sale-reversal";
import type { StockAdjustment } from "./src/inventory-adjustment";
import type { CustomerReceiptInput } from "./src/customer-payment";
import { WorkspaceSwitchScreen } from "./src/screens/WorkspaceSwitchScreen";
import { ProviderSettingsScreen } from "./src/screens/ProviderSettingsScreen";
import { BusinessAdminScreen } from "./src/screens/BusinessAdminScreen";
import { ReportsScreen } from "./src/screens/ReportsScreen";
import { OperationsScreen } from "./src/screens/OperationsScreen";
import type { OperationTransaction } from "./src/operations-workspace";
import { FinanceScreen } from "./src/screens/FinanceScreen";
import type { TreasuryTransaction } from "./src/treasury-workspace";
import type { FinanceTransaction } from "./src/finance-workspace";
import { PurchaseOrdersScreen } from "./src/screens/PurchaseOrdersScreen";
import { SuppliersScreen } from "./src/screens/SuppliersScreen";
import type { SupplierTransaction } from "./src/supplier-workspace";
import { DocumentsScreen } from "./src/screens/DocumentsScreen";
import { CatalogStockScreen } from "./src/screens/CatalogStockScreen";
import { CustomersScreen } from "./src/screens/CustomersScreen";
import { SalesScreen } from "./src/screens/SalesScreen";
import { ErrorScreen, LoadingScreen, NeedsBusinessScreen } from "./src/screens/BootScreens";
import { colors } from "./src/theme";

const APP_VERSION = "0.0.1";
const DEFAULT_API_BASE = "https://tradeosafrica.lightworldtech.com";

/**
 * App root — a thin shell that:
 *  1. Wires the mobile runtime (MobileApiClient + MobileRuntime + MobileAppModel)
 *     using native persistence and queue storage. Business logic is unchanged
 *     from the prior implementation.
 *  2. Subscribes to NetInfo and forwards connectivity events to the model.
 *  3. Renders the appropriate screen for the current mobile phase, and — once
 *     the workspace is READY — anchors a BottomNav below the active screen.
 *
 * All presentation is delegated to the TradeOS design system in `src/components`
 * and `src/screens`. This file holds no inline StyleSheet colors or hex values.
 */
export default function App() {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}><MobileWorkspace /></SafeAreaProvider>;
}

function MobileWorkspace() {
  const services = useMemo(() => {
    const persistence = createNativeMobilePersistence();
    const api = new MobileApiClient({
      baseUrl: process.env.EXPO_PUBLIC_TRADEOS_API_BASE ?? DEFAULT_API_BASE,
      persistence,
      platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
      appVersion: APP_VERSION,
    });
    const runtime = new MobileRuntime({
      api,
      persistence,
      queueStorage: createNativeQueueStorage(),
      now: () => new Date().toISOString(),
      createMutationId: () => Crypto.randomUUID(),
    });
    return { model: new MobileAppModel(runtime), api, runtime };
  }, []);

  const { model, api, runtime } = services;
  const [snapshot, setSnapshot] = useState<MobileAppSnapshot>(model.snapshot);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [feedback,setFeedback]=useState<MobileActionFeedback|null>(null);
  const checkoutLock=useRef(false);
  const [screen, setScreen] = useState<BottomNavTab | "notifications" | "questions" | "catalog" | "inventory" | "documents" | "suppliers" | "purchaseOrders" | "finance" | "operations" | "reports" | "businessAdmin" | "providers" | "workspaceSwitch">("dashboard");

  useEffect(() => {
    let mounted = true;
    const apply = (next: MobileAppSnapshot) => { if (mounted) setSnapshot(next); };
    void model.start().then(apply);
    const unsubscribe = NetInfo.addEventListener((network) => {
      const online = network.isConnected === true && network.isInternetReachable !== false;
      void model.connectivityChanged(online).then(apply);
    });
    return () => { mounted = false; unsubscribe(); };
  }, [model]);

  const login = async () => {
    if (!identifier.trim() || !password) return;
    const next = await model.login(identifier, password);
    setSnapshot(next);
    if (next.phase === "READY" || next.phase === "NEEDS_BUSINESS") {
      setPassword("");
      setScreen("dashboard");
    }
  };
  const refreshCommerce = async () => {const operation=model.loadCommerce();setSnapshot(model.snapshot);setSnapshot(await operation);};
  const sync = async () => {
    const operation=model.sync();setSnapshot(model.snapshot);
    const next=await operation;setSnapshot(next);
    if(next.error)setFeedback({tone:"danger",title:"Sync needs attention",message:next.error});
    else if(next.phase==="READY"&&next.online===true)void refreshCommerce();
  };
  const checkout = async (quickServe:boolean) => {
    if(checkoutLock.current||model.snapshot.cart.length===0||model.snapshot.checkoutBusy)return;
    checkoutLock.current=true;
    try{
      const operation=model.checkout();setSnapshot(model.snapshot);
      const next=await operation;setSnapshot(next);
      if(next.phase==="READY"){
        setFeedback(saleActionFeedback(next.saleNotice,next.error,quickServe));
        if(next.saleNotice?.tone==="success"&&next.online===true)void refreshCommerce();
      }
    }finally{checkoutLock.current=false;}
  };
  const getOwnCashShift = useCallback((businessId:string,branchId:string)=>
    api.getOwnCashShift(businessId,branchId),[api]);
  const ownCashShift = async (
    status:MobileOwnCashShiftStatus,countedMinor:number,note:string,
  ) => {
    try {
      await runtime.recordOwnCashShift(status,countedMinor,note,snapshot.online===true);
    } finally {
      setSnapshot(await model.sync());
    }
  };
  const logout = async () => {
    if(checkoutLock.current)return;
    setFeedback(null);
    setSnapshot(await model.logout());
    setPassword("");
    setSearch("");
    setScreen("dashboard");
  };
  const recordCustomerReceipt=async(input:CustomerReceiptInput)=>{
    if(checkoutLock.current)throw new Error("Another transaction is in progress.");
    checkoutLock.current=true;
    try{
      return await runtime.recordCustomerReceipt(input,snapshot.online===true);
    }finally{
      try{if(model.snapshot.phase==="READY")setSnapshot(await model.refreshQueueState());}
      finally{checkoutLock.current=false;}
    }
  };
  const recordStockAdjustment=async(input:StockAdjustment)=>{
    if(checkoutLock.current)throw new Error("Another transaction is in progress.");
    checkoutLock.current=true;
    try{return await runtime.recordStockAdjustment(input,snapshot.online===true);}
    finally{try{setSnapshot(await model.refreshQueueState());}finally{checkoutLock.current=false;}}
  };
  const recordSupplierTransaction=async(input:SupplierTransaction)=>{
    if(checkoutLock.current)throw new Error("Another transaction is in progress.");
    checkoutLock.current=true;
    try{return await runtime.recordSupplierTransaction(input,snapshot.online===true);}
    finally{try{setSnapshot(await model.refreshQueueState());void refreshCommerce();}finally{checkoutLock.current=false;}}
  };
  const recordFinanceTransaction=async(input:FinanceTransaction|TreasuryTransaction)=>{
    if(checkoutLock.current)throw new Error("Another transaction is in progress.");
    checkoutLock.current=true;
    try{return await runtime.recordFinanceTransaction(input,snapshot.online===true);}
    finally{try{setSnapshot(await model.refreshQueueState());}finally{checkoutLock.current=false;}}
  };
  const recordSaleReversal=async(input:SaleReversal)=>{
    if(checkoutLock.current)throw new Error("Another transaction is in progress.");
    checkoutLock.current=true;
    try{return await runtime.recordSaleReversal(input,snapshot.online===true);}
    finally{try{setSnapshot(await model.refreshQueueState());void refreshCommerce();}finally{checkoutLock.current=false;}}
  };
  const recordOperation=async(input:OperationTransaction)=>{
    if(checkoutLock.current)throw new Error("Another transaction is in progress.");
    checkoutLock.current=true;
    try{return await runtime.recordOperation(input,snapshot.online===true);}
    finally{try{setSnapshot(await model.refreshQueueState());}finally{checkoutLock.current=false;}}
  };
  const retry = async () => setSnapshot(await model.start());

  const addCart = (item: Parameters<typeof model.addCart>[0]) => setSnapshot(model.addCart(item));
  const changeQuantity = (key: string, quantity: number) => setSnapshot(model.setCartQuantity(key, quantity));
  const removeCart = (key: string) => setSnapshot(model.removeCart(key));
  const selectPayment = (method: Parameters<typeof model.selectPaymentMethod>[0]) =>
    setSnapshot(model.selectPaymentMethod(method));

  const queue = snapshot.bootstrap?.status === "READY" ? snapshot.bootstrap.queue : null;
  const ready = snapshot.bootstrap?.status === "READY" ? snapshot.bootstrap : null;

  const workspaceReady=snapshot.phase==="READY"&&ready!==null;
  const attendantOnly=ready?.membership.role==="POS_ATTENDANT";
  const activeScreen=attendantOnly?"sell":screen;
  const titleByScreen={dashboard:"Dashboard",sell:"Sell (POS)",sales:"Sales",customers:"Customers",catalog:"Catalog",inventory:"Inventory",documents:"Quotes & proformas",suppliers:"Suppliers & purchases",purchaseOrders:"Purchase orders",finance:"Cashbook & expenses",operations:"Operating days & shifts",reports:"Reports & analytics",businessAdmin:"Business administration",providers:"Payment & SMS integrations",workspaceSwitch:"Switch workspace",more:"More",notifications:"Notifications",questions:"Business intelligence"} as const;
  return (
    <SafeAreaView style={[styles.safeArea,workspaceReady&&styles.workspaceSafeArea]}
      edges={workspaceReady?["top","left","right"]:["top","left","right","bottom"]}>
      <StatusBar barStyle={workspaceReady?"dark-content":"light-content"} />
      {workspaceReady&&ready?<WorkspaceHeader
        businessName={ready.business.name} branchName={ready.branch.name}
        userName={ready.user.displayName} title={titleByScreen[activeScreen]}
        online={snapshot.online} syncing={snapshot.syncing}
        pendingCount={ready.queue.pending} failedCount={ready.queue.failed}
        onMenu={()=>{if(attendantOnly){if(!checkoutLock.current)setFeedback(signOutFeedback);}else if(!checkoutLock.current)setScreen("more");}}
        attendantOnly={attendantOnly}/> : null}
      <View style={styles.flex}>
        {snapshot.phase === "BOOTING" ? <LoadingScreen /> : null}

        {snapshot.phase === "SIGNED_OUT" ? (
          <LoginScreen
            snapshot={snapshot}
            identifier={identifier}
            password={password}
            onIdentifier={setIdentifier}
            onPassword={setPassword}
            onLogin={() => { void login(); }}
          />
        ) : null}

        {snapshot.phase === "NEEDS_BUSINESS" ? (
          <NeedsBusinessScreen snapshot={snapshot} onLogout={() => { void logout(); }} />
        ) : null}

        {snapshot.phase === "ERROR" ? (
          <ErrorScreen message={snapshot.error} onRetry={() => { void retry(); }} />
        ) : null}

        {snapshot.phase === "READY" ? (
          <>
            <View style={styles.flex}>
              {activeScreen === "dashboard" ? (
                <DashboardScreen
                  snapshot={snapshot}
                  onGoToSell={() => setScreen("sell")}
                  onGoToSales={() => setScreen("sales")}
                  onGoToMore={() => setScreen("more")}
                  onSync={() => { void sync(); }}
                  onRefreshCatalog={() => { void refreshCommerce(); }}
                />
              ) : null}
              {activeScreen === "sell" ? (
                <PosScreen
                  snapshot={snapshot}
                  search={search}
                  onSearch={setSearch}
                  onRefresh={() => { void refreshCommerce(); }}
                  onAdd={addCart}
                  onQuantity={changeQuantity}
                  onRemove={removeCart}
                  onPayment={selectPayment}
                  onCheckout={(quickServe) => { void checkout(quickServe); }}
                  getOwnCashShift={getOwnCashShift}
                  onOwnCashShift={ownCashShift}
                />
              ) : null}
              {activeScreen === "sales" ? (
                <SalesScreen
                  api={api}
                  snapshot={snapshot}
                  onSync={() => { void sync(); }}
                  onGoToSell={() => setScreen("sell")}
                  onReversal={recordSaleReversal} onFeedback={setFeedback}
                />
              ) : null}
              {activeScreen === "customers" && ready ? (
                <CustomersScreen
                  key={ready.user.id+":"+ready.membership.businessId+":"+ready.membership.role}
                  api={api} businessId={ready.membership.businessId}
                  role={ready.membership.role} currencyCode={ready.business.currencyCode}
                  branchId={ready.branch.id} onReceipt={recordCustomerReceipt}
                  timezone={ready.branch.timezone} online={snapshot.online===true}
                  onFeedback={setFeedback}/>
              ) : null}
              {(activeScreen==="catalog"||activeScreen==="inventory")&&ready ? (
                <CatalogStockScreen key={ready.user.id+":"+ready.business.id+":"+ready.branch.id+":"+ready.membership.role+":"+activeScreen}
                  mode={activeScreen} api={api} businessId={ready.business.id} branchId={ready.branch.id}
                  currencyCode={ready.business.currencyCode} role={ready.membership.role} online={snapshot.online===true}
                  queueVersion={ready.queue.pending+":"+ready.queue.failed} onBack={()=>setScreen("more")}
                  onFeedback={setFeedback} onAdjustment={recordStockAdjustment} onCatalogChanged={()=>{void refreshCommerce();}}/>
              ):null}
              {activeScreen==="documents"&&ready?<DocumentsScreen
                key={ready.user.id+":"+ready.business.id+":"+ready.branch.id+":"+ready.membership.role}
                api={api} businessId={ready.business.id} branchId={ready.branch.id} role={ready.membership.role}
                online={snapshot.online===true} currencyCode={ready.business.currencyCode}
                onFeedback={setFeedback} onBack={()=>setScreen("more")}/>:null}
              {activeScreen==="suppliers"&&ready?<SuppliersScreen
                key={ready.user.id+":"+ready.business.id+":"+ready.branch.id+":"+ready.membership.role}
                api={api} businessId={ready.business.id} branchId={ready.branch.id} role={ready.membership.role}
                online={snapshot.online===true} currencyCode={ready.business.currencyCode}
                onRecord={recordSupplierTransaction} onFeedback={setFeedback} onBack={()=>setScreen("more")}/>:null}
              {activeScreen==="purchaseOrders"&&ready?<PurchaseOrdersScreen
                key={ready.user.id+":"+ready.business.id+":"+ready.branch.id+":"+ready.membership.role}
                api={api} businessId={ready.business.id} branchId={ready.branch.id} role={ready.membership.role}
                online={snapshot.online===true} currencyCode={ready.business.currencyCode}
                onRecord={recordSupplierTransaction} onFeedback={setFeedback} onBack={()=>setScreen("more")}/>:null}
              {activeScreen==="finance"&&ready?<FinanceScreen
                key={ready.user.id+":"+ready.business.id+":"+ready.branch.id+":"+ready.membership.role}
                api={api} businessId={ready.business.id} branchId={ready.branch.id} role={ready.membership.role}
                online={snapshot.online===true} currencyCode={ready.business.currencyCode}
                onRecord={recordFinanceTransaction} onFeedback={setFeedback} onBack={()=>setScreen("more")}/>:null}
              {activeScreen==="operations"&&ready?<OperationsScreen
                key={ready.user.id+":"+ready.business.id+":"+ready.branch.id+":"+ready.membership.role}
                api={api} businessId={ready.business.id} branchId={ready.branch.id} role={ready.membership.role}
                online={snapshot.online===true} currencyCode={ready.business.currencyCode} timezone={ready.branch.timezone}
                onRecord={recordOperation} onFeedback={setFeedback} onBack={()=>setScreen("more")}/>:null}
              {activeScreen==="reports"&&ready?<ReportsScreen
                key={ready.user.id+":"+ready.business.id+":"+ready.branch.id+":"+ready.membership.role}
                api={api} businessId={ready.business.id} branchId={ready.branch.id} branchName={ready.branch.name}
                role={ready.membership.role} online={snapshot.online===true} currencyCode={ready.business.currencyCode}
                onBack={()=>setScreen("more")}/>:null}
              {activeScreen==="businessAdmin"&&ready?<BusinessAdminScreen
                key={ready.user.id+":"+ready.business.id+":"+ready.branch.id+":"+ready.membership.role}
                api={api} businessId={ready.business.id} branchId={ready.branch.id} role={ready.membership.role}
                staffId={ready.membership.staffId} online={snapshot.online===true}
                portalOrigin={process.env.EXPO_PUBLIC_TRADEOS_API_BASE??DEFAULT_API_BASE}
                onChanged={()=>{if(!checkoutLock.current){checkoutLock.current=true;void model.start().then(setSnapshot).finally(()=>{checkoutLock.current=false;});}}}
                onFeedback={setFeedback} onBack={()=>setScreen("more")}/>:null}
              {activeScreen==="providers"&&ready?<ProviderSettingsScreen
                key={ready.user.id+":"+ready.business.id+":"+ready.branch.id+":"+ready.membership.role}
                api={api} businessId={ready.business.id} role={ready.membership.role} online={snapshot.online===true}
                onFeedback={setFeedback} onBack={()=>setScreen("more")}/>:null}
              {activeScreen==="workspaceSwitch"&&ready?<WorkspaceSwitchScreen
                key={ready.user.id+":"+ready.business.id+":"+ready.branch.id}
                api={api} ready={ready} online={snapshot.online===true} cartCount={snapshot.cart.length} syncing={snapshot.syncing}
                onBack={()=>setScreen("more")}
                onSwitch={async(businessId,branchId)=>{
                  if(checkoutLock.current)throw new Error("A transaction is in progress.");
                  checkoutLock.current=true;
                  try{
                    const operation=model.switchWorkspace(businessId,branchId);setSnapshot(model.snapshot);
                    const next=await operation;setSnapshot(next);setSearch("");setScreen("dashboard");
                    setFeedback({tone:"success",title:"Workspace changed",message:"The selected business and branch are now active."});
                  }catch(e){setSnapshot(model.snapshot);setFeedback({tone:"warning",title:"Workspace not changed",message:e instanceof Error?e.message:"Refresh the workspace."});throw e;}
                  finally{checkoutLock.current=false;}
                }}/>:null}
              {activeScreen === "more" ? (
                <MoreScreen
                  snapshot={snapshot}
                  appVersion={APP_VERSION}
                  onSync={() => { void sync(); }}
                  onRefreshCatalog={() => { void refreshCommerce(); }}
                  onLogout={() => { if(!checkoutLock.current)setFeedback(signOutFeedback); }}
                  onGoToNotifications={() => setScreen("notifications")}
                  onGoToWorkspaceSwitch={()=>setScreen("workspaceSwitch")}
                  onGoToProviders={()=>setScreen("providers")}
                  onGoToBusinessAdmin={()=>setScreen("businessAdmin")}
                  onGoToReports={()=>setScreen("reports")}
                  onGoToOperations={()=>setScreen("operations")}
                  onGoToFinance={()=>setScreen("finance")}
                  onGoToPurchaseOrders={()=>setScreen("purchaseOrders")}
                  onGoToSuppliers={()=>setScreen("suppliers")}
                  onGoToDocuments={()=>setScreen("documents")}
                  onGoToCatalog={()=>setScreen("catalog")}
                  onGoToInventory={()=>setScreen("inventory")}
                  onGoToQuestions={() => setScreen("questions")}
                />
              ) : null}
              {activeScreen === "questions" && ready ? (
                <BusinessQuestionsScreen
                  key={ready.user.id + ":" + ready.membership.businessId + ":" + ready.branch.id + ":" + ready.membership.role}
                  api={api}
                  businessId={ready.membership.businessId}
                  branchId={ready.branch.id}
                  role={ready.membership.role}
                  online={snapshot.online === true}
                  onBack={() => setScreen("more")}
                />
              ) : null}
              {activeScreen === "notifications" && ready ? (
                <NotificationsScreen
                  key={ready.user.id + ":" + ready.membership.businessId + ":" + ready.branch.id + ":" + ready.membership.role}
                  api={api}
                  businessId={ready.membership.businessId}
                  branchId={ready.branch.id}
                  role={ready.membership.role}
                  online={snapshot.online === true}
                  onBack={() => setScreen("more")}
                />
              ) : null}
            </View>
            <BottomNav
              active={activeScreen === "notifications" || activeScreen === "questions" || activeScreen==="catalog" || activeScreen==="inventory" || activeScreen==="documents" || activeScreen==="suppliers" || activeScreen==="purchaseOrders" || activeScreen==="finance" || activeScreen==="operations" || activeScreen==="reports" || activeScreen==="businessAdmin" || activeScreen==="providers" || activeScreen==="workspaceSwitch" ? "more" : activeScreen}
              onChange={next=>{if(!checkoutLock.current)setScreen(next);}}
              attendantOnly={attendantOnly}
              onSignOut={()=>{if(!checkoutLock.current)setFeedback(signOutFeedback);}}
              pendingCount={queue?.pending ?? 0}
              failedCount={queue?.failed ?? 0}
            />
          </>
        ) : null}
      </View>
      <ActionDialog feedback={feedback} onDismiss={()=>setFeedback(null)}
        {...(feedback?.confirmLabel?{onConfirm:()=>{void logout();}}:{})} />
    </SafeAreaView>
  );
}

// Tiny local styles — no inline colors; the design system owns palette + spacing.
const styles = {
  safeArea: { flex: 1, backgroundColor: colors.midnight } as const,
  workspaceSafeArea: { backgroundColor: colors.surface } as const,
  flex: { flex: 1, minHeight:0 } as const,
};
