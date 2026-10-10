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
import { MobileAppModel, type MobileAppSnapshot } from "./src/app-model";
import { createNativeMobilePersistence, createNativeQueueStorage } from "./src/native-storage";
import { MobileRuntime } from "./src/runtime";

const APP_VERSION = "0.0.1";
const DEFAULT_API_BASE = "https://tradeosafrica.lightworldtech.com/api/mobile";

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
  const logout = async () => {
    setSnapshot(await model.logout());
    setPassword("");
  };
  const retry = async () => setSnapshot(await model.start());

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
      {snapshot.phase === "READY" ? <Workspace snapshot={snapshot} onSync={() => { void sync(); }} onLogout={() => { void logout(); }} /> : null}
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
            <Text style={styles.authLead}>Your authorized workspace, durable offline queue and server-authoritative sync now travel with you.</Text>
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
            <Text style={styles.securityText}>Tokens are stored in the device secure vault. Unsynced transactions remain in the durable offline queue.</Text>
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

function Workspace({ snapshot, onSync, onLogout }: { snapshot: MobileAppSnapshot; onSync: () => void; onLogout: () => void }) {
  if (snapshot.bootstrap?.status !== "READY") return null;
  const ready = snapshot.bootstrap;
  return (
    <ScrollView contentContainerStyle={styles.page}>
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
        <Text style={styles.workspaceGreeting}>Good to see you, {ready.user.displayName.split(" ")[0]}.</Text>
        <Text style={styles.workspaceCopy}>This device is bound to the same tenant, permissions and accounting authority as TradeOS web.</Text>
      </View>

      {snapshot.error ? <ErrorBanner message={snapshot.error} /> : null}

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
        <Text style={styles.cardKicker}>Mobile foundation online</Text>
        <Text style={styles.sectionTitle}>Ready for transaction workflows</Text>
        <View style={styles.foundationList}>
          <FoundationRow title="Secure session" copy="Encrypted access + refresh rotation" />
          <FoundationRow title="Tenant restore" copy="Authorized business, branch and role" />
          <FoundationRow title="Offline durability" copy="Restart-safe mutation queue" />
          <FoundationRow title="Reconnect sync" copy="Active-business scoped flush" />
        </View>
      </View>

      <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onLogout}>
        <Text style={styles.secondaryButtonText}>Sign out of this device</Text>
      </Pressable>
      <Text style={styles.footerText}>TradeOS Africa · Mobile runtime {APP_VERSION}</Text>
    </ScrollView>
  );
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

function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <View style={[styles.metricCard, warning && styles.metricWarning]}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function FoundationRow({ title, copy }: { title: string; copy: string }) {
  return <View style={styles.foundationRow}><View style={styles.checkMark}><Text style={styles.checkText}>✓</Text></View><View style={styles.flex}><Text style={styles.foundationTitle}>{title}</Text><Text style={styles.foundationCopy}>{copy}</Text></View></View>;
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
  workspaceHero: { backgroundColor: "#0c2b22", borderRadius: 22, padding: 20, gap: 12 },
  workspaceTopRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "flex-start" },
  businessIdentity: { flex: 1, gap: 3 },
  workspaceEyebrow: { color: "#d7aa47", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  businessName: { color: "#ffffff", fontSize: 25, lineHeight: 31, fontWeight: "900" },
  businessMeta: { color: "#a9beb6", fontSize: 13, fontWeight: "700" },
  currencyBadge: { minWidth: 52, minHeight: 34, paddingHorizontal: 10, borderRadius: 12, backgroundColor: "#173b31", alignItems: "center", justifyContent: "center" },
  currencyText: { color: "#d7aa47", fontSize: 12, fontWeight: "900" },
  workspaceGreeting: { color: "#ffffff", fontSize: 17, fontWeight: "800", marginTop: 4 },
  workspaceCopy: { color: "#adc0ba", fontSize: 13, lineHeight: 20 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  sectionKicker: { color: "#8a6a28", fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.1 },
  sectionTitle: { color: "#132821", fontSize: 20, lineHeight: 25, fontWeight: "900" },
  metricGrid: { flexDirection: "row", gap: 9 },
  metricCard: { flex: 1, minHeight: 94, backgroundColor: "#ffffff", borderRadius: 17, padding: 14, justifyContent: "center", gap: 4 },
  metricWarning: { borderWidth: 1, borderColor: "#d49c83" },
  metricValue: { color: "#10251f", fontSize: 25, fontWeight: "900" },
  metricLabel: { color: "#74837e", fontSize: 11, lineHeight: 15, fontWeight: "700" },
  offlineHint: { color: "#806029", fontSize: 12, lineHeight: 18, textAlign: "center" },
  foundationCard: { backgroundColor: "#ffffff", borderRadius: 20, padding: 18, gap: 12 },
  foundationList: { gap: 13, marginTop: 2 },
  foundationRow: { flexDirection: "row", gap: 11, alignItems: "center" },
  checkMark: { width: 30, height: 30, borderRadius: 10, backgroundColor: "#e4f2ea", alignItems: "center", justifyContent: "center" },
  checkText: { color: "#168552", fontWeight: "900" },
  foundationTitle: { color: "#173029", fontSize: 13, fontWeight: "900" },
  foundationCopy: { color: "#798782", fontSize: 12, marginTop: 2 },
  secondaryButton: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: "#cbd5cf", alignItems: "center", justifyContent: "center", paddingHorizontal: 18, backgroundColor: "#ffffff" },
  secondaryButtonText: { color: "#29413a", fontSize: 14, fontWeight: "900" },
  noticeCard: { backgroundColor: "#ffffff", borderRadius: 22, padding: 21, gap: 10 },
  errorBanner: { borderRadius: 13, padding: 12, backgroundColor: "#fff0eb", borderWidth: 1, borderColor: "#efc0ad" },
  errorText: { color: "#87412b", fontSize: 12, lineHeight: 18, fontWeight: "700" },
  footerText: { color: "#8b9994", fontSize: 11, textAlign: "center" },
});