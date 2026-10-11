import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { colors, radius, shadows, spacing, typography } from "../theme";
import type { MobileAppSnapshot } from "../app-model";

/**
 * LoadingScreen — shown during BOOTING phase. Full midnight canvas with the
 * TradeOS brand and a calm loading message.
 */
export function LoadingScreen() {
  return (
    <View style={styles.centered}>
      <View style={styles.card}>
        <Brand variant="light" />
        <ActivityIndicator size="large" color={colors.gold} />
        <Text style={styles.loadingText}>Opening your TradeOS workspace…</Text>
      </View>
    </View>
  );
}

/**
 * NeedsBusinessScreen — shown when the signed-in user has no active business
 * membership. Tells them to use the web workspace to create/reactivate.
 */
export function NeedsBusinessScreen({
  snapshot,
  onLogout,
}: {
  snapshot: MobileAppSnapshot;
  onLogout: () => void;
}) {
  const user = snapshot.bootstrap?.status === "NEEDS_BUSINESS" ? snapshot.bootstrap.user : null;
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Brand variant="light" />
      </View>
      <Card padding="comfortable" variant="raised" style={styles.card}>
        <Text style={styles.kicker}>Account connected</Text>
        <Text style={styles.title}>Welcome, {user?.displayName ?? "TradeOS user"}</Text>
        <Text style={styles.copy}>
          Your account does not currently have an active business membership.
          Create or reactivate a business in the web workspace, then return here.
        </Text>
        <Button variant="secondary" fullWidth accessibilityLabel="Sign out" onPress={onLogout}>
          Sign out
        </Button>
      </Card>
    </ScrollView>
  );
}

/**
 * ErrorScreen — shown when the workspace could not open safely. Allows retry.
 */
export function ErrorScreen({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  return (
    <View style={styles.centered}>
      <View style={styles.card}>
        <Brand variant="light" />
        <Card padding="comfortable" variant="raised" style={styles.errorCard}>
          <Text style={styles.kicker}>Workspace unavailable</Text>
          <Text style={styles.title}>TradeOS could not open safely.</Text>
          <Text style={styles.copy}>{message ?? "Check your connection and try again."}</Text>
          <Button variant="gold" fullWidth accessibilityLabel="Retry opening workspace" onPress={onRetry}>
            Retry
          </Button>
        </Card>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.midnight,
    paddingHorizontal: spacing.s5,
    paddingVertical: spacing.s6,
    justifyContent: "center",
    gap: spacing.s6,
  },
  page: {
    flexGrow: 1,
    backgroundColor: colors.midnight,
    paddingHorizontal: spacing.s4,
    paddingBottom: spacing.s6,
    gap: spacing.s4,
  },
  hero: {
    alignItems: "flex-start",
    paddingVertical: spacing.s4,
  },
  card: {
    backgroundColor: colors.midnightSoft,
    borderRadius: radius.lg,
    padding: spacing.s5,
    gap: spacing.s4,
    ...shadows.floating,
  },
  errorCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  kicker: {
    color: colors.gold,
    fontSize: typography.meta,
    fontWeight: typography.weightHeavy,
    letterSpacing: typography.kickerTracking,
    textTransform: "uppercase",
  },
  title: {
    color: colors.textInverse,
    fontSize: typography.section,
    fontWeight: typography.weightBlack,
    lineHeight: typography.sectionLine + 2,
  },
  copy: {
    color: colors.textInverseMuted,
    fontSize: typography.supporting,
    lineHeight: typography.supportingLine,
  },
  loadingText: {
    color: colors.textInverseMuted,
    textAlign: "center",
    fontSize: typography.supporting,
  },
});
