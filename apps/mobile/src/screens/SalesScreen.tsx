import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Card, HeroCard } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Icon, IconTile } from "../components/icons";
import { StatCard } from "../components/StatCard";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { colors, radius, spacing, typography } from "../theme";
import type { MobileAppSnapshot } from "../app-model";

export type SalesScreenProps = {
  snapshot: MobileAppSnapshot;
  onSync: () => void;
  onGoToSell: () => void;
};

export function SalesScreen({ snapshot, onSync, onGoToSell }: SalesScreenProps) {
  if (snapshot.bootstrap?.status !== "READY") return null;
  const ready = snapshot.bootstrap;
  const queue = ready.queue;
  const totalActive = queue.pending + queue.failed;

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
        <Text style={styles.heroKicker}>Sales · mobile view</Text>
        <Text style={styles.heroTitle}>Sales history &amp; sync queue</Text>
        <Text style={styles.heroLead}>
          TradeOS records every sale as authoritative evidence on the server.
          This mobile view shows the offline queue — sales captured on this
          device that are waiting to sync or need review.
        </Text>
      </HeroCard>

      <View style={styles.statGrid}>
        <StatCard
          label="Pending sync"
          value={String(queue.pending)}
          tone={queue.pending > 0 ? "warning" : "neutral"}
          hint={queue.pending > 0 ? "On this device" : "All synced"}
        />
        <StatCard
          label="Other business"
          value={String(queue.blocked)}
          tone="info"
          hint="Held locally"
        />
        <StatCard
          label="Needs review"
          value={String(queue.failed)}
          tone={queue.failed > 0 ? "danger" : "neutral"}
          hint={queue.failed > 0 ? "Server rejected" : "No rejections"}
        />
      </View>

      <Card padding="default" style={styles.section}>
        <View style={styles.sectionHeader}>
          <IconTile name="sync" size={40} background={colors.warningSoft} tint={colors.warning} accessibilityLabel="Pending sync" />
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>Pending sync queue</Text>
            <Text style={styles.sectionCopy}>
              {queue.pending === 0
                ? "No sales are waiting. New sales are saved here when this device is offline."
                : `${queue.pending} sale${queue.pending === 1 ? "" : "s"} captured on this device will sync automatically when the connection returns.`}
            </Text>
          </View>
        </View>
        <Button
          variant="primary"
          fullWidth
          disabled={snapshot.syncing || snapshot.online !== true || queue.pending === 0}
          loading={snapshot.syncing}
          accessibilityLabel="Sync pending sales now"
          onPress={onSync}
        >
          {snapshot.online === false ? "Offline — will sync on reconnect" : "Sync now"}
        </Button>
        {snapshot.online === false ? (
          <Text style={styles.helperText}>
            You are offline. TradeOS will flush this business automatically when the connection returns.
          </Text>
        ) : null}
      </Card>

      <Card padding="default" style={styles.section}>
        <View style={styles.sectionHeader}>
          <IconTile
            name="warning"
            size={40}
            background={queue.failed > 0 ? colors.dangerSoft : colors.surfaceSoft}
            tint={queue.failed > 0 ? colors.danger : colors.textSoft}
            accessibilityLabel="Needs review"
          />
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>Needs review</Text>
            <Text style={styles.sectionCopy}>
              {queue.failed === 0
                ? "No sales were rejected by the server."
                : `${queue.failed} sale${queue.failed === 1 ? "" : "s"} could not be applied. The evidence is preserved on this device for correction or retry.`}
            </Text>
          </View>
        </View>
        {queue.failed > 0 ? (
          <Banner
            tone="danger"
            message="Open the web workspace to inspect the rejection reason and resubmit, or contact your business admin."
            title="Why a sale lands here"
          />
        ) : null}
      </Card>

      <Card padding="default">
        <View style={styles.sectionHeader}>
          <IconTile name="sales" size={40} background={colors.surfaceSoft} tint={colors.midnight} accessibilityLabel="Posted sales history" />
          <View style={styles.flex}>
            <Text style={styles.sectionTitle}>Posted sales history</Text>
            <Text style={styles.sectionCopy}>
              Synchronized sales become immutable business evidence on the TradeOS server. The full history, receipt-level detail, returns, and refunds live in the web workspace.
            </Text>
          </View>
        </View>
        <EmptyState
          kind="empty"
          icon="chart"
          title="No posted sales on this device"
          description="Each synced sale is recorded as authoritative evidence. Use the web workspace to view, search, and filter every sale."
          actionLabel={totalActive > 0 ? "Sync now to clear queue" : "Start a new sale"}
          onAction={totalActive > 0 ? onSync : onGoToSell}
        />
      </Card>

      <Text style={styles.footerNote}>
        TradeOS Africa · Mobile sales view · {ready.business.currencyCode}
      </Text>
    </ScrollView>
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
  heroTitle: {
    color: colors.textInverse,
    fontSize: typography.section + 4,
    fontWeight: typography.weightBlack,
    lineHeight: typography.sectionLine + 6,
    marginTop: spacing.s1,
  },
  heroLead: {
    color: colors.textInverseMuted,
    fontSize: typography.supporting,
    lineHeight: typography.supportingLine,
    marginTop: spacing.s2,
  },
  statGrid: {
    flexDirection: "row",
    gap: spacing.s2 + 2,
  },
  section: {
    gap: spacing.s3,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.s3,
  },
  flex: { flex: 1 },
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
    marginTop: 2,
  },
  helperText: {
    color: colors.warning,
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
    fontWeight: typography.weightBold,
  },
  footerNote: {
    color: colors.textSoft,
    fontSize: typography.meta,
    textAlign: "center",
    marginTop: spacing.s2,
  },
});
