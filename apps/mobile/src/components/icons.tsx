import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ViewStyle } from "react-native";
import { colors, spacing } from "../theme";

/** Shared native vector icons for a consistent, scalable visual language. */
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

const GLYPHS: Record<IconName, React.ComponentProps<typeof Ionicons>["name"]> = {
  dashboard: "home-outline", sell: "cart-outline", sales: "receipt-outline",
  more: "grid-outline", sync: "sync-outline", refresh: "refresh-outline",
  search: "search-outline", plus: "add", minus: "remove", close: "close",
  check: "checkmark", warning: "warning-outline", error: "alert-circle-outline",
  info: "information-circle-outline", lock: "lock-closed-outline",
  logout: "log-out-outline", user: "person-outline", store: "storefront-outline",
  cart: "cart-outline", catalog: "pricetags-outline", wifiOff: "cloud-offline-outline",
  wifiOn: "wifi-outline", spinner: "reload-outline", branch: "location-outline",
  currency: "cash-outline", chart: "stats-chart-outline", shield: "shield-checkmark-outline",
  arrowRight: "chevron-forward", trash: "trash-outline",
};

export function Icon({ name, size = 22, color, accessibilityLabel }: IconProps) {
  return <Ionicons name={GLYPHS[name]} size={size} color={color ?? colors.text}
    accessible={Boolean(accessibilityLabel)} accessibilityLabel={accessibilityLabel} />;
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
