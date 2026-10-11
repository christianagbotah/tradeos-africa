import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Card } from "./Card";
import { colors, spacing, typography } from "../theme";

export type StatTone = "neutral" | "positive" | "warning" | "danger" | "info" | "gold";

export type StatCardProps = {
  label: string;
  value: string;
  hint?: string | null;
  tone?: StatTone;
  variant?: "default" | "raised";
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

const TONE_VALUE: Record<StatTone, string> = {
  neutral: colors.textStrong,
  positive: colors.positive,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
  gold: colors.goldStrong,
};

const TONE_HINT: Record<StatTone, string> = {
  neutral: colors.textSoft,
  positive: colors.positive,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
  gold: colors.goldStrong,
};

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  variant = "default",
  style,
  accessibilityLabel,
}: StatCardProps) {
  return (
    <Card
      variant={variant}
      padding="compact"
      accessibilityLabel={accessibilityLabel ?? `${label}: ${value}${hint ? `, ${hint}` : ""}`}
      style={[styles.card, style]}
    >
      <View style={styles.content}>
        <Text style={styles.label} numberOfLines={2}>{label}</Text>
        <Text style={[styles.value, { color: TONE_VALUE[tone] }]} numberOfLines={1}>
          {value}
        </Text>
        {hint ? <Text style={[styles.hint, { color: TONE_HINT[tone] }]} numberOfLines={2}>{hint}</Text> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 96,
    justifyContent: "center",
  },
  content: {
    gap: spacing.s1,
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.meta,
    fontWeight: typography.weightBold,
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  value: {
    color: colors.textStrong,
    fontSize: typography.kpi,
    fontWeight: typography.weightBlack,
    letterSpacing: -0.4,
  },
  hint: {
    fontSize: typography.meta,
    fontWeight: typography.weightBold,
  },
});
