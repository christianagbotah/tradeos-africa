import { describe, expect, it } from "vitest";
import {
  SUPPORTED_CURRENCIES,
  SUPPORTED_COUNTRIES,
  SUPPORTED_TIMEZONES,
  getCurrencyMeta,
  getCountry,
  getDefaultCurrencyCode,
  getSuggestedTimezones,
  isSupportedCurrency,
  isSupportedCountry,
  isSupportedTimezone,
  minorToMajor,
  majorToMinor,
  parseMoneyInput,
  formatMoneyInput,
  formatMoney,
} from "@tradeos/contracts";

describe("currency metadata", () => {
  it("exposes a non-empty supported currencies list", () => {
    expect(SUPPORTED_CURRENCIES.length).toBeGreaterThan(0);
    for (const c of SUPPORTED_CURRENCIES) {
      expect(c.currencyCode).toMatch(/^[A-Z]{3}$/);
      expect(c.exponent).toBeGreaterThanOrEqual(0);
      expect(c.exponent).toBeLessThanOrEqual(3);
      expect(c.symbol.length).toBeGreaterThan(0);
    }
  });

  it("includes GHS, NGN, XOF, UGX, TND with correct exponents", () => {
    expect(getCurrencyMeta("GHS")?.exponent).toBe(2);
    expect(getCurrencyMeta("NGN")?.exponent).toBe(2);
    expect(getCurrencyMeta("XOF")?.exponent).toBe(0);
    expect(getCurrencyMeta("XAF")?.exponent).toBe(0);
    expect(getCurrencyMeta("UGX")?.exponent).toBe(0);
    expect(getCurrencyMeta("RWF")?.exponent).toBe(0);
    expect(getCurrencyMeta("TND")?.exponent).toBe(3);
    expect(getCurrencyMeta("KES")?.exponent).toBe(2);
  });
});

describe("minorToMajor — exponent-aware conversion", () => {
  it("converts 2-decimal currencies correctly", () => {
    expect(minorToMajor(1234, "GHS")).toBe(12.34);
    expect(minorToMajor(1234, "NGN")).toBe(12.34);
    expect(minorToMajor(50000, "KES")).toBe(500);
  });

  it("converts 0-decimal currencies correctly (no division)", () => {
    expect(minorToMajor(500, "UGX")).toBe(500);
    expect(minorToMajor(500, "XOF")).toBe(500);
    expect(minorToMajor(1000, "RWF")).toBe(1000);
  });

  it("converts 3-decimal currencies correctly", () => {
    expect(minorToMajor(1234, "TND")).toBe(1.234);
    expect(minorToMajor(5000, "TND")).toBe(5);
  });

  it("returns null for unsupported currencies", () => {
    expect(minorToMajor(1234, "XXX")).toBeNull();
    expect(minorToMajor(1234, "ghs")).not.toBeNull(); // case-insensitive
  });
});

describe("majorToMinor — exponent-aware conversion", () => {
  it("converts 2-decimal currencies correctly", () => {
    expect(majorToMinor(12.34, "GHS")).toBe(1234);
    expect(majorToMinor(12.34, "NGN")).toBe(1234);
    expect(majorToMinor(500, "KES")).toBe(50000);
  });

  it("converts 0-decimal currencies correctly (no multiplication)", () => {
    expect(majorToMinor(500, "UGX")).toBe(500);
    expect(majorToMinor(500, "XOF")).toBe(500);
    expect(majorToMinor(1000, "RWF")).toBe(1000);
  });

  it("converts 3-decimal currencies correctly", () => {
    expect(majorToMinor(1.234, "TND")).toBe(1234);
    expect(majorToMinor(5, "TND")).toBe(5000);
  });

  it("rounds to nearest minor unit", () => {
    expect(majorToMinor(12.345, "GHS")).toBe(1235); // rounds up
    expect(majorToMinor(12.344, "GHS")).toBe(1234); // rounds down
  });

  it("returns null for unsupported currencies", () => {
    expect(majorToMinor(12.34, "XXX")).toBeNull();
  });
});

describe("money input parsing — exact exponent-aware boundaries", () => {
  it("round-trips 2-decimal GHS without floating-point conversion", () => {
    expect(parseMoneyInput("12.34", "GHS")).toBe(1234);
    expect(formatMoneyInput(1234, "GHS")).toBe("12.34");
    expect(majorToMinor(1.005, "GHS")).toBe(101);
  });

  it("enforces zero-decimal currencies", () => {
    expect(parseMoneyInput("500", "UGX")).toBe(500);
    expect(parseMoneyInput("500.00", "UGX")).toBeNull();
    expect(formatMoneyInput(500, "XOF")).toBe("500");
  });

  it("accepts exactly up to three decimals for TND", () => {
    expect(parseMoneyInput("1.234", "TND")).toBe(1234);
    expect(parseMoneyInput("1.2345", "TND")).toBeNull();
    expect(formatMoneyInput(1234, "TND")).toBe("1.234");
  });

  it("supports signed values for adjustment workflows", () => {
    expect(parseMoneyInput("-12.34", "GHS")).toBe(-1234);
    expect(formatMoneyInput(-1234, "GHS")).toBe("-12.34");
  });
});

describe("formatMoney — exponent-aware display", () => {
  it("formats GHS with symbol and 2 decimals", () => {
    const result = formatMoney(1234, "GHS");
    expect(result).toContain("₵");
    expect(result).toContain("12.34");
  });

  it("formats NGN with symbol and 2 decimals", () => {
    const result = formatMoney(1234, "NGN");
    expect(result).toContain("₦");
    expect(result).toContain("12.34");
  });

  it("formats XOF with 0 decimals (no fractional part)", () => {
    const result = formatMoney(500, "XOF");
    expect(result).toContain("CFA");
    expect(result).not.toContain("500.00"); // 0-decimal: should not have .00
    expect(result).toContain("500");
  });

  it("formats UGX with 0 decimals", () => {
    const result = formatMoney(500, "UGX");
    expect(result).toContain("USh");
    expect(result).not.toContain("500.00");
    expect(result).toContain("500");
  });

  it("formats RWF with 0 decimals", () => {
    const result = formatMoney(1000, "RWF");
    expect(result).toContain("RF");
    expect(result).not.toMatch(/\.\d/);
  });

  it("formats TND with 3 decimals", () => {
    const result = formatMoney(1234, "TND");
    expect(result).toContain("DT");
    expect(result).toContain("1.234");
  });

  it("does NOT silently fall back to GHS for unsupported currencies", () => {
    const result = formatMoney(1234, "XXX");
    expect(result).not.toContain("₵");
    expect(result).toContain("XXX");
    expect(result).toContain("1234");
  });

  it("is case-insensitive for currency codes", () => {
    expect(formatMoney(1234, "ghs")).toContain("₵");
    expect(formatMoney(1234, "Ghs")).toContain("₵");
  });
});

describe("country lookup — no silent Ghana fallback", () => {
  it("returns undefined for unsupported countries", () => {
    expect(getCountry("XX")).toBeUndefined();
    expect(getCountry("ZZ")).toBeUndefined();
    expect(getCountry("")).toBeUndefined();
  });

  it("returns undefined for unsupported country currency default", () => {
    expect(getDefaultCurrencyCode("XX")).toBeUndefined();
    expect(getSuggestedTimezones("XX")).toBeUndefined();
  });

  it("never produces GHS for an unknown country", () => {
    const unknown = getCountry("XX");
    expect(unknown?.defaultCurrencyCode).not.toBe("GHS");
    expect(getDefaultCurrencyCode("XX")).not.toBe("GHS");
  });

  it("returns correct data for supported countries", () => {
    const ghana = getCountry("GH");
    expect(ghana?.country).toBe("Ghana");
    expect(ghana?.defaultCurrencyCode).toBe("GHS");
    expect(ghana?.timezones).toContain("Africa/Accra");

    const nigeria = getCountry("NG");
    expect(nigeria?.country).toBe("Nigeria");
    expect(nigeria?.defaultCurrencyCode).toBe("NGN");
    expect(nigeria?.timezones).toContain("Africa/Lagos");

    const kenya = getCountry("KE");
    expect(kenya?.country).toBe("Kenya");
    expect(kenya?.defaultCurrencyCode).toBe("KES");
    expect(kenya?.timezones).toContain("Africa/Nairobi");

    const cameroon = getCountry("CM");
    expect(cameroon?.timezones).toEqual(["Africa/Douala"]);
    expect(cameroon?.timezones).not.toContain("Africa/Ndjamena");
  });

  it("is case-insensitive for country codes", () => {
    expect(getCountry("gh")?.country).toBe("Ghana");
    expect(getCountry("ng")?.country).toBe("Nigeria");
  });

  it("supports boolean checks", () => {
    expect(isSupportedCountry("GH")).toBe(true);
    expect(isSupportedCountry("XX")).toBe(false);
    expect(isSupportedCurrency("GHS")).toBe(true);
    expect(isSupportedCurrency("XXX")).toBe(false);
    expect(isSupportedTimezone("Africa/Accra")).toBe(true);
    expect(isSupportedTimezone("Mars/Olympus")).toBe(false);
  });
});

describe("country → currency → timezone chain", () => {
  it("Ghana → GHS → Africa/Accra", () => {
    expect(getDefaultCurrencyCode("GH")).toBe("GHS");
    expect(getSuggestedTimezones("GH")?.[0]).toBe("Africa/Accra");
  });

  it("Nigeria → NGN → Africa/Lagos", () => {
    expect(getDefaultCurrencyCode("NG")).toBe("NGN");
    expect(getSuggestedTimezones("NG")?.[0]).toBe("Africa/Lagos");
  });

  it("Kenya → KES → Africa/Nairobi", () => {
    expect(getDefaultCurrencyCode("KE")).toBe("KES");
    expect(getSuggestedTimezones("KE")?.[0]).toBe("Africa/Nairobi");
  });

  it("Tunisia → TND → Africa/Tunis (3-decimal currency)", () => {
    expect(getDefaultCurrencyCode("TN")).toBe("TND");
    expect(getCurrencyMeta("TND")?.exponent).toBe(3);
    expect(getSuggestedTimezones("TN")?.[0]).toBe("Africa/Tunis");
  });

  it("Senegal → XOF → Africa/Dakar (0-decimal currency)", () => {
    expect(getDefaultCurrencyCode("SN")).toBe("XOF");
    expect(getCurrencyMeta("XOF")?.exponent).toBe(0);
    expect(getSuggestedTimezones("SN")?.[0]).toBe("Africa/Dakar");
  });

  it("SUPPORTED_TIMEZONES is a non-empty deduplicated sorted list", () => {
    expect(SUPPORTED_TIMEZONES.length).toBeGreaterThan(0);
    // Check sorted
    const sorted = [...SUPPORTED_TIMEZONES].sort();
    expect(SUPPORTED_TIMEZONES).toEqual(sorted);
    // Check no duplicates
    expect(new Set(SUPPORTED_TIMEZONES).size).toBe(SUPPORTED_TIMEZONES.length);
  });
});
