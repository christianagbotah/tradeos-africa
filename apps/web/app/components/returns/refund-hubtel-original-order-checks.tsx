"use client";

import { useRef, useState } from "react";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { useWorkspace } from "../workspace/use-workspace";
import { Button } from "../ui/button";
import { StatePanel } from "../ui/state-panel";

type OriginalObservation = {
  id:string;refundId:string;originalOrderStatus:"PAID"|"UNPAID"|"REFUNDED";
  observationKind:string;checkedAt:string;recordedAt:string;
  evidenceScope:"ORIGINAL_PAYMENT_ONLY";
  refundDestinationVerified:false;refundSpecificSettlementVerified:false;
  providerFinality:"NOT_ESTABLISHED";canMarkPaid:false;paymentStatusUnchanged:true;
};
type Result={
  refundId:string;observations:OriginalObservation[];
  recheckAvailable:boolean;nextCheckAt:string|null;
  providerFinality:"NOT_ESTABLISHED";
  refundDestinationVerified:false;refundSpecificSettlementVerified:false;
  canMarkPaid:false;
};
const KIND:Record<string,string>={
  ORIGINAL_ORDER_PAID:"Original payment still marked paid",
  ORIGINAL_ORDER_UNPAID_CONFLICT:"Original payment status conflicts with recorded settlement",
  ORIGINAL_ORDER_REFUND_REPORTED:"Hubtel reports the original order as refunded (not refund-specific proof)",
  ORIGINAL_ORDER_REFERENCE_CONFLICT:"Provider reference or payment method conflicts",
};
export function RefundHubtelOriginalOrderChecks({refundId}:{refundId:string}){
  const {session,queue}=useWorkspace();
  const [saving,setSaving]=useState(false);
  const [errorMessage,setErrorMessage]=useState<string|null>(null);
  const [successMessage,setSuccessMessage]=useState<string|null>(null);
  const requestId=useRef<string|null>(null);
  const path=session
    ? `/v1/refunds/hubtel-original-order-observations?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&refundId=${encodeURIComponent(refundId)}`
    : null;
  const {data,loading,error,refetch}=useApiFetch<Result>(path);
  const result=data?.refundId===refundId?data:null;
  const valid=result &&
    result.providerFinality==="NOT_ESTABLISHED" &&
    result.refundDestinationVerified===false &&
    result.refundSpecificSettlementVerified===false &&
    result.canMarkPaid===false &&
    Array.isArray(result.observations) &&
    (result.nextCheckAt===null || Number.isFinite(Date.parse(result.nextCheckAt))) &&
    result.observations.every((item)=>
      item.refundId===refundId &&
      item.evidenceScope==="ORIGINAL_PAYMENT_ONLY" &&
      item.canMarkPaid===false &&
      item.refundDestinationVerified===false &&
      item.refundSpecificSettlementVerified===false &&
      item.providerFinality==="NOT_ESTABLISHED" &&
      Number.isFinite(Date.parse(item.checkedAt)));
  const cooldown=valid && result?.nextCheckAt
    ? Date.parse(result.nextCheckAt)>Date.now():false;
  async function checkOriginal(){
    if(!session||!queue.online||saving||!valid||!result?.recheckAvailable||cooldown)return;
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    const clientRequestId=requestId.current??crypto.randomUUID();
    requestId.current=clientRequestId;
    try{
      const response=await getOfflineQueue().authenticatedFetch(
        "/v1/refunds/hubtel-original-order-recheck",{
          method:"POST",cache:"no-store",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            businessId:session.businessId,branchId:session.branchId,refundId,
            clientRequestId,
          }),
        });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const json=await response.json() as {observation?:OriginalObservation};
      const item=json.observation;
      if(!item||item.refundId!==refundId||
          item.providerFinality!=="NOT_ESTABLISHED"||
          item.canMarkPaid!==false||
          item.evidenceScope!=="ORIGINAL_PAYMENT_ONLY"||
          item.refundDestinationVerified!==false||
          item.refundSpecificSettlementVerified!==false)
        throw new Error("Original-order check returned unverified data. Refresh the history.");
      requestId.current=null;
      setSuccessMessage(
        "Authenticated original-payment status recorded. This does not confirm a refund payout.");
      refetch();
    }catch(e){
      setErrorMessage(e instanceof Error?e.message:"Original payment could not be rechecked.");
      refetch();
    }finally{setSaving(false);}
  }
  return <section className="tos-card tos-card--padded" aria-label="Hubtel original payment observations"
    style={{marginTop:14}}>
    <div className="tos-row" style={{gap:10,flexWrap:"wrap",
      justifyContent:"space-between",alignItems:"flex-start"}}>
      <div>
        <h3 className="tos-section__title">Hubtel original-order status history</h3>
        <p className="tos-section__sub">
          Authenticated provider status applies to the original payment, not a specific
          refund destination. It is never sufficient to mark this refund paid.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={refetch}>Refresh</Button>
    </div>
    {loading?<p role="status" className="tos-section__sub">Loading provider checks…</p>:null}
    {error?<StatePanel inline variant="error" title="Cannot load provider observations"
      text={error} actionLabel="Retry" onAction={refetch}/>:null}
    {!loading&&!error&&result&&!valid?<p role="alert" className="tos-section__sub">
      Verification history is incomplete or unsafe; no payout status can be inferred.
    </p>:null}
    {valid&&result?<>
      <div className="tos-row" style={{gap:8,flexWrap:"wrap",marginTop:10}}>
        <Button size="sm" variant="outline" loading={saving}
          disabled={!queue.online||!result.recheckAvailable||Boolean(cooldown)}
          onClick={()=>void checkOriginal()}>
          Check original Hubtel order
        </Button>
        {!queue.online?<span className="tos-section__sub">
          Internet connection required for an authenticated provider check.
        </span>:null}
        {!result.recheckAvailable?<span className="tos-section__sub">
          Recheck unavailable: an approved original merchant account and matched,
          fully paid Hubtel order are required.
        </span>:null}
        {cooldown&&result.nextCheckAt?<span className="tos-section__sub">
          Next provider check after {new Date(result.nextCheckAt).toLocaleString()}.
        </span>:null}
      </div>
      {errorMessage?<p role="alert" className="tos-section__sub">{errorMessage}</p>:null}
      {successMessage?<p role="status" className="tos-section__sub">{successMessage}</p>:null}
      <div style={{marginTop:12}}>
        <strong>Authenticated original-order checks</strong>
        {result.observations.length===0?<p className="tos-section__sub">
          No authenticated original-order checks recorded for this refund yet.
        </p>:null}
        {result.observations.length>0?<ol className="tos-list-cards">
          {result.observations.map((item)=><li key={item.id} className="tos-returnable-card">
            <strong>{KIND[item.observationKind]??"Original-order status requires review"}</strong>
            <span className="tos-returnable-card__sub">
              Checked {new Date(item.checkedAt).toLocaleString()}
            </span>
            <p className="tos-section__sub">Refund-specific settlement: NOT verified.
              Customer destination: NOT verified.</p>
          </li>)}
        </ol>:null}
      </div>
    </>:null}
  </section>;
}
