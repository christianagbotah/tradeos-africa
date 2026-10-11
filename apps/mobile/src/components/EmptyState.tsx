import { StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { Icon, IconTile, type IconName } from "./icons";
import { Button } from "./Button";
import { colors, spacing, typography } from "../theme";

export type EmptyStateKind = "empty" | "loading" | "error";

export type EmptyStateProps = {
  kind?: EmptyStateKind;
  icon?: IconName;
  title: string;
  description?: string;
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  children?: ReactNode;
  accessibilityLabel?: string;
};

const KIND_ICON: Record<EmptyStateKind, IconName> = {
  empty: "info",
  loading: "refresh",
  error: "error",
};

const KIND_TINT: Record<EmptyStateKind, { bg: string; fg: string }> = {
  empty: { bg: colors.surfaceSoft, fg: colors.textSoft },
  loading: { bg: colors.infoSoft, fg: colors.info },
  error: { bg: colors.dangerSoft, fg: colors.danger },
};

export function EmptyState({
  kind = "empty",
  icon,
  title,
  description,
  actionLabel,
  onAction,
  children,
  accessibilityLabel,
}: EmptyStateProps) {
  const iconName = icon ?? KIND_ICON[kind];
  const tint = KIND_TINT[kind];
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel ?? title}
      style={styles.container}
    >
      <IconTile name={iconName} size={56} background={tint.bg} tint={tint.fg} accessibilityLabel={`${kind} state`} />
      <Text style={styles.title} numberOfLines={2}>{title}</Text>
      {description ? <Text style={styles.description} numberOfLines={4}>{description}</Text> : null}
      {children}
      {actionLabel && onAction ? (
        <Button
          variant="secondary"
          size="compact"
          accessibilityLabel={actionLabel}
          onPress={onAction}
        >
          {actionLabel}
        </Button>
      ) : null}
    </View>
  );
}

/**
 * Inline loading row used inside cards / list areas (smaller than EmptyState).
 */
export function LoadingRow({ label, hint }: { label: string; hint?: string }) {
  return (
    <View style={styles.loadingRow}>
      <Icon name="refresh" size={18} color={colors.info} />
      <View style={styles.loadingCopy}>
        <Text style={styles.loadingLabel}>{label}</Text>
        {hint ? <Text style={styles.loadingHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.s6,
    paddingHorizontal: spacing.s4,
    gap: spacing.s3,
  },
  title: {
    color: colors.textStrong,
    fontSize: typography.supporting,
    fontWeight: typography.weightBlack,
    textAlign: "center",
    maxWidth: 320,
  },
  description: {
    color: colors.textMuted,
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
    textAlign: "center",
    maxWidth: 320,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s3,
    padding: spacing.s3,
  },
  loadingCopy: {
    flex: 1,
    gap: 2,
  },
  loadingLabel: {
    color: colors.text,
    fontSize: typography.supporting,
    fontWeight: typography.weightBold,
  },
  loadingHint: {
    color: colors.textMuted,
    fontSize: typography.meta,
  },
});
