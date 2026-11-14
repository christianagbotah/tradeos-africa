import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import type { BusinessNotificationItem, BusinessNotificationsResponse } from "@tradeos/contracts";
import type { MobileApiClient } from "../api-client";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { colors, radius, spacing, typography } from "../theme";

const ALLOWED_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

export function canReadMobileNotifications(role: string): boolean {
  return ALLOWED_ROLES.has(role);
}

export type NotificationsScreenProps = {
  api: Pick<MobileApiClient, "getBusinessNotifications" | "acknowledgeBusinessNotification">;
  businessId: string;
  branchId: string;
  role: string;
  online: boolean;
  onBack: () => void;
};

/**
 * The mobile inbox does not persist private financial notifications or claim
 * that cached advice is current. It fetches authoritative business and branch
 * alerts on each entry/reconnect and checks the returned scope before display.
 * Owner approvals stay in the canonical web review workflow.
 */
export function NotificationsScreen({
  api, businessId, branchId, role, online, onBack,
}: NotificationsScreenProps) {
  const allowed = canReadMobileNotifications(role);
  const [inbox, setInbox] = useState<BusinessNotificationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const reload = useCallback(async () => {
    const current = ++sequence.current;
    setInbox(null);
    setError(null);
    if (!online || !allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const fresh = await api.getBusinessNotifications(businessId, branchId);
      if (sequence.current !== current) return;
      if (fresh.businessId !== businessId || fresh.branchId !== branchId) {
        setError("TradeOS returned notifications for a different business context. Nothing was displayed.");
        return;
      }
      setInbox(fresh);
    } catch {
      if (sequence.current === current) {
        setError("Could not load notifications. Check your connection and try again.");
      }
    } finally {
      if (sequence.current === current) setLoading(false);
    }
  }, [api, businessId, branchId, online, allowed]);

  useEffect(() => {
    void reload();
    return () => { sequence.current += 1; };
  }, [reload]);

  async function markRead(item: BusinessNotificationItem) {
    if (!online || saving || !allowed) return;
    const current = sequence.current;
    setSaving(item.kind + ":" + item.id);
    setError(null);
    try {
      await api.acknowledgeBusinessNotification(businessId, branchId, item.kind, item.id);
      if (sequence.current === current) await reload();
    } catch {
      if (sequence.current === current) setError("Could not acknowledge this notification. Try again.");
    } finally {
      if (sequence.current === current) setSaving(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <WorkspaceHeader online={online} syncing={false} pendingCount={0} failedCount={0} />
      <View style={styles.heading}>
        <View style={styles.headingText}>
          <Text style={styles.eyebrow}>Business intelligence</Text>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>Verified branch alerts and pending owner reviews.</Text>
        </View>
        <Button variant="secondary" size="compact" accessibilityLabel="Go back to More"
          onPress={onBack}>Back</Button>
      </View>

      {!allowed ? (
        <Banner tone="warning" title="Not permitted"
          message="Your business role cannot access private financial notifications." />
      ) : !online ? (
        <Banner tone="info" title="Offline"
          message="Notifications are not available offline. Your queued sales continue working normally." />
      ) : (
        <>
          <View style={styles.toolbar}>
            <Text style={styles.unread}>
              {inbox ? inbox.unreadCount.toLocaleString("en-GH") + " unread" : "Current branch"}
            </Text>
            <Button variant="secondary" size="compact" accessibilityLabel="Refresh notifications"
              disabled={loading || saving !== null}
              onPress={() => { void reload(); }}>Refresh</Button>
          </View>
          {loading ? (
            <Card>
              <View style={styles.loading}>
                <ActivityIndicator color={colors.goldStrong} />
                <Text style={styles.support}>Checking business notifications…</Text>
              </View>
            </Card>
          ) : null}
          {error ? <Banner tone="danger" title="Notifications error" message={error} /> : null}
          {!loading && inbox && inbox.notifications.length === 0 ? (
            <Card><Text style={styles.support}>
              No active alerts or pending approval notifications for this branch.
            </Text></Card>
          ) : null}
          {inbox?.notifications.map((item) => (
            <Card key={item.kind + ":" + item.id} style={styles.item}>
              <View style={styles.itemHeading}>
                <Text style={styles.kind}>{item.kind === "APPROVAL" ? "OWNER APPROVAL" : item.severity}</Text>
                {item.readAt ? null : <Text style={styles.unreadFlag}>NEW</Text>}
              </View>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemSummary}>{item.summary}</Text>
              <Text style={styles.meta}>
                {new Date(item.occurredAt).toLocaleString("en-GH",
                  { dateStyle: "medium", timeStyle: "short" })}
              </Text>
              {item.kind === "APPROVAL" ? (
                <Text style={styles.guidance}>
                  To approve or reject this proposal, open your business dashboard on the web.
                  Marking this notice as read does not approve it.
                </Text>
              ) : null}
              {!item.readAt ? (
                <Button variant="secondary" size="compact"
                  accessibilityLabel={"Mark " + item.title + " as read"}
                  loading={saving === item.kind + ":" + item.id}
                  disabled={saving !== null || loading}
                  onPress={() => { void markRead(item); }}>
                  Mark as read
                </Button>
              ) : null}
            </Card>
          ))}
          {inbox?.truncated ? (
            <Banner tone="warning" title="Partial results"
              message="Showing the first 100 active notifications. Review your business web dashboard for more." />
          ) : null}
          <Text style={styles.footer}>
            Notifications update only when online. No push notification delivery is enabled yet.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, gap: spacing.s3, paddingHorizontal: spacing.s4,
    paddingBottom: spacing.s8, backgroundColor: colors.canvas },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    gap: spacing.s3, marginTop: spacing.s2 },
  headingText: { flex: 1, gap: spacing.s1 },
  eyebrow: { fontSize: typography.meta, fontWeight: typography.weightHeavy,
    color: colors.goldStrong, textTransform: "uppercase", letterSpacing: typography.kickerTracking },
  title: { color: colors.textStrong, fontSize: typography.display,
    fontWeight: typography.weightBlack },
  subtitle: { color: colors.textMuted, fontSize: typography.supporting,
    lineHeight: typography.supportingLine },
  toolbar: { flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", gap: spacing.s2 },
  unread: { fontSize: typography.supporting, fontWeight: typography.weightBlack,
    color: colors.textStrong },
  loading: { flexDirection: "row", alignItems: "center", gap: spacing.s3 },
  support: { color: colors.textMuted, fontSize: typography.supporting,
    lineHeight: typography.supportingLine },
  item: { gap: spacing.s2, borderRadius: radius.md },
  itemHeading: { flexDirection: "row", alignItems: "center", gap: spacing.s2 },
  kind: { color: colors.warning, fontSize: typography.meta, fontWeight: typography.weightBlack },
  unreadFlag: { backgroundColor: colors.infoSoft, color: colors.info, overflow: "hidden",
    borderRadius: radius.sm, paddingHorizontal: spacing.s2, paddingVertical: spacing.s1,
    fontSize: typography.meta, fontWeight: typography.weightBlack },
  itemTitle: { fontSize: typography.body, lineHeight: typography.bodyLine,
    fontWeight: typography.weightBlack, color: colors.textStrong },
  itemSummary: { fontSize: typography.supporting, lineHeight: typography.supportingLine,
    color: colors.text },
  meta: { color: colors.textSoft, fontSize: typography.meta },
  guidance: { color: colors.warning, fontSize: typography.meta,
    lineHeight: typography.metaLine },
  footer: { color: colors.textMuted, fontSize: typography.meta,
    lineHeight: typography.metaLine },
});
