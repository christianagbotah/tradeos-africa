import { StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { colors, radius, spacing, typography } from "../theme";

export type BannerTone = "info" | "success" | "warning" | "danger" | "neutral";

export type BannerProps = {
  tone?: BannerTone;
  message: string;
  title?: string;
  icon?: IconName;
  children?: ReactNode;
};

const TONE_STYLES: Record<BannerTone, { bg: string; border: string; fg: string; icon: IconName; iconColor: string }> = {
  info:    { bg: colors.infoSoft,    border: colors.infoBorder,    fg: colors.info,    icon: "info",    iconColor: colors.info },
  success: { bg: colors.positiveSoft, border: colors.positiveBorder, fg: colors.positive, icon: "check",   iconColor: colors.positive },
  warning: { bg: colors.warningSoft, border: colors.warningBorder, fg: colors.warning, icon: "warning", iconColor: colors.warning },
  danger:  { bg: colors.dangerSoft,  border: colors.dangerBorder,  fg: colors.danger,  icon: "error",   iconColor: colors.danger },
  neutral: { bg: colors.surfaceSoft, border: colors.border,        fg: colors.text,    icon: "info",    iconColor: colors.textMuted },
};

export function Banner({ tone = "info", message, title, icon, children }: BannerProps) {
  const s = TONE_STYLES[tone];
  const iconName = icon ?? s.icon;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.base, { backgroundColor: s.bg, borderColor: s.border }]}
    >
      <View style={styles.row}>
        <Icon name={iconName} size={18} color={s.iconColor} />
        <View style={styles.copy}>
          {title ? <Text style={[styles.title, { color: s.fg }]} numberOfLines={2}>{title}</Text> : null}
          <Text style={[styles.message, { color: s.fg }]}>{message}</Text>
          {children}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.s3,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.s2,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: typography.supporting,
    fontWeight: typography.weightBlack,
  },
  message: {
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
    fontWeight: typography.weightMedium,
  },
});
