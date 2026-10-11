import { Text, View } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { colors, spacing, typography } from "../theme";

/**
 * Lightweight inline icons for TradeOS mobile.
 *
 * No external icon dependency — we render with View + Text glyphs so the bundle
 * stays inside the existing mobile dependency list (Expo, RN, netinfo,
 * async-storage, secure-store, expo-crypto).
 *
 * Glyphs are simple, monochrome, and inherit tint from `color`.
 */

export type IconName =
  | "dashboard"
  | "sell"
  | "sales"
  | "more"
  | "sync"
  | "refresh"
  | "search"
  | "plus"
  | "minus"
  | "close"
  | "check"
  | "warning"
  | "error"
  | "info"
  | "lock"
  | "logout"
  | "user"
  | "store"
  | "cart"
  | "catalog"
  | "wifiOff"
  | "wifiOn"
  | "spinner"
  | "branch"
  | "currency"
  | "chart"
  | "shield"
  | "arrowRight"
  | "trash";

export type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
};

const GLYPHS: Record<IconName, string> = {
  dashboard: "⌂",
  sell: "₵",
  sales: "▦",
  more: "⋯",
  sync: "↻",
  refresh: "↻",
  search: "⌕",
  plus: "+",
  minus: "−",
  close: "×",
  check: "✓",
  warning: "!",
  error: "✕",
  info: "i",
  lock: "⚿",
  logout: "⏻",
  user: "◍",
  store: "🏬",
  cart: "🛒",
  catalog: "☰",
  wifiOff: "⊘",
  wifiOn: "◐",
  spinner: "◌",
  branch: "⌖",
  currency: "¤",
  chart: "📈",
  shield: "⛨",
  arrowRight: "→",
  trash: "⌫",
};

export function Icon({ name, size = 22, color, accessibilityLabel }: IconProps) {
  const tint = color ?? colors.text;
  const glyph = GLYPHS[name];
  // For solid-dot style icons (warning/error/info/wifiOff), render a circular
  // badge with a single-letter/symbol glyph so they read clearly at small sizes.
  if (name === "warning" || name === "error" || name === "info" || name === "wifiOff") {
    const badgeColor = name === "warning" ? colors.warning
      : name === "error" ? colors.danger
      : name === "wifiOff" ? colors.danger
      : colors.info;
    const badgeText = name === "warning" ? "!"
      : name === "error" ? "✕"
      : name === "wifiOff" ? "!"
      : "i";
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: badgeColor,
          alignItems: "center",
          justifyContent: "center",
        }}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
      >
        <Text style={{ color: colors.textInverse, fontSize: size * 0.55, fontWeight: typography.weightBlack }}>
          {badgeText}
        </Text>
      </View>
    );
  }
  return (
    <Text
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{
        color: tint,
        fontSize: size,
        lineHeight: size,
        fontWeight: typography.weightBold,
        textAlign: "center",
        textAlignVertical: "center",
        includeFontPadding: false,
      } satisfies TextStyle}
    >
      {glyph}
    </Text>
  );
}

/**
 * Small rounded tile used to anchor an icon in lists / quick actions.
 */
export function IconTile({
  name,
  size = 44,
  tint,
  background,
  accessibilityLabel,
}: {
  name: IconName;
  size?: number;
  tint?: string;
  background?: string;
  accessibilityLabel?: string;
}) {
  const bg = background ?? colors.midnightSoft;
  const fg = tint ?? colors.gold;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radiusFor(size),
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
      } satisfies ViewStyle}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <Icon name={name} size={Math.round(size * 0.5)} color={fg} />
    </View>
  );
}

function radiusFor(size: number): number {
  if (size <= 32) return 10;
  if (size <= 44) return 12;
  return 14;
}

export { spacing };
