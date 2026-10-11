"use client";

import { formatMoney, getCurrencyMeta, minorToMajor } from "@tradeos/contracts";

export interface MoneyValueProps {
  /** Integer minor units (e.g. pesewas, kobo). */
  minor: number;
  /** ISO 4217 currency code. */
  currencyCode: string;
  /** Visual size. */
  size?: "default" | "lg" | "xl";
  /** Tone — overrides color. */
  tone?: "default" | "muted" | "positive" | "negative";
  /** Show the currency code as a small prefix label (default: false — symbol is in the formatted string). */
  showCode?: boolean;
  /** Show the explicit + or - sign based on value sign. */
  signed?: boolean;
  className?: string;
}

/**
 * Exponent-aware money display. Uses `formatMoney` from `@tradeos/contracts`
 * which respects the currency's minor-unit exponent (0 for UGX/RWF/XOF/XAF,
 * 2 for GHS/NGN/KES, 3 for TND). Never hardcodes `/100`.
 */
export function MoneyValue({
  minor,
  currencyCode,
  size = "default",
  tone = "default",
  showCode = false,
  signed = false,
  className,
}: MoneyValueProps) {
  const meta = getCurrencyMeta(currencyCode);
  const formatted = formatMoney(minor, currencyCode);
  const toneClass =
    tone === "muted"
      ? " tos-money-value--muted"
      : tone === "positive" || (tone === "default" && minor > 0)
        ? ""
        : tone === "negative" || (tone === "default" && minor < 0)
          ? " tos-money-value--negative"
          : "";
  const sizeClass = size === "lg" ? " tos-money-value--lg" : size === "xl" ? " tos-money-value--xl" : "";
  const cls = `tos-money-value${toneClass}${sizeClass}${className ? ` ${className}` : ""}`;

  const sign = signed && minor > 0 ? "+" : "";
  return (
    <span className={cls} title={meta ? `${meta.name} (${currencyCode})` : currencyCode}>
      {showCode ? <span className="tos-money-value__currency">{currencyCode}</span> : null}
      {sign}
      {formatted}
    </span>
  );
}

/**
 * Returns the major-unit number for a minor-unit amount, or null if the
 * currency is unsupported. Convenience wrapper around `minorToMajor`.
 */
export function asMajor(minor: number, currencyCode: string): number | null {
  return minorToMajor(minor, currencyCode);
}
