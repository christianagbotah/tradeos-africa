import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "./icons";
import { colors, spacing, touch, typography } from "../theme";

export type BottomNavTab = "dashboard" | "sell" | "sales" | "more";

export type BottomNavProps = {
  active: BottomNavTab;
  onChange: (tab: BottomNavTab) => void;
  pendingCount?: number;
  failedCount?: number;
};

type TabDef = {
  key: BottomNavTab;
  label: string;
  icon: IconName;
  accessibilityLabel: string;
  accessibilityHint: string;
};

const TABS: readonly TabDef[] = [
  { key: "dashboard", label: "Home", icon: "dashboard",
    accessibilityLabel: "Dashboard tab", accessibilityHint: "View business overview and quick actions" },
  { key: "sell", label: "Sell", icon: "sell",
    accessibilityLabel: "Sell tab", accessibilityHint: "Open the point-of-sale workspace" },
  { key: "sales", label: "Sales", icon: "sales",
    accessibilityLabel: "Sales tab", accessibilityHint: "View recent sales and the offline sync queue" },
  { key: "more", label: "More", icon: "more",
    accessibilityLabel: "More tab", accessibilityHint: "Open sync settings, branch context, and sign out" },
] as const;

export function BottomNav({ active, onChange, pendingCount = 0, failedCount = 0 }: BottomNavProps) {
  return (
    <SafeAreaView style={styles.wrapper}>
      <View style={styles.bar} accessibilityRole="tablist">
        {TABS.map((tab) => {
          const isActive = active === tab.key;
          const showBadge = (tab.key === "sales") && (pendingCount > 0 || failedCount > 0);
          const badgeTone = failedCount > 0 ? colors.danger : colors.gold;
          const badgeCount = failedCount > 0 ? failedCount : pendingCount;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={tab.accessibilityLabel}
              accessibilityHint={tab.accessibilityHint}
              onPress={() => onChange(tab.key)}
              style={({ pressed }) => [
                styles.tab,
                pressed && styles.tabPressed,
              ]}
            >
              <View style={styles.iconWrap}>
                <Icon
                  name={tab.icon}
                  size={22}
                  color={isActive ? colors.gold : colors.textMuted}
                />
                {showBadge ? (
                  <View style={[styles.badge, { backgroundColor: badgeTone }]}>
                    <Text style={styles.badgeText}>{badgeCount > 9 ? "9+" : badgeCount}</Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={[styles.label, { color: isActive ? colors.gold : colors.textMuted }]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
              {isActive ? <View style={styles.accentBar} /> : null}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.midnight,
  },
  bar: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: touch.minTarget + 14,
    paddingHorizontal: spacing.s2,
    paddingTop: spacing.s1,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing.s2,
    paddingBottom: spacing.s2,
    minHeight: touch.minTarget,
    position: "relative",
  },
  tabPressed: {
    opacity: 0.7,
  },
  iconWrap: {
    position: "relative",
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: typography.meta,
    fontWeight: typography.weightBold,
    marginTop: 2,
  },
  accentBar: {
    position: "absolute",
    top: 0,
    width: 24,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.gold,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: colors.textInverse,
    fontSize: 10,
    fontWeight: typography.weightBlack,
  },
});
