/**
 * Aggregate minor-unit financial amounts without silently treating a missing,
 * malformed or unsafe value as a confirmed zero.
 *
 * Returns null when any source amount is unverified. This is particularly
 * important for refund settlement fields during API/client version skew.
 * An empty collection has a verified sum of zero.
 */
export function sumKnownMinorAmounts<T>(
  items: readonly T[],
  selectAmount: (item: T) => unknown,
): number | null {
  let total = 0;
  for (const item of items) {
    const amount = selectAmount(item);
    if (typeof amount !== "number" || !Number.isSafeInteger(amount)) {
      return null;
    }
    total += amount;
    if (!Number.isSafeInteger(total)) {
      return null;
    }
  }
  return total;
}
