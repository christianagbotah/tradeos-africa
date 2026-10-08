const LOGOUT_PENDING_KEY = "tradeos.session.logout-pending.v1";
const SESSION_EPOCH_KEY = "tradeos.session.epoch.v1";
let memoryEpoch = 0;

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function readEpoch(): number {
  const current = storage()?.getItem(SESSION_EPOCH_KEY);
  const parsed = current === null || current === undefined ? NaN : Number(current);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.max(memoryEpoch, parsed) : memoryEpoch;
}

export function captureSessionEpoch(): number {
  return readEpoch();
}

export function isSessionEpochCurrent(epoch: number): boolean {
  return epoch === readEpoch();
}

export function invalidateSessionEpoch(): number {
  const next = readEpoch() + 1;
  memoryEpoch = next;
  try { storage()?.setItem(SESSION_EPOCH_KEY, String(next)); } catch { /* in-memory guard still works */ }
  return next;
}

export function markLogoutPending(): void {
  invalidateSessionEpoch();
  try { storage()?.setItem(LOGOUT_PENDING_KEY, "1"); } catch { /* best effort */ }
}

export function isLogoutPending(): boolean {
  try { return storage()?.getItem(LOGOUT_PENDING_KEY) === "1"; } catch { return false; }
}

export function clearLogoutPending(): void {
  try { storage()?.removeItem(LOGOUT_PENDING_KEY); } catch { /* best effort */ }
}

export async function finalizePendingLogout(fetcher: typeof fetch = fetch): Promise<"none" | "cleared" | "pending"> {
  if (!isLogoutPending()) return "none";
  try {
    const response = await fetcher("/api/session/logout", { method: "POST", cache: "no-store" });
    if (!response.ok) return "pending";
    clearLogoutPending();
    return "cleared";
  } catch {
    return "pending";
  }
}
