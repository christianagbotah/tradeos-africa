import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { colors, radius, shadows, spacing } from "../theme";

export type CardVariant = "default" | "raised" | "flat";
export type CardPadding = "none" | "compact" | "default" | "comfortable";

export type CardProps = {
  variant?: CardVariant;
  padding?: CardPadding;
  background?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  accessibilityLabel?: string | undefined;
};

const PADDING: Record<CardPadding, number> = {
  none: 0,
  compact: spacing.s3,
  default: spacing.s4,
  comfortable: spacing.s5,
};

export function Card({
  variant = "default",
  padding = "default",
  background,
  style,
  children,
  accessibilityLabel,
}: CardProps) {
  const bg = background ?? colors.surface;
  const shadowStyle = variant === "raised" ? shadows.raised
    : variant === "flat" ? null
    : shadows.card;
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.base,
        {
          backgroundColor: bg,
          borderRadius: radius.md,
          padding: PADDING[padding],
        },
        shadowStyle,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * A midnight-coloured hero card — used for the workspace identity, dashboard
 * header, and POS totals bar. Inverts text color expectations.
 */
export function HeroCard({
  padding = "comfortable",
  style,
  children,
  accessibilityLabel,
}: {
  padding?: CardPadding;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  accessibilityLabel?: string | undefined;
}) {
  return (
    <Card
      variant="raised"
      padding={padding}
      background={colors.midnight}
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderColor: colors.border,
  },
});
