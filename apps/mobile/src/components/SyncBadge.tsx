import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../theme";

export type SyncStatus = "online" | "offline" | "syncing" | "sync-failed" | "checking";

export type SyncBadgeProps = {
  status: SyncStatus;
  pendingCount?: number;
  failedCount?: number;
  variant?: "light" | "dark";
  accessibilityLabel?: string;
};

const STATUS_LABEL: Record<SyncStatus, string> = {
  online: "Online",
  offline: "Offline",
  syncing: "Syncing…",
  "sync-failed": "Sync failed",
  checking: "Checking…",
};

const STATUS_DOT: Record<SyncStatus, string> = {
  online: colors.positive,
  offline: colors.warning,
  syncing: colors.info,
  "sync-failed": colors.danger,
  checking: colors.textSoft,
};

/**
 * Derives the canonical sync status used by the workspace header from the
 * runtime's online/syncing flags and queue counters.
 */
export function deriveSyncStatus(args: {
  online: boolean | null;
  syncing: boolean;
  failed: number;
}): SyncStatus {
  if (args.syncing) return "syncing";
  if (args.online === null) return "checking";
  if (!args.online) return "offline";
  if (args.failed > 0) return "sync-failed";
  return "online";
}

export function SyncBadge({
  status,
  pendingCount,
  failedCount,
  variant = "light",
  accessibilityLabel,
}: SyncBadgeProps) {
  const isDark = variant === "dark";
  const bg = isDark ? "rgba(255,255,255,0.10)" : colors.surfaceSoft;
  const fg = isDark ? colors.textInverse : colors.text;
  const dot = STATUS_DOT[status];
  const label = STATUS_LABEL[status];
  const tail = pendingCount && pendingCount > 0 ? ` · ${pendingCount} pending`
    : failedCount && failedCount > 0 ? ` · ${failedCount} to review`
    : "";
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel ?? `${label}${tail}`.trim()}
      style={[styles.badge, { backgroundColor: bg }]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
        {label}
        {tail ? <Text style={isDark ? styles.tailDark : styles.tailLight}>{tail}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s2,
    paddingHorizontal: spacing.s3,
    paddingVertical: spacing.s1 + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(11,20,36,0.06)",
    alignSelf: "flex-start",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: typography.meta,
    fontWeight: typography.weightBold,
  },
  tailDark: {
    color: colors.textInverseMuted,
    fontWeight: typography.weightMedium,
  },
  tailLight: {
    color: colors.textMuted,
    fontWeight: typography.weightMedium,
  },
});
