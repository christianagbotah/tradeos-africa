"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney, majorToMinor, minorToMajor, getCurrencyMeta } from "@tradeos/contracts";
import type { SyncResponse } from "@tradeos/contracts";
import type { QueuedMutation } from "@tradeos/client-core/sync-runtime";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { mayStartNextQuickServeCustomer } from "../../../lib/quick-serve-sale-gate";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { receiptUrl } from "../../../lib/receipt-document";
import { loadReceiptPaper,shareVerifiedReceiptPdf } from "../../../lib/receipt-pdf";
import { notifyAction } from "../ui/action-feedback";
import { buildSaleCreatePayload, type PaymentMethod } from "../../../lib/mutation-builders";
import type { CartLine } from "./cart-panel";
import type { VoicePayment,VoiceCheckoutSuggestion } from "../../../lib/voice-transaction-draft";
import {evaluateVoicePaymentSuggestion} from "../../../lib/voice-payment-review";
import { CustomerPicker } from "./customer-picker";
import { MoneyValue } from "../business/money-value";
import { MoneyInput } from "../ui/money-input";
import { Button } from "../ui/button";
import {
  IconCheck,
  IconClose,
  IconPrint,
  IconShare,
  IconBanknote,
  IconSmartphone,
  IconCreditCard,
  IconWallet,
  IconCloudOff,
} from "../ui/icons";
import type { Customer } from "../workspace/workspace-provider";

interface CheckoutSheetProps {
  open: boolean;
  lines: readonly CartLine[];
  currencyCode: string;
  businessId: string;
  branchId: string;
  customers: readonly Customer[];
  online: boolean;
  onClose: () => void;
  onComplete: () => void;
  initialCustomerId?: string | null;
  initialPaymentMethod?: VoicePayment;
  initialVoicePaymentSuggestion?: VoiceCheckoutSuggestion | null;
  /** Fast walk-in cash collection without hiding normal payment verification. */
  quickServe?: boolean;
  cashOnly?: boolean;
}

interface ServerQuoteLine{
  itemId:string;unitCode:string;quantity:number;unitPriceMinor:number;
  standardPriceMinor:number;source:"CATALOG"|"CUSTOMER";
}
interface ServerQuote{
  lines:ServerQuoteLine[];totalMinor:number;
}
interface ApprovedPrice{
  id:string;status:string;branchId:string;customerId:string|null;
  itemId:string;unitCode:string;quantity:number;
  baseUnitPriceMinor:number;requestedUnitPriceMinor:number;
  expiresAt:string|null;createdAt:string;
}
interface SaleResult {
  status: "pending" | "completed";
  reference: string;
  changeMinor: number | null;
  totalMinor: number | null;
  message?: string;
  paymentPending?: boolean;
  receiptAvailable?: boolean;
}

export function CheckoutSheet({
  open,
  lines,
  currencyCode,
  businessId,
  branchId,
  customers,
  online,
  onClose,
  onComplete,
  initialCustomerId,
  initialPaymentMethod,
  initialVoicePaymentSuggestion,
  quickServe = false,
  cashOnly = false,
}: CheckoutSheetProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [hubtelSelected,setHubtelSelected] = useState(false);
  const [hubtelAvailable,setHubtelAvailable] = useState(false);
  const [preferredGateway,setPreferredGateway]=useState("HUBTEL");
  const gatewayLabel:Record<string,string>={
    HUBTEL:"Hubtel",PAYSTACK:"Paystack",FLUTTERWAVE:"Flutterwave",
    STRIPE:"Stripe",PESAPAL:"Pesapal",DPO:"DPO Pay",MPESA:"M-Pesa",
  };
  const gatewayName=gatewayLabel[preferredGateway]??"selected provider";
  const [cashReceivedMinor, setCashReceivedMinor] = useState<number | null>(null);
  const [splitWithCredit,setSplitWithCredit]=useState(false);
  const [paidNowMinor,setPaidNowMinor]=useState<number|null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);
  const [voiceSuggestion,setVoiceSuggestion]=useState<VoiceCheckoutSuggestion|null>(null);
  const [voiceAmountCopied,setVoiceAmountCopied]=useState(false);
  const [serverQuote,setServerQuote]=useState<{key:string;value:ServerQuote}|null>(null);
  const [quotePending,setQuotePending]=useState(false);
  const [quoteError,setQuoteError]=useState<string|null>(null);
  const [approvals,setApprovals]=useState<ApprovedPrice[]>([]);
  const [selectedApprovals,setSelectedApprovals]=useState<Record<string,string>>({});
  const initializedRef=useRef(false);
  const submittingRef=useRef(false);
  // Reuse one clientMutationId if a network response is lost while charging
  // exactly the same draft. The sync backend is idempotent by mutation ID.
  const attemptedSaleRef=useRef<{signature:string;mutation:QueuedMutation}|null>(null);
  const [quickManual,setQuickManual]=useState(false);
  const quickCheckout=quickServe&&!quickManual;
  const [reviewVersion,setReviewVersion]=useState(0);
  const quoteKey=JSON.stringify({
    customerId:customer?.id??null,
    lines:lines.map(l=>[l.sellable.itemId,l.sellable.unitCode,l.quantity]),
  });
  const quote=online&&serverQuote?.key===quoteKey?serverQuote.value:null;
  function matchingApproval(itemId:string,unitCode:string,quantity:number,
    baseMinor:number,id:string){
    return approvals.find(a=>a.id===id&&a.status==="APPROVED"&&
      a.branchId===branchId&&a.customerId===(customer?.id??null)&&
      a.itemId===itemId&&a.unitCode===unitCode&&a.quantity===quantity&&
      a.baseUnitPriceMinor===baseMinor&&
      a.requestedUnitPriceMinor<baseMinor&&
      a.expiresAt!==null&&Date.parse(a.expiresAt)>Date.now());
  }
  function lineNetMinor(l:CartLine,index:number):number{
    const server=quote?.lines[index];
    const base=server?.itemId===l.sellable.itemId&&
      server.unitCode===l.sellable.unitCode&&
      server.quantity===l.quantity?server.unitPriceMinor:l.sellable.priceMinor;
    const selected=selectedApprovals[l.sellable.key]??"";
    const special=matchingApproval(l.sellable.itemId,l.sellable.unitCode,l.quantity,
      base,selected);
    return special?.requestedUnitPriceMinor??base;
  }
  const totalMinor = lines.reduce((sum,l,i)=>
    sum+Math.round(lineNetMinor(l,i)*l.quantity),0);
  const quoteReady=!online||Boolean(quote)&&!quoteError&&!quotePending;
  const approvalValid=lines.every((l,i)=>{
    const id=selectedApprovals[l.sellable.key];
    if(!id)return true;
    const base=quote?.lines[i]?.unitPriceMinor??l.sellable.priceMinor;
    return Boolean(matchingApproval(l.sellable.itemId,l.sellable.unitCode,l.quantity,
      base,id));
  });
  const amountToCollect = splitWithCredit?(paidNowMinor??0):totalMinor;
  const changeMinor = cashReceivedMinor !== null ?
    cashReceivedMinor - amountToCollect : null;
  const availableCreditMinor=customer?.creditLimitMinor===null||
    customer?.creditLimitMinor===undefined?null:
    Math.max(0,customer.creditLimitMinor-customer.balanceMinor);
  const creditMinor=splitWithCredit?totalMinor-amountToCollect:
    paymentMethod==="CUSTOMER_CREDIT"?totalMinor:0;
  const creditReady=creditMinor<=0||Boolean(customer?.active&&online&&
    availableCreditMinor!==null&&availableCreditMinor>=creditMinor);
  const splitValid=!splitWithCredit || (
    online&&!hubtelSelected&&paymentMethod!=="CUSTOMER_CREDIT"&&
    Number.isSafeInteger(amountToCollect)&&amountToCollect>0&&amountToCollect<totalMinor
  );
  const voicePaymentGuide=evaluateVoicePaymentSuggestion({
    suggestion:voiceSuggestion,
    paymentMethod,
    online,
    pricingVerified:quoteReady&&approvalValid,
    hubtelSelected,
    totalMinor,
    activeCustomer:Boolean(customer?.active),
    availableCreditMinor,
  });
  const canQuickCash=quickCheckout&&quoteReady&&approvalValid&&lines.length>0&&
    !hubtelSelected&&paymentMethod==="CASH"&&!splitWithCredit&&!customer&&
    Number.isSafeInteger(totalMinor)&&totalMinor>=0;
  const canCharge = quoteReady&&approvalValid&&lines.length>0&&
    (!hubtelSelected||(online&&hubtelAvailable))&&
    splitValid&&creditReady&&(paymentMethod!=="CUSTOMER_CREDIT"||online)&&
    (paymentMethod!=="CASH" || (cashReceivedMinor!==null &&
      cashReceivedMinor>=amountToCollect));

  // Initialize once per opening, not whenever the customer list refreshes.
  useEffect(() => {
    if (!open) {initializedRef.current=false;return;}
    if (open && !initializedRef.current) {
      initializedRef.current=true;
      const voiceMethod = cashOnly ? "CASH" :
        initialPaymentMethod === "CREDIT"?"CUSTOMER_CREDIT":
        initialPaymentMethod && initialPaymentMethod!=="UNSPECIFIED"?
          initialPaymentMethod:"CASH";
      // Voice cannot mark an electronic payment received without Hubtel status.
      const electronicVoice=["MOMO","CARD","BANK","OTHER"].includes(voiceMethod);
      setPaymentMethod(electronicVoice?
        (voiceMethod==="CARD"?"CARD":"MOMO"):voiceMethod);
      setHubtelSelected(electronicVoice);
      setCashReceivedMinor(null);
      setQuickManual(false);
      submittingRef.current=false;
      attemptedSaleRef.current=null;
      setSplitWithCredit(false);
      setPaidNowMinor(null);
      setCustomer(cashOnly ? null : customers.find(c=>c.id===initialCustomerId&&c.active)??null);
      setVoiceSuggestion(initialVoicePaymentSuggestion??null);
      setVoiceAmountCopied(false);
      setBusy(false);
      setError(null);
      setResult(null);
      setSelectedApprovals({});
      setReviewVersion(v=>v+1);
    }
  }, [open,initialCustomerId,initialPaymentMethod,
    initialVoicePaymentSuggestion,customers,cashOnly]);

  useEffect(()=>{
    if(!open||!online||lines.length===0){
      setServerQuote(null);setQuotePending(false);setQuoteError(null);return;
    }
    let active=true;
    const submittedKey=quoteKey;
    setQuotePending(true);setQuoteError(null);
    void getOfflineQueue().authenticatedFetch("/v1/pricing/quote",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({businessId,branchId,customerId:customer?.id??null,
        lines:lines.map(l=>({itemId:l.sellable.itemId,
          unitCode:l.sellable.unitCode,quantity:l.quantity}))}),
    }).then(async response=>{
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const result=await response.json() as ServerQuote;
      if(result.lines.length!==lines.length ||
        result.lines.some((l,i)=>l.itemId!==lines[i]?.sellable.itemId||
          l.unitCode!==lines[i]?.sellable.unitCode||
          l.quantity!==lines[i]?.quantity||
          !Number.isSafeInteger(l.unitPriceMinor)||l.unitPriceMinor<0) ||
        !Number.isSafeInteger(result.totalMinor)||result.totalMinor<0)
        throw new Error("The pricing server returned an inconsistent quote.");
      if(active)setServerQuote({key:submittedKey,value:result});
    }).catch(e=>{
      if(active){setServerQuote(null);setQuoteError(
        e instanceof Error?e.message:"Cannot verify current selling prices.");}
    }).finally(()=>{if(active)setQuotePending(false);});
    return ()=>{active=false;};
  },[open,online,businessId,branchId,customer?.id,quoteKey,reviewVersion]);
  useEffect(()=>{
    if(!open||!online||cashOnly){setApprovals([]);return;}
    let active=true;
    void getOfflineQueue().authenticatedFetch(
      "/v1/pricing/discount-requests?businessId="+encodeURIComponent(businessId)+
      "&status=APPROVED",
    ).then(async response=>{
      if(!response.ok)return;
      const data=await response.json() as {requests:ApprovedPrice[]};
      if(active)setApprovals(data.requests);
    }).catch(()=>{if(active)setApprovals([]);});
    return ()=>{active=false;};
  },[open,online,businessId,reviewVersion,cashOnly]);
  useEffect(()=>{
    if(!open || !online || cashOnly){setHubtelAvailable(false);return;}
    let active=true;
    setHubtelAvailable(false);
    setPreferredGateway("HUBTEL");
    void getOfflineQueue().authenticatedFetch(
      "/v1/payments/hubtel/readiness?businessId="+encodeURIComponent(businessId),
    ).then(async response=>{
      if(!response.ok)return;
      const data=await response.json() as {enabled?:boolean;preferredProvider?:string};
      if(active){
        setHubtelAvailable(data.enabled===true);
        setPreferredGateway(data.preferredProvider??"HUBTEL");
      }
    }).catch(()=>{if(active)setHubtelAvailable(false);});
    return ()=>{active=false;};
  },[open,online,businessId,cashOnly]);
  if (!open) return null;

  function chooseTender(next:"CASH"|"MOMO"|"CARD"|"CUSTOMER_CREDIT"){
    if (cashOnly && next !== "CASH") return;
    setPaymentMethod(next);
    setHubtelSelected(next==="MOMO"||next==="CARD");
    setCashReceivedMinor(null);setPaidNowMinor(null);
    setSplitWithCredit(false);setVoiceSuggestion(null);
    setVoiceAmountCopied(false);
  }

  function copySpokenCash(){
    if(!voiceSuggestion||!voicePaymentGuide.action||
      voiceSuggestion.tenderedMinor===null)return;
    if(voicePaymentGuide.action==="SPLIT_CASH"){
      if (cashOnly) return;
      setSplitWithCredit(true);
      setPaidNowMinor(voiceSuggestion.tenderedMinor);
      setCashReceivedMinor(voiceSuggestion.tenderedMinor);
    }else if(voicePaymentGuide.action==="CASH_RECEIVED"){
      setSplitWithCredit(false);
      setPaidNowMinor(null);
      setCashReceivedMinor(voiceSuggestion.tenderedMinor);
    }
    setVoiceSuggestion(null);
    setVoiceAmountCopied(true);
  }
  const handleCharge = async (exactCash = false) => {
    // One user gesture is an explicit confirmation that physical cash equal
    // to the verified quoted total was actually collected.
    const exactMode = exactCash && canQuickCash;
    if (!exactCash) {
      if (!canCharge || busy) return;
    } else if (!exactMode || busy) return;
    if (submittingRef.current) return;
    submittingRef.current=true;
    if(online&&!quoteReady){
      submittingRef.current=false;
      setError("Current prices have not been verified. Refresh pricing before charging.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      // Canonical SALE_CREATE contract: identifiers + unit choice + quantity
      // only. The server resolves the current price, tax, stock and posting.
      const payload = buildSaleCreatePayload({
        currencyCode,
        paymentMethod,
        lines: lines.map((l,i) => ({
          itemId: l.sellable.itemId,
          saleUnitCode: l.sellable.unitCode,
          quantity: l.quantity,
          ...(online?{expectedUnitPriceMinor:lineNetMinor(l,i)}:{}),
          ...(selectedApprovals[l.sellable.key]?{
            priceApprovalId:selectedApprovals[l.sellable.key],
          }:{}),
        })),
        ...(customer ? { customerId: customer.id } : {}),
        ...(splitWithCredit?{payments:[
          {method:paymentMethod,amountMinor:amountToCollect},
          {method:"CUSTOMER_CREDIT" as const,amountMinor:creditMinor},
        ]}:{}),
      });

      if(hubtelSelected) {
        (payload as Record<string,unknown>).paymentProvider="HUBTEL";
      }
      const signature=JSON.stringify({businessId,branchId,payload});
      const mutation=attemptedSaleRef.current?.signature===signature?
        attemptedSaleRef.current.mutation:
        queue.build({
          businessId,
          branchId,
          mutationType: "SALE_CREATE",
          payload,
        });
      attemptedSaleRef.current={signature,mutation};

      if (online) {
        // Direct sync push for immediate feedback.
        const res = await queue.authenticatedFetch("/v1/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mutations: [mutation] }),
        });
        if (!res.ok) {
          throw new Error(await readApiErrorMessage(res, "Sale failed"));
        }
        const json = (await res.json()) as SyncResponse;
        const mr = json.mutationResults[0];
        if (!mr) throw new Error("Server did not return a sale result.");
        if (mr.status === "REJECTED") {
          throw new Error(mr.errorMessage ?? mr.errorCode ?? "Sale was rejected by the server.");
        }
        if (mr.status === "RECEIVED") {
          // Queued server-side but not yet applied — treat as pending.
          setResult({
            status: "pending",
            reference: mutation.clientMutationId,
            changeMinor: paymentMethod === "CASH" ? changeMinor : null,
            totalMinor,
            message: "Sale received and is being processed.",
          });
          return;
        }
        // APPLIED — extract receipt reference from the result if present.
        const resultData = mr.result as {saleId?:string;receiptNo?:string;
          totalMinor?:number;status?:string}|undefined;
        if(hubtelSelected) {
          if(resultData?.status!=="AWAITING_PAYMENT"||!resultData.saleId) {
            throw new Error("Hubtel sale was not confirmed as pending. Check Sales before retrying.");
          }
          const saleId=resultData.saleId;
          setResult({status:"pending",reference:saleId,changeMinor:null,paymentPending:true,
            totalMinor:resultData.totalMinor??totalMinor,
            message:"Sale created but not yet paid. Open Sales to resume or verify checkout."});
          try {
            const response=await queue.authenticatedFetch(
              "/v1/sales/"+encodeURIComponent(saleId)+"/hubtel/checkout",{
                method:"POST",headers:{"Content-Type":"application/json"},
                body:JSON.stringify({businessId,clientRequestId:crypto.randomUUID()}),
              });
            if(!response.ok)throw new Error(await readApiErrorMessage(response));
            const data=await response.json() as {checkout:{saleId:string;checkoutUrl:string|null}};
            if(data.checkout.saleId!==saleId||!data.checkout.checkoutUrl) {
              throw new Error("Hubtel checkout link is missing or mismatched.");
            }
            const target=new URL(data.checkout.checkoutUrl);
            if(target.protocol!=="https:"||target.hostname!=="pay.hubtel.com"||
               target.username||target.password||target.port||target.hash) {
              throw new Error("Hubtel returned an untrusted checkout link.");
            }
            window.location.assign(target.toString());
          }catch(error) {
            setResult({status:"pending",reference:saleId,changeMinor:null,paymentPending:true,
              totalMinor:resultData.totalMinor??totalMinor,
              message:"The sale is awaiting payment. "+
                (error instanceof Error?error.message:"Could not open Hubtel.")+
                " Open Sales to resume checkout; do not create a duplicate sale."});
          }
          return;
        }
        if (exactMode && !mayStartNextQuickServeCustomer({
          source:"SERVER",mutationStatus:mr.status,
          saleStatus:resultData?.status??null,
        })) {
          setResult({status:"pending",
            reference:resultData?.saleId??mutation.clientMutationId,
            changeMinor:null,totalMinor:resultData?.totalMinor??totalMinor,
            message:"The server has not confirmed this as a completed cash sale. Review Sales before serving the next customer."});
          return;
        }
        if (exactMode) {
          notifyAction({tone:"success",title:"Cash sale recorded",
            message:"The sale was confirmed. Ready for the next customer. Find the receipt under Sales."});
          onComplete();
          return;
        }
        // APPLIED acknowledges the sync mutation, not necessarily a final
        // sale. Never offer a receipt for an unconfirmed domain result.
        if (resultData?.status !== "COMPLETED" || !resultData.saleId) {
          setResult({status:"pending",
            reference:resultData?.saleId??mutation.clientMutationId,
            changeMinor:null,totalMinor:resultData?.totalMinor??totalMinor,
            message:"The server has not confirmed a completed sale. Review Sales before charging again."});
          return;
        }
        setResult({
          status: "completed",
          reference: resultData.saleId,
          changeMinor: paymentMethod === "CASH" ? changeMinor : null,
          totalMinor: resultData?.totalMinor ?? totalMinor,
          message: "Sale complete.",
          receiptAvailable: Boolean(resultData?.saleId),
        });
      } else {
        // Offline — enqueue and surface the queued reference.
        const stored = await queue.enqueue(mutation);
        if (!mayStartNextQuickServeCustomer({
          source:"OFFLINE",locallyPersisted:stored,
        })) throw new Error("The offline sale was not added to the local queue. Review pending sales before trying again.");
        if (exactMode) {
          notifyAction({tone:"info",title:"Cash sale saved offline",
            message:"Saved on this device for sync. It is not yet server-confirmed. Ready for the next customer."});
          onComplete();
          return;
        }
        setResult({
          status: "pending",
          reference: mutation.clientMutationId,
          changeMinor: paymentMethod === "CASH" ? changeMinor : null,
          totalMinor,
          message: "You are offline. Sale queued locally and will sync automatically.",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sale could not be completed.");
    } finally {
      submittingRef.current=false;
      setBusy(false);
    }
  };

  const handlePrint = () => {
    if (result?.status !== "completed" || !result.receiptAvailable) return;
    const path = receiptUrl(result.reference);
    // Navigate in the current window: native desktop and mobile webviews may
    // silently block new popups, leaving an apparently blank receipt.
    if (path) window.location.assign(path);
  };

  const handleShare = async () => {
    if(result?.status!=="completed" || !result.receiptAvailable)return;
    try {
      const outcome=await shareVerifiedReceiptPdf(result.reference,businessId,loadReceiptPaper(businessId,branchId));
      if(outcome==="downloaded")notifyAction({tone:"info",title:"Receipt PDF downloaded",
        message:"Attach the downloaded PDF in your preferred sharing app."});
      else if(outcome==="shared")notifyAction({tone:"success",title:"PDF ready for sharing",
        message:"The verified receipt PDF was handed to the sharing app."});
    } catch(error){
      notifyAction({tone:"error",message:error instanceof Error?error.message:"Could not share receipt PDF."});
    }
  };

  // A submitted sale is no longer an editable cart, even while awaiting
  // sync/payment. Closing its result must not re-open the original basket.
  const closeCheckout = () => {
    if (busy || submittingRef.current) return;
    if (result) onComplete();
    else onClose();
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={closeCheckout} aria-hidden="true" />
      <div className="tos-sheet tos-sheet--wide tos-sheet--fullscreen" role="dialog" aria-label="Checkout">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Checkout</span>
            <h2 className="tos-sheet__title">{result?.paymentPending?"Payment pending":result?.status==="completed"?"Sale complete":result?"Sale queued":"Take payment"}</h2>
            <p className="tos-sheet__sub">
              {online ? "Online — ready to process" : "Offline — sale will queue locally"}
            </p>
          </div>
          <button type="button" className="tos-sheet__close"
            onClick={closeCheckout} disabled={busy} aria-label="Close checkout">
            <IconClose style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div className="tos-sheet__body">
          {result ? (
            <SuccessPanel
              result={result}
              online={online}
              currencyCode={currencyCode}
              onPrint={handlePrint}
              onShare={handleShare}
              onNewSale={onComplete}
            />
          ) : (
            <>
              <section className="tos-section">
                <div className="tos-section__head">
                  <h3 className="tos-section__title">Order summary</h3>
                  <span className="tos-section__sub">
                    {lines.reduce((n, l) => n + l.quantity, 0)} item(s) · {lines.length} line(s)
                  </span>
                </div>
                <div className="tos-section__body">
                  <ul className="tos-checkout-lines">
                    {lines.map((l) => (
                      <li key={l.sellable.key} className="tos-checkout-lines__row">
                        <div className="tos-checkout-lines__main">
                          <span className="tos-checkout-lines__title">{l.sellable.name}</span>
                          <span className="tos-checkout-lines__sub">
                            {l.quantity} × {l.sellable.unitLabel} · {formatMoney(lineNetMinor(l,
                              lines.findIndex(x=>x.sellable.key===l.sellable.key)),currencyCode)}
                          </span>
                        </div>
                        <span className="tos-checkout-lines__amount">
                          <MoneyValue minor={Math.round(lineNetMinor(l,
                            lines.findIndex(x=>x.sellable.key===l.sellable.key))*l.quantity)}
                            currencyCode={currencyCode} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              <div className="tos-amount-display" aria-label="Amount due">
                <span className="tos-amount-display__label">Amount due</span>
                <span className="tos-amount-display__val">{formatMoney(totalMinor, currencyCode)}</span>
                <span className="tos-amount-display__sub">
                  {lines.length} line(s) · pricing confirmed by server
                </span>
              </div>

              {quickCheckout ? (
                <section className="tos-quick-checkout" aria-label="Quick Serve cash collection"
                  style={{display:"grid",gap:12,padding:16,borderRadius:14,
                    border:"1px solid var(--tos-border,#d4dfe9)"}}>
                  <p style={{margin:0,fontSize:14,fontWeight:700}}>
                    Walk-in customer · exact cash received
                  </p>
                  {online&&quotePending?<p role="status" className="tos-callout">
                    Verifying current prices and stock before recording…</p>:null}
                  {online&&quoteError?<p role="alert" className="tos-callout">
                    Cannot record this cash sale yet: {quoteError}</p>:null}
                  {!online?<p role="status" className="tos-callout">
                    Offline: save this sale on this device first. The server will verify pricing,
                    stock and accounting on sync. Keep the device until it has synced.</p>:null}
                  {error?<div className="tos-banner tos-banner--danger" role="alert">
                    {error}</div>:null}
                  <button type="button" disabled={!canQuickCash||busy}
                    onClick={()=>void handleCharge(true)}
                    style={{minHeight:62,fontSize:19,fontWeight:900,border:0,
                      borderRadius:12,cursor:canQuickCash?"pointer":"not-allowed",
                      background:"var(--tos-accent,#c68f32)",color:"#151718",
                      opacity:busy||!canQuickCash?0.5:1}}>
                    {busy?"Saving sale…":online?
                      "Cash paid · Save "+formatMoney(totalMinor,currencyCode)+" & next customer":
                      "Cash paid · Save offline "+formatMoney(totalMinor,currencyCode)}
                  </button>
                  <button type="button" disabled={busy} onClick={()=>{
                    setQuickManual(true);setCashReceivedMinor(null);
                  }} style={{minHeight:44,padding:10,borderRadius:10,fontWeight:800,
                    border:"1px solid var(--tos-border,#d4dfe9)",
                    color:"inherit",background:"transparent",cursor:"pointer"}}>
                    {cashOnly ? "Count cash/change or print receipt" :
                      "Customer gave different cash / MoMo / credit / print receipt"}
                  </button>
                  <p style={{margin:0,fontSize:12,opacity:.8}}>
                    Press Cash paid only after receiving the money. A rejected sale stays open;
                    a pending electronic payment is never treated as cash.
                  </p>
                </section>
              ) : <>
              {!cashOnly ? <CustomerPicker customers={customers} selected={customer}
                onSelect={c=>{
                  setCustomer(c);setSelectedApprovals({});
                  setCashReceivedMinor(null);setPaidNowMinor(null);
                  setSplitWithCredit(false);setVoiceSuggestion(null);
                  setVoiceAmountCopied(false);
                }}/> : null}
              {online&&quotePending?<p className="tos-callout" role="status">
                Verifying current customer prices with the server…</p>:null}
              {online&&quoteError?<p className="tos-callout" role="alert">
                Price verification unavailable: {quoteError}. Charging is paused
                until a valid server quote is available.</p>:null}
              {!online&&customer?<p className="tos-callout">
                Customer prices are offline estimates and may differ from a
                negotiated rate. Reconnect before giving a binding price.</p>:null}
              {online && !cashOnly?<section className="tos-section">
                <div className="tos-section__head">
                  <h3 className="tos-section__title">Approved price exceptions</h3>
                  <button type="button" style={{padding:"7px 10px",
                    borderRadius:8,background:"transparent",cursor:"pointer"}}
                    onClick={()=>setReviewVersion(v=>v+1)}>
                    Refresh prices & approvals
                  </button>
                </div>
                <div className="tos-section__body tos-checkout-approvals">
                  {lines.map((l,i)=>{
                    const base=quote?.lines[i]?.unitPriceMinor??l.sellable.priceMinor;
                    const usable=approvals.filter(a=>a.status==="APPROVED"&&
                      a.branchId===branchId&&a.customerId===(customer?.id??null)&&
                      a.itemId===l.sellable.itemId&&a.unitCode===l.sellable.unitCode&&
                      a.quantity===l.quantity&&a.baseUnitPriceMinor===base&&
                      a.expiresAt!==null&&Date.parse(a.expiresAt)>Date.now());
                    return <label key={l.sellable.key} style={{display:"grid",gap:5}}>
                      <span style={{fontWeight:750,fontSize:12}}>{l.sellable.name}
                        {" "}({l.quantity} × {l.sellable.unitLabel}) —{" "}
                        {formatMoney(base,currencyCode)}</span>
                      <select value={selectedApprovals[l.sellable.key]??""}
                        onChange={e=>{setSelectedApprovals(old=>({
                          ...old,[l.sellable.key]:e.target.value}));
                          setCashReceivedMinor(null);setPaidNowMinor(null);}}
                        style={{padding:10,borderRadius:8,maxWidth:"100%"}}>
                        <option value="">Use normal / customer-specific rate</option>
                        {usable.map(a=><option key={a.id} value={a.id}>
                          Approved: {formatMoney(a.requestedUnitPriceMinor,currencyCode)}
                          {" "}· expires {new Date(a.expiresAt!).toLocaleTimeString("en-GB")}
                        </option>)}
                      </select>
                    </label>;
                  })}
                  <a href="/pricing" className="tos-checkout-approval-link">
                    Request a new discount or view approval status
                  </a>
                </div>
              </section>:null}

              <div className="tos-field">
                <span className="tos-field__label">Payment method</span>
                <div className="tos-pay-cards tos-pay-cards--primary" role="group" aria-label="Payment method">
                  <button type="button" className="tos-pay-card"
                    aria-pressed={!hubtelSelected&&paymentMethod==="CASH"}
                    onClick={()=>chooseTender("CASH")}>
                    <span className="tos-pay-card__icon-wrap" aria-hidden="true">
                      <IconBanknote className="tos-pay-card__icon"/>
                    </span>
                    <span className="tos-pay-card__text">
                      <span className="tos-pay-card__label">Cash</span>
                    </span>
                  </button>
                  {!cashOnly ? <button type="button" className="tos-pay-card"
                    aria-pressed={hubtelSelected}
                    onClick={()=>chooseTender("MOMO")}>
                    <span className="tos-pay-card__icon-wrap" aria-hidden="true">
                      <IconSmartphone className="tos-pay-card__icon"/>
                    </span>
                    <span className="tos-pay-card__text">
                      <span className="tos-pay-card__label">Electronic</span>
                    </span>
                  </button> : null}
                  {!cashOnly ?
                  <button type="button" className="tos-pay-card"
                    aria-pressed={!hubtelSelected&&paymentMethod==="CUSTOMER_CREDIT"}
                    onClick={()=>chooseTender("CUSTOMER_CREDIT")}>
                    <span className="tos-pay-card__icon-wrap" aria-hidden="true">
                      <IconWallet className="tos-pay-card__icon"/>
                    </span>
                    <span className="tos-pay-card__text">
                      <span className="tos-pay-card__label">Pay later</span>
                    </span>
                  </button> : null}
                </div>
                {hubtelSelected && !cashOnly?<section className="tos-section"
                  aria-label="Electronic payment type">
                  <div className="tos-section__head">
                    <h3 className="tos-section__title">Electronic payment type</h3>
                  </div>
                  <div className="tos-section__body" style={{display:"grid",gap:12}}>
                    <div className="tos-pay-cards" role="group"
                      aria-label="Electronic payment type">
                      <button type="button" className="tos-pay-card"
                        aria-pressed={paymentMethod==="MOMO"}
                        onClick={()=>chooseTender("MOMO")}>
                        <span className="tos-pay-card__icon-wrap" aria-hidden="true">
                          <IconSmartphone className="tos-pay-card__icon"/>
                        </span>
                        <span className="tos-pay-card__text">
                          <span className="tos-pay-card__label">Mobile money</span>
                          <span className="tos-pay-card__sub">MTN · Telecel · AirtelTigo</span>
                        </span>
                      </button>
                      <button type="button" className="tos-pay-card"
                        aria-pressed={paymentMethod==="CARD"}
                        onClick={()=>chooseTender("CARD")}>
                        <span className="tos-pay-card__icon-wrap" aria-hidden="true">
                          <IconCreditCard className="tos-pay-card__icon"/>
                        </span>
                        <span className="tos-pay-card__text">
                          <span className="tos-pay-card__label">Bank card</span>
                          <span className="tos-pay-card__sub">
                            Secure card authentication by {gatewayName}
                          </span>
                        </span>
                      </button>
                    </div>
                    <p role="status" style={{fontSize:13}}>
                      {paymentMethod==="MOMO"?
                        gatewayName+" collects the customer's mobile number and network, then requests the customer to authorize payment on their phone.":
                        "Card details and bank approval must be handled only by the selected secure provider. Never enter card details in TradeOS."}
                    </p>
                    {!hubtelAvailable?<p role="alert" className="tos-callout">
                      {gatewayName} electronic collection is not enabled for
                      this business. No prompt or card charge will be sent.
                      Open Settings → Payment providers to review your selection
                      and complete merchant verification.
                    </p>:null}
                  </div>
                </section>:null}

              </div>

              {voiceSuggestion && !cashOnly?<section className="tos-section"
                aria-label="Review spoken payment suggestion">
                <div className="tos-section__head">
                  <h3 className="tos-section__title">Spoken payment — review required</h3>
                </div>
                <div className="tos-section__body" style={{display:"grid",gap:11}}>
                  {voiceSuggestion.tenderedMinor!==null?<p>
                    Recognized amount: <strong>{formatMoney(
                      voiceSuggestion.tenderedMinor,currencyCode)}</strong>.
                    Speech is not proof that money was received.
                  </p>:null}
                  <p role="status">{voicePaymentGuide.message}</p>
                  {voicePaymentGuide.action?<button type="button"
                    style={{justifySelf:"start",padding:"10px 13px",
                      fontWeight:800,borderRadius:8,cursor:"pointer",
                      border:"1px solid #174f79",background:"#174f79",color:"#fff"}}
                    onClick={copySpokenCash}>
                    {voicePaymentGuide.action==="SPLIT_CASH"?
                      "Use spoken amount for cash + credit split":
                      "Use spoken amount as cash received"}
                  </button>:null}
                  <p style={{fontSize:12}}>
                    You must review the customer, final prices, payment details and
                    remaining balance before charging. Electronic payments are never
                    marked as received by a voice command.
                  </p>
                </div>
              </section>:null}
              {voiceAmountCopied?<p role="status" className="tos-callout">
                Spoken amount copied for review only. Check the physical cash
                and any customer credit before pressing Charge.
              </p>:null}
              {!cashOnly && customer?.active&&availableCreditMinor!==null&&
                !hubtelSelected&&paymentMethod!=="CUSTOMER_CREDIT"?
                <section className="tos-section">
                  <label style={{display:"flex",alignItems:"center",gap:9,
                    cursor:"pointer",fontWeight:750}}>
                    <input type="checkbox" checked={splitWithCredit}
                      onChange={e=>{
                        setSplitWithCredit(e.target.checked);
                        setPaidNowMinor(null);
                        setCashReceivedMinor(null);
                      }}/>
                    Customer paid part — put the balance on credit
                  </label>
                  {splitWithCredit?<div style={{display:"grid",gap:10,
                    paddingTop:12}}>
                    <MoneyInput currencyCode={currencyCode}
                      valueMinor={paidNowMinor} onChange={setPaidNowMinor}
                      label="Amount paid now" placeholder="0"/>
                    <p role="status" style={{fontSize:13}}>
                      Balance on customer credit: {formatMoney(
                        Math.max(0,creditMinor),currencyCode)}
                    </p>
                    <p style={{fontSize:12}}>Credit available:
                      {" "}{formatMoney(availableCreditMinor,currencyCode)}.
                      An online server check confirms the final credit limit.
                      If the authoritative selling price has changed, checkout
                      will reject a mismatched split rather than silently adjust it.
                    </p>
                  </div>:null}
                </section>:null}
              {!cashOnly && paymentMethod==="CUSTOMER_CREDIT"?
                <p role="status" className="tos-callout">
                  Pay later requires an active selected customer with available
                  credit and an online credit-limit check. It creates a receivable,
                  not a cash or MoMo payment.
                </p>:null}
              {hubtelSelected?<p role="status" className="tos-callout">
                Hubtel will open a secure {paymentMethod==="CARD"?"card":"mobile money"}
                payment page. The sale remains unpaid until independent Hubtel
                verification. Use Sales to resume; never create duplicate payments.
              </p>:null}

              {paymentMethod === "CASH" ? (
                <>
                  <MoneyInput
                    currencyCode={currencyCode}
                    valueMinor={cashReceivedMinor}
                    onChange={setCashReceivedMinor}
                    label="Cash received"
                    placeholder="0"
                    size="lg"
                  />
                  <div className="tos-kv">
                    <span className="tos-kv__key">Change due</span>
                    <span className="tos-kv__val">
                      {changeMinor !== null && changeMinor >= 0 ? (
                        <MoneyValue minor={changeMinor} currencyCode={currencyCode} tone="positive" size="lg" />
                      ) : (
                        <span className="tos-money-value tos-money-value--muted">—</span>
                      )}
                    </span>
                  </div>
                  <div className="tos-quick-cash" role="group" aria-label="Quick cash amounts">
                    {[amountToCollect, amountToCollect * 2,
                      roundToNextCashUnit(amountToCollect, currencyCode)].map((amt, i) => (
                      <button
                        key={i}
                        type="button"
                        className="tos-quick-cash__btn"
                        aria-pressed={cashReceivedMinor === amt}
                        onClick={() => setCashReceivedMinor(amt)}
                      >
                        {formatMoney(amt, currencyCode)}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {error ? (
                <div className="tos-banner tos-banner--danger" role="alert">
                  <span className="tos-banner__title">{error}</span>
                </div>
              ) : null}
              </>}
            </>
          )}
        </div>

        {!result&&!quickCheckout ? (
          <div className="tos-sheet__foot">
            <Button variant="ghost" onClick={closeCheckout} disabled={busy}>Cancel</Button>
            <Button
              variant="gold"
              size="lg"
              onClick={()=>void handleCharge()}
              loading={busy}
              disabled={!canCharge}
            >
              {hubtelSelected?`Request Hubtel payment ${formatMoney(totalMinor,currencyCode)}`:`Charge ${formatMoney(totalMinor,currencyCode)}`}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function SuccessPanel({
  result,
  online,
  currencyCode,
  onPrint,
  onShare,
  onNewSale,
}: {
  result: SaleResult;
  online: boolean;
  currencyCode: string;
  onPrint: () => void;
  onShare: () => void;
  onNewSale: () => void;
}) {
  const pending = result.status !== "completed";
  return (
    <div className={`tos-success${pending ? " tos-success--pending" : ""}`}>
      <div className="tos-success__check" aria-hidden="true">
        {pending ? (
          <IconCloudOff className="tos-success__check-icon" />
        ) : (
          <IconCheck className="tos-success__check-icon" />
        )}
      </div>
      <span
        className={
          pending
            ? "tos-success__status-row tos-success__status-row--pending"
            : "tos-success__status-row"
        }
      >
        <span className="tos-success__status-row-dot" aria-hidden="true" />
        {result.paymentPending?"Awaiting verified Hubtel payment":pending?(online?"Queued — processing":"Queued — will sync when online"):"Synced"}
      </span>
      <h2 className="tos-success__title">
        {result.paymentPending?"Payment not yet confirmed":pending?"Sale queued":"Sale complete"}
      </h2>
      <p className="tos-success__text">{result.message}</p>

      <div className="tos-success__receipt">
        <span className="tos-success__receipt-label">{result.paymentPending?"Unpaid order reference":"Receipt reference"}</span>
        <span className="tos-success__receipt-ref">{result.reference}</span>
        {result.totalMinor !== null ? (
          <>
            <span className="tos-success__receipt-label" style={{ marginTop: "var(--tos-space-2)" }}>Total</span>
            <MoneyValue minor={result.totalMinor} currencyCode={currencyCode} size="lg" />
          </>
        ) : null}
        {result.changeMinor !== null && result.changeMinor > 0 ? (
          <>
            <span className="tos-success__receipt-label" style={{ marginTop: "var(--tos-space-2)" }}>Change due</span>
            <span className="tos-success__receipt-change">
              {formatMoney(result.changeMinor, currencyCode)}
            </span>
          </>
        ) : null}
      </div>

      <div className="tos-success__actions">
        {result.status==="completed" && result.receiptAvailable?<Button variant="outline" icon={<IconPrint className="tos-btn__icon" />} onClick={onPrint}>Print receipt</Button>:null}
        {result.status==="completed" && result.receiptAvailable?<Button variant="outline" icon={<IconShare className="tos-btn__icon" />} onClick={onShare}>Share</Button>:null}
        <Button variant="gold" className="tos-btn--block" onClick={onNewSale}>New sale</Button>
      </div>
    </div>
  );
}

/** Rounds up to the next "natural" cash unit (e.g. nearest 10/50/100) for quick-cash buttons. */
function roundToNextCashUnit(minor: number, currencyCode: string): number {
  const meta = getCurrencyMeta(currencyCode);
  if (!meta) return minor;
  const major = minorToMajor(minor, currencyCode) ?? 0;
  const factor = major >= 100 ? 50 : major >= 20 ? 10 : 5;
  const rounded = Math.ceil(major / factor) * factor;
  const back = majorToMinor(rounded, currencyCode);
  return back ?? minor;
}
