/**
 * Authoritative TradeOS currency + country metadata.
 *
 * Single source of truth for supported currencies (ISO 4217 with minor-unit
 * exponents) and supported countries (ISO 3166-1 alpha-2 with default currency
 * and suggested IANA timezones).
 *
 * Both the API server and the web frontend import from this module so that
 * client and server validation can never silently drift.
 *
 * --- Money model ---
 * TradeOS stores money as integer minor units (e.g. GHS 12.34 = 1234 pesewas).
 * The minor-unit exponent is currency-specific:
 *   - GHS, NGN, KES, TZS, ETB, ZAR, EGP, MAD, DZD, MZN, AOA, ZMW, BWP, NAD → 2
 *   - EUR, GBP, USD, CAD, CHF, SEK, NOK, DKK, PLN, CZK, HUF, RON → 2
 *   - UGX, RWF, XOF, XAF → 0 (no minor units; 500 UGX is stored as 500, not 50000)
 *   - TND → 3 (1.234 TND is stored as 1234 millimes)
 *
 * Never hard-code `/ 100` or `* 100` for money conversion.
 * Always use minorToMajor() / majorToMinor() which respect the exponent.
 */

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

export interface SupportedCurrency {
  /** ISO 4217 currency code, uppercase 3 letters */
  currencyCode: string;
  /** Commercial display symbol (what appears on a price tag) */
  symbol: string;
  /** Human-readable currency name */
  name: string;
  /** ISO 4217 minor-unit exponent (0, 2, or 3). 10^exponent minor units = 1 major unit. */
  exponent: number;
  /** BCP-47 locale tag for Intl formatting fallback */
  locale: string;
  /** Number of decimal places to display (same as exponent for all current currencies) */
  decimalPlaces: number;
}

export const SUPPORTED_CURRENCIES: readonly SupportedCurrency[] = [
  { currencyCode: "GHS", symbol: "₵", name: "Ghanaian Cedi", exponent: 2, locale: "en-GH", decimalPlaces: 2 },
  { currencyCode: "NGN", symbol: "₦", name: "Nigerian Naira", exponent: 2, locale: "en-NG", decimalPlaces: 2 },
  { currencyCode: "KES", symbol: "KSh", name: "Kenyan Shilling", exponent: 2, locale: "en-KE", decimalPlaces: 2 },
  { currencyCode: "UGX", symbol: "USh", name: "Ugandan Shilling", exponent: 0, locale: "en-UG", decimalPlaces: 0 },
  { currencyCode: "TZS", symbol: "TSh", name: "Tanzanian Shilling", exponent: 2, locale: "en-TZ", decimalPlaces: 2 },
  { currencyCode: "RWF", symbol: "RF", name: "Rwandan Franc", exponent: 0, locale: "en-RW", decimalPlaces: 0 },
  { currencyCode: "ETB", symbol: "Br", name: "Ethiopian Birr", exponent: 2, locale: "en-ET", decimalPlaces: 2 },
  { currencyCode: "ZAR", symbol: "R", name: "South African Rand", exponent: 2, locale: "en-ZA", decimalPlaces: 2 },
  { currencyCode: "EGP", symbol: "E£", name: "Egyptian Pound", exponent: 2, locale: "ar-EG", decimalPlaces: 2 },
  { currencyCode: "MAD", symbol: "DH", name: "Moroccan Dirham", exponent: 2, locale: "ar-MA", decimalPlaces: 2 },
  { currencyCode: "XOF", symbol: "CFA", name: "West African CFA Franc", exponent: 0, locale: "fr-SN", decimalPlaces: 0 },
  { currencyCode: "XAF", symbol: "FCFA", name: "Central African CFA Franc", exponent: 0, locale: "fr-CM", decimalPlaces: 0 },
  { currencyCode: "DZD", symbol: "DA", name: "Algerian Dinar", exponent: 2, locale: "ar-DZ", decimalPlaces: 2 },
  { currencyCode: "TND", symbol: "DT", name: "Tunisian Dinar", exponent: 3, locale: "ar-TN", decimalPlaces: 3 },
  { currencyCode: "MZN", symbol: "MT", name: "Mozambican Metical", exponent: 2, locale: "pt-MZ", decimalPlaces: 2 },
  { currencyCode: "AOA", symbol: "Kz", name: "Angolan Kwanza", exponent: 2, locale: "pt-AO", decimalPlaces: 2 },
  { currencyCode: "ZMW", symbol: "K", name: "Zambian Kwacha", exponent: 2, locale: "en-ZM", decimalPlaces: 2 },
  { currencyCode: "BWP", symbol: "P", name: "Botswana Pula", exponent: 2, locale: "en-BW", decimalPlaces: 2 },
  { currencyCode: "NAD", symbol: "N$", name: "Namibian Dollar", exponent: 2, locale: "en-NA", decimalPlaces: 2 },
  { currencyCode: "EUR", symbol: "€", name: "Euro", exponent: 2, locale: "de-DE", decimalPlaces: 2 },
  { currencyCode: "GBP", symbol: "£", name: "British Pound", exponent: 2, locale: "en-GB", decimalPlaces: 2 },
  { currencyCode: "USD", symbol: "$", name: "US Dollar", exponent: 2, locale: "en-US", decimalPlaces: 2 },
  { currencyCode: "CAD", symbol: "C$", name: "Canadian Dollar", exponent: 2, locale: "en-CA", decimalPlaces: 2 },
  { currencyCode: "CHF", symbol: "CHF", name: "Swiss Franc", exponent: 2, locale: "de-CH", decimalPlaces: 2 },
  { currencyCode: "SEK", symbol: "kr", name: "Swedish Krona", exponent: 2, locale: "sv-SE", decimalPlaces: 2 },
  { currencyCode: "NOK", symbol: "kr", name: "Norwegian Krone", exponent: 2, locale: "nb-NO", decimalPlaces: 2 },
  { currencyCode: "DKK", symbol: "kr", name: "Danish Krone", exponent: 2, locale: "da-DK", decimalPlaces: 2 },
  { currencyCode: "PLN", symbol: "zł", name: "Polish Zloty", exponent: 2, locale: "pl-PL", decimalPlaces: 2 },
  { currencyCode: "CZK", symbol: "Kč", name: "Czech Koruna", exponent: 2, locale: "cs-CZ", decimalPlaces: 2 },
  { currencyCode: "HUF", symbol: "Ft", name: "Hungarian Forint", exponent: 2, locale: "hu-HU", decimalPlaces: 2 },
  { currencyCode: "RON", symbol: "lei", name: "Romanian Leu", exponent: 2, locale: "ro-RO", decimalPlaces: 2 },
] as const;

const CURRENCY_BY_CODE = new Map<string, SupportedCurrency>(
  SUPPORTED_CURRENCIES.map((c) => [c.currencyCode, c]),
);

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------

export interface SupportedCountry {
  /** ISO 3166-1 alpha-2 country code, uppercase 2 letters */
  countryCode: string;
  /** Country display name */
  country: string;
  /** Flag emoji */
  flag: string;
  /** Phone dial code */
  dialCode: string;
  /** Default/recommended currency code for this country (ISO 4217) */
  defaultCurrencyCode: string;
  /** Supported IANA timezone identifier(s) for this country */
  timezones: readonly [string, ...string[]];
  /** BCP-47 locale tag */
  locale: string;
}

/**
 * Launch / supported countries.
 *
 * This is NOT a claim of every country on earth or a guarantee that
 * every local payment gateway is available — it is a gradually expanding
 * supported-country configuration set. Each entry has been checked for ISO country code,
 * ISO currency code, currency exponent, symbol, locale, dial code, and
 * timezone behavior.
 */
export const SUPPORTED_COUNTRIES: readonly SupportedCountry[] = [
  { countryCode: "GH", country: "Ghana", flag: "🇬🇭", dialCode: "+233", defaultCurrencyCode: "GHS", timezones: ["Africa/Accra"], locale: "en-GH" },
  { countryCode: "NG", country: "Nigeria", flag: "🇳🇬", dialCode: "+234", defaultCurrencyCode: "NGN", timezones: ["Africa/Lagos"], locale: "en-NG" },
  { countryCode: "KE", country: "Kenya", flag: "🇰🇪", dialCode: "+254", defaultCurrencyCode: "KES", timezones: ["Africa/Nairobi"], locale: "en-KE" },
  { countryCode: "UG", country: "Uganda", flag: "🇺🇬", dialCode: "+256", defaultCurrencyCode: "UGX", timezones: ["Africa/Kampala"], locale: "en-UG" },
  { countryCode: "TZ", country: "Tanzania", flag: "🇹🇿", dialCode: "+255", defaultCurrencyCode: "TZS", timezones: ["Africa/Dar_es_Salaam"], locale: "en-TZ" },
  { countryCode: "RW", country: "Rwanda", flag: "🇷🇼", dialCode: "+250", defaultCurrencyCode: "RWF", timezones: ["Africa/Kigali"], locale: "en-RW" },
  { countryCode: "ET", country: "Ethiopia", flag: "🇪🇹", dialCode: "+251", defaultCurrencyCode: "ETB", timezones: ["Africa/Addis_Ababa"], locale: "en-ET" },
  { countryCode: "ZA", country: "South Africa", flag: "🇿🇦", dialCode: "+27", defaultCurrencyCode: "ZAR", timezones: ["Africa/Johannesburg"], locale: "en-ZA" },
  { countryCode: "EG", country: "Egypt", flag: "🇪🇬", dialCode: "+20", defaultCurrencyCode: "EGP", timezones: ["Africa/Cairo"], locale: "ar-EG" },
  { countryCode: "MA", country: "Morocco", flag: "🇲🇦", dialCode: "+212", defaultCurrencyCode: "MAD", timezones: ["Africa/Casablanca"], locale: "ar-MA" },
  { countryCode: "SN", country: "Senegal", flag: "🇸🇳", dialCode: "+221", defaultCurrencyCode: "XOF", timezones: ["Africa/Dakar"], locale: "fr-SN" },
  { countryCode: "CI", country: "Côte d'Ivoire", flag: "🇨🇮", dialCode: "+225", defaultCurrencyCode: "XOF", timezones: ["Africa/Abidjan"], locale: "fr-CI" },
  { countryCode: "CM", country: "Cameroon", flag: "🇨🇲", dialCode: "+237", defaultCurrencyCode: "XAF", timezones: ["Africa/Douala"], locale: "fr-CM" },
  { countryCode: "DZ", country: "Algeria", flag: "🇩🇿", dialCode: "+213", defaultCurrencyCode: "DZD", timezones: ["Africa/Algiers"], locale: "ar-DZ" },
  { countryCode: "TN", country: "Tunisia", flag: "🇹🇳", dialCode: "+216", defaultCurrencyCode: "TND", timezones: ["Africa/Tunis"], locale: "ar-TN" },
  { countryCode: "MZ", country: "Mozambique", flag: "🇲🇿", dialCode: "+258", defaultCurrencyCode: "MZN", timezones: ["Africa/Maputo"], locale: "pt-MZ" },
  { countryCode: "AO", country: "Angola", flag: "🇦🇴", dialCode: "+244", defaultCurrencyCode: "AOA", timezones: ["Africa/Luanda"], locale: "pt-AO" },
  { countryCode: "ZM", country: "Zambia", flag: "🇿🇲", dialCode: "+260", defaultCurrencyCode: "ZMW", timezones: ["Africa/Lusaka"], locale: "en-ZM" },
  { countryCode: "BW", country: "Botswana", flag: "🇧🇼", dialCode: "+267", defaultCurrencyCode: "BWP", timezones: ["Africa/Gaborone"], locale: "en-BW" },
  { countryCode: "NA", country: "Namibia", flag: "🇳🇦", dialCode: "+264", defaultCurrencyCode: "NAD", timezones: ["Africa/Windhoek"], locale: "en-NA" },
  { countryCode: "AT", country: "Austria", flag: "🇦🇹", dialCode: "+43", defaultCurrencyCode: "EUR", timezones: ["Europe/Vienna"], locale: "de-AT" },
  { countryCode: "BE", country: "Belgium", flag: "🇧🇪", dialCode: "+32", defaultCurrencyCode: "EUR", timezones: ["Europe/Brussels"], locale: "fr-BE" },
  { countryCode: "BG", country: "Bulgaria", flag: "🇧🇬", dialCode: "+359", defaultCurrencyCode: "EUR", timezones: ["Europe/Sofia"], locale: "bg-BG" },
  { countryCode: "HR", country: "Croatia", flag: "🇭🇷", dialCode: "+385", defaultCurrencyCode: "EUR", timezones: ["Europe/Zagreb"], locale: "hr-HR" },
  { countryCode: "CY", country: "Cyprus", flag: "🇨🇾", dialCode: "+357", defaultCurrencyCode: "EUR", timezones: ["Asia/Nicosia"], locale: "el-CY" },
  { countryCode: "CZ", country: "Czech Republic", flag: "🇨🇿", dialCode: "+420", defaultCurrencyCode: "CZK", timezones: ["Europe/Prague"], locale: "cs-CZ" },
  { countryCode: "DK", country: "Denmark", flag: "🇩🇰", dialCode: "+45", defaultCurrencyCode: "DKK", timezones: ["Europe/Copenhagen"], locale: "da-DK" },
  { countryCode: "EE", country: "Estonia", flag: "🇪🇪", dialCode: "+372", defaultCurrencyCode: "EUR", timezones: ["Europe/Tallinn"], locale: "et-EE" },
  { countryCode: "FI", country: "Finland", flag: "🇫🇮", dialCode: "+358", defaultCurrencyCode: "EUR", timezones: ["Europe/Helsinki"], locale: "fi-FI" },
  { countryCode: "FR", country: "France", flag: "🇫🇷", dialCode: "+33", defaultCurrencyCode: "EUR", timezones: ["Europe/Paris"], locale: "fr-FR" },
  { countryCode: "DE", country: "Germany", flag: "🇩🇪", dialCode: "+49", defaultCurrencyCode: "EUR", timezones: ["Europe/Berlin"], locale: "de-DE" },
  { countryCode: "GR", country: "Greece", flag: "🇬🇷", dialCode: "+30", defaultCurrencyCode: "EUR", timezones: ["Europe/Athens"], locale: "el-GR" },
  { countryCode: "HU", country: "Hungary", flag: "🇭🇺", dialCode: "+36", defaultCurrencyCode: "HUF", timezones: ["Europe/Budapest"], locale: "hu-HU" },
  { countryCode: "IE", country: "Ireland", flag: "🇮🇪", dialCode: "+353", defaultCurrencyCode: "EUR", timezones: ["Europe/Dublin"], locale: "en-IE" },
  { countryCode: "IT", country: "Italy", flag: "🇮🇹", dialCode: "+39", defaultCurrencyCode: "EUR", timezones: ["Europe/Rome"], locale: "it-IT" },
  { countryCode: "LV", country: "Latvia", flag: "🇱🇻", dialCode: "+371", defaultCurrencyCode: "EUR", timezones: ["Europe/Riga"], locale: "lv-LV" },
  { countryCode: "LT", country: "Lithuania", flag: "🇱🇹", dialCode: "+370", defaultCurrencyCode: "EUR", timezones: ["Europe/Vilnius"], locale: "lt-LT" },
  { countryCode: "LU", country: "Luxembourg", flag: "🇱🇺", dialCode: "+352", defaultCurrencyCode: "EUR", timezones: ["Europe/Luxembourg"], locale: "fr-LU" },
  { countryCode: "MT", country: "Malta", flag: "🇲🇹", dialCode: "+356", defaultCurrencyCode: "EUR", timezones: ["Europe/Malta"], locale: "en-MT" },
  { countryCode: "NL", country: "Netherlands", flag: "🇳🇱", dialCode: "+31", defaultCurrencyCode: "EUR", timezones: ["Europe/Amsterdam"], locale: "nl-NL" },
  { countryCode: "PL", country: "Poland", flag: "🇵🇱", dialCode: "+48", defaultCurrencyCode: "PLN", timezones: ["Europe/Warsaw"], locale: "pl-PL" },
  { countryCode: "PT", country: "Portugal", flag: "🇵🇹", dialCode: "+351", defaultCurrencyCode: "EUR", timezones: ["Europe/Lisbon"], locale: "pt-PT" },
  { countryCode: "RO", country: "Romania", flag: "🇷🇴", dialCode: "+40", defaultCurrencyCode: "RON", timezones: ["Europe/Bucharest"], locale: "ro-RO" },
  { countryCode: "SK", country: "Slovakia", flag: "🇸🇰", dialCode: "+421", defaultCurrencyCode: "EUR", timezones: ["Europe/Bratislava"], locale: "sk-SK" },
  { countryCode: "SI", country: "Slovenia", flag: "🇸🇮", dialCode: "+386", defaultCurrencyCode: "EUR", timezones: ["Europe/Ljubljana"], locale: "sl-SI" },
  { countryCode: "ES", country: "Spain", flag: "🇪🇸", dialCode: "+34", defaultCurrencyCode: "EUR", timezones: ["Europe/Madrid"], locale: "es-ES" },
  { countryCode: "SE", country: "Sweden", flag: "🇸🇪", dialCode: "+46", defaultCurrencyCode: "SEK", timezones: ["Europe/Stockholm"], locale: "sv-SE" },
  { countryCode: "GB", country: "United Kingdom", flag: "🇬🇧", dialCode: "+44", defaultCurrencyCode: "GBP", timezones: ["Europe/London"], locale: "en-GB" },
  { countryCode: "NO", country: "Norway", flag: "🇳🇴", dialCode: "+47", defaultCurrencyCode: "NOK", timezones: ["Europe/Oslo"], locale: "nb-NO" },
  { countryCode: "CH", country: "Switzerland", flag: "🇨🇭", dialCode: "+41", defaultCurrencyCode: "CHF", timezones: ["Europe/Zurich"], locale: "de-CH" },
  { countryCode: "US", country: "United States", flag: "🇺🇸", dialCode: "+1", defaultCurrencyCode: "USD", timezones: ["America/New_York","America/Chicago","America/Denver","America/Los_Angeles"], locale: "en-US" },
  { countryCode: "CA", country: "Canada", flag: "🇨🇦", dialCode: "+1", defaultCurrencyCode: "CAD", timezones: ["America/Toronto","America/Winnipeg","America/Edmonton","America/Vancouver"], locale: "en-CA" },
] as const;

const COUNTRY_BY_CODE = new Map<string, SupportedCountry>(
  SUPPORTED_COUNTRIES.map((c) => [c.countryCode, c]),
);

// ---------------------------------------------------------------------------
// All supported IANA timezones (flattened from countries, deduplicated)
// ---------------------------------------------------------------------------

export const SUPPORTED_TIMEZONES: readonly string[] = Array.from(
  new Set(SUPPORTED_COUNTRIES.flatMap((c) => c.timezones)),
).sort();

// ---------------------------------------------------------------------------
// Lookup helpers — no silent fallback
// ---------------------------------------------------------------------------

/**
 * Returns currency metadata for a code, or `undefined` if unsupported.
 * Never silently falls back to a default currency.
 */
export function getCurrencyMeta(currencyCode: string): SupportedCurrency | undefined {
  return CURRENCY_BY_CODE.get(currencyCode.toUpperCase());
}

/**
 * Returns country metadata for a code, or `undefined` if unsupported.
 * Never silently falls back to a default country.
 */
export function getCountry(countryCode: string): SupportedCountry | undefined {
  return COUNTRY_BY_CODE.get(countryCode.toUpperCase());
}

export function isSupportedCurrency(currencyCode: string): boolean {
  return CURRENCY_BY_CODE.has(currencyCode.toUpperCase());
}

export function isSupportedCountry(countryCode: string): boolean {
  return COUNTRY_BY_CODE.has(countryCode.toUpperCase());
}

export function isSupportedTimezone(timezone: string): boolean {
  return SUPPORTED_TIMEZONES.includes(timezone);
}

/**
 * Returns the default currency code for a country, or `undefined` if the
 * country is unsupported. Never silently falls back.
 */
export function getDefaultCurrencyCode(countryCode: string): string | undefined {
  return getCountry(countryCode)?.defaultCurrencyCode;
}

/**
 * Returns the suggested timezone(s) for a country, or `undefined` if unsupported.
 */
export function getSuggestedTimezones(countryCode: string): readonly string[] | undefined {
  return getCountry(countryCode)?.timezones;
}

// ---------------------------------------------------------------------------
// Money conversion helpers — exponent-aware, no hardcoded /100 or *100
// ---------------------------------------------------------------------------

/**
 * Parse a user-entered major-unit decimal string into integer minor units.
 * This is the preferred boundary helper for money input fields because it
 * avoids binary floating-point surprises and rejects excess precision.
 *
 * Examples:
 *   parseMoneyInput("12.34", "GHS") → 1234
 *   parseMoneyInput("500", "UGX") → 500
 *   parseMoneyInput("1.234", "TND") → 1234
 *   parseMoneyInput("1.23", "UGX") → null
 */
export function parseMoneyInput(value: string, currencyCode: string): number | null {
  const meta = getCurrencyMeta(currencyCode);
  if (!meta) return null;
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return null;
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[3] ?? "";
  if (fraction.length > meta.exponent) return null;
  if (meta.exponent === 0 && fraction.length > 0) return null;

  const factor = 10n ** BigInt(meta.exponent);
  const whole = BigInt(match[2]!);
  const fractional = meta.exponent === 0 ? 0n : BigInt(fraction.padEnd(meta.exponent, "0") || "0");
  const signed = (whole * factor + fractional) * (match[1] === "-" ? -1n : 1n);
  const minor = Number(signed);
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * Format integer minor units for an editable major-unit input (no symbol).
 * The output always uses the currency's exact configured exponent.
 */
export function formatMoneyInput(minor: number, currencyCode: string): string | null {
  const meta = getCurrencyMeta(currencyCode);
  if (!meta || !Number.isSafeInteger(minor)) return null;
  const negative = minor < 0;
  const absolute = BigInt(Math.abs(minor));
  if (meta.exponent === 0) return `${negative ? "-" : ""}${absolute}`;
  const factor = 10n ** BigInt(meta.exponent);
  const whole = absolute / factor;
  const fraction = String(absolute % factor).padStart(meta.exponent, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Convert integer minor units to a major-unit number for a currency.
 * Returns `null` if the currency is unsupported (never silently falls back).
 *
 * Examples:
 *   minorToMajor(1234, "GHS") → 12.34    (exponent 2)
 *   minorToMajor(500,  "UGX") → 500      (exponent 0)
 *   minorToMajor(1234, "TND") → 1.234    (exponent 3)
 *   minorToMinor(1234, "XXX") → null
 */
export function minorToMajor(minor: number, currencyCode: string): number | null {
  const meta = getCurrencyMeta(currencyCode);
  if (!meta) return null;
  if (!Number.isSafeInteger(minor)) return null;
  return minor / Math.pow(10, meta.exponent);
}

/**
 * Convert a major-unit number to integer minor units for a currency.
 * Returns `null` if the currency is unsupported or the result is not a safe integer.
 *
 * Examples:
 *   majorToMinor(12.34, "GHS") → 1234    (exponent 2)
 *   majorToMinor(500,   "UGX") → 500     (exponent 0)
 *   majorToMinor(1.234, "TND") → 1234    (exponent 3)
 *   majorToMinor(1.005, "GHS") → 101     (rounds to nearest minor unit)
 */
export function majorToMinor(major: number, currencyCode: string): number | null {
  const meta = getCurrencyMeta(currencyCode);
  if (!meta) return null;
  if (!Number.isFinite(major)) return null;
  const scaled = major * Math.pow(10, meta.exponent);
  const adjustment = Number.EPSILON * Math.max(1, Math.abs(scaled));
  const minor = Math.sign(scaled) * Math.round(Math.abs(scaled) + adjustment);
  if (!Number.isSafeInteger(minor)) return null;
  return minor;
}

/**
 * Format integer minor units as a display string for a currency.
 * Uses the currency's commercial symbol and correct decimal places.
 * Returns `${currencyCode} ${amount}` for unsupported currencies (never
 * silently converts to GHS or any other currency).
 *
 * Examples:
 *   formatMoney(1234, "GHS") → "₵ 12.34"
 *   formatMoney(500,  "UGX") → "USh 500"
 *   formatMoney(1234, "TND") → "DT 1.234"
 *   formatMoney(1234, "XOF") → "CFA 1,234"
 *   formatMoney(1234, "XXX") → "XXX 12.34"   (unsupported — no fallback)
 */
export function formatMoney(minor: number, currencyCode: string): string {
  const meta = getCurrencyMeta(currencyCode);
  if (!meta) {
    // Unsupported currency: show code + raw value, never silently fall back.
    return `${currencyCode.toUpperCase()} ${minor}`;
  }
  const major = minorToMajor(minor, currencyCode);
  if (major === null) return `${meta.symbol} ${minor}`;
  const formatted = major.toLocaleString("en", {
    minimumFractionDigits: meta.decimalPlaces,
    maximumFractionDigits: meta.decimalPlaces,
  });
  return `${meta.symbol} ${formatted}`;
}
