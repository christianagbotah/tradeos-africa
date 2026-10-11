import { StyleSheet, View } from "react-native";
import { Brand } from "./Brand";
import { SyncBadge, deriveSyncStatus, type SyncBadgeProps } from "./SyncBadge";
import { colors, spacing } from "../theme";

export type WorkspaceHeaderProps = {
  online: boolean | null;
  syncing: boolean;
  failedCount: number;
  pendingCount?: number;
  variant?: "light" | "dark";
  right?: React.ReactNode;
};

/**
 * Midnight sticky header used at the top of every authenticated screen. Carries
 * the TradeOS brand and a live sync badge.
 */
export function WorkspaceHeader({
  online,
  syncing,
  failedCount,
  pendingCount = 0,
  variant = "dark",
  right,
}: WorkspaceHeaderProps) {
  const status = deriveSyncStatus({ online, syncing, failed: failedCount });
  const isDark = variant === "dark";
  return (
    <View
      accessibilityRole="header"
      style={[styles.header, isDark && styles.headerDark]}
    >
      <Brand compact variant={isDark ? "light" : "dark"} />
      <View style={styles.right}>
        {right}
        <SyncBadge
          status={status}
          pendingCount={pendingCount}
          failedCount={failedCount}
          variant={isDark ? "dark" : "light"}
        />
      </View>
    </View>
  );
}

export type { SyncBadgeProps };

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.s4,
    paddingVertical: spacing.s3,
    gap: spacing.s3,
  },
  headerDark: {
    backgroundColor: colors.midnight,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s2,
    flexShrink: 1,
  },
});
