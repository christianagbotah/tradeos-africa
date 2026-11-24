/** The UI only constructs payloads accepted by the existing audited domain mutation handler. */
export const OPERATIONS_METHODS = ["CASH","MOMO","CARD","BANK","OTHER"] as const;
export type OperationsMethod = (typeof OPERATIONS_METHODS)[number];
export type OperationsCounts = Partial<Record<OperationsMethod,number|null>>;
export type OperationsAction = "open-day"|"close-day"|"open-shift"|"close-shift";
export interface OperationsSnapshot {
  operatingDay:{id:string;status:"OPEN"|"CLOSED"}|null;
  shift:{id:string;status:"OPEN"|"CLOSED"}|null;
  openShiftCount:number;
}
export interface OperationsMutation {
  mutationType:"OPERATING_DAY_OPEN_CREATE"|"OPERATING_DAY_CLOSE_CREATE"|"SHIFT_OPEN_CREATE"|"SHIFT_CLOSE_CREATE";
  payload:{
    businessDate?:string;
    dayId?:string;
    shiftId?:string;
    openingBalances?:{method:OperationsMethod;countedMinor:number}[];
    closingBalances?:{method:OperationsMethod;countedMinor:number}[];
    note?:string;
  };
}
export function businessDateAt(now:Date,timezone:string):string {
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(now);
  const item=(key:string)=>parts.find(p=>p.type===key)?.value ?? "";
  const year=item("year"),month=item("month"),day=item("day");
  if(!/^\d{4}$/.test(year)||!/^\d{2}$/.test(month)||!/^\d{2}$/.test(day)){
    throw new Error("The selected business timezone cannot determine its business date.");
  }
  return [year,month,day].join("-");
}
export function validateOperationsCounts(
  counts:OperationsCounts,kind:"opening"|"closing",
):{method:OperationsMethod;countedMinor:number}[] {
  const values=OPERATIONS_METHODS.map(method=>({method,countedMinor:counts[method]}));
  for(const value of values){
    if(value.countedMinor===null||value.countedMinor===undefined){
      if(kind==="closing"||value.method==="CASH")
        throw new Error("Enter a verified count for "+value.method+" before "+kind+" the interval.");
      continue;
    }
    if(!Number.isSafeInteger(value.countedMinor)||value.countedMinor<0)
      throw new Error("The "+value.method+" count must be a valid nonnegative amount.");
  }
  return values.filter((entry): entry is {method:OperationsMethod;countedMinor:number} =>
    entry.countedMinor!==null&&entry.countedMinor!==undefined);
}
export function buildOperationsMutation(
  action:OperationsAction,snapshot:OperationsSnapshot,counts:OperationsCounts,
  timezone:string,now:Date=new Date(),note?:string,
):OperationsMutation {
  const day=snapshot.operatingDay,shift=snapshot.shift;
  const cleanNote=note?.trim() || undefined;
  if(cleanNote && cleanNote.length>1000)throw new Error("Keep your note within 1,000 characters.");
  if(action==="open-day"){
    if(day?.status==="OPEN")throw new Error("Close the current operating day first.");
    return {mutationType:"OPERATING_DAY_OPEN_CREATE",
      payload:{businessDate:businessDateAt(now,timezone),
        openingBalances:validateOperationsCounts(counts,"opening"),note:cleanNote}};
  }
  if(!day||day.status!=="OPEN")throw new Error("An operating day must be open.");
  if(action==="open-shift"){
    if(shift?.status==="OPEN")throw new Error("Close your open shift first.");
    return {mutationType:"SHIFT_OPEN_CREATE",
      payload:{dayId:day.id,openingBalances:validateOperationsCounts(counts,"opening"),note:cleanNote}};
  }
  if(action==="close-shift"){
    if(!shift||shift.status!=="OPEN")throw new Error("Your own shift is not open.");
    return {mutationType:"SHIFT_CLOSE_CREATE",
      payload:{shiftId:shift.id,closingBalances:validateOperationsCounts(counts,"closing"),note:cleanNote}};
  }
  if(snapshot.openShiftCount!==0)throw new Error("Close all staff shifts before closing the operating day.");
  return {mutationType:"OPERATING_DAY_CLOSE_CREATE",
    payload:{dayId:day.id,closingBalances:validateOperationsCounts(counts,"closing"),note:cleanNote}};
}
export function operationsPermission(role:string|null|undefined,action:OperationsAction):boolean {
  if(action==="open-day"||action==="close-day")
    return ["OWNER","ADMIN","MANAGER","ACCOUNTANT"].includes(role??"");
  return ["OWNER","ADMIN","MANAGER","CASHIER","ACCOUNTANT"].includes(role??"");
}
export function operationsVariance(counts:OperationsCounts,expected:number):number|null {
  const cash=counts.CASH;
  return cash===null||cash===undefined ? null : cash-expected;
}
