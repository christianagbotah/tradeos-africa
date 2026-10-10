import { useEffect, useMemo, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MobileApiClient } from "./src/api-client";
import { MobileAppModel, type MobileAppSnapshot, type MobileWorkspaceView } from "./src/app-model";
import { createNativeMobilePersistence, createNativeQueueStorage } from "./src/native-storage";
import {
  displayCartTotalMinor,
  filterSellableItems,
  type MobileCartLine,
  type MobileImmediatePaymentMethod,
  type MobileSellableItem,
} from "./src/pos-model";
import { MobileRuntime } from "./src/runtime";

const APP_VERSION = "0.0.1";
const DEFAULT_API_BASE = "https://tradeosafrica.lightworldtech.com/api/mobile";
const SALE_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "STAFF"]);
const PAYMENT_METHODS: Array<{ value: MobileImmediatePaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "MOMO", label: "MoMo" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank" },
  { value: "OTHER", label: "Other" },
];

export default function App() {
  const model = useMemo(() => {
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
    return new MobileAppModel(runtime);
  }, []);
  const [snapshot, setSnapshot] = useState<MobileAppSnapshot>(model.snapshot);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");

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
    if (next.phase === "READY" || next.phase === "NEEDS_BUSINESS") setPassword("");
  };
  const sync = async () => setSnapshot(await model.sync());
  const refreshCommerce = async () => setSnapshot(await model.loadCommerce());
  const checkout = async () => setSnapshot(await model.checkout());
  const logout = async () => {
    setSnapshot(await model.logout());
    setPassword("");
    setSearch("");
  };
  const retry = async () => setSnapshot(await model.start());
  const setView = (view: MobileWorkspaceView) => setSnapshot(model.setView(view));
  const addCart = (item: MobileSellableItem) => setSnapshot(model.addCart(item));
  const changeQuantity = (key: string, quantity: number) => setSnapshot(model.setCartQuantity(key, quantity));
  const removeCart = (key: string) => setSnapshot(model.removeCart(key));
  const selectPayment = (method: MobileImmediatePaymentMethod) => setSnapshot(model.selectPaymentMethod(method));

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#071d17" />
      {snapshot.phase === "BOOTING" ? <LoadingScreen /> : null}
      {snapshot.phase === "SIGNED_OUT" ? (
        <AuthScreen
          snapshot={snapshot}
          identifier={identifier}
          password={password}
          onIdentifier={setIdentifier}
          onPassword={setPassword}
          onLogin={() => { void login(); }}
        />
      ) : null}
      {snapshot.phase === "NEEDS_BUSINESS" ? <NeedsBusiness snapshot={snapshot} onLogout={() => { void logout(); }} /> : null}
      {snapshot.phase === "READY" ? (
        <Workspace
          snapshot={snapshot}
          search={search}
          onSearch={setSearch}
          onView={setView}
          onRefresh={() => { void refreshCommerce(); }}
          onAdd={addCart}
          onQuantity={changeQuantity}
          onRemove={removeCart}
          onPayment={selectPayment}
          onCheckout={() => { void checkout(); }}
          onSync={() => { void sync(); }}
          onLogout={() => { void logout(); }}
        />
      ) : null}
      {snapshot.phase === "ERROR" ? <ErrorScreen message={snapshot.error} onRetry={() => { void retry(); }} /> : null}
    </SafeAreaView>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.centered}>
      <Brand compact />
      <ActivityIndicator size="large" color="#d7aa47" />
      <Text style={styles.loadingText}>Opening your TradeOS workspace…</Text>
    </View>
  );
}

function AuthScreen({ snapshot, identifier, password, onIdentifier, onPassword, onLogin }: {
  snapshot: MobileAppSnapshot;
  identifier: string;
  password: string;
  onIdentifier: (value: string) => void;
  onPassword: (value: string) => void;
  onLogin: () => void;
}) {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.authPage} keyboardShouldPersistTaps="handled">
        <View style={styles.authHero}>
          <Brand />
          <View style={styles.authHeroCopy}>
            <Text style={styles.eyebrow}>The business OS for African trade</Text>
            <Text style={styles.authTitle}>Run the day from your pocket.</Text>
            <Text style={styles.authLead}>Sell, keep working offline and synchronize through the same server-authoritative TradeOS ledger.</Text>
          </View>
          <ConnectionPill online={snapshot.online} />
        </View>

        <View style={styles.authCard}>
          <Text style={styles.cardKicker}>Secure access</Text>
          <Text style={styles.cardTitle}>Sign in to TradeOS</Text>
          <Text style={styles.cardCopy}>Use the same owner or staff account you use on the web workspace.</Text>
          {snapshot.error ? <ErrorBanner message={snapshot.error} /> : null}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email or phone</Text>
            <TextInput
              value={identifier}
              onChangeText={onIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@business.com"
              placeholderTextColor="#81918b"
              style={styles.input}
              returnKeyType="next"
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              value={password}
              onChangeText={onPassword}
              secureTextEntry
              placeholder="Enter your password"
              placeholderTextColor="#81918b"
              style={styles.input}
              onSubmitEditing={onLogin}
              returnKeyType="go"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={!identifier.trim() || !password}
            onPress={onLogin}
            style={({ pressed }) => [styles.primaryButton, (!identifier.trim() || !password) && styles.buttonDisabled, pressed && styles.buttonPressed]}
          >
            <Text style={styles.primaryButtonText}>Open workspace</Text>
          </Pressable>
          <View style={styles.securityNote}>
            <Text style={styles.securityIcon}>◆</Text>
            <Text style={styles.securityText}>Credentials stay in the secure device vault. Durably saved sales survive app restarts and connectivity loss.</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function NeedsBusiness({ snapshot, onLogout }: { snapshot: MobileAppSnapshot; onLogout: () => void }) {
  const user = snapshot.bootstrap?.status === "NEEDS_BUSINESS" ? snapshot.bootstrap.user : null;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Header online={snapshot.online} />
      <View style={styles.noticeCard}>
        <Text style={styles.cardKicker}>Account connected</Text>
        <Text style={styles.sectionTitle}>Welcome, {user?.displayName ?? "TradeOS user"}</Text>
        <Text style={styles.cardCopy}>Your account does not currently have an active business membership. Create or reactivate a business in the web workspace, then return here.</Text>
      </View>
      <Pressable style={styles.secondaryButton} onPress={onLogout}><Text style={styles.secondaryButtonText}>Sign out</Text></Pressable>
    </ScrollView>
  );
}

function Workspace({
  snapshot,
  search,
  onSearch,
  onView,
  onRefresh,
  onAdd,
  onQuantity,
  onRemove,
  onPayment,
  onCheckout,
  onSync,
  onLogout,
}: {
  snapshot: MobileAppSnapshot;
  search: string;
  onSearch: (value: string) => void;
  onView: (view: MobileWorkspaceView) => void;
  onRefresh: () => void;
  onAdd: (item: MobileSellableItem) => void;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onPayment: (method: MobileImmediatePaymentMethod) => void;
  onCheckout: () => void;
  onSync: () => void;
  onLogout: () => void;
}) {
  if (snapshot.bootstrap?.status !== "READY") return null;
  const ready = snapshot.bootstrap;
  const canSell = SALE_ROLES.has(ready.membership.role);
  const visibleItems = filterSellableItems(snapshot.commerce?.items ?? [], search);

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Header online={snapshot.online} />
      <View style={styles.workspaceHero}>
        <View style={styles.workspaceTopRow}>
          <View style={styles.businessIdentity}>
            <Text style={styles.workspaceEyebrow}>Current business</Text>
            <Text style={styles.businessName}>{ready.business.name}</Text>
            <Text style={styles.businessMeta}>{ready.branch.name} · {ready.membership.role}</Text>
          </View>
          <View style={styles.currencyBadge}><Text style={styles.currencyText}>{ready.business.currencyCode}</Text></View>
        </View>
        <Text style={styles.workspaceCopy}>Prices and stock shown here are read models. The server recalculates and validates every synchronized sale.</Text>
      </View>

      <View style={styles.tabBar}>
        <TabButton active={snapshot.view === "SELL"} label="Sell" onPress={() => onView("SELL")} />
        <TabButton active={snapshot.view === "SYNC"} label={`Sync ${ready.queue.pending > 0 ? `· ${ready.queue.pending}` : ""}`} onPress={() => onView("SYNC")} />
      </View>

      {snapshot.error ? <ErrorBanner message={snapshot.error} /> : null}
      {snapshot.view === "SELL" ? (
        <SellView
          snapshot={snapshot}
          currencyCode={ready.business.currencyCode}
          canSell={canSell}
          search={search}
          visibleItems={visibleItems}
          onSearch={onSearch}
          onRefresh={onRefresh}
          onAdd={onAdd}
          onQuantity={onQuantity}
          onRemove={onRemove}
          onPayment={onPayment}
          onCheckout={onCheckout}
        />
      ) : (
        <SyncView snapshot={snapshot} onSync={onSync} />
      )}

      <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onLogout}>
        <Text style={styles.secondaryButtonText}>Sign out of this device</Text>
      </Pressable>
      <Text style={styles.footerText}>TradeOS Africa · Mobile runtime {APP_VERSION}</Text>
    </ScrollView>
  );
}

function SellView({ snapshot, currencyCode, canSell, search, visibleItems, onSearch, onRefresh, onAdd, onQuantity, onRemove, onPayment, onCheckout }: {
  snapshot: MobileAppSnapshot;
  currencyCode: string;
  canSell: boolean;
  search: string;
  visibleItems: MobileSellableItem[];
  onSearch: (value: string) => void;
  onRefresh: () => void;
  onAdd: (item: MobileSellableItem) => void;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onPayment: (method: MobileImmediatePaymentMethod) => void;
  onCheckout: () => void;
}) {
  const total = displayCartTotalMinor(snapshot.cart);
  return (
    <>
      <View style={styles.sectionHeader}>
        <View style={styles.flex}>
          <Text style={styles.sectionKicker}>Fast sale</Text>
          <Text style={styles.sectionTitle}>Catalog</Text>
          <Text style={styles.sectionCopy}>{commerceFreshness(snapshot)}</Text>
        </View>
        <Pressable disabled={snapshot.commerceLoading} onPress={onRefresh} style={styles.compactButton}>
          {snapshot.commerceLoading ? <ActivityIndicator size="small" color="#173029" /> : <Text style={styles.compactButtonText}>Refresh</Text>}
        </Pressable>
      </View>

      {snapshot.commerce?.warning ? <WarningBanner message={snapshot.commerce.warning} /> : null}
      <TextInput
        value={search}
        onChangeText={onSearch}
        placeholder="Search item, SKU or unit"
        placeholderTextColor="#81918b"
        style={styles.searchInput}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {!snapshot.commerce && snapshot.commerceLoading ? (
        <View style={styles.loadingCard}><ActivityIndicator color="#9b762a" /><Text style={styles.cardCopy}>Loading this branch catalog…</Text></View>
      ) : null}
      {snapshot.commerce && visibleItems.length === 0 ? (
        <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No matching sellable items</Text><Text style={styles.cardCopy}>Try a different search or check the web catalog setup.</Text></View>
      ) : null}
      <View style={styles.catalogList}>
        {visibleItems.map((item) => (
          <CatalogCard key={item.key} item={item} currencyCode={currencyCode} onAdd={() => onAdd(item)} />
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionKicker}>Current sale</Text>
          <Text style={styles.sectionTitle}>Cart · {snapshot.cart.length}</Text>
        </View>
        {snapshot.cart.length > 0 ? <Text style={styles.displayTotal}>{formatMoney(total, currencyCode)}</Text> : null}
      </View>

      {snapshot.cart.length === 0 ? (
        <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Cart is empty</Text><Text style={styles.cardCopy}>Tap Add on a catalog unit to begin a sale.</Text></View>
      ) : (
        <View style={styles.cartCard}>
          {snapshot.cart.map((line) => (
            <CartRow key={line.key} line={line} currencyCode={currencyCode} onQuantity={onQuantity} onRemove={onRemove} />
          ))}
          <View style={styles.totalRow}>
            <View style={styles.flex}><Text style={styles.totalLabel}>Display total</Text><Text style={styles.totalHint}>Server recalculates final price</Text></View>
            <Text style={styles.totalValue}>{formatMoney(total, currencyCode)}</Text>
          </View>
        </View>
      )}

      <View style={styles.paymentCard}>
        <Text style={styles.sectionKicker}>Payment</Text>
        <Text style={styles.paymentTitle}>How is the customer paying?</Text>
        <View style={styles.paymentGrid}>
          {PAYMENT_METHODS.map((method) => (
            <Pressable
              key={method.value}
              onPress={() => onPayment(method.value)}
              style={[styles.paymentChip, snapshot.paymentMethod === method.value && styles.paymentChipActive]}
            >
              <Text style={[styles.paymentChipText, snapshot.paymentMethod === method.value && styles.paymentChipTextActive]}>{method.label}</Text>
            </Pressable>
          ))}
        </View>
        {!canSell ? <WarningBanner message="Your role can browse this catalog but does not have permission to create sales." /> : null}
        {snapshot.saleNotice ? <SaleNotice tone={snapshot.saleNotice.tone} message={snapshot.saleNotice.message} /> : null}
        <Pressable
          accessibilityRole="button"
          disabled={!canSell || snapshot.cart.length === 0 || snapshot.checkoutBusy}
          onPress={onCheckout}
          style={({ pressed }) => [styles.chargeButton, (!canSell || snapshot.cart.length === 0 || snapshot.checkoutBusy) && styles.buttonDisabled, pressed && styles.buttonPressed]}
        >
          {snapshot.checkoutBusy ? <ActivityIndicator color="#071d17" /> : (
            <View style={styles.chargeRow}><Text style={styles.chargeLabel}>Charge</Text><Text style={styles.chargeAmount}>{formatMoney(total, currencyCode)}</Text></View>
          )}
        </Pressable>
        <Text style={styles.checkoutHint}>{snapshot.online === false ? "Offline: the sale will be saved on this device and synchronized later." : "TradeOS saves locally first, then synchronizes with the server."}</Text>
      </View>
    </>
  );
}

function SyncView({ snapshot, onSync }: { snapshot: MobileAppSnapshot; onSync: () => void }) {
  if (snapshot.bootstrap?.status !== "READY") return null;
  const ready = snapshot.bootstrap;
  return (
    <>
      <View style={styles.sectionHeader}>
        <View><Text style={styles.sectionKicker}>Offline engine</Text><Text style={styles.sectionTitle}>Sync queue</Text></View>
        <ConnectionPill online={snapshot.online} />
      </View>
      <View style={styles.metricGrid}>
        <Metric label="Pending" value={ready.queue.pending} />
        <Metric label="Other business" value={ready.queue.blocked} />
        <Metric label="Needs review" value={ready.queue.failed} warning={ready.queue.failed > 0} />
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={snapshot.syncing || snapshot.online !== true}
        onPress={onSync}
        style={({ pressed }) => [styles.primaryButton, (snapshot.syncing || snapshot.online !== true) && styles.buttonDisabled, pressed && styles.buttonPressed]}
      >
        {snapshot.syncing ? <ActivityIndicator color="#071d17" /> : <Text style={styles.primaryButtonText}>Sync now</Text>}
      </Pressable>
      {snapshot.online === false ? <Text style={styles.offlineHint}>You are offline. TradeOS will flush this business automatically when the connection returns.</Text> : null}
      <View style={styles.foundationCard}>
        <Text style={styles.cardKicker}>Data safety</Text>
        <Text style={styles.sectionTitle}>What these counts mean</Text>
        <FoundationRow title="Pending" copy="Durably captured on this device, waiting for server confirmation." />
        <FoundationRow title="Other business" copy="Held locally and never sent into the wrong active business." />
        <FoundationRow title="Needs review" copy="Server rejected the mutation; evidence is preserved for correction or retry." />
      </View>
    </>
  );
}

function CatalogCard({ item, currencyCode, onAdd }: { item: MobileSellableItem; currencyCode: string; onAdd: () => void }) {
  const stock = item.trackStock
    ? item.availableStock === null ? "Stock not cached" : `${formatQuantity(item.availableStock)} ${item.stockUnitCode ?? "stock"} last known`
    : "No stock tracking";
  return (
    <View style={styles.catalogCard}>
      <View style={styles.catalogMain}>
        <Text style={styles.catalogName}>{item.name}</Text>
        <Text style={styles.catalogMeta}>{item.sku ? `${item.sku} · ` : ""}{item.unitLabel}</Text>
        <Text style={styles.stockText}>{stock}</Text>
      </View>
      <View style={styles.catalogAction}>
        <Text style={styles.catalogPrice}>{formatMoney(item.priceMinor, currencyCode)}</Text>
        <Pressable onPress={onAdd} style={styles.addButton}><Text style={styles.addButtonText}>+ Add</Text></Pressable>
      </View>
    </View>
  );
}

function CartRow({ line, currencyCode, onQuantity, onRemove }: {
  line: MobileCartLine;
  currencyCode: string;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
}) {
  const decrease = () => line.quantity <= 1 ? onRemove(line.key) : onQuantity(line.key, line.quantity - 1);
  return (
    <View style={styles.cartRow}>
      <View style={styles.cartInfo}>
        <Text style={styles.cartName}>{line.name}</Text>
        <Text style={styles.catalogMeta}>{line.unitLabel} · {formatMoney(line.priceMinor, currencyCode)}</Text>
      </View>
      <View style={styles.quantityControl}>
        <Pressable onPress={decrease} style={styles.quantityButton}><Text style={styles.quantityButtonText}>−</Text></Pressable>
        <Text style={styles.quantityValue}>{formatQuantity(line.quantity)}</Text>
        <Pressable onPress={() => onQuantity(line.key, line.quantity + 1)} style={styles.quantityButton}><Text style={styles.quantityButtonText}>+</Text></Pressable>
      </View>
      <Pressable accessibilityLabel={`Remove ${line.name}`} onPress={() => onRemove(line.key)} style={styles.removeButton}><Text style={styles.removeButtonText}>×</Text></Pressable>
    </View>
  );
}

function TabButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.tabButton, active && styles.tabButtonActive]}><Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text></Pressable>;
}

function SaleNotice({ tone, message }: { tone: "success" | "pending" | "review"; message: string }) {
  return <View style={[styles.saleNotice, tone === "review" && styles.saleNoticeReview, tone === "success" && styles.saleNoticeSuccess]}><Text style={styles.saleNoticeText}>{message}</Text></View>;
}

function ErrorScreen({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <View style={styles.centered}>
      <Brand compact />
      <View style={styles.noticeCard}>
        <Text style={styles.cardKicker}>Workspace unavailable</Text>
        <Text style={styles.sectionTitle}>TradeOS could not open safely.</Text>
        <Text style={styles.cardCopy}>{message ?? "Check your connection and try again."}</Text>
      </View>
      <Pressable style={styles.primaryButtonWide} onPress={onRetry}><Text style={styles.primaryButtonText}>Retry</Text></Pressable>
    </View>
  );
}

function Header({ online }: { online: boolean | null }) {
  return <View style={styles.header}><Brand compact /><ConnectionPill online={online} /></View>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.brandRow}>
      <View style={[styles.mark, compact && styles.markCompact]}><Text style={styles.markText}>T</Text></View>
      <View><Text style={styles.brand}>TradeOS</Text><Text style={styles.brandAccent}>AFRICA</Text></View>
    </View>
  );
}

function ConnectionPill({ online }: { online: boolean | null }) {
  const label = online === null ? "Checking" : online ? "Online" : "Offline";
  return <View style={[styles.connectionPill, online === false && styles.connectionOffline]}><View style={[styles.connectionDot, online === false && styles.connectionDotOffline]} /><Text style={styles.connectionText}>{label}</Text></View>;
}

function ErrorBanner({ message }: { message: string }) {
  return <View style={styles.errorBanner}><Text style={styles.errorText}>{message}</Text></View>;
}

function WarningBanner({ message }: { message: string }) {
  return <View style={styles.warningBanner}><Text style={styles.warningText}>{message}</Text></View>;
}

function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <View style={[styles.metricCard, warning && styles.metricWarning]}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function FoundationRow({ title, copy }: { title: string; copy: string }) {
  return <View style={styles.foundationRow}><View style={styles.checkMark}><Text style={styles.checkText}>✓</Text></View><View style={styles.flex}><Text style={styles.foundationTitle}>{title}</Text><Text style={styles.foundationCopy}>{copy}</Text></View></View>;
}

function commerceFreshness(snapshot: MobileAppSnapshot): string {
  if (snapshot.commerceLoading && !snapshot.commerce) return "Loading catalog and branch stock…";
  if (!snapshot.commerce) return snapshot.online === false ? "Connect online once to cache this branch catalog." : "Catalog has not loaded yet.";
  const time = new Date(snapshot.commerce.fetchedAt);
  const formatted = Number.isNaN(time.getTime()) ? snapshot.commerce.fetchedAt : time.toLocaleString();
  return snapshot.commerce.source === "LIVE" ? `Live data confirmed ${formatted}` : `Last-known data from ${formatted}`;
}

function formatMoney(minor: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-GH", { style: "currency", currency: currencyCode, minimumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return `${currencyCode} ${(minor / 100).toFixed(2)}`;
  }
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: "#071d17" },
  centered: { flex: 1, backgroundColor: "#071d17", padding: 24, justifyContent: "center", gap: 24 },
  loadingText: { color: "#b8c8c2", textAlign: "center", fontSize: 14 },
  authPage: { flexGrow: 1, backgroundColor: "#f2f4ef" },
  authHero: { backgroundColor: "#071d17", paddingHorizontal: 24, paddingTop: 28, paddingBottom: 38, gap: 28 },
  authHeroCopy: { gap: 10 },
  eyebrow: { color: "#d7aa47", fontSize: 11, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase" },
  authTitle: { color: "#ffffff", fontSize: 34, lineHeight: 39, fontWeight: "900", letterSpacing: -0.8 },
  authLead: { color: "#b8c8c2", fontSize: 15, lineHeight: 23, maxWidth: 520 },
  authCard: { marginTop: -12, marginHorizontal: 16, marginBottom: 32, backgroundColor: "#ffffff", borderRadius: 24, padding: 22, gap: 16, shadowColor: "#000000", shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 5 },
  cardKicker: { color: "#9b762a", fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  cardTitle: { color: "#10251f", fontSize: 24, lineHeight: 30, fontWeight: "900" },
  cardCopy: { color: "#60706a", fontSize: 14, lineHeight: 21 },
  fieldGroup: { gap: 7 },
  label: { color: "#29413a", fontSize: 13, fontWeight: "800" },
  input: { minHeight: 52, borderWidth: 1, borderColor: "#d7dfda", borderRadius: 14, paddingHorizontal: 15, color: "#10251f", backgroundColor: "#f9faf8", fontSize: 16 },
  primaryButton: { minHeight: 52, borderRadius: 15, backgroundColor: "#d7aa47", alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  primaryButtonWide: { minHeight: 52, borderRadius: 15, backgroundColor: "#d7aa47", alignItems: "center", justifyContent: "center", paddingHorizontal: 28, alignSelf: "stretch" },
  primaryButtonText: { color: "#071d17", fontSize: 15, fontWeight: "900" },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { transform: [{ scale: 0.99 }] },
  compactButton: { minHeight: 38, minWidth: 78, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#e3e9e5", alignItems: "center", justifyContent: "center" },
  compactButtonText: { color: "#173029", fontSize: 12, fontWeight: "900" },
  securityNote: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingTop: 2 },
  securityIcon: { color: "#168552", fontSize: 12, marginTop: 2 },
  securityText: { flex: 1, color: "#71817b", fontSize: 12, lineHeight: 18 },
  page: { flexGrow: 1, backgroundColor: "#f2f4ef", padding: 16, paddingBottom: 34, gap: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#071d17", marginHorizontal: -16, marginTop: -16, paddingHorizontal: 18, paddingVertical: 16 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { width: 46, height: 46, borderRadius: 15, backgroundColor: "#d7aa47", alignItems: "center", justifyContent: "center" },
  markCompact: { width: 40, height: 40, borderRadius: 13 },
  markText: { color: "#071d17", fontSize: 21, fontWeight: "900" },
  brand: { color: "#ffffff", fontSize: 18, lineHeight: 20, fontWeight: "900" },
  brandAccent: { color: "#d7aa47", fontSize: 9, lineHeight: 12, letterSpacing: 2, fontWeight: "900" },
  connectionPill: { alignSelf: "flex-start", minHeight: 34, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 11, borderRadius: 17, backgroundColor: "#123a2e" },
  connectionOffline: { backgroundColor: "#4c3028" },
  connectionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#53d68a" },
  connectionDotOffline: { backgroundColor: "#e18b65" },
  connectionText: { color: "#ffffff", fontSize: 12, fontWeight: "800" },
  workspaceHero: { backgroundColor: "#0c2b22", borderRadius: 22, padding: 20, gap: 10 },
  workspaceTopRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "flex-start" },
  businessIdentity: { flex: 1, gap: 3 },
  workspaceEyebrow: { color: "#d7aa47", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  businessName: { color: "#ffffff", fontSize: 25, lineHeight: 31, fontWeight: "900" },
  businessMeta: { color: "#a9beb6", fontSize: 13, fontWeight: "700" },
  currencyBadge: { minWidth: 52, minHeight: 34, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "#173b31", alignItems: "center", justifyContent: "center" },
  currencyText: { color: "#d7aa47", fontSize: 12, fontWeight: "900" },
  workspaceCopy: { color: "#adc0ba", fontSize: 12, lineHeight: 18 },
  tabBar: { flexDirection: "row", gap: 8, backgroundColor: "#e1e7e3", padding: 5, borderRadius: 16 },
  tabButton: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tabButtonActive: { backgroundColor: "#ffffff" },
  tabText: { color: "#65756f", fontSize: 13, fontWeight: "800" },
  tabTextActive: { color: "#10251f" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  sectionKicker: { color: "#8a6a28", fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.1 },
  sectionTitle: { color: "#132821", fontSize: 20, lineHeight: 25, fontWeight: "900" },
  sectionCopy: { color: "#7c8a85", fontSize: 11, lineHeight: 16, marginTop: 2 },
  searchInput: { minHeight: 50, borderRadius: 15, backgroundColor: "#ffffff", paddingHorizontal: 15, fontSize: 15, color: "#132821", borderWidth: 1, borderColor: "#dce3df" },
  catalogList: { gap: 10 },
  catalogCard: { flexDirection: "row", gap: 12, backgroundColor: "#ffffff", borderRadius: 18, padding: 15, alignItems: "center" },
  catalogMain: { flex: 1, gap: 3 },
  catalogAction: { alignItems: "flex-end", gap: 9 },
  catalogName: { color: "#132821", fontSize: 15, fontWeight: "900" },
  catalogMeta: { color: "#74837e", fontSize: 11, lineHeight: 16 },
  stockText: { color: "#567067", fontSize: 11, lineHeight: 16, fontWeight: "700" },
  catalogPrice: { color: "#132821", fontSize: 13, fontWeight: "900" },
  addButton: { minHeight: 36, minWidth: 66, borderRadius: 11, backgroundColor: "#e6f1eb", alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  addButtonText: { color: "#16704a", fontSize: 12, fontWeight: "900" },
  displayTotal: { color: "#132821", fontSize: 16, fontWeight: "900" },
  loadingCard: { backgroundColor: "#ffffff", borderRadius: 17, padding: 18, flexDirection: "row", gap: 12, alignItems: "center" },
  emptyCard: { backgroundColor: "#ffffff", borderRadius: 17, padding: 18, gap: 5 },
  emptyTitle: { color: "#213a32", fontSize: 14, fontWeight: "900" },
  cartCard: { backgroundColor: "#ffffff", borderRadius: 19, overflow: "hidden" },
  cartRow: { flexDirection: "row", gap: 9, alignItems: "center", padding: 14, borderBottomWidth: 1, borderBottomColor: "#edf0ee" },
  cartInfo: { flex: 1, gap: 2 },
  cartName: { color: "#173029", fontSize: 13, fontWeight: "900" },
  quantityControl: { flexDirection: "row", alignItems: "center", gap: 7 },
  quantityButton: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#eef2ef", alignItems: "center", justifyContent: "center" },
  quantityButtonText: { color: "#29413a", fontSize: 17, fontWeight: "900" },
  quantityValue: { minWidth: 28, textAlign: "center", color: "#132821", fontWeight: "900" },
  removeButton: { width: 30, height: 30, borderRadius: 10, backgroundColor: "#fff0eb", alignItems: "center", justifyContent: "center" },
  removeButtonText: { color: "#9a4c34", fontSize: 18, fontWeight: "900" },
  totalRow: { flexDirection: "row", gap: 12, alignItems: "center", padding: 15, backgroundColor: "#f8faf8" },
  totalLabel: { color: "#173029", fontSize: 13, fontWeight: "900" },
  totalHint: { color: "#87948f", fontSize: 10, marginTop: 2 },
  totalValue: { color: "#10251f", fontSize: 18, fontWeight: "900" },
  paymentCard: { backgroundColor: "#ffffff", borderRadius: 20, padding: 17, gap: 13 },
  paymentTitle: { color: "#173029", fontSize: 16, fontWeight: "900" },
  paymentGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  paymentChip: { minHeight: 40, minWidth: 68, borderRadius: 12, borderWidth: 1, borderColor: "#d6dfda", paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  paymentChipActive: { backgroundColor: "#0d3227", borderColor: "#0d3227" },
  paymentChipText: { color: "#4c5f58", fontSize: 12, fontWeight: "800" },
  paymentChipTextActive: { color: "#ffffff" },
  chargeButton: { minHeight: 56, borderRadius: 16, backgroundColor: "#d7aa47", justifyContent: "center", paddingHorizontal: 18 },
  chargeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chargeLabel: { color: "#071d17", fontSize: 15, fontWeight: "900" },
  chargeAmount: { color: "#071d17", fontSize: 17, fontWeight: "900" },
  checkoutHint: { color: "#7a8883", fontSize: 11, lineHeight: 16, textAlign: "center" },
  metricGrid: { flexDirection: "row", gap: 9 },
  metricCard: { flex: 1, minHeight: 94, backgroundColor: "#ffffff", borderRadius: 17, padding: 14, justifyContent: "center", gap: 4 },
  metricWarning: { borderWidth: 1, borderColor: "#d49c83" },
  metricValue: { color: "#10251f", fontSize: 25, fontWeight: "900" },
  metricLabel: { color: "#74837e", fontSize: 11, lineHeight: 15, fontWeight: "700" },
  offlineHint: { color: "#806029", fontSize: 12, lineHeight: 18, textAlign: "center" },
  foundationCard: { backgroundColor: "#ffffff", borderRadius: 20, padding: 18, gap: 12 },
  foundationRow: { flexDirection: "row", gap: 11, alignItems: "center" },
  checkMark: { width: 30, height: 30, borderRadius: 10, backgroundColor: "#e4f2ea", alignItems: "center", justifyContent: "center" },
  checkText: { color: "#168552", fontWeight: "900" },
  foundationTitle: { color: "#173029", fontSize: 13, fontWeight: "900" },
  foundationCopy: { color: "#798782", fontSize: 12, marginTop: 2, lineHeight: 17 },
  secondaryButton: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: "#cbd5cf", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, backgroundColor: "#ffffff" },
  secondaryButtonText: { color: "#29413a", fontSize: 14, fontWeight: "900" },
  noticeCard: { backgroundColor: "#ffffff", borderRadius: 22, padding: 21, gap: 10 },
  errorBanner: { borderRadius: 13, padding: 12, backgroundColor: "#fff0eb", borderWidth: 1, borderColor: "#efc0ad" },
  errorText: { color: "#87412b", fontSize: 12, lineHeight: 18, fontWeight: "700" },
  warningBanner: { borderRadius: 13, padding: 12, backgroundColor: "#fff8e7", borderWidth: 1, borderColor: "#e8d29a" },
  warningText: { color: "#745a1f", fontSize: 12, lineHeight: 18, fontWeight: "700" },
  saleNotice: { borderRadius: 13, padding: 12, backgroundColor: "#fff8e7", borderWidth: 1, borderColor: "#e8d29a" },
  saleNoticeReview: { backgroundColor: "#fff0eb", borderColor: "#efc0ad" },
  saleNoticeSuccess: { backgroundColor: "#eaf6ef", borderColor: "#b9dfc9" },
  saleNoticeText: { color: "#3e554d", fontSize: 12, lineHeight: 18, fontWeight: "800" },
  footerText: { color: "#8b9994", fontSize: 11, textAlign: "center" },
});
