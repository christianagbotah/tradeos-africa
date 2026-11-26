"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { StatePanel } from "../ui/state-panel";
import { Button } from "../ui/button";
import {
  IconBanknote,
  IconCashbook,
  IconClock,
  IconCreditCard,
  IconOperations,
  IconRefresh,
  IconShield,
  IconSmartphone,
  IconWallet,
} from "../ui/icons";
import { getOfflineQueue } from "../../../lib/offline-sync";
import {
  buildOperationsMutation, OPERATIONS_METHODS, operationsPermission, operationsVariance,
  type OperationsAction, type OperationsCounts, type OperationsMethod,
} from "../../../lib/operations-flow";
import { dayCloseReportCsv } from "../../../lib/operations-report";

interface MethodBalance {
  method: string;
  openingCountedMinor: number;
  movementMinor: number;
  expectedClosingMinor: number;
  closingCountedMinor: number | null;
  varianceMinor: number | null;
}

interface OperatingDay {
  id: string;
  businessDate: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  balances: ReadonlyArray<MethodBalance>;
}

interface Shift {
  id: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  staffId: string;
  balances: ReadonlyArray<MethodBalance>;
}

interface CurrentOperations {
  operatingDay: OperatingDay | null;
  shift: Shift | null;
  openShiftCount: number;
}

interface OperationsHistory { days: ReadonlyArray<OperatingDay> }
interface ShiftHistory { shifts: ReadonlyArray<Shift> }

function methodIconSvg(method: string): ReactNode {
  switch (method) {
    case "CASH": return <IconBanknote style={{ width: 16, height: 16 }} />;
    case "MOMO": return <IconSmartphone style={{ width: 16, height: 16 }} />;
    case "BANK": return <IconWallet style={{ width: 16, height: 16 }} />;
    case "CARD": return <IconCreditCard style={{ width: 16, height: 16 }} />;
    default: return <IconCashbook style={{ width: 16, height: 16 }} />;
  }
}

function methodLabel(method: string): string {
  switch (method) {
    case "CASH": return "Cash";
    case "MOMO": return "Mobile money";
    case "BANK": return "Bank";
    case "CARD": return "Card";
    default: return method.toLowerCase();
  }
}

function varianceValClass(varianceMinor: number | null): string {
  if (varianceMinor === null) return "tos-ops-method__col-val tos-ops-method__col-val--muted";
  if (varianceMinor === 0) return "tos-ops-method__col-val tos-ops-method__col-val--balanced";
  return "tos-ops-method__col-val tos-ops-method__col-val--variance";
}

function varianceText(varianceMinor: number | null): string {
  if (varianceMinor === null) return "Pending count";
  if (varianceMinor === 0) return "Balanced";
  return varianceMinor < 0 ? "Shortage" : "Surplus";
}

function MethodCounts({
  values,onChange,currencyCode,mode,identity,
}:{
  values:OperationsCounts;
  onChange:(updated:OperationsCounts)=>void;
  currencyCode:string;
  mode:"opening"|"closing";
  identity:"day"|"shift";
}) {
  return (
    <div className="tos-stack" aria-label={identity+" "+mode+" counts"}>
      <p className="tos-section__sub">
        {mode==="closing"
          ? "Enter confirmed balances for all five methods. Enter zero only if verified."
          : "Count the physical cash float. Other opening balances are optional and default to zero."}
      </p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,220px),1fr))",gap:12}}>
        {OPERATIONS_METHODS.map((method:OperationsMethod)=>(
          <MoneyInput
            key={method}
            id={"ops-"+identity+"-"+mode+"-"+method.toLowerCase()}
            currencyCode={currencyCode}
            valueMinor={values[method]??null}
            onChange={value=>onChange({...values,[method]:value})}
            label={methodLabel(method)+(mode==="closing"?" confirmed closing":" opening float")}
            hint={mode==="closing"?"Required before closing":method==="CASH"?"Required":"Optional; zero if unentered"}
            required={mode==="closing"||method==="CASH"}
          />
        ))}
      </div>
    </div>
  );
}

export function OperationsWorkspace() {
  const { session, role, bump } = useWorkspace();
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dayCounts, setDayCounts] = useState<OperationsCounts>({});
  const [shiftCounts, setShiftCounts] = useState<OperationsCounts>({});
  const [dayNote, setDayNote] = useState("");
  const [shiftNote, setShiftNote] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmShiftClose, setConfirmShiftClose] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const path = session
    ? `/v1/operations/current?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}`
    : null;
  // /current returns the data directly; it is NOT wrapped in {current:...}.
  const { data, loading, error: loadError, refetch } = useApiFetch<CurrentOperations>(path);
  const historyPath = session
    ? "/v1/operations/days?businessId="+encodeURIComponent(session.businessId)+
      "&branchId="+encodeURIComponent(session.branchId)+"&limit=7"
    : null;
  const { data: history, refetch: refetchHistory } =
    useApiFetch<OperationsHistory>(historyPath);
  const shiftHistoryPath = session
    ? "/v1/operations/shifts?businessId="+encodeURIComponent(session.businessId)+
      "&branchId="+encodeURIComponent(session.branchId)+"&limit=15"
    : null;
  const { data: shiftHistory, refetch: refetchShiftHistory } =
    useApiFetch<ShiftHistory>(shiftHistoryPath);

  // Never keep counts from a previous tenant or physical branch.
  useEffect(()=>{
    setDayCounts({});setShiftCounts({});
    setDayNote("");setShiftNote("");
    setConfirmClose(false);setConfirmShiftClose(false);
    setError(null);setSuccess(null);
  },[session?.businessId,session?.branchId]);

  useEffect(() => {
    if (nonce > 0) refetch();
  }, [nonce, refetch]);

  const canManageDay = operationsPermission(role,"open-day");
  const canManageShift = operationsPermission(role,"open-shift");
  const currencyCode = session?.currencyCode ?? "GHS";
  const current = data;
  const operatingDay = current?.operatingDay ?? null;
  const shift = current?.shift ?? null;

  const hasVariance = useMemo(() => {
    if (!operatingDay) return false;
    return operatingDay.balances.some((b) => b.varianceMinor !== null && b.varianceMinor !== 0);
  }, [operatingDay]);

  const completedDays=history?.days.filter(day=>day.status==="CLOSED")??[];
  const exportDays=()=>{
    if(completedDays.length===0)return;
    try{
      const csv=dayCloseReportCsv(completedDays,currencyCode);
      const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
      const element=document.createElement("a");
      element.href=url;
      element.download="tradeos-day-close-"+completedDays[0]!.businessDate+".csv";
      document.body.append(element);element.click();element.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),30_000);
      setSuccess("Confirmed day-close report exported.");
    }catch(error){
      setError(error instanceof Error?error.message:"Report export failed.");
    }
  };

  const handleAction = async (action: OperationsAction) => {
    if (!session || busy || !current || !operationsPermission(role,action)) return;
    setError(null);setSuccess(null);
    if(typeof navigator!=="undefined" && !navigator.onLine){
      setError("Connect to the internet to verify and finalize this financial interval. No close has been posted.");
      return;
    }
    const isDay=action.endsWith("day");
    const values=isDay?dayCounts:shiftCounts;
    const note=isDay?dayNote:shiftNote;
    let built:ReturnType<typeof buildOperationsMutation>;
    try{
      built=buildOperationsMutation(action,current,values,session.timezone,new Date(),note);
    }catch(err){
      setError(err instanceof Error?err.message:"Confirm the balances before continuing.");
      return;
    }
    setBusy(true);
    try{
      const queue=getOfflineQueue();
      const mutation=queue.build({
        businessId:session.businessId,branchId:session.branchId,
        mutationType:built.mutationType,payload:built.payload,
      });
      await queue.enqueue(mutation);
      await queue.flushOrThrow({activeBusinessId:session.businessId,online:true});
      bump();
      if(isDay){setDayCounts({});setDayNote("");}
      else{setShiftCounts({});setShiftNote("");}
      setConfirmClose(false);setConfirmShiftClose(false);
      setNonce(n=>n+1);refetchHistory();refetchShiftHistory();
      setSuccess(action==="close-day"?"Operating day close confirmed. Review the reconciliation report below.":
        action==="close-shift"?"Shift close confirmed. Review the counted variance in shift history.":
        action==="open-day"?"Operating day opened successfully.":"Staff shift opened successfully.");
    }catch(err){
      setError(err instanceof Error?err.message:"The interval was not confirmed by the server.");
    }finally{setBusy(false);}
  };


  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Money</span>
          <h1 className="tos-page__title">Operations</h1>
          <p className="tos-page__subtitle">Open and close operating days and shifts. Reconcile cash drawers against expected balances.</p>
        </div>
        <div className="tos-page__actions">
          {["OWNER","ADMIN","MANAGER","ACCOUNTANT"].includes(role) ? <Link href="/payments/hubtel" className="tos-btn tos-btn--outline">Hubtel payments</Link> : null}
          <Button variant="outline" icon={<IconRefresh className="tos-btn__icon" />} onClick={() => setNonce((n) => n + 1)}>Refresh</Button>
        </div>
      </header>

      {loading ? (
        <div className="tos-card tos-card--padded"><StatePanel inline variant="loading" /></div>
      ) : loadError ? (
        <StatePanel variant="error" title="Could not load operations" text={loadError} actionLabel="Retry" onAction={() => refetch()} />
      ) : !current ? (
        <StatePanel variant="empty" icon={<IconOperations className="tos-state__icon" />} title="No operations data" text="Open an operating day to start tracking shifts and reconciliation." />
      ) : (
        <>
          {/* Operations status hero — midnight gradient with status pill */}
          <div className="tos-ops-hero tos-animate-fade-in-up">
            <div className="tos-ops-hero__head">
              <div className="tos-ops-hero__head-main">
                <span className="tos-ops-hero__eyebrow">Operating day</span>
                <h2 className="tos-ops-hero__title">{operatingDay ? `Day ${operatingDay.id.slice(0, 8)}` : "No day open"}</h2>
                <p className="tos-ops-hero__sub">
                  {operatingDay
                    ? operatingDay.status === "OPEN"
                      ? `Opened ${new Date(operatingDay.openedAt).toLocaleString()}`
                      : `Closed ${operatingDay.closedAt ? new Date(operatingDay.closedAt).toLocaleString() : ""}`
                    : "Open an operating day to begin tracking shifts and reconciliation."}
                </p>
              </div>
              <span className={`tos-ops-status-pill ${operatingDay?.status === "OPEN" ? "tos-ops-status-pill--open" : "tos-ops-status-pill--closed"}`}>
                <span className="tos-ops-status-pill__dot" />{operatingDay?.status ?? "CLOSED"}
              </span>
            </div>
            {operatingDay ? (
              <div className="tos-ops-operator">
                <span className="tos-ops-operator__icon" aria-hidden="true">
                  <IconClock style={{ width: 16, height: 16 }} />
                </span>
                <div className="tos-ops-operator__body">
                  <span className="tos-ops-operator__label">{operatingDay.status === "OPEN" ? "Opened by operator" : "Closed by operator"}</span>
                  <span className="tos-ops-operator__value">
                    {operatingDay.status === "OPEN"
                      ? new Date(operatingDay.openedAt).toLocaleString()
                      : operatingDay.closedAt
                        ? new Date(operatingDay.closedAt).toLocaleString()
                        : "—"}
                  </span>
                </div>
              </div>
            ) : null}
            <p className="tos-ops-hero__sub" style={{ position: "relative", zIndex: 1 }}>
              Operating days and shifts connect your counted cash with recorded sales, purchases, expenses, transfers and adjustments so differences are easy to spot.
            </p>
          </div>

          <div className="tos-ops-grid">
            {/* Operating day — expected vs actual per method */}
            <section className="tos-section tos-animate-fade-in-up">
              <div className="tos-section__head">
                <h2 className="tos-section__title">Operating day</h2>
                <span className="tos-section__sub">
                  {operatingDay
                    ? hasVariance
                      ? `${operatingDay.balances.filter((b) => b.varianceMinor !== null && b.varianceMinor !== 0).length} variance(s)`
                      : operatingDay.balances.length > 0 ? "All methods balanced" : "No balances yet"
                    : "Closed"}
                </span>
              </div>
              <div className="tos-section__body--padded tos-stack">
                {operatingDay ? (
                  operatingDay.balances.length > 0 ? (
                    <>
                      {/* Per-method expected vs actual comparison rows */}
                      <div className="tos-section" style={{ boxShadow: "none" }}>
                        <div className="tos-section__body">
                          {operatingDay.balances.map((b) => {
                            const varianceLabel = varianceText(b.varianceMinor);
                            return (
                              <div key={b.method} className="tos-ops-method">
                                <div className="tos-ops-method__head">
                                  <span className="tos-ops-method__icon" aria-hidden="true">
                                    {methodIconSvg(b.method)}
                                  </span>
                                  <span className="tos-ops-method__name">{methodLabel(b.method)}</span>
                                </div>
                                <div className="tos-ops-method__col">
                                  <span className="tos-ops-method__col-label">Expected</span>
                                  <MoneyValue minor={b.expectedClosingMinor} currencyCode={currencyCode} className="tos-ops-method__col-val tos-ops-method__col-val--muted" />
                                </div>
                                <div className="tos-ops-method__col">
                                  <span className="tos-ops-method__col-label">Counted</span>
                                  {b.closingCountedMinor !== null ? (
                                    <MoneyValue minor={b.closingCountedMinor} currencyCode={currencyCode} className="tos-ops-method__col-val" />
                                  ) : (
                                    <span className="tos-ops-method__col-val tos-ops-method__col-val--muted">Pending</span>
                                  )}
                                </div>
                                <div className="tos-ops-method__col">
                                  <span className="tos-ops-method__col-label">Variance</span>
                                  {b.varianceMinor !== null ? (
                                    <MoneyValue minor={b.varianceMinor} currencyCode={currencyCode} className={varianceValClass(b.varianceMinor)} signed />
                                  ) : (
                                    <span className="tos-ops-method__col-val tos-ops-method__col-val--muted">{varianceLabel}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Day summary — opening / movement / expected / variance totals */}
                      <div className="tos-account-group">
                        {operatingDay.balances.map((b) => (
                          <div key={`${b.method}-movement`} className="tos-account-group__head">
                            <span className="tos-account-group__icon tos-account-group__icon--cash" aria-hidden="true">
                              {methodIconSvg(b.method)}
                            </span>
                            <div className="tos-account-group__body">
                              <span className="tos-account-group__title">{methodLabel(b.method)} movement</span>
                              <span className="tos-account-group__meta">
                                Opening <MoneyValue minor={b.openingCountedMinor} currencyCode={currencyCode} tone="muted" /> · {b.movementMinor >= 0 ? "inflow" : "outflow"} <MoneyValue minor={b.movementMinor} currencyCode={currencyCode} tone={b.movementMinor >= 0 ? "positive" : "negative"} />
                              </span>
                            </div>
                            <MoneyValue minor={b.expectedClosingMinor} currencyCode={currencyCode} className="tos-account-group__total" />
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="tos-state__text">No balances recorded yet. Open the day with a counted cash balance to begin.</p>
                  )
                ) : (
                  <p className="tos-state__text">No operating day is open. Open one to begin tracking.</p>
                )}

                {canManageDay ? (
                  <>
                    <MethodCounts values={dayCounts} onChange={setDayCounts}
                      currencyCode={currencyCode}
                      mode={operatingDay ? "closing" : "opening"} identity="day" />
                    <label className="tos-field__label" htmlFor="ops-day-note">Day cash count note</label>
                    <textarea id="ops-day-note" className="tos-input" maxLength={1000} rows={2}
                      value={dayNote} onChange={event=>setDayNote(event.target.value)}
                      placeholder="Optional: explain shortages, cash top-ups or handover evidence" />
                  </>
                ) : null}
                {error ? <div role="alert" className="tos-banner tos-banner--danger">
                  <span className="tos-banner__title">{error}</span></div> : null}
                {success ? <div role="status" className="tos-callout tos-callout--info">
                  {success}</div> : null}

                {canManageDay && operatingDay && confirmClose ? (
                  <div className="tos-ops-confirm tos-animate-fade-in-up">
                    <h3 className="tos-ops-confirm__title">Confirm operating day closing</h3>
                    <p className="tos-ops-confirm__sub">
                      The server will preserve your five method counts, compare them with ledger
                      movements and retain any variance for review. It will not silently
                      alter cashbook balances to hide a difference.
                    </p>
                    {operatingDay.balances.map(balance=>{
                      const counted=dayCounts[balance.method as OperationsMethod];
                      const variance=counted==null?null:counted-balance.expectedClosingMinor;
                      return (
                        <div key={balance.method} className="tos-ops-confirm__row">
                          <span className="tos-ops-confirm__row-label">{methodLabel(balance.method)} expected</span>
                          <MoneyValue minor={balance.expectedClosingMinor} currencyCode={currencyCode} />
                          <span className="tos-ops-confirm__row-label">Counted</span>
                          {counted==null?<strong>Missing</strong>:
                            <MoneyValue minor={counted} currencyCode={currencyCode}/>}
                          {variance!=null?<MoneyValue minor={variance} currencyCode={currencyCode} signed
                            tone={variance===0?"muted":variance>0?"positive":"negative"} />:null}
                        </div>
                      );
                    })}
                    {current.openShiftCount>0?
                      <p role="alert" className="tos-callout tos-callout--warning">
                        Close all {current.openShiftCount} open staff shifts first.
                      </p>:null}
                    <div className="tos-row tos-row--between">
                      <Button variant="ghost" onClick={()=>setConfirmClose(false)}
                        disabled={busy}>Cancel</Button>
                      <Button variant="danger" loading={busy}
                        disabled={current.openShiftCount>0}
                        onClick={()=>void handleAction("close-day")}>Close day &amp; record variance</Button>
                    </div>
                  </div>
                ):null}
              </div>
              <div className="tos-section__foot">
                {canManageDay ? (
                  !operatingDay ? (
                    <Button variant="primary" loading={busy}
                      onClick={()=>void handleAction("open-day")}>Open operating day</Button>
                  ):confirmClose?(
                    <span className="tos-section__sub">Confirm all counted balances above.</span>
                  ):(
                    <Button variant="danger" disabled={busy || current.openShiftCount>0}
                      onClick={()=>setConfirmClose(true)}>Review &amp; close operating day</Button>
                  )
                ):<p className="tos-section__sub">
                  A supervisor opens and closes operating days. Cashiers can manage their own shifts below.
                </p>}
              </div>
            </section>

            {/* Shift card — secondary status */}
            <section className="tos-ops-shift-card tos-animate-fade-in-up">
              <div className="tos-ops-shift-card__head">
                <h2 className="tos-ops-shift-card__title">Shift</h2>
                <span className={`tos-badge ${shift ? "tos-badge--positive" : "tos-badge--neutral"}`}>
                  <span className="tos-badge__dot" />{shift ? shift.status : "CLOSED"}
                </span>
              </div>
              <div className="tos-ops-shift-card__body">
                {shift ? (
                  <div className="tos-ops-shift-card__row">
                    <span className="tos-ops-shift-card__row-label">Opened</span>
                    <span className="tos-ops-shift-card__row-val">{new Date(shift.openedAt).toLocaleString()}</span>
                  </div>
                ) : (
                  <p className="tos-state__text"><IconClock style={{ width: 16, height: 16, verticalAlign: "middle", marginRight: 6 }} />No shift open. Open one to track cashier sessions.</p>
                )}
                {current ? (
                  <div className="tos-ops-shift-card__row">
                    <span className="tos-ops-shift-card__row-label">Open shifts</span>
                    <span className="tos-ops-shift-card__row-val">{current.openShiftCount}</span>
                  </div>
                ) : null}
              </div>
              {canManageShift && operatingDay ? (
                <div className="tos-ops-shift-card__body">
                  {shift && shift.balances.length>0 ? (
                    <div style={{display:"grid",gap:6,marginBottom:12}}>
                      <h3 className="tos-section__title">My shift expected balances</h3>
                      {shift.balances.map(balance=>(
                        <div key={balance.method} className="tos-row tos-row--between">
                          <span>{methodLabel(balance.method)}</span>
                          <MoneyValue minor={balance.expectedClosingMinor} currencyCode={currencyCode} />
                        </div>
                      ))}
                    </div>
                  ):null}
                  <MethodCounts values={shiftCounts} onChange={setShiftCounts}
                    currencyCode={currencyCode}
                    mode={shift?"closing":"opening"} identity="shift"/>
                  <label className="tos-field__label" htmlFor="ops-shift-note">Shift handover note</label>
                  <textarea id="ops-shift-note" className="tos-input" maxLength={1000} rows={2}
                    value={shiftNote} onChange={event=>setShiftNote(event.target.value)}
                    placeholder="Optional cash count or handover explanation"/>
                  {shift && confirmShiftClose ? (
                    <div className="tos-ops-confirm" style={{marginTop:12}}>
                      <h3>Confirm closing my own shift</h3>
                      <p>Cash difference: {operationsVariance(shiftCounts,
                        shift.balances.find(b=>b.method==="CASH")?.expectedClosingMinor??0)===null
                        ? "Awaiting cash count" : "See the counted variance in the shift report."}</p>
                      <Button variant="ghost" onClick={()=>setConfirmShiftClose(false)}
                        disabled={busy}>Cancel</Button>
                      <Button variant="danger" loading={busy}
                        onClick={()=>void handleAction("close-shift")}>Record shift close</Button>
                    </div>
                  ):(
                    <Button variant={shift?"danger":"primary"} block loading={busy}
                      onClick={()=>shift?setConfirmShiftClose(true):void handleAction("open-shift")}>
                      {shift?"Review & close my shift":"Open my shift"}
                    </Button>
                  )}
                </div>
              ):null}
              {!operatingDay ? (
                <p className="tos-callout tos-callout--warning">
                  A supervisor must open the operating day before staff can open their shifts.
                </p>
              ):null}
            </section>
          </div>

          <section className="tos-section tos-animate-fade-in-up" aria-label="Staff shift history">
            <div className="tos-section__head">
              <div>
                <h2 className="tos-section__title">Recent staff shifts</h2>
                <p className="tos-section__sub">Cashiers see their own shifts;
                  supervisors can review staff handovers by recorded employee and branch.</p>
              </div>
            </div>
            <div className="tos-section__body--padded tos-stack">
              {(shiftHistory?.shifts??[]).filter(item=>item.status==="CLOSED").length===0?
                <p className="tos-state__text">No completed staff shifts have been recorded yet.</p>:
                (shiftHistory?.shifts??[]).filter(item=>item.status==="CLOSED").map(item=>(
                  <article key={item.id} className="tos-section" style={{padding:12}}>
                    <h3 className="tos-section__title">
                      {new Date(item.openedAt).toLocaleString()} ·
                      {" "+item.staffId.slice(0,8)}
                    </h3>
                    <p className="tos-section__sub">
                      Closed {item.closedAt?new Date(item.closedAt).toLocaleString():"—"}
                    </p>
                    <div style={{display:"grid",gap:6}}>
                      {item.balances.map(balance=>(
                        <div key={balance.method} className="tos-row tos-row--between" style={{gap:12}}>
                          <strong>{methodLabel(balance.method)}</strong>
                          <span>Expected <MoneyValue minor={balance.expectedClosingMinor}
                            currencyCode={currencyCode}/></span>
                          <span>Counted {balance.closingCountedMinor===null?"—":
                            <MoneyValue minor={balance.closingCountedMinor} currencyCode={currencyCode}/>}</span>
                          <span>Variance {balance.varianceMinor===null?"—":
                            <MoneyValue minor={balance.varianceMinor} currencyCode={currencyCode} signed
                              tone={balance.varianceMinor===0?"muted":
                                balance.varianceMinor>0?"positive":"negative"}/>}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
            </div>
          </section>

          <section className="tos-section tos-animate-fade-in-up" aria-label="Completed operating days">
            <div className="tos-section__head">
              <div>
                <h2 className="tos-section__title">Recent completed days</h2>
                <p className="tos-section__sub">Actual recorded opening, movements,
                  counted balances and shortages or surpluses for this branch.</p>
              </div>
              <Button variant="outline" size="sm" disabled={completedDays.length===0}
                onClick={exportDays}>Export CSV</Button>
            </div>
            <div className="tos-section__body--padded tos-stack">
              {completedDays.length===0 ? (
                <p className="tos-state__text">No completed day-close reports yet.</p>
              ):completedDays.map(day=>(
                <article key={day.id} className="tos-section" style={{padding:14}}>
                  <h3 className="tos-section__title">{day.businessDate}</h3>
                  <p className="tos-section__sub">
                    {day.balances.some(b=>b.varianceMinor!==null&&b.varianceMinor!==0)
                      ? "Variance recorded: inspect each tender below."
                      : "All counted methods balanced."}
                  </p>
                  <div style={{overflowX:"auto"}}>
                    <table className="tos-team__table" style={{minWidth:620,width:"100%"}}>
                      <thead><tr>
                        <th scope="col">Method</th><th scope="col">Opening</th>
                        <th scope="col">Movement</th><th scope="col">Expected</th>
                        <th scope="col">Counted</th><th scope="col">Variance</th>
                      </tr></thead>
                      <tbody>
                        {day.balances.map(balance=>(
                          <tr key={balance.method}>
                            <th scope="row">{methodLabel(balance.method)}</th>
                            <td><MoneyValue minor={balance.openingCountedMinor} currencyCode={currencyCode}/></td>
                            <td><MoneyValue minor={balance.movementMinor} currencyCode={currencyCode} signed/></td>
                            <td><MoneyValue minor={balance.expectedClosingMinor} currencyCode={currencyCode}/></td>
                            <td>{balance.closingCountedMinor===null?"—":
                              <MoneyValue minor={balance.closingCountedMinor} currencyCode={currencyCode}/>}</td>
                            <td>{balance.varianceMinor===null?"—":
                              <MoneyValue minor={balance.varianceMinor} currencyCode={currencyCode} signed
                                tone={balance.varianceMinor===0?"muted":
                                  balance.varianceMinor>0?"positive":"negative"}/>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="tos-callout tos-callout--info">
            <span className="tos-callout__icon-wrap" aria-hidden="true">
              <IconShield style={{ width: 16, height: 16 }} />
            </span>
            <span className="tos-callout__body">
              Operating days and shifts keep a traceable history.
              <span className="tos-callout__sub"> TradeOS compares the counted amount with the recorded account balance and shows any variance before the day is finalized.</span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
