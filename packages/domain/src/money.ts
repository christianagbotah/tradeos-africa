export interface Money {
  currency: string;
  /** Integer minor units: e.g. GHS 12.34 is 1234 pesewas. */
  minor: number;
}

export class MoneyError extends Error {}

export function money(currency: string, minor: number): Money {
  if (!currency || currency.trim().length !== 3) {
    throw new MoneyError("Currency must be a 3-letter ISO code");
  }
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError("Money minor units must be a safe integer");
  }
  return { currency: currency.toUpperCase(), minor };
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.currency, a.minor + b.minor);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.currency, a.minor - b.minor);
}

export function multiplyMoney(value: Money, quantity: number): Money {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new MoneyError("Quantity must be a non-negative finite number");
  }
  return money(value.currency, Math.round(value.minor * quantity));
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}
