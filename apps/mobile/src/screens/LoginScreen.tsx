import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Brand } from "../components/Brand";
import { Button } from "../components/Button";
import { Banner } from "../components/Banner";
import { Input } from "../components/Input";
import { SyncBadge, deriveSyncStatus } from "../components/SyncBadge";
import { colors, radius, shadows, spacing, typography } from "../theme";
import type { MobileAppSnapshot } from "../app-model";

export type LoginScreenProps = {
  snapshot: MobileAppSnapshot;
  identifier: string;
  password: string;
  onIdentifier: (value: string) => void;
  onPassword: (value: string) => void;
  onLogin: () => void;
};

export function LoginScreen({
  snapshot,
  identifier,
  password,
  onIdentifier,
  onPassword,
  onLogin,
}: LoginScreenProps) {
  const canSubmit = identifier.trim().length > 0 && password.length > 0;
  const status = deriveSyncStatus({
    online: snapshot.online,
    syncing: snapshot.syncing,
    failed: snapshot.bootstrap?.status === "SIGNED_OUT" ? snapshot.bootstrap.queue.failed : 0,
  });

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Brand variant="light" />
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>The business OS for African trade</Text>
            <Text style={styles.heroTitle}>Run the day from your pocket.</Text>
            <Text style={styles.heroLead}>
              Sell, keep working offline, and synchronize through the same
              server-authoritative TradeOS ledger.
            </Text>
          </View>
          <SyncBadge status={status} variant="dark" />
        </View>

        <View style={styles.card}>
          <Text style={styles.kicker}>Secure access</Text>
          <Text style={styles.cardTitle}>Sign in to TradeOS</Text>
          <Text style={styles.cardCopy}>
            Use the same owner or staff account you use on the web workspace.
          </Text>

          {snapshot.error ? (
            <Banner tone="danger" message={snapshot.error} title="Could not sign in" />
          ) : null}

          <Input
            label="Email or phone"
            value={identifier}
            onChangeText={onIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@business.com"
            returnKeyType="next"
            textContentType="username"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={onPassword}
            secureTextEntry
            placeholder="Enter your password"
            returnKeyType="go"
            onSubmitEditing={onLogin}
            textContentType="password"
          />

          <Button
            variant="gold"
            fullWidth
            loading={snapshot.phase === "BOOTING"}
            disabled={!canSubmit}
            accessibilityLabel="Open workspace"
            onPress={onLogin}
          >
            Open workspace
          </Button>

          <View style={styles.securityNote}>
            <Text style={styles.securityIcon}>◆</Text>
            <Text style={styles.securityText}>
              Credentials stay in the secure device vault. Durably saved sales
              survive app restarts and connectivity loss.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  scrollContent: {
    flexGrow: 1,
    backgroundColor: colors.canvas,
  },
  hero: {
    backgroundColor: colors.midnight,
    paddingHorizontal: spacing.s5,
    paddingTop: spacing.s6 + 4,
    paddingBottom: spacing.s8,
    gap: spacing.s6,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  heroCopy: {
    gap: spacing.s2 + 2,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.meta,
    fontWeight: typography.weightHeavy,
    letterSpacing: typography.kickerTracking,
    textTransform: "uppercase",
  },
  heroTitle: {
    color: colors.textInverse,
    fontSize: typography.page,
    lineHeight: typography.pageLine,
    fontWeight: typography.weightBlack,
    letterSpacing: -0.6,
  },
  heroLead: {
    color: colors.textInverseMuted,
    fontSize: typography.supporting,
    lineHeight: typography.supportingLine,
    maxWidth: 520,
  },
  card: {
    marginTop: -spacing.s5,
    marginHorizontal: spacing.s4,
    marginBottom: spacing.s8,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.s5,
    gap: spacing.s4,
    borderColor: colors.border,
    borderWidth: 1,
    ...shadows.floating,
  },
  kicker: {
    color: colors.goldStrong,
    fontSize: typography.meta,
    fontWeight: typography.weightBlack,
    letterSpacing: typography.kickerTracking,
    textTransform: "uppercase",
  },
  cardTitle: {
    color: colors.textStrong,
    fontSize: typography.section + 2,
    fontWeight: typography.weightBlack,
    lineHeight: typography.sectionLine + 2,
  },
  cardCopy: {
    color: colors.textMuted,
    fontSize: typography.supporting,
    lineHeight: typography.supportingLine,
  },
  securityNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.s2 + 2,
    paddingTop: spacing.s1,
  },
  securityIcon: {
    color: colors.positive,
    fontSize: typography.meta,
    marginTop: 2,
  },
  securityText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: typography.meta,
    lineHeight: typography.metaLine + 2,
  },
});
