import type { MobileAppSnapshot } from "../app-model";

/**
 * Mobile presentation helpers (formatters + freshness strings). Pure functions
 * only — no business logic, no runtime calls. Mirrors the web app's GHS
 * formatting conventions.
 */

export function formatMoney(minor: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-GH", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${currencyCode} ${(minor / 100).toFixed(2)}`;
  }
}

export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

export function commerceFreshness(snapshot: MobileAppSnapshot): string {
  if (snapshot.commerceLoading && !snapshot.commerce) return "Loading catalog and branch stock…";
  if (!snapshot.commerce) {
    return snapshot.online === false
      ? "Connect online once to cache this branch catalog."
      : "Catalog has not loaded yet.";
  }
  const time = new Date(snapshot.commerce.fetchedAt);
  const formatted = Number.isNaN(time.getTime()) ? snapshot.commerce.fetchedAt : time.toLocaleString();
  return snapshot.commerce.source === "LIVE"
    ? `Live data confirmed ${formatted}`
    : `Last-known data from ${formatted}`;
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}
