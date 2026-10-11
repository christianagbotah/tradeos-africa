/**
 * Production helper: resolve the eligible money account for a payment method.
 *
 * Used by BOTH CustomerPaymentForm and SupplierPaymentForm so the selection
 * logic is identical and testable without a React component.
 *
 * Rules:
 *   1. Filter accounts to active + matching currencyCode + matching method.
 *   2. If a configured default exists for this method AND the default's
 *      account is among the eligible accounts, select it.
 *   3. Otherwise, if exactly one eligible account exists, select it.
 *   4. If multiple eligible accounts exist with no configured default,
 *      return null (require explicit user selection — do NOT pretend the
 *      first account is the default).
 *   5. If no eligible accounts exist, return null.
 */

export interface MoneyAccount {
  id: string;
  name: string;
  method: string;
  active: boolean;
  currencyCode: string;
}

export interface MoneyAccountDefault {
  branchId: string | null;
  method: string;
  moneyAccountId: string;
  accountName: string;
  updatedAt: string;
}

/**
 * Filter accounts to those eligible for a given payment method + currency.
 * Eligible = active AND currencyCode matches AND method matches.
 */
export function filterEligibleAccounts(
  accounts: readonly MoneyAccount[],
  method: string,
  currencyCode: string,
): MoneyAccount[] {
  return accounts.filter(
    (a) => a.active && a.currencyCode === currencyCode && a.method === method,
  );
}

/**
 * Resolve the default money account ID for a payment method.
 *
 * Returns the account ID string if a default can be determined, or null
 * if the user must explicitly choose (or if no eligible accounts exist).
 *
 * @param eligibleAccounts — already filtered by method + currency + active
 * @param defaults — the configured money-account-defaults for this branch
 * @param method — the selected payment method
 */
export function resolveDefaultAccountId(
  eligibleAccounts: readonly MoneyAccount[],
  defaults: readonly MoneyAccountDefault[],
  method: string,
): string | null {
  if (eligibleAccounts.length === 0) return null;

  // Check if a configured default exists for this method
  const configuredDefault = defaults.find((d) => d.method === method);
  if (configuredDefault) {
    // Is the configured default's account among the eligible accounts?
    const match = eligibleAccounts.find((a) => a.id === configuredDefault.moneyAccountId);
    if (match) return match.id;
  }

  // No configured default (or it's not eligible):
  // If exactly one eligible account, auto-select it
  if (eligibleAccounts.length === 1) return eligibleAccounts[0]!.id;

  // Multiple eligible accounts with no configured default:
  // require explicit user selection
  return null;
}

/**
 * Determine whether the currently selected account ID is still valid
 * for the given eligible accounts. If not, the caller should resolve
 * a new default.
 */
export function isSelectionValid(
  selectedAccountId: string | null,
  eligibleAccounts: readonly MoneyAccount[],
): boolean {
  if (!selectedAccountId) return false;
  return eligibleAccounts.some((a) => a.id === selectedAccountId);
}
