/**
 * Bounded, literal search for unresolved finance refunds. Search is applied
 * only after authorization and tenant/branch predicates by the route's SQL.
 * SQL LIKE metacharacters are escaped so a literal `%` cannot become a
 * request to retrieve an entire branch's confidential refund history.
 */
export function normalizeRefundInvestigationSearch(raw: unknown): string | null {
  if (raw === undefined) return "";
  if (typeof raw !== "string") return null;
  const search = raw.trim();
  if (search.length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(search)) return null;
  return search;
}

/** PostgreSQL ILIKE with `ESCAPE '!'` — the same escape applies in both routes. */
export function refundInvestigationSearchPattern(search: string): string {
  return `%${search.replace(/[!%_]/g, (character) => `!${character}`)}%`;
}
