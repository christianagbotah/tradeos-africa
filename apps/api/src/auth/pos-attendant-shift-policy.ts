import { PosAttendantPolicyError } from "./pos-attendant-policy.js";

/**
 * Shop floor staff may only open / close their OWN, CASH-only shift.
 * No noncash amounts, arbitrary actor identities, financial settings or day-close.
 */
const METHODS = ["CASH", "MOMO", "CARD", "BANK", "OTHER"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Mode = "SHIFT_OPEN_CREATE" | "SHIFT_CLOSE_CREATE";
export function assertPosAttendantShiftPayload(type:Mode,raw:unknown):void {
  if(!raw || typeof raw!=="object" || Array.isArray(raw))throw new PosAttendantPolicyError(
    "Only own cash shift opening and closing is allowed.");
  const payload=raw as Record<string,unknown>;
  const opening=type==="SHIFT_OPEN_CREATE";
  const allowed = new Set(opening?["dayId","openingBalances","note"]:["shiftId","closingBalances","note"]);
  if(Object.keys(payload).some(key=>!allowed.has(key)))throw new PosAttendantPolicyError(
    "Shop attendants cannot change staff identity, business days or financial settings.");
  const target=payload[opening?"dayId":"shiftId"];
  if(typeof target!=="string"||!UUID.test(target))throw new PosAttendantPolicyError(
    "A valid open day or own shift identifier is required.");
  if(payload.note!==undefined && (typeof payload.note!=="string" || payload.note.length>1000))
    throw new PosAttendantPolicyError("Shift note must contain at most 1,000 characters.");
  const balances=payload[opening?"openingBalances":"closingBalances"];
  if(!Array.isArray(balances)||balances.length!==(opening?1:5)){
    throw new PosAttendantPolicyError("Provide only a counted cash float, with zero other closing tenders.");
  }
  const seen=new Set<string>();
  for(const balance of balances){
    if(!balance||typeof balance!=="object"||Array.isArray(balance))
      throw new PosAttendantPolicyError("Invalid shift count.");
    const entry=balance as Record<string,unknown>;
    if(Object.keys(entry).length!==2 || !("method" in entry) || !("countedMinor" in entry))
      throw new PosAttendantPolicyError("Shift counts cannot contain economic overrides.");
    if(typeof entry.method!=="string"||!METHODS.some(method=>method===entry.method)||
      seen.has(entry.method)||typeof entry.countedMinor!=="number"||
      !Number.isSafeInteger(entry.countedMinor)||
      (entry.countedMinor as number)<0)throw new PosAttendantPolicyError("Invalid counted amount.");
    if(entry.method!=="CASH" && entry.countedMinor!==0)
      throw new PosAttendantPolicyError("Only cash tender counts are permitted for POS attendants.");
    seen.add(entry.method);
  }
  if(!seen.has("CASH")||(!opening && METHODS.some(method=>!seen.has(method))))
    throw new PosAttendantPolicyError("A verified cash count and zero-valued other tenders are required.");
}
