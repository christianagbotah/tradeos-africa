/**
 * African country → currency → locale map.
 *
 * Used by the onboarding flow so a user picks their country once and the
 * correct currency code / symbol / Intl locale flows through the whole app.
 *
 * Currency codes are ISO 4217. Symbols are the common commercial symbol
 * (what you'd see on a price tag), not always the ISO letter code.
 */

export interface AfricanLocale {
  /** ISO 3166-1 alpha-2 country code */
  countryCode: string;
  /** Country display name */
  country: string;
  /** ISO 4217 currency code */
  currencyCode: string;
  /** Commercial currency symbol (e.g. ₵, ₦, KSh) */
  symbol: string;
  /** Native currency name */
  currencyName: string;
  /** BCP-47 locale tag for Intl.NumberFormat */
  locale: string;
  /** Flag emoji */
  flag: string;
  /** Approximate dial code (for phone input context) */
  dialCode: string;
}

export const AFRICAN_LOCALES: AfricanLocale[] = [
  { countryCode: "GH", country: "Ghana", currencyCode: "GHS", symbol: "₵", currencyName: "Cedi", locale: "en-GH", flag: "🇬🇭", dialCode: "+233" },
  { countryCode: "NG", country: "Nigeria", currencyCode: "NGN", symbol: "₦", currencyName: "Naira", locale: "en-NG", flag: "🇳🇬", dialCode: "+234" },
  { countryCode: "KE", country: "Kenya", currencyCode: "KES", symbol: "KSh", currencyName: "Shilling", locale: "en-KE", flag: "🇰🇪", dialCode: "+254" },
  { countryCode: "UG", country: "Uganda", currencyCode: "UGX", symbol: "USh", currencyName: "Shilling", locale: "en-UG", flag: "🇺🇬", dialCode: "+256" },
  { countryCode: "TZ", country: "Tanzania", currencyCode: "TZS", symbol: "TSh", currencyName: "Shilling", locale: "en-TZ", flag: "🇹🇿", dialCode: "+255" },
  { countryCode: "RW", country: "Rwanda", currencyCode: "RWF", symbol: "RF", currencyName: "Franc", locale: "en-RW", flag: "🇷🇼", dialCode: "+250" },
  { countryCode: "ET", country: "Ethiopia", currencyCode: "ETB", symbol: "Br", currencyName: "Birr", locale: "en-ET", flag: "🇪🇹", dialCode: "+251" },
  { countryCode: "ZA", country: "South Africa", currencyCode: "ZAR", symbol: "R", currencyName: "Rand", locale: "en-ZA", flag: "🇿🇦", dialCode: "+27" },
  { countryCode: "EG", country: "Egypt", currencyCode: "EGP", symbol: "E£", currencyName: "Pound", locale: "ar-EG", flag: "🇪🇬", dialCode: "+20" },
  { countryCode: "MA", country: "Morocco", currencyCode: "MAD", symbol: "DH", currencyName: "Dirham", locale: "ar-MA", flag: "🇲🇦", dialCode: "+212" },
  { countryCode: "SN", country: "Senegal", currencyCode: "XOF", symbol: "CFA", currencyName: "Franc", locale: "fr-SN", flag: "🇸🇳", dialCode: "+221" },
  { countryCode: "CI", country: "Côte d'Ivoire", currencyCode: "XOF", symbol: "CFA", currencyName: "Franc", locale: "fr-CI", flag: "🇨🇮", dialCode: "+225" },
  { countryCode: "CM", country: "Cameroon", currencyCode: "XAF", symbol: "FCFA", currencyName: "Franc", locale: "fr-CM", flag: "🇨🇲", dialCode: "+237" },
  { countryCode: "DZ", country: "Algeria", currencyCode: "DZD", symbol: "DA", currencyName: "Dinar", locale: "ar-DZ", flag: "🇩🇿", dialCode: "+213" },
  { countryCode: "TN", country: "Tunisia", currencyCode: "TND", symbol: "DT", currencyName: "Dinar", locale: "ar-TN", flag: "🇹🇳", dialCode: "+216" },
  { countryCode: "MZ", country: "Mozambique", currencyCode: "MZN", symbol: "MT", currencyName: "Metical", locale: "pt-MZ", flag: "🇲🇿", dialCode: "+258" },
  { countryCode: "AO", country: "Angola", currencyCode: "AOA", symbol: "Kz", currencyName: "Kwanza", locale: "pt-AO", flag: "🇦🇴", dialCode: "+244" },
  { countryCode: "ZM", country: "Zambia", currencyCode: "ZMW", symbol: "K", currencyName: "Kwacha", locale: "en-ZM", flag: "🇿🇲", dialCode: "+260" },
  { countryCode: "BW", country: "Botswana", currencyCode: "BWP", symbol: "P", currencyName: "Pula", locale: "en-BW", flag: "🇧🇼", dialCode: "+267" },
  { countryCode: "NA", country: "Namibia", currencyCode: "NAD", symbol: "N$", currencyName: "Dollar", locale: "en-NA", flag: "🇳🇦", dialCode: "+264" },
];

const LOCALE_BY_COUNTRY = new Map(AFRICAN_LOCALES.map((l) => [l.countryCode, l]));

/** Returns the locale for a country code, falling back to Ghana (GHS). */
export function getLocale(countryCode: string): AfricanLocale {
  return LOCALE_BY_COUNTRY.get(countryCode) ?? AFRICAN_LOCALES[0]!;
}

/** Returns the currency code for a country code, falling back to GHS. */
export function getCurrencyCode(countryCode: string): string {
  return getLocale(countryCode).currencyCode;
}

/**
 * Format a money minor-units amount for a currency code.
 * Uses the locale's commercial symbol for a clean price-tag look,
 * falling back to Intl.NumberFormat for unknown currencies.
 */
export function formatMoney(minor: number, currencyCode: string): string {
  const amount = (minor / 100).toFixed(2);
  const locale = AFRICAN_LOCALES.find((l) => l.currencyCode === currencyCode);
  if (locale) {
    return `${locale.symbol} ${amount}`;
  }
  if (currencyCode === "GHS") return `₵ ${amount}`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(minor / 100);
  } catch {
    return `${currencyCode} ${amount}`;
  }
}
