/**
 * Display formatters for the TradeOS desktop client.
 *
 * Money is rendered using `@tradeos/contracts` currency metadata so the
 * symbol, exponent and decimal places are always authoritative. The desktop
 * visual style is `₵6.50` (no space between symbol and value); we post-process
 * the canonical `formatMoney` output to match.
 *
 * For demo/sample content that still uses major-unit floats (legacy shapes),
 * `fmtMoneyMajor` accepts a major-unit number and routes through the same
 * currency metadata so the rendered string is identical.
 */

import {
  formatMoney as canonicalFormatMoney,
  getCurrencyMeta,
  minorToMajor,
} from "@tradeos/contracts";

const DEFAULT_CURRENCY = "GHS";

/**
 * Format integer minor units as a display string. Defaults to GHS.
 * Mirrors the desktop's compact visual style (`₵6.50`, no space).
 */
export function fmtMoneyMinor(minor: number, currencyCode: string = DEFAULT_CURRENCY): string {
  const meta = getCurrencyMeta(currencyCode);
  if (!meta) {
    // Unsupported currency: never silently fall back. Show code + raw value.
    return `${currencyCode.toUpperCase()} ${minor}`;
  }
  const canonical = canonicalFormatMoney(minor, currencyCode);
  // canonical returns e.g. "₵ 6.50" — strip the space to match desktop style.
  return canonical.replace(/^([^\s]+)\s+/, "$1");
}

/**
 * Format a major-unit number (e.g. 6.5) for display. Used only by demo/sample
 * paths where the source data is already in major units. Live data uses
 * `fmtMoneyMinor` with integer minor units.
 */
export function fmtMoneyMajor(major: number, currencyCode: string = DEFAULT_CURRENCY): string {
  const meta = getCurrencyMeta(currencyCode);
  if (!meta) return `${currencyCode.toUpperCase()} ${major}`;
  const abs = Math.abs(major);
  const sign = major < 0 ? "-" : "";
  const formatted = abs.toLocaleString(meta.locale, {
    minimumFractionDigits: meta.decimalPlaces,
    maximumFractionDigits: meta.decimalPlaces,
  });
  return `${sign}${meta.symbol}${formatted}`;
}

/**
 * Convert minor units to a major-unit number for input fields.
 * Returns 0 if the currency is unsupported (never throws).
 */
export function minorToMajorNumber(minor: number, currencyCode: string = DEFAULT_CURRENCY): number {
  return minorToMajor(minor, currencyCode) ?? 0;
}

export function fmtNumber(value: number): string {
  return value.toLocaleString("en-GH");
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = now.getTime() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return fmtDate(iso);
}
