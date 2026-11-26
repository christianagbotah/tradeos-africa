"use client";
import {useEffect,useState} from "react";
import {getOfflineQueue} from "../../../lib/offline-sync";
import {useApiFetch} from "../../../lib/use-api-fetch";
import {readApiErrorMessage} from "../../../lib/auth-fetch";
import {useWorkspace} from "../workspace/use-workspace";
import {Button} from "../ui/button";

interface ShiftSalePolicy {
  required:boolean;revision:string|null;changedAt:string|null;
}
interface ShiftSalePolicyResponse {policy:ShiftSalePolicy}

export function ShiftSalePolicyPanel({
  online,canManage,
}:{
  online:boolean;canManage:boolean;
}){
  const {session,businessContext}=useWorkspace();
  const businessId=session?.businessId??null,branchId=session?.branchId??null;
  const branch=businessContext?.branches.find(item=>item.id===branchId);
  const path=businessId&&branchId?
    "/v1/operations/sale-shift-policy?businessId="+encodeURIComponent(businessId)+
      "&branchId="+encodeURIComponent(branchId):null;
  const {data,loading,error:loadError,refetch,setData}=
    useApiFetch<ShiftSalePolicyResponse>(path);
  const [choice,setChoice]=useState<boolean|null>(null);
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);

  useEffect(()=>{
    setChoice(null);setReason("");setError(null);setSuccess(null);
  },[businessId,branchId]);

  const change=async()=>{
    if(!path||!canManage||!online||busy||!data||choice===null||
      choice===data.policy.required||reason.trim().length<10)return;
    setBusy(true);setError(null);setSuccess(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(path,{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          required:choice,expectedRevision:data.policy.revision,reason:reason.trim(),
        }),
      });
      if(!response.ok)throw new Error(await readApiErrorMessage(
        response,"The branch cash-shift policy could not be updated."));
      const result=await response.json() as ShiftSalePolicyResponse;
      if(!result.policy||result.policy.required!==choice||!result.policy.revision)
        throw new Error("The server did not confirm the new cash-shift setting.");
      setData({policy:result.policy});
      setChoice(null);setReason("");
      setSuccess(choice?
        "Shift-before-sale is enabled for this branch. Staff must have a valid shift.":
        "Shift-before-sale is disabled for this branch. The change was audited.");
      refetch();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Policy update failed.");
    }finally{setBusy(false);}
  };

  return (
    <section className="tos-settings__subpanel" aria-label="Shift before sale policy"
      style={{display:"grid",gap:14,marginTop:16}}>
      <div>
        <h3 className="tos-settings__subheading">Cashier shift before sale</h3>
        <p className="tos-settings__subtext">
          Apply to {branch?.name??"the selected branch"} only. When enabled, TradeOS
          verifies that the authenticated seller has a staff shift covering the
          transaction time and that the operating day covers that time.
          Existing businesses remain unrestricted until the owner enables this.
        </p>
      </div>
      {loading?<p role="status">Checking the branch shift policy…</p>:null}
      {loadError?<p role="alert" className="tos-banner tos-banner--danger">{loadError}</p>:null}
      {data?(
        <p role="status">
          Current setting: <strong>{data.policy.required?
            "Required — sales need a valid staff shift":
            "Optional — normal sales continue without a shift"}</strong>
        </p>
      ):null}
      {!canManage?(
        <p className="tos-settings__subtext">
          Owners and admins control this policy. You can view the current setting.
        </p>
      ):null}
      {canManage&&data&&choice===null?(
        <div className="tos-settings__actions">
          <Button variant={data.policy.required?"outline":"primary"}
            disabled={!online||busy} onClick={()=>{setChoice(!data.policy.required);
              setError(null);setSuccess(null);}}>
            {data.policy.required?"Disable shift requirement":"Require shift before sale"}
          </Button>
        </div>
      ):null}
      {success?<p role="status" className="tos-callout tos-callout--info">{success}</p>:null}
      {error?<p role="alert" className="tos-banner tos-banner--danger">{error}</p>:null}
      {choice!==null&&canManage&&data?(
        <div role="presentation" style={{position:"fixed",inset:0,zIndex:900,
          background:"rgba(6,14,26,0.7)",display:"flex",alignItems:"center",
          justifyContent:"center",padding:16,overflowY:"auto"}}>
          <div role="dialog" aria-modal="true" aria-labelledby="shift-policy-title"
            style={{width:"100%",maxWidth:520,background:"var(--tos-surface, #fff)",
              color:"var(--tos-text, #07111f)",borderRadius:18,padding:24,
              boxShadow:"0 16px 48px rgba(0,0,0,.25)",display:"grid",gap:12}}>
            <h3 id="shift-policy-title" className="tos-settings__subheading">
              {choice?"Enable mandatory cashier shifts?":"Disable mandatory cashier shifts?"}
            </h3>
            <p className="tos-settings__subtext">
              {choice?
                "New sales made after activation must belong to a valid open trading day and staff shift. Cashiers must open their shift before selling. Existing queued sales are checked against the policy that applied when they were recorded.":
                "Sales made after disabling will no longer require a shift. Earlier offline transactions still follow the historical policy at their sale time."}
            </p>
            <label className="tos-field__label" htmlFor="shift-policy-reason">
              Reason for the change (required, at least 10 characters)
            </label>
            <textarea id="shift-policy-reason" className="tos-input"
              rows={3} maxLength={500} autoFocus
              value={reason} onChange={event=>setReason(event.target.value)}
              placeholder="Example: Implement cashier drawer accountability in this branch"/>
            <div className="tos-settings__actions">
              <Button variant="outline" disabled={busy} onClick={()=>{setChoice(null);
                setReason("");}}>Cancel</Button>
              <Button variant={choice?"primary":"danger"} loading={busy}
                disabled={!online||reason.trim().length<10}
                onClick={()=>void change()}>
                {choice?"Confirm & enable":"Confirm & disable"}
              </Button>
            </div>
          </div>
        </div>
      ):null}
    </section>
  );
}
