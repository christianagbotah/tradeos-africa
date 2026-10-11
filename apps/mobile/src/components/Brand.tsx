import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../theme";

export type BrandProps = {
  compact?: boolean;
  variant?: "light" | "dark";
};

/**
 * TradeOS Africa wordmark + gold tile. The `compact` variant is used in the
 * workspace header; the full variant anchors the auth hero.
 */
export function Brand({ compact = false, variant = "light" }: BrandProps) {
  const isLight = variant === "light";
  const brandText = isLight ? colors.textInverse : colors.textStrong;
  const accentText = isLight ? colors.gold : colors.gold;
  return (
    <View style={styles.row}>
      <View style={[styles.mark, compact && styles.markCompact]}>
        <Text style={styles.markText}>T</Text>
      </View>
      <View style={styles.copy}>
        <Text style={[styles.brand, { color: brandText }]}>TradeOS</Text>
        <Text style={[styles.accent, { color: accentText }]}>AFRICA</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s2 + 2,
  },
  mark: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  markCompact: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
  },
  markText: {
    color: colors.midnight,
    fontSize: typography.section,
    fontWeight: typography.weightBlack,
  },
  copy: {
    gap: 0,
  },
  brand: {
    fontSize: typography.supporting + 1,
    fontWeight: typography.weightBlack,
    lineHeight: typography.supportingLine - 4,
  },
  accent: {
    fontSize: typography.meta - 2,
    fontWeight: typography.weightBlack,
    letterSpacing: typography.brandTracking,
    lineHeight: typography.metaLine - 2,
  },
});
