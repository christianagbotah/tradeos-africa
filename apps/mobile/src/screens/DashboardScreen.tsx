import { ScrollView, StyleSheet, Text, View } from "react-native";
import { HeroCard } from "../components/Card";
import { StatCard } from "../components/StatCard";
import { Button } from "../components/Button";
import { Banner } from "../components/Banner";
import { Icon, IconTile } from "../components/icons";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { colors, radius, spacing, typography } from "../theme";
import type { MobileAppSnapshot, MobileSaleNotice } from "../app-model";
import { commerceFreshness, formatRelativeTime } from "../lib/format";

export type DashboardScreenProps = {
  snapshot: MobileAppSnapshot;
  onGoToSell: () => void;
  onGoToSales: () => void;
  onGoToMore: () => void;
  onSync: () => void;
  onRefreshCatalog: () => void;
};

export function DashboardScreen({
  snapshot,
  onGoToSell,
  onGoToSales,
  onGoToMore,
  onSync,
  onRefreshCatalog,
}: DashboardScreenProps) {
  if (snapshot.bootstrap?.status !== "READY") return null;
  const ready = snapshot.bootstrap;
  const queue = ready.queue;
  const commerce = snapshot.commerce;
  const lastSync = commerce ? formatRelativeTime(commerce.fetchedAt) : "—";

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
        <Text style={styles.eyebrow}>Current business</Text>
        <Text style={styles.businessName} numberOfLines={2}>{ready.business.name}</Text>
        <View style={styles.metaRow}>
          <Icon name="branch" size={14} color={colors.gold} />
          <Text style={styles.meta}>{ready.branch.name} · {ready.membership.role}</Text>
        </View>
        <View style={styles.heroFooter}>
          <View style={styles.currencyPill}>
            <Icon name="currency" size={12} color={colors.gold} />
            <Text style={styles.currencyText}>{ready.business.currencyCode}</Text>
          </View>
          <Text style={styles.countryText}>{ready.business.countryCode}</Text>
        </View>
      </HeroCard>

      {snapshot.saleNotice ? (
        <SaleNoticeBanner notice={snapshot.saleNotice} />
      ) : null}

      <Text style={styles.sectionLabel}>Today</Text>
      <View style={styles.statGrid}>
        <StatCard
          label="Pending sync"
          value={String(queue.pending)}
          tone={queue.pending > 0 ? "warning" : "neutral"}
          hint={queue.pending > 0 ? "Will send automatically" : "All caught up"}
        />
        <StatCard
          label="Needs review"
          value={String(queue.failed)}
          tone={queue.failed > 0 ? "danger" : "neutral"}
          hint={queue.failed > 0 ? "Server rejected" : "No rejections"}
        />
        <StatCard
          label="Catalog source"
          value={commerce ? (commerce.source === "LIVE" ? "Live" : "Cache") : "—"}
          tone={commerce?.source === "LIVE" ? "positive" : commerce?.source === "CACHE" ? "warning" : "neutral"}
          hint={lastSync}
        />
        <StatCard
          label="Sellable items"
          value={String(commerce?.items.length ?? 0)}
          tone="info"
          hint={commerceFreshness(snapshot)}
        />
      </View>

      <Text style={styles.sectionLabel}>Quick actions</Text>
      <View style={styles.actions}>
        <QuickAction
          icon="sell"
          tint={colors.gold}
          background={colors.goldSoft}
          label="Start a sale"
          hint="Open the POS workspace"
          onPress={onGoToSell}
        />
        <QuickAction
          icon="sync"
          tint={colors.info}
          background={colors.infoSoft}
          label="Sync now"
          hint={snapshot.online === false ? "Offline — will sync on reconnect" : "Flush pending sales"}
          disabled={snapshot.syncing || snapshot.online !== true}
          loading={snapshot.syncing}
          onPress={onSync}
        />
        <QuickAction
          icon="refresh"
          tint={colors.positive}
          background={colors.positiveSoft}
          label="Refresh catalog"
          hint={snapshot.commerceLoading ? "Refreshing…" : "Pull latest stock"}
          disabled={snapshot.commerceLoading}
          loading={snapshot.commerceLoading}
          onPress={onRefreshCatalog}
        />
        <QuickAction
          icon="sales"
          tint={colors.midnight}
          background={colors.surfaceSoft}
          label="View sales queue"
          hint={`${queue.pending + queue.failed} pending or review`}
          onPress={onGoToSales}
        />
        <QuickAction
          icon="more"
          tint={colors.textMuted}
          background={colors.surfaceSoft}
          label="More"
          hint="Settings, branch, sign out"
          onPress={onGoToMore}
        />
      </View>

      {commerce?.warning ? (
        <Banner tone="warning" message={commerce.warning} title="Catalog notice" />
      ) : null}
      {snapshot.online === false ? (
        <Banner
          tone="info"
          message="You are offline. Sales are saved on this device and will sync automatically when the connection returns."
          title="Working offline"
        />
      ) : null}
    </ScrollView>
  );
}

function QuickAction({
  icon,
  tint,
  background,
  label,
  hint,
  onPress,
  disabled,
  loading,
}: {
  icon: Parameters<typeof IconTile>[0]["name"];
  tint: string;
  background: string;
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      fullWidth
      disabled={disabled}
      loading={loading}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.quickActionBtn}
    >
      <View style={styles.quickActionRow}>
        <IconTile name={icon} size={44} tint={tint} background={background} accessibilityLabel={`${label} action`} />
        <View style={styles.quickActionCopy}>
          <Text style={styles.quickActionLabel} numberOfLines={1}>{label}</Text>
          <Text style={styles.quickActionHint} numberOfLines={2}>{hint}</Text>
        </View>
        <Icon name="arrowRight" size={18} color={colors.textSoft} />
      </View>
    </Button>
  );
}

function SaleNoticeBanner({ notice }: { notice: MobileSaleNotice }) {
  const tone = notice.tone === "success" ? "success"
    : notice.tone === "pending" ? "warning"
    : "danger";
  return <Banner tone={tone} message={notice.message} title="Sale result" />;
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
  eyebrow: {
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
    letterSpacing: -0.4,
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
    alignItems: "center",
    gap: spacing.s2,
    marginTop: spacing.s3,
  },
  currencyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s1,
    paddingHorizontal: spacing.s2 + 2,
    paddingVertical: spacing.s1,
    borderRadius: radius.sm,
    backgroundColor: colors.midnightRaised,
  },
  currencyText: {
    color: colors.gold,
    fontSize: typography.meta,
    fontWeight: typography.weightBlack,
  },
  countryText: {
    color: colors.textInverseMuted,
    fontSize: typography.meta,
    fontWeight: typography.weightBold,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: typography.meta,
    fontWeight: typography.weightBlack,
    letterSpacing: typography.kickerTracking,
    textTransform: "uppercase",
    marginTop: spacing.s2,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s2 + 2,
  },
  actions: {
    gap: spacing.s2,
  },
  quickActionBtn: {
    alignItems: "stretch",
    justifyContent: "flex-start",
    paddingHorizontal: 0,
    paddingVertical: 0,
    minHeight: 0,
    borderWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderColor: colors.border,
  },
  quickActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s3,
    padding: spacing.s3,
  },
  quickActionCopy: {
    flex: 1,
    gap: 2,
  },
  quickActionLabel: {
    color: colors.textStrong,
    fontSize: typography.supporting,
    fontWeight: typography.weightBlack,
  },
  quickActionHint: {
    color: colors.textMuted,
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
  },
});
