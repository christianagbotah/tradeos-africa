import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../components/Card";
import { StatCard } from "../components/StatCard";
import { Banner } from "../components/Banner";
import { Icon, IconTile } from "../components/icons";
import { colors, radius, spacing, typography, touch } from "../theme";
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
  snapshot, onGoToSell, onGoToSales, onGoToMore, onSync, onRefreshCatalog,
}: DashboardScreenProps) {
  if (snapshot.bootstrap?.status !== "READY") return null;
  const ready = snapshot.bootstrap;
  const queue = ready.queue;
  const commerce = snapshot.commerce;
  const lastSync = commerce ? formatRelativeTime(commerce.fetchedAt) : "—";

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card background={colors.brandForest} variant="raised" padding="comfortable" style={styles.hero}>
        <View style={styles.heroHeading}>
          <IconTile name="store" size={44} tint={colors.gold} background="rgba(255,255,255,0.10)" />
          <View style={styles.heroContext}>
            <Text style={styles.eyebrow}>Point of sale</Text>
            <Text style={styles.businessName}>{ready.business.name}</Text>
            <Text style={styles.meta}>{ready.branch.name}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Start a sale"
          onPress={onGoToSell} style={({pressed}) => [styles.heroAction, pressed && styles.pressed]}>
          <Icon name="sell" size={22} color={colors.midnight} />
          <Text style={styles.heroActionText}>New sale</Text>
          <Icon name="arrowRight" size={18} color={colors.midnight} />
        </Pressable>
      </Card>

      {snapshot.saleNotice ? <SaleNoticeBanner notice={snapshot.saleNotice} /> : null}
      {snapshot.online === false ? <Banner tone="info" title="Working offline"
        message="Sales are saved on this device and will sync on reconnect." /> : null}
      {commerce?.warning ? <Banner tone="warning" message={commerce.warning} title="Catalog notice" /> : null}

      <Text accessibilityRole="header" style={styles.sectionLabel}>Catalog overview</Text>
      <View style={styles.statGrid}>
        <StatCard style={styles.statTile} label="Sellable items"
          value={commerce ? String(commerce.items.length) : "—"}
          tone="neutral" hint={commerce ? "Available in POS" : "Not loaded"} />
        <StatCard style={styles.statTile} label="Catalog source"
          value={commerce ? (commerce.source === "LIVE" ? "Live" : "Cache") : "—"}
          tone={commerce?.source === "LIVE" ? "positive" : commerce?.source === "CACHE" ? "warning" : "neutral"}
          hint={lastSync} />
      </View>

      <Text accessibilityRole="header" style={styles.sectionLabel}>Data & sync</Text>
      <Card padding="none" variant="flat">
        <View style={styles.queueSummary}>
          <QueueMetric label="Pending sync" value={queue.pending} tone={queue.pending > 0 ? colors.warning : colors.textStrong} />
          <QueueMetric label="Needs review" value={queue.failed} tone={queue.failed > 0 ? colors.danger : colors.textStrong} />
          <QueueMetric label="Blocked" value={queue.blocked} tone={queue.blocked > 0 ? colors.danger : colors.textStrong} />
        </View>
        <ActionRow icon="sync" label="Sync now" disabled={snapshot.syncing || snapshot.online !== true}
          loading={snapshot.syncing} onPress={onSync} />
        <ActionRow icon="refresh" label="Refresh catalog" disabled={snapshot.commerceLoading}
          loading={snapshot.commerceLoading} onPress={onRefreshCatalog} />
        <ActionRow icon="sales" label="View sales queue" onPress={onGoToSales} />
      </Card>

      <Text accessibilityRole="header" style={styles.sectionLabel}>Workspace</Text>
      <Card padding="none" variant="flat">
        <ActionRow icon="more" label="More" onPress={onGoToMore} first />
      </Card>
    </ScrollView>
  );
}

function QueueMetric({label, value, tone}: {label: string; value: number; tone: string}) {
  return <View style={styles.queueMetric} accessibilityLabel={label + ": " + value}>
    <Text style={[styles.queueValue, {color: tone}]}>{value}</Text>
    <Text style={styles.queueLabel}>{label}</Text>
  </View>;
}

function ActionRow({
  icon, label, onPress, disabled, loading, first,
}: {
  icon: Parameters<typeof IconTile>[0]["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  first?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading} onPress={onPress}
      style={({pressed}) => [styles.actionRow, !first && styles.rowDivider, (pressed || disabled) && styles.pressed]}>
      <IconTile name={icon} size={36} tint={colors.brandForest} background={colors.positiveSoft} />
      <Text style={styles.actionLabel}>{label}</Text>
      {loading ? <ActivityIndicator color={colors.brandForest} /> : <Icon name="arrowRight" size={18} color={colors.textMuted} />}
    </Pressable>
  );
}

function SaleNoticeBanner({notice}: {notice: MobileSaleNotice}) {
  const tone = notice.tone === "success" ? "success" : notice.tone === "pending" ? "warning" : "danger";
  return <Banner tone={tone} message={notice.message} title="Sale result" />;
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.s4, flexGrow: 1, backgroundColor: colors.canvas,
    paddingHorizontal: spacing.s4, paddingBottom: spacing.s6, gap: spacing.s3,
  },
  hero: {borderColor: colors.brandForest, borderRadius: radius.lg},
  heroHeading: {flexDirection: "row", alignItems: "flex-start", gap: spacing.s3},
  heroContext: {flex: 1, minWidth: 0, gap: spacing.s1},
  eyebrow: {color: colors.gold, fontSize: typography.meta, fontWeight: typography.weightBold},
  businessName: {color: colors.textInverse, fontSize: 24, fontWeight: typography.weightHeavy, lineHeight: 30},
  meta: {color: colors.textInverseMuted, fontSize: typography.supporting, lineHeight: typography.supportingLine},
  heroAction: {
    flexDirection: "row", alignItems: "center", gap: spacing.s3, padding: spacing.s3,
    minHeight: touch.minTarget, borderRadius: radius.sm, backgroundColor: colors.gold, marginTop: spacing.s4,
  },
  heroActionText: {flex: 1, color: colors.midnight, fontSize: typography.body, fontWeight: typography.weightHeavy},
  pressed: {opacity: 0.6},
  sectionLabel: {color: colors.textStrong, fontSize: 19, lineHeight: 25, fontWeight: typography.weightHeavy, marginTop: spacing.s1},
  statGrid: {flexDirection: "row", flexWrap: "wrap", gap: spacing.s2},
  statTile: {flexGrow: 1, flexBasis: "46%", minWidth: 120},
  queueSummary: {flexDirection: "row", flexWrap: "wrap", gap: spacing.s3, padding: spacing.s4},
  queueMetric: {flexGrow: 1, flexBasis: 78, minWidth: 78, gap: spacing.s1},
  queueValue: {fontSize: typography.kpi, fontWeight: typography.weightHeavy},
  queueLabel: {color: colors.textMuted, fontSize: typography.meta, fontWeight: typography.weightBold},
  actionRow: {
    flexDirection: "row", alignItems: "center", minHeight: touch.minTarget,
    gap: spacing.s3, paddingHorizontal: spacing.s4, paddingVertical: spacing.s2,
  },
  rowDivider: {borderTopWidth: 1, borderTopColor: colors.border},
  actionLabel: {flex: 1, color: colors.textStrong, fontSize: typography.body, fontWeight: typography.weightMedium},
});
