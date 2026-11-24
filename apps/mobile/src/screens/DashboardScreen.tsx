import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { HeroCard } from "../components/Card";
import { StatCard } from "../components/StatCard";
import { Banner } from "../components/Banner";
import { Icon, IconTile } from "../components/icons";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { colors, radius, spacing, typography } from "../theme";
import type { MobileAppSnapshot, MobileSaleNotice } from "../app-model";
import { formatRelativeTime } from "../lib/format";

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
        variant="light"
        online={snapshot.online}
        syncing={snapshot.syncing}
        failedCount={queue.failed}
        pendingCount={queue.pending}
      />

      <View style={styles.intro}>
        <Text style={styles.pageTitle}>Your workspace</Text>
        <Text style={styles.introText}>Sell, manage and keep your business moving.</Text>
      </View>
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
            <Text style={styles.currencyText}>{ready.business.currencyCode === "GHS" ? "₵" : ready.business.currencyCode}</Text>
          </View>
          <Text style={styles.countryText}>{ready.business.countryCode}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Start a sale" onPress={onGoToSell} style={({pressed}) => [styles.heroAction, pressed && styles.pressed]}>
          <Icon name="sell" size={22} color={colors.midnight} />
          <Text style={styles.heroActionText}>New sale</Text>
          <Icon name="arrowRight" size={18} color={colors.midnight} />
        </Pressable>
      </HeroCard>

      {snapshot.saleNotice ? (
        <SaleNoticeBanner notice={snapshot.saleNotice} />
      ) : null}

      <Text style={styles.sectionLabel}>Workspace status</Text>
      <View style={styles.statGrid}>
        <StatCard
          style={styles.statTile}
          label="Pending sync"
          value={String(queue.pending)}
          tone={queue.pending > 0 ? "warning" : "neutral"}
          hint={queue.pending > 0 ? "Will send automatically" : "All caught up"}
        />
        <StatCard
          style={styles.statTile}
          label="Needs review"
          value={String(queue.failed)}
          tone={queue.failed > 0 ? "danger" : "neutral"}
          hint={queue.failed > 0 ? "Server rejected" : "No rejections"}
        />
        <StatCard
          style={styles.statTile}
          label="Catalog source"
          value={commerce ? (commerce.source === "LIVE" ? "Live" : "Cache") : "—"}
          tone={commerce?.source === "LIVE" ? "positive" : commerce?.source === "CACHE" ? "warning" : "neutral"}
          hint={lastSync}
        />
        <StatCard
          style={styles.statTile}
          label="Sellable items"
          value={String(commerce?.items.length ?? 0)}
          tone="info"
          hint={commerce ? "Available in POS" : "Catalog not loaded"}
        />
      </View>

      <Text style={styles.sectionLabel}>Quick actions</Text>
      <View style={styles.actions}>
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
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading} onPress={onPress}
      style={({ pressed }) => [styles.quickActionBtn, (pressed || disabled) && styles.pressed]}>
      <IconTile name={icon} size={42} tint={tint} background={background} />
      {loading ? <ActivityIndicator color={tint} /> : null}
      <Text style={styles.quickActionLabel}>{label}</Text>
      <Text style={styles.quickActionHint}>{hint}</Text>
    </Pressable>
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
  intro: { gap: 4 },
  pageTitle: { color: colors.textStrong, fontSize: 28, fontWeight: "800", letterSpacing: -0.8 },
  introText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  hero: { borderColor: colors.midnight, borderRadius: 24 },
  heroAction: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14,
    minHeight: 52, borderRadius: 14, backgroundColor: colors.gold, marginTop: 18 },
  heroActionText: { flex: 1, color: colors.midnight, fontSize: 16, fontWeight: "800" },
  pressed: { opacity: 0.65 },
  statTile: { flexGrow: 1, flexBasis: "46%", minWidth: 120 },
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
    color: colors.textStrong,
    fontSize: 19,
    fontWeight: typography.weightHeavy,
    marginTop: spacing.s2,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s2 + 2,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  quickActionBtn: { flexGrow: 1, flexBasis: "46%", minWidth: 120, minHeight: 120,
    alignItems: "flex-start", padding: 14, gap: 7, borderWidth: 1,
    backgroundColor: colors.surface, borderRadius: radius.md, borderColor: colors.border },
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
