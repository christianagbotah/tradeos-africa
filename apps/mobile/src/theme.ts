import type { TextStyle, ViewStyle } from "react-native";

/**
 * TradeOS Africa mobile design tokens.
 *
 * Mirrors `apps/web/app/tradeos-tokens.css` so the mobile app expresses the same
 * product family — TradeOS canvas, midnight surfaces, gold brand accent, and the
 * same semantic positive/warning/danger/info palette — as React Native values.
 */

export const colors = {
  // Surfaces
  canvas: "#f3f5f8",
  surface: "#ffffff",
  surfaceSoft: "#f8fafc",
  surfaceRaised: "#ffffff",

  // Text
  text: "#101828",
  textStrong: "#07111f",
  textMuted: "#667085",
  textSoft: "#8791a2",
  textInverse: "#ffffff",
  textInverseMuted: "#c8d2e2",

  // Borders
  border: "#dde3ea",
  borderStrong: "#c8d1dc",

  // Brand — midnight + gold (TradeOS African trade palette)
  midnight: "#0b1424",
  midnightSoft: "#152238",
  midnightRaised: "#1d2c46",
  gold: "#c99935",
  goldStrong: "#a87f25",
  goldSoft: "#f7efd9",
  goldBorder: "#e5cd92",

  // Semantic
  positive: "#168456",
  positiveSoft: "#eaf7f0",
  positiveBorder: "#b9dfc9",
  warning: "#ad7016",
  warningSoft: "#fff7e8",
  warningBorder: "#e8d29a",
  danger: "#b84a45",
  dangerSoft: "#fff0ef",
  dangerBorder: "#efc0ad",
  info: "#356b94",
  infoSoft: "#eef6fb",
  infoBorder: "#c8dcec",

  // Misc
  overlay: "rgba(11, 20, 36, 0.45)",
  transparent: "transparent",
} as const;

export const spacing = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 20,
  s6: 24,
  s8: 32,
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  // Font sizes
  meta: 12,
  supporting: 14,
  body: 16,
  nav: 15,
  section: 20,
  page: 32,
  display: 28,
  kpi: 26,

  // Line heights
  metaLine: 17,
  supportingLine: 21,
  bodyLine: 24,
  sectionLine: 26,
  pageLine: 38,

  // Letter spacing
  kickerTracking: 1.2,
  brandTracking: 2,

  // Weights
  weightRegular: "400" as const,
  weightMedium: "600" as const,
  weightBold: "700" as const,
  weightHeavy: "800" as const,
  weightBlack: "900" as const,
} as const;

export const touch = {
  minTarget: 48,
  iconTarget: 44,
  compactTarget: 40,
} as const;

export const shadows = {
  card: {
    shadowColor: "#0b1424",
    shadowOpacity: 0.055,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  } satisfies ViewStyle,
  raised: {
    shadowColor: "#0b1424",
    shadowOpacity: 0.1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  } satisfies ViewStyle,
  floating: {
    shadowColor: "#0b1424",
    shadowOpacity: 0.16,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
  } satisfies ViewStyle,
  header: {
    shadowColor: "#0b1424",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  } satisfies ViewStyle,
} as const;

export const textStyles = {
  eyebrow: {
    color: colors.gold,
    fontSize: typography.meta,
    fontWeight: typography.weightHeavy,
    letterSpacing: typography.kickerTracking,
    textTransform: "uppercase",
  } satisfies TextStyle,
  kicker: {
    color: colors.goldStrong,
    fontSize: typography.meta,
    fontWeight: typography.weightBlack,
    letterSpacing: typography.kickerTracking,
    textTransform: "uppercase",
  } satisfies TextStyle,
  sectionTitle: {
    color: colors.textStrong,
    fontSize: typography.section,
    fontWeight: typography.weightBlack,
    lineHeight: typography.sectionLine,
  } satisfies TextStyle,
  bodyText: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: typography.bodyLine,
  } satisfies TextStyle,
  supportingText: {
    color: colors.textMuted,
    fontSize: typography.supporting,
    lineHeight: typography.supportingLine,
  } satisfies TextStyle,
  metaText: {
    color: colors.textSoft,
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
  } satisfies TextStyle,
  pageHeader: {
    color: colors.textStrong,
    fontSize: typography.page,
    fontWeight: typography.weightBlack,
    lineHeight: typography.pageLine,
    letterSpacing: -0.6,
  } satisfies TextStyle,
} as const;

export const motion = {
  fast: 150,
  medium: 220,
} as const;

export type Theme = {
  colors: typeof colors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  touch: typeof touch;
  shadows: typeof shadows;
  textStyles: typeof textStyles;
  motion: typeof motion;
};

export const theme: Theme = {
  colors,
  spacing,
  radius,
  typography,
  touch,
  shadows,
  textStyles,
  motion,
};
