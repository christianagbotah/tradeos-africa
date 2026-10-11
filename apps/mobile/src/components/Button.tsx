import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { PressableProps, StyleProp, ViewStyle } from "react-native";
import { colors, radius, spacing, touch, typography } from "../theme";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "gold";
export type ButtonSize = "default" | "compact";

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  children: React.ReactNode;
};

const VARIANT_COLORS: Record<ButtonVariant, { bg: string; fg: string; border: string; pressedBg: string }> = {
  primary: { bg: colors.midnight, fg: colors.textInverse, border: colors.midnight, pressedBg: colors.midnightSoft },
  gold: { bg: colors.gold, fg: colors.midnight, border: colors.gold, pressedBg: colors.goldStrong },
  secondary: { bg: colors.surface, fg: colors.textStrong, border: colors.borderStrong, pressedBg: colors.surfaceSoft },
  ghost: { bg: colors.transparent, fg: colors.text, border: colors.transparent, pressedBg: colors.surfaceSoft },
  danger: { bg: colors.danger, fg: colors.textInverse, border: colors.danger, pressedBg: "#9a3e3a" },
};

export function Button({
  variant = "primary",
  size = "default",
  disabled = false,
  loading = false,
  fullWidth = false,
  accessibilityLabel,
  onPress,
  style,
  children,
  ...rest
}: ButtonProps) {
  const palette = VARIANT_COLORS[variant];
  const minHeight = size === "compact" ? touch.compactTarget : touch.minTarget;
  const paddingHorizontal = size === "compact" ? spacing.s3 : spacing.s4;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight,
          paddingHorizontal,
          backgroundColor: pressed ? palette.pressedBg : palette.bg,
          borderColor: palette.border,
        },
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={palette.fg} />
          <Text style={[styles.label, { color: palette.fg }]}>{accessibilityLabel}</Text>
        </View>
      ) : (
        <Text style={[styles.label, { color: palette.fg }]} numberOfLines={1}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.s2,
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  disabled: {
    opacity: 0.45,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s2,
  },
  label: {
    fontSize: typography.supporting,
    fontWeight: typography.weightBlack,
    letterSpacing: 0.2,
  },
});
