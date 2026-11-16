"use client";

import { useEffect, useState } from "react";
import { formatMoney, majorToMinor, minorToMajor, getCurrencyMeta } from "@tradeos/contracts";
import type { SyncResponse } from "@tradeos/contracts";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { receiptUrl } from "../../../lib/receipt-document";
import { buildSaleCreatePayload, type PaymentMethod } from "../../../lib/mutation-builders";
import type { CartLine } from "./cart-panel";
import type { VoicePayment } from "../../../lib/voice-transaction-draft";
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
  IconBuilding,
  IconWallet,
  IconCloudOff,
} from "../ui/icons";
import type { Customer } from "../workspace/workspace-provider";

type PayMethodDef = { value: PaymentMethod; label: string; sub: string; Icon: typeof IconBanknote };

const PAYMENT_METHODS: ReadonlyArray<PayMethodDef> = [
  { value: "CASH", label: "Cash", sub: "Notes & coins", Icon: IconBanknote },
  { value: "MOMO", label: "Mobile money", sub: "MTN, Vodafone, Airtel", Icon: IconSmartphone },
  { value: "CARD", label: "Card", sub: "POS terminal", Icon: IconCreditCard },
  { value: "BANK", label: "Bank transfer", sub: "Direct deposit", Icon: IconBuilding },
  { value: "CUSTOMER_CREDIT", label: "Pay later", sub: "Approved customer credit", Icon: IconWallet },
  { value: "OTHER", label: "Other", sub: "Manual payment", Icon: IconWallet },
];

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
}: CheckoutSheetProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [hubtelSelected,setHubtelSelected] = useState(false);
  const [hubtelAvailable,setHubtelAvailable] = useState(false);
  const [cashReceivedMinor, setCashReceivedMinor] = useState<number | null>(null);
  const [splitWithCredit,setSplitWithCredit]=useState(false);
  const [paidNowMinor,setPaidNowMinor]=useState<number|null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);

  // Display-only total — the server prices every sale from its own catalog.
  const totalMinor = lines.reduce((sum, l) => sum + l.sellable.priceMinor * l.quantity, 0);
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
  const canCharge = lines.length>0&&(!hubtelSelected||online)&&
    splitValid&&creditReady&&(paymentMethod!=="CUSTOMER_CREDIT"||online)&&
    (paymentMethod!=="CASH" || (cashReceivedMinor!==null &&
      cashReceivedMinor>=amountToCollect));

  // Reset state when the sheet opens.
  useEffect(() => {
    if (open) {
      const voiceMethod = initialPaymentMethod === "CREDIT"?"CUSTOMER_CREDIT":
        initialPaymentMethod && initialPaymentMethod!=="UNSPECIFIED"?
          initialPaymentMethod:"CASH";
      setPaymentMethod(voiceMethod);
      setHubtelSelected(false);
      setCashReceivedMinor(null);
      setSplitWithCredit(false);
      setPaidNowMinor(null);
      setCustomer(customers.find(c=>c.id===initialCustomerId&&c.active)??null);
      setBusy(false);
      setError(null);
      setResult(null);
    }
  }, [open,initialCustomerId,initialPaymentMethod,customers]);

  useEffect(()=>{
    if(!open || !online){setHubtelAvailable(false);return;}
    let active=true;
    void getOfflineQueue().authenticatedFetch(
      "/v1/payments/hubtel/readiness?businessId="+encodeURIComponent(businessId),
    ).then(async response=>{
      if(!response.ok)return;
      const data=await response.json() as {enabled?:boolean};
      if(active)setHubtelAvailable(data.enabled===true);
    }).catch(()=>{if(active)setHubtelAvailable(false);});
    return ()=>{active=false;};
  },[open,online,businessId]);
  if (!open) return null;

  const handleCharge = async () => {
    if (!canCharge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const queue = getOfflineQueue();
      // Canonical SALE_CREATE contract: identifiers + unit choice + quantity
      // only. The server resolves the current price, tax, stock and posting.
      const payload = buildSaleCreatePayload({
        currencyCode,
        paymentMethod,
        lines: lines.map((l) => ({
          itemId: l.sellable.itemId,
          saleUnitCode: l.sellable.unitCode,
          quantity: l.quantity,
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
      const mutation = queue.build({
        businessId,
        branchId,
        mutationType: "SALE_CREATE",
        payload,
      });

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
        setResult({
          status: "completed",
          reference: resultData?.saleId ?? resultData?.receiptNo ?? mutation.clientMutationId,
          changeMinor: paymentMethod === "CASH" ? changeMinor : null,
          totalMinor: resultData?.totalMinor ?? totalMinor,
          message: "Sale complete.",
          receiptAvailable: Boolean(resultData?.saleId),
        });
      } else {
        // Offline — enqueue and surface the queued reference.
        await queue.enqueue(mutation);
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
    if (typeof navigator === "undefined" || !navigator.share) return;
    try {
      await navigator.share({
        title: "TradeOS receipt",
        text: `Receipt ${result?.reference ?? ""}`,
      });
    } catch {
      // user cancelled — ignore
    }
  };

  return (
    <>
      <div className="tos-sheet-scrim" onClick={onClose} aria-hidden="true" />
      <div className="tos-sheet tos-sheet--wide tos-sheet--fullscreen" role="dialog" aria-label="Checkout">
        <div className="tos-sheet__head">
          <div className="tos-sheet__head-main">
            <span className="tos-sheet__eyebrow">Checkout</span>
            <h2 className="tos-sheet__title">{result?.paymentPending?"Payment pending":result?"Sale complete":"Take payment"}</h2>
            <p className="tos-sheet__sub">
              {online ? "Online — ready to process" : "Offline — sale will queue locally"}
            </p>
          </div>
          <button type="button" className="tos-sheet__close" onClick={onClose} aria-label="Close checkout">
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
                            {l.quantity} × {l.sellable.unitLabel} · {formatMoney(l.sellable.priceMinor, currencyCode)}
                          </span>
                        </div>
                        <span className="tos-checkout-lines__amount">
                          <MoneyValue minor={l.sellable.priceMinor * l.quantity} currencyCode={currencyCode} />
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

              <CustomerPicker customers={customers} selected={customer} onSelect={setCustomer} />

              <div className="tos-field">
                <span className="tos-field__label">Payment method</span>
                <div className="tos-pay-cards" role="group" aria-label="Payment method">
                  {PAYMENT_METHODS.map((m) => {
                    const Icon = m.Icon;
                    return (
                      <button
                        key={m.value}
                        type="button"
                        className="tos-pay-card"
                        aria-pressed={paymentMethod === m.value && !hubtelSelected}
                        onClick={() => {setPaymentMethod(m.value);setHubtelSelected(false);}}
                      >
                        <span className="tos-pay-card__icon-wrap" aria-hidden="true">
                          <Icon className="tos-pay-card__icon" />
                        </span>
                        <span className="tos-pay-card__text">
                          <span className="tos-pay-card__label">{m.label}</span>
                          <span className="tos-pay-card__sub">{m.sub}</span>
                        </span>
                      </button>
                    );
                  })}
                  {hubtelAvailable?<button
                    type="button" className="tos-pay-card"
                    aria-pressed={hubtelSelected}
                    onClick={()=>{setPaymentMethod("MOMO");setHubtelSelected(true);}}
                  >
                    <span className="tos-pay-card__icon-wrap" aria-hidden="true">
                      <IconSmartphone className="tos-pay-card__icon"/>
                    </span>
                    <span className="tos-pay-card__text">
                      <span className="tos-pay-card__label">Pay with Hubtel</span>
                      <span className="tos-pay-card__sub">Online · confirmed before receipt</span>
                    </span>
                  </button>:null}
                </div>
              </div>

              {customer?.active&&availableCreditMinor!==null&&
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
              {paymentMethod==="CUSTOMER_CREDIT"?
                <p role="status" className="tos-callout">
                  Pay later requires an active selected customer with available
                  credit and an online credit-limit check. It creates a receivable,
                  not a cash or MoMo payment.
                </p>:null}
              {hubtelSelected?<p role="status" className="tos-callout">
                Hubtel will open a secure payment page. The order remains unpaid until
                verification; use Sales to resume if the payment page closes.
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
            </>
          )}
        </div>

        {!result ? (
          <div className="tos-sheet__foot">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button
              variant="gold"
              size="lg"
              onClick={handleCharge}
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
