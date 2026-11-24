/**
 * Price-driven Quick Serve shortcuts for prepared food and services.
 * Creates normal catalog sale units; the existing catalog mutation, POS,
 * stock and accounting engines retain authority. No sale price override.
 */
export interface PriceButtonUnit {
  code: string;
  label: string;
  canPurchase: boolean;
  canSell: boolean;
  canStock: boolean;
  priceMinor: number | null;
}
export interface PriceButtonResult<T extends PriceButtonUnit> {
  units: T[];
  added: number;
  alreadyPresent: number;
}

/** Input prices are in the current currency's 2-decimal base units. */
export function parseQuickPrices(raw: string): number[] {
  const tokens = raw.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
  if (tokens.length === 0) throw new Error("Enter prices, such as 10, 12, 15, 20.");
  if (tokens.length > 20) throw new Error("Add at most 20 prices at a time.");
  const amounts: number[] = [];
  const seen = new Set<number>();
  for (const text of tokens) {
    if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(text)) {
      throw new Error('"' + text.slice(0, 32) + '" is not a valid price. Enter 10, 12.50, 15.');
    }
    const [whole, fractional = ""] = text.split(".");
    const minor = Number(whole) * 100 + Number(fractional.padEnd(2,"0"));
    if (!Number.isSafeInteger(minor) || minor <= 0) {
      throw new Error("Every Quick Serve price must be greater than zero.");
    }
    if (!seen.has(minor)) { amounts.push(minor); seen.add(minor); }
  }
  return amounts;
}
export function quickPriceCode(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("Invalid quick price.");
  return "price_" + minor;
}

export function addQuickPriceUnits<T extends PriceButtonUnit>(
  existing: readonly T[],
  raw: string,
  opts: {
    kind: "PRODUCT" | "PREPARED_PRODUCT" | "SERVICE";
    currencyCode: string;
    newItem: boolean;
    hasConversions: boolean;
  },
): PriceButtonResult<T> {
  // Stocked products (cement, nails, bottles) need real quantity conversions;
  // a nominal price is NOT a physical unit and must not change stock balances.
  if (opts.kind === "PRODUCT") {
    throw new Error("Use real stock units and conversions for physical products.");
  }
  const prices = parseQuickPrices(raw);
  let units = existing.map(u=>({...u}));
  const first=units[0];
  // Replace ONLY the untouched initial placeholder on a new item.
  if (opts.newItem && !opts.hasConversions && units.length === 1 &&
      first?.code === "each" && first.label === "Each (piece)" &&
      first.priceMinor === null && first.canPurchase && first.canSell && first.canStock) {
    units = [];
  }
  let added=0;
  let alreadyPresent=0;
  for (const minor of prices) {
    if (units.some(u=>u.canSell && u.priceMinor === minor)) {
      alreadyPresent++;
      continue;
    }
    const code=quickPriceCode(minor);
    if (units.some(u=>u.code.trim().toLowerCase()===code)) {
      throw new Error("Unit code " + code + " exists with another price. Edit it manually.");
    }
    if (units.length >= 50) throw new Error("This item has too many units. Remove unused ones first.");
    const display=(minor / 100).toLocaleString("en-GH",{
      minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });
    const symbol=opts.currencyCode === "GHS" ? "₵" : opts.currencyCode + " ";
    units.push({
      code, label: symbol+display+(opts.kind === "SERVICE" ? " service" : " portion"),
      canPurchase:false,canSell:true,canStock:false,priceMinor:minor,
    } as T);
    added++;
  }
  return { units, added, alreadyPresent };
}
