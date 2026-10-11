import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Card, HeroCard } from "../components/Card";
import { Icon, IconTile } from "../components/icons";
import { StatCard } from "../components/StatCard";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { colors, radius, spacing, typography } from "../theme";
import type { MobileAppSnapshot } from "../app-model";

export type MoreScreenProps = {
  snapshot: MobileAppSnapshot;
  appVersion: string;
  onSync: () => void;
  onRefreshCatalog: () => void;
  onLogout: () => void;
};

export function MoreScreen({
  snapshot,
  appVersion,
  onSync,
  onRefreshCatalog,
  onLogout,
}: MoreScreenProps) {
  if (snapshot.bootstrap?.status !== "READY") return null;
  const ready = snapshot.bootstrap;
  const queue = ready.queue;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <WorkspaceHeader
        online={snapshot.online}
        syncing={snapshot.syncing}
        failedCount={queue.failed}
        pendingCount={queue.pending}
      />

      <HeroCard padding="comfortable" style={styles.hero}>
        <Text style={styles.heroKicker}>Workspace context</Text>
        <Text style={styles.businessName} numberOfLines={2}>{ready.business.name}</Text>
        <View style={styles.metaRow}>
          <Icon name="branch" size={14} color={colors.gold} />
          <Text style={styles.meta}>{ready.branch.name} · {ready.branch.code}</Text>
        </View>
        <View style={styles.metaRow}>
          <Icon name="user" size={14} color={colors.gold} />
          <Text style={styles.meta}>{ready.user.displayName} · {ready.membership.role}</Text>
        </View>
        <View style={styles.heroFooter}>
          <View style={styles.pill}>
            <Icon name="currency" size={12} color={colors.gold} />
            <Text style={styles.pillText}>{ready.business.currencyCode}</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{ready.business.countryCode}</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{ready.business.businessType}</Text>
          </View>
        </View>
      </HeroCard>

      <Card padding="default" style={styles.section}>
        <Text style={styles.kicker}>Sync engine</Text>
        <Text style={styles.sectionTitle}>Offline engine</Text>
        <View style={styles.statGrid}>
          <StatCard
            label="Pending"
            value={String(queue.pending)}
            tone={queue.pending > 0 ? "warning" : "neutral"}
          />
          <StatCard
            label="Other business"
            value={String(queue.blocked)}
            tone="info"
          />
          <StatCard
            label="Needs review"
            value={String(queue.failed)}
            tone={queue.failed > 0 ? "danger" : "neutral"}
          />
        </View>
        <Button
          variant="primary"
          fullWidth
          disabled={snapshot.syncing || snapshot.online !== true}
          loading={snapshot.syncing}
          accessibilityLabel="Sync now"
          onPress={onSync}
        >
          {snapshot.online === false ? "Offline — will sync on reconnect" : "Sync now"}
        </Button>
        <Button
          variant="secondary"
          fullWidth
          disabled={snapshot.commerceLoading}
          loading={snapshot.commerceLoading}
          accessibilityLabel="Refresh catalog and stock"
          onPress={onRefreshCatalog}
        >
          Refresh catalog &amp; stock
        </Button>
        {snapshot.online === false ? (
          <Banner
            tone="info"
            message="You are offline. TradeOS will flush this business automatically when the connection returns."
            title="Working offline"
          />
        ) : null}
      </Card>

      <Card padding="default" style={styles.section}>
        <Text style={styles.kicker}>Data safety</Text>
        <Text style={styles.sectionTitle}>What these counts mean</Text>
        <FoundationRow
          title="Pending"
          copy="Durably captured on this device, waiting for server confirmation."
        />
        <FoundationRow
          title="Other business"
          copy="Held locally and never sent into the wrong active business."
        />
        <FoundationRow
          title="Needs review"
          copy="Server rejected the mutation; evidence is preserved for correction or retry."
        />
      </Card>

      <Card padding="default" style={styles.section}>
        <Text style={styles.kicker}>Account</Text>
        <Text style={styles.sectionTitle}>Sign out of this device</Text>
        <Text style={styles.sectionCopy}>
          Signing out clears the session from this device's secure vault. Pending sales in the offline queue are preserved.
        </Text>
        <Button
          variant="danger"
          fullWidth
          accessibilityLabel="Sign out of this device"
          onPress={onLogout}
        >
          Sign out of this device
        </Button>
      </Card>

      <Text style={styles.footerNote}>
        TradeOS Africa · Mobile runtime {appVersion}
      </Text>
    </ScrollView>
  );
}

function FoundationRow({ title, copy }: { title: string; copy: string }) {
  return (
    <View style={styles.foundationRow}>
      <View style={styles.checkMark}>
        <Icon name="check" size={16} color={colors.positive} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.foundationTitle}>{title}</Text>
        <Text style={styles.foundationCopy}>{copy}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.s4,
    paddingBottom: spacing.s6 + 4,
    gap: spacing.s4,
  },
  hero: {
    marginTop: spacing.s2,
  },
  heroKicker: {
    color: colors.gold,
    fontSize: typography.meta,
    fontWeight: typography.weightHeavy,
    letterSpacing: typography.kickerTracking,
    textTransform: "uppercase",
  },
  businessName: {
    color: colors.textInverse,
    fontSize: typography.display,
    fontWeight: typography.weightBlack,
    lineHeight: typography.sectionLine + 6,
    marginTop: spacing.s1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s2,
    marginTop: spacing.s1,
  },
  meta: {
    color: colors.textInverseMuted,
    fontSize: typography.supporting,
    fontWeight: typography.weightBold,
  },
  heroFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.s2,
    marginTop: spacing.s3,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s1,
    paddingHorizontal: spacing.s2 + 2,
    paddingVertical: spacing.s1,
    borderRadius: radius.sm,
    backgroundColor: colors.midnightRaised,
  },
  pillText: {
    color: colors.textInverse,
    fontSize: typography.meta,
    fontWeight: typography.weightBlack,
  },
  section: {
    gap: spacing.s3,
  },
  kicker: {
    color: colors.goldStrong,
    fontSize: typography.meta,
    fontWeight: typography.weightBlack,
    letterSpacing: typography.kickerTracking,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: colors.textStrong,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
    lineHeight: typography.bodyLine,
  },
  sectionCopy: {
    color: colors.textMuted,
    fontSize: typography.supporting,
    lineHeight: typography.supportingLine,
  },
  statGrid: {
    flexDirection: "row",
    gap: spacing.s2,
  },
  foundationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.s3,
  },
  checkMark: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.positiveSoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  flex: { flex: 1 },
  foundationTitle: {
    color: colors.textStrong,
    fontSize: typography.supporting,
    fontWeight: typography.weightBlack,
  },
  foundationCopy: {
    color: colors.textMuted,
    fontSize: typography.meta,
    lineHeight: typography.metaLine + 2,
    marginTop: 2,
  },
  footerNote: {
    color: colors.textSoft,
    fontSize: typography.meta,
    textAlign: "center",
    marginTop: spacing.s2,
  },
});
