"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { projectSellableItems, indexInventory, type SellableItem } from "../../../lib/catalog-read-model";
import { ProductBrowser } from "./product-browser";
import { QuickServe } from "./quick-serve";
import { CartPanel, type CartLine } from "./cart-panel";
import { CheckoutSheet } from "./checkout-sheet";
import { Button } from "../ui/button";
import { IconSell } from "../ui/icons";
import { VoiceSaleAssistant } from "./voice-sale-assistant";
import type { VoicePayment,VoiceCheckoutSuggestion } from "../../../lib/voice-transaction-draft";

export function PosWorkspace() {
  const { catalog, inventory, customers, session, role, queue, bump } = useWorkspace();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [quickMode, setQuickMode] = useState(false);
  const [voiceCustomerId,setVoiceCustomerId]=useState<string|null>(null);
  const [voicePayment,setVoicePayment]=useState<VoicePayment>("UNSPECIFIED");
  const [voicePaymentSuggestion,setVoicePaymentSuggestion]=useState<VoiceCheckoutSuggestion|null>(null);

  const cashOnly = role === "POS_ATTENDANT";
  const currencyCode = session?.currencyCode ?? "GHS";
  const online = queue.online;
  const modeKey = session ?
    "tradeos.pos.quick-mode.v1:"+encodeURIComponent(session.businessId)+":"+
    encodeURIComponent(session.branchId) : null;
  useEffect(() => {
    if (!modeKey) return;
    try { setQuickMode(window.localStorage.getItem(modeKey)==="quick"); }
    catch { setQuickMode(false); }
  }, [modeKey]);
  const selectMode = (quick: boolean) => {
    if (lines.length>0 || checkoutOpen) return;
    setQuickMode(quick);
    if (modeKey) {
      try { window.localStorage.setItem(modeKey,quick?"quick":"standard"); }
      catch { /* Device privacy setting: mode will remain in memory. */ }
    }
  };

  // Canonical sellable projection — one tile per (item, sellable unit with a
  // price). Same semantics as the mobile client (apps/mobile/src/pos-model.ts).
  const sellable = useMemo(
    () => projectSellableItems(catalog, indexInventory(inventory)),
    [catalog, inventory],
  );

  const handlePick = useCallback((item: SellableItem) => {
    setVoicePaymentSuggestion(null);
    setLines((prev) => {
      const existing = prev.find((l) => l.sellable.key === item.key);
      if (existing) {
        return prev.map((l) => (l.sellable.key === item.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { sellable: item, quantity: 1 }];
    });
  }, []);

  const handleInc = useCallback((key: string) => {
    setVoicePaymentSuggestion(null);
    setLines((prev) => prev.map((l) => (l.sellable.key === key ? { ...l, quantity: l.quantity + 1 } : l)));
  }, []);

  const handleDec = useCallback((key: string) => {
    setVoicePaymentSuggestion(null);
    setLines((prev) =>
      prev
        .map((l) => (l.sellable.key === key ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const handleRemove = useCallback((key: string) => {
    setVoicePaymentSuggestion(null);
    setLines((prev) => prev.filter((l) => l.sellable.key !== key));
  }, []);

  const handleClear = useCallback(() => {
    setVoicePaymentSuggestion(null);
    setLines([]);
  }, []);

  const openCheckout = useCallback(() => {
    setCartOpen(false);
    setCheckoutOpen(true);
  }, []);

  const handleComplete = useCallback(() => {
    setVoiceCustomerId(null);
    setVoicePayment("UNSPECIFIED");
    setVoicePaymentSuggestion(null);
    setLines([]);
    setCheckoutOpen(false);
    setCartOpen(false);
    bump();
  }, [bump]);

  // Surface "in cart" quantities on product tiles.
  const cartQuantities = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of lines) m[l.sellable.key] = l.quantity;
    return m;
  }, [lines]);

  const totalMinor = useMemo(
    () => lines.reduce((sum, l) => sum + l.sellable.priceMinor * l.quantity, 0),
    [lines],
  );
  const itemCount = useMemo(() => lines.reduce((sum, l) => sum + l.quantity, 0), [lines]);

  if (!session) return null;

  return (
    <div className="tos-page">
      <header className="tos-page__head">
        <div className="tos-page__heading">
          <span className="tos-page__eyebrow">TradeOS · Point of sale</span>
          <h1 className="tos-page__title">Sell</h1>
          <p className="tos-page__subtitle">
            {quickMode ? "One screen, large food buttons, no customer form for walk-in cash sales."
              : "Tap products to build a cart. Prices and stock are verified at checkout."}
          </p>
        </div>
      </header>

      <div role="group" aria-label="Selling mode"
        style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        <button type="button" aria-pressed={!quickMode}
          onClick={()=>selectMode(false)}
          disabled={lines.length>0||checkoutOpen}
          style={{cursor:lines.length||checkoutOpen?"not-allowed":"pointer",padding:"10px 14px",fontWeight:800,
            borderRadius:10,border:"1px solid var(--tos-border,#cfd8e3)",
            background:!quickMode?"var(--tos-accent,#e0ac44)":"transparent",color:"inherit"}}>
          Standard POS
        </button>
        <button type="button" aria-pressed={quickMode}
          onClick={()=>selectMode(true)}
          disabled={lines.length>0||checkoutOpen}
          style={{cursor:lines.length||checkoutOpen?"not-allowed":"pointer",padding:"10px 14px",fontWeight:800,
            borderRadius:10,border:"1px solid var(--tos-border,#cfd8e3)",
            background:quickMode?"var(--tos-accent,#e0ac44)":"transparent",color:"inherit"}}>
          ⚡ Quick Serve · food & queues
        </button>
        {lines.length>0?<span style={{fontSize:12,alignSelf:"center",opacity:.75}}>
          Finish or clear this order to switch modes
        </span>:null}
      </div>

      {quickMode ? (
        <QuickServe
          businessId={session.businessId}
          branchId={session.branchId}
          sellable={sellable}
          currencyCode={currencyCode}
          lines={lines}
          online={online}
          onPick={handlePick}
          onInc={handleInc}
          onDec={handleDec}
          onClear={handleClear}
          onCheckout={openCheckout}
        />
      ) : <div className="tos-pos">
        <ProductBrowser
          onSpeak={()=>setVoiceOpen(true)}
          items={sellable}
          currencyCode={currencyCode}
          onPick={handlePick}
          cartQuantities={cartQuantities}
        />
        <div className="tos-pos__cart-wrap" data-open={cartOpen}>
          <div className="tos-pos__cart-sheet-handle" aria-hidden="true" />
          <CartPanel
            lines={lines}
            currencyCode={currencyCode}
            onInc={handleInc}
            onDec={handleDec}
            onRemove={handleRemove}
            onClear={handleClear}
            onCheckout={openCheckout}
            online={online}
          />
        </div>
      </div>}

      {/* Mobile sticky charge bar — always visible total + charge. Hidden on desktop via CSS. */}
      {!quickMode ? <div className="tos-charge-bar" aria-label="Cart summary">
        <button
          type="button"
          className="tos-charge-bar__cart-btn"
          onClick={() => setCartOpen(true)}
          aria-label={`View cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
        >
          <IconSell style={{ width: 20, height: 20 }} />
          Cart
          <span className="tos-charge-bar__count">{itemCount}</span>
        </button>
        <div className="tos-charge-bar__info">
          <span className="tos-charge-bar__total">{formatMoney(totalMinor, currencyCode)}</span>
          <span className="tos-charge-bar__sub">
            {itemCount === 0 ? "Cart empty" : `${itemCount} item${itemCount === 1 ? "" : "s"}`}
          </span>
        </div>
        <Button
          variant="gold"
          className="tos-charge-bar__charge"
          onClick={openCheckout}
          disabled={lines.length === 0}
          icon={<IconSell className="tos-btn__icon" />}
        >
          Charge
        </Button>
      </div> : null}

      {/* Mobile cart sheet scrim. */}
      <div
        className="tos-pos__cart-scrim"
        data-open={cartOpen}
        onClick={() => setCartOpen(false)}
        aria-hidden="true"
      />

      {voiceOpen?<VoiceSaleAssistant
        sellable={sellable} customers={customers} currencyCode={currencyCode}
        onClose={()=>setVoiceOpen(false)}
        onApply={(reviewed,customerId,payment,suggestion)=>{
          if(lines.length>0&&!window.confirm(
            "You have items in your cart. Add the voice-selected items to this cart?")){
            return false;
          }
          setLines(prev=>{
            const next=[...prev];
            for(const line of reviewed){
              const index=next.findIndex(x=>x.sellable.key===line.sellable.key);
              if(index>=0){
                next[index]={...next[index]!,quantity:next[index]!.quantity+line.quantity};
              } else next.push(line);
            }
            return next;
          });
          setVoiceCustomerId(customerId);
          setVoicePayment(payment);
          // Do not reuse a spoken amount for a cart that already contained
          // other products: the amount was dictated for a different total.
          setVoicePaymentSuggestion(lines.length===0?suggestion:null);
          setCartOpen(true);
          return true;
        }}
      />:null}
      <CheckoutSheet
        cashOnly={cashOnly}
        quickServe={quickMode}
        initialCustomerId={voiceCustomerId}
        initialPaymentMethod={voicePayment}
        initialVoicePaymentSuggestion={voicePaymentSuggestion}
        open={checkoutOpen}
        lines={lines}
        currencyCode={currencyCode}
        businessId={session.businessId}
        branchId={session.branchId}
        customers={customers}
        online={online}
        onClose={() => setCheckoutOpen(false)}
        onComplete={handleComplete}
      />
    </div>
  );
}
