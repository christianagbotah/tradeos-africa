import {describe,expect,it} from "vitest";
import {
  getCountry,getCurrencyMeta,getDefaultCurrencyCode,getSuggestedTimezones,
  parseMoneyInput,formatMoneyInput,SUPPORTED_COUNTRIES,SUPPORTED_CURRENCIES,
} from "@tradeos/contracts";

describe("European and African business currency coverage",()=>{
  it("onboards Europe with valid ISO currency and local timezone",()=>{
    const expected:Record<string,string>={GH:"GHS",DE:"EUR",FR:"EUR",
      GB:"GBP",IE:"EUR",BG:"EUR",CH:"CHF",NO:"NOK",
      DK:"DKK",SE:"SEK",PL:"PLN",CZ:"CZK",RO:"RON",HU:"HUF",
      US:"USD",CA:"CAD"};
    for(const [country,currency] of Object.entries(expected)){
      expect(getDefaultCurrencyCode(country),country).toBe(currency);
      expect(getSuggestedTimezones(country)?.length,country).toBeGreaterThan(0);
      expect(getCountry(country)?.countryCode).toBe(country);
      expect(getCurrencyMeta(currency)?.exponent).toBe(2);
    }
    expect(new Set(SUPPORTED_COUNTRIES.map(c=>c.countryCode)).size)
      .toBe(SUPPORTED_COUNTRIES.length);
    expect(new Set(SUPPORTED_CURRENCIES.map(c=>c.currencyCode)).size)
      .toBe(SUPPORTED_CURRENCIES.length);
  });
  it("calculates minor units exactly and preserves zero-unit African money",()=>{
    expect(parseMoneyInput("1,234.56","EUR")).toBe(123456);
    expect(parseMoneyInput("10.75","GBP")).toBe(1075);
    expect(parseMoneyInput("125.00","USD")).toBe(12500);
    expect(formatMoneyInput(1075,"GBP")).toBe("10.75");
    expect(parseMoneyInput("1500","UGX")).toBe(1500);
    expect(parseMoneyInput("1500.02","UGX")).toBeNull();
    expect(parseMoneyInput("2.123","TND")).toBe(2123);
  });
});
