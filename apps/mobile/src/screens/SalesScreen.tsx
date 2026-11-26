import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Card, HeroCard } from "../components/Card";
import type {SaleReversal} from "../sale-reversal";
import type {ReceiptOutcome} from "../customer-payment";
import type {MobileActionFeedback} from "../action-feedback";
import { PostedSalesHistory } from "./PostedSalesHistory";
import type { MobileApiClient } from "../api-client";
import { Icon, IconTile } from "../components/icons";
import { StatCard } from "../components/StatCard";
import { colors, radius, spacing, typography } from "../theme";
import type { MobileAppSnapshot } from "../app-model";

export type SalesScreenProps = {
  snapshot: MobileAppSnapshot;
  api: MobileApiClient;
  onSync: () => void;
  onGoToSell: () => void;
  onReversal:(input:SaleReversal)=>Promise<ReceiptOutcome>;
  onFeedback:(feedback:MobileActionFeedback)=>void;
};

export function SalesScreen({ snapshot, api, onSync, onGoToSell,onReversal,onFeedback }: SalesScreenProps) {
  if (snapshot.bootstrap?.status !== "READY") return null;
  const ready = snapshot.bootstrap;
  const queue = ready.queue;


  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >

      <HeroCard padding="comfortable" style={styles.hero}>
        <Text style={styles.heroKicker}>Sales · mobile view</Text>
        <Text style={styles.heroTitle}>Sales history &amp; sync queue</Text>
        <Text style={styles.heroLead}>
          TradeOS records every sale as authoritative evidence on the server.
          Review posted sales and transactions waiting to sync, in one workspace.
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
                ? "No transactions are waiting. Offline-capable submissions are saved here."
                : `${queue.pending} transaction${queue.pending === 1 ? "" : "s"} captured on this device will sync automatically when the connection returns.`}
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
                ? "No transactions were rejected by the server."
                : `${queue.failed} transaction${queue.failed === 1 ? "" : "s"} could not be applied. The evidence is preserved on this device for correction or retry.`}
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

      <PostedSalesHistory
        key={ready.user.id+":"+ready.membership.businessId+":"+ready.branch.id+":"+ready.membership.role}
        api={api} businessId={ready.membership.businessId} branchId={ready.branch.id}
        role={ready.membership.role} timezone={ready.branch.timezone}
        online={snapshot.online===true} syncing={snapshot.syncing} pendingCount={queue.pending} onReversal={onReversal} onFeedback={onFeedback}/>
      <Button variant="gold" fullWidth accessibilityLabel="Start a new sale" onPress={onGoToSell}>Start a new sale</Button>

      <Text style={styles.footerNote}>
        TradeOS Africa · Mobile sales view · {ready.business.currencyCode}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.s4,
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
