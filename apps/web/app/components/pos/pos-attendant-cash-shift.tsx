"use client";

import { useEffect,useState } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";

interface OwnCashShift {
  id:string;status:"OPEN"|"CLOSED";openedAt:string;
  balances:readonly {method:"CASH";openingCountedMinor:number;
    expectedClosingMinor:number;movementMinor:number}[];
}
interface RestrictedShiftStatus {
  operatingDay:{id:string;status:"OPEN"|"CLOSED";openedAt:string}|null;
  shift:OwnCashShift|null;
  openShiftCount:number;
}
const nonCashZero=["MOMO","CARD","BANK","OTHER"].map(method=>({method,countedMinor:0}));

/** POS-only accounts see their cash drawer, never account-wide Finance or day-closing controls. */
export function PosAttendantCashShift(){
  const {session,bump,queue} = useWorkspace();
  const [cashCount,setCashCount]=useState<number|null>(null);
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [confirmClose,setConfirmClose]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const path=session?
    "/v1/operations/current?businessId="+encodeURIComponent(session.businessId)+
    "&branchId="+encodeURIComponent(session.branchId):null;
  const {data,loading,error:fetchError,refetch}=useApiFetch<RestrictedShiftStatus>(path);
  useEffect(()=>{
    setCashCount(null);setNote("");setError(null);
    setNotice(null);setConfirmClose(false);
  },[session?.businessId,session?.branchId]);

  const act=async()=>{
    if(!session||busy||!data?.operatingDay||!queue.online)return;
    if(cashCount===null || !Number.isSafeInteger(cashCount)||cashCount<0){
      setError("Count your cash float or closing drawer before continuing.");return;
    }
    const closing=Boolean(data.shift);
    if(note.length>1000){setError("Keep the handover note under 1,000 characters.");return;}
    setBusy(true);setError(null);setNotice(null);
    try{
      const payload=closing?
        {shiftId:data.shift!.id,closingBalances:[
          {method:"CASH",countedMinor:cashCount},...nonCashZero,
        ],...(note.trim()?{note:note.trim()}:{})}:
        {dayId:data.operatingDay.id,openingBalances:[
          {method:"CASH",countedMinor:cashCount},
        ],...(note.trim()?{note:note.trim()}:{})};
      const mutation=getOfflineQueue().build({
        businessId:session.businessId,branchId:session.branchId,
        mutationType:closing?"SHIFT_CLOSE_CREATE":"SHIFT_OPEN_CREATE",
        payload,
      });
      await getOfflineQueue().enqueue(mutation);
      await getOfflineQueue().flushOrThrow({
        activeBusinessId:session.businessId,online:true,
      });
      setCashCount(null);setNote("");setConfirmClose(false);
      setNotice(closing?"Your shift close has been recorded. Hand over the counted cash to your supervisor.":
        "Your cash shift is open. Cash sales are attributed to your shift.");
      refetch();bump();
    }catch(e){
      setError(e instanceof Error?e.message:"The server has not confirmed your shift action.");
    }finally{setBusy(false);}
  };
  if(!session)return null;
  const expectedCash=data?.shift?.balances.find(b=>b.method==="CASH")?.expectedClosingMinor??null;
  const difference=cashCount!==null&&expectedCash!==null?cashCount-expectedCash:null;
  return (
    <section aria-label="My cash shift" className="tos-section"
      style={{marginBottom:12,padding:16,borderRadius:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div>
          <h2 className="tos-section__title" style={{margin:0}}>My cash shift</h2>
          <p className="tos-section__sub">
            {loading?"Checking today's shift…":
             data?.shift?"Shift open · cash drawer accountability":
             data?.operatingDay?"Trading day is open · start your cash shift":
             "A supervisor must open today's trading day before you can begin."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refetch} disabled={busy}>Refresh</Button>
      </div>
      {fetchError?<p role="alert" className="tos-banner tos-banner--danger">{fetchError}</p>:null}
      {error?<p role="alert" className="tos-banner tos-banner--danger">{error}</p>:null}
      {notice?<p role="status" className="tos-callout tos-callout--info">{notice}</p>:null}
      {data?.operatingDay?(
        <div style={{display:"grid",gap:12,marginTop:12}}>
          <p className="tos-section__sub">
            This role records cash only. MoMo, card, bank and other tenders
            cannot be accepted by this employee and are recorded as zero at
            closing. Your supervisor manages the overall trading day.
          </p>
          {data.shift && expectedCash!==null?(
            <div className="tos-row tos-row--between" style={{gap:12}}>
              <span>Expected cash in my drawer</span>
              <MoneyValue currencyCode={session.currencyCode} minor={expectedCash} size="lg"/>
            </div>
          ):null}
          <MoneyInput id="attendant-cash-count" currencyCode={session.currencyCode}
            valueMinor={cashCount} onChange={setCashCount}
            label={data.shift?"Physical cash counted for handover":"Opening cash float"}
            hint={data.shift?"Count every note and coin. Zero must be entered explicitly.":
              "Enter the starting cash in your drawer, including change."}
            required/>
          <label className="tos-field__label" htmlFor="attendant-shift-note">Handover note (optional)</label>
          <textarea id="attendant-shift-note" className="tos-input" rows={2}
            maxLength={1000} value={note}
            onChange={event=>setNote(event.target.value)}
            placeholder="Explanation for shortages, surplus or handover details"/>
          {data.shift && difference!==null?(
            <div className="tos-row tos-row--between" style={{gap:8}}>
              <strong>Expected versus counted</strong>
              <MoneyValue minor={difference} currencyCode={session.currencyCode} signed
                tone={difference===0?"muted":difference>0?"positive":"negative"}/>
            </div>
          ):null}
          {data.shift && !confirmClose?(
            <Button variant="outline" onClick={()=>setConfirmClose(true)}
              disabled={cashCount===null||!queue.online||busy}>Review shift close</Button>
          ):data.shift?(
            <div className="tos-stack">
              <p className="tos-section__sub">
                Confirm cash handover. The count and variance are audited and cannot be
                silently rewritten as a balancing cashbook adjustment.
              </p>
              <div className="tos-row tos-row--between">
                <Button variant="ghost" onClick={()=>setConfirmClose(false)}
                  disabled={busy}>Cancel</Button>
                <Button variant="danger" onClick={()=>void act()} loading={busy}
                  disabled={!queue.online}>Confirm my shift close</Button>
              </div>
            </div>
          ):(
            <Button variant="primary" onClick={()=>void act()} loading={busy}
              disabled={cashCount===null||!queue.online}>Open my cash shift</Button>
          )}
          {!queue.online?<p className="tos-section__sub" role="status">
            Connect to the internet to verify an opening or closing; no shift will be marked complete offline.
          </p>:null}
        </div>
      ):null}
    </section>
  );
}
