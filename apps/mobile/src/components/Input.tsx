import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { TextInputProps } from "react-native";
import { colors, radius, spacing, typography } from "../theme";

export type InputProps = Omit<TextInputProps, "value" | "onChangeText"> & {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string | null;
  hint?: string | null;
  leftAdornment?: React.ReactNode;
  rightAdornment?: React.ReactNode;
};

export function Input({
  label,
  value,
  onChangeText,
  error,
  hint,
  leftAdornment,
  rightAdornment,
  style,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(error);
  const borderColor = hasError ? colors.danger
    : focused ? colors.gold
    : colors.border;
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputWrap,
          {
            borderColor,
            backgroundColor: focused ? colors.surface : colors.surfaceSoft,
          },
        ]}
      >
        {leftAdornment ? <View style={styles.adornmentLeft}>{leftAdornment}</View> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholderTextColor={colors.textSoft}
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
          style={[styles.input, style]}
          {...rest}
        />
        {rightAdornment ? <View style={styles.adornmentRight}>{rightAdornment}</View> : null}
      </View>
      {hint && !hasError ? <Text style={styles.hint}>{hint}</Text> : null}
      {hasError && error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGroup: {
    gap: spacing.s2,
  },
  label: {
    color: colors.textStrong,
    fontSize: typography.supporting,
    fontWeight: typography.weightBold,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.s3,
    backgroundColor: colors.surfaceSoft,
  },
  input: {
    flex: 1,
    minHeight: 48,
    color: colors.text,
    fontSize: typography.body,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  adornmentLeft: {
    marginRight: spacing.s2,
  },
  adornmentRight: {
    marginLeft: spacing.s2,
  },
  hint: {
    color: colors.textSoft,
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
  },
  error: {
    color: colors.danger,
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
    fontWeight: typography.weightBold,
  },
});
