import { useEffect, useMemo, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import * as Crypto from "expo-crypto";
import { Platform, SafeAreaView, StatusBar, View } from "react-native";
import { MobileApiClient } from "./src/api-client";
import { MobileAppModel, type MobileAppSnapshot } from "./src/app-model";
import { BottomNav, type BottomNavTab } from "./src/components/BottomNav";
import { createNativeMobilePersistence, createNativeQueueStorage } from "./src/native-storage";
import { MobileRuntime } from "./src/runtime";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MoreScreen } from "./src/screens/MoreScreen";
import { PosScreen } from "./src/screens/PosScreen";
import { SalesScreen } from "./src/screens/SalesScreen";
import { ErrorScreen, LoadingScreen, NeedsBusinessScreen } from "./src/screens/BootScreens";
import { colors } from "./src/theme";

const APP_VERSION = "0.0.1";
const DEFAULT_API_BASE = "https://tradeosafrica.lightworldtech.com/api/mobile";

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
  const [screen, setScreen] = useState<BottomNavTab>("dashboard");

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
  const sync = async () => setSnapshot(await model.sync());
  const refreshCommerce = async () => setSnapshot(await model.loadCommerce());
  const checkout = async () => setSnapshot(await model.checkout());
  const logout = async () => {
    setSnapshot(await model.logout());
    setPassword("");
    setSearch("");
    setScreen("dashboard");
  };
  const retry = async () => setSnapshot(await model.start());

  const addCart = (item: Parameters<typeof model.addCart>[0]) => setSnapshot(model.addCart(item));
  const changeQuantity = (key: string, quantity: number) => setSnapshot(model.setCartQuantity(key, quantity));
  const removeCart = (key: string) => setSnapshot(model.removeCart(key));
  const selectPayment = (method: Parameters<typeof model.selectPaymentMethod>[0]) =>
    setSnapshot(model.selectPaymentMethod(method));

  const queue = snapshot.bootstrap?.status === "READY" ? snapshot.bootstrap.queue : null;
  const isReady = snapshot.phase === "READY";

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle={isReady || snapshot.phase === "SIGNED_OUT" ? "dark-content" : "light-content"}
        backgroundColor={colors.midnight}
      />
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
              {screen === "dashboard" ? (
                <DashboardScreen
                  snapshot={snapshot}
                  onGoToSell={() => setScreen("sell")}
                  onGoToSales={() => setScreen("sales")}
                  onGoToMore={() => setScreen("more")}
                  onSync={() => { void sync(); }}
                  onRefreshCatalog={() => { void refreshCommerce(); }}
                />
              ) : null}
              {screen === "sell" ? (
                <PosScreen
                  snapshot={snapshot}
                  search={search}
                  onSearch={setSearch}
                  onRefresh={() => { void refreshCommerce(); }}
                  onAdd={addCart}
                  onQuantity={changeQuantity}
                  onRemove={removeCart}
                  onPayment={selectPayment}
                  onCheckout={() => { void checkout(); }}
                />
              ) : null}
              {screen === "sales" ? (
                <SalesScreen
                  snapshot={snapshot}
                  onSync={() => { void sync(); }}
                  onGoToSell={() => setScreen("sell")}
                />
              ) : null}
              {screen === "more" ? (
                <MoreScreen
                  snapshot={snapshot}
                  appVersion={APP_VERSION}
                  onSync={() => { void sync(); }}
                  onRefreshCatalog={() => { void refreshCommerce(); }}
                  onLogout={() => { void logout(); }}
                />
              ) : null}
            </View>
            <BottomNav
              active={screen}
              onChange={setScreen}
              pendingCount={queue?.pending ?? 0}
              failedCount={queue?.failed ?? 0}
            />
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

// Tiny local styles — no inline colors; the design system owns palette + spacing.
const styles = {
  safeArea: { flex: 1, backgroundColor: colors.midnight } as const,
  flex: { flex: 1 } as const,
};
