"use client";

import {useEffect,useState} from "react";
import {readSandboxReturn,sandboxSettingsUrl,
  type SandboxReturnContext} from "./return-context";

export default function GatewayTestReturnPage(){
  const [context,setContext]=useState<SandboxReturnContext|null>(null);
  const [parsed,setParsed]=useState(false);
  useEffect(()=>{
    const value=readSandboxReturn(window.location.search);
    setContext(value);setParsed(true);
    // Do not leave provider IDs or status parameters in browser history.
    window.history.replaceState(null,"",window.location.pathname);
  },[]);
  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",
    padding:"clamp(16px,4vw,36px)",background:"var(--tos-color-surface,#f8fafc)"}}>
    <section aria-labelledby="return-title" style={{width:"100%",maxWidth:620,
      border:"1px solid var(--tos-color-border,#cbd5e1)",borderRadius:16,
      padding:"clamp(20px,4vw,36px)",background:"var(--tos-color-bg,#fff)",
      display:"grid",gap:15}}>
      <p style={{margin:0,fontSize:13,fontWeight:700,letterSpacing:1}}>
        TRADEOS · PAYMENT GATEWAY TEST</p>
      <h1 id="return-title" style={{fontSize:"clamp(24px,5vw,34px)",margin:0}}>
        Back from the provider TEST checkout</h1>
      <p role="status" style={{margin:0,lineHeight:1.6}}>
        This return page is <strong>not confirmation of payment</strong>.
        Only an independent server-side provider status check can record
        TEST evidence. No real sale, receipt, cashbook or stock is updated here.</p>
      {!parsed?<p>Reading provider TEST return…</p>:context?<>
        <div style={{border:"1px solid #a7b4c6",borderRadius:10,
          padding:14,display:"grid",gap:8}}>
          <strong>{context.referenceConflict?
            "Provider reference does not match — review required":
            "Provider returned to TradeOS"}</strong>
          <span>Reported status: <strong>{context.providerStatus}</strong>
            {" "}(unverified)</span>
          <span>TEST reference: <code style={{overflowWrap:"anywhere"}}>
            {context.expectedReference}</code></span>
          {context.transactionId&&!context.referenceConflict?
            <span>Provider transaction ID: <code>{context.transactionId}</code></span>:null}
          {context.referenceConflict?<p role="alert" style={{margin:0}}>
            Do not approve or retry payment. Flag the TEST attempt for review.</p>:null}
        </div>
        <a href={sandboxSettingsUrl(context)} style={{display:"inline-block",
          width:"fit-content",padding:"12px 18px",borderRadius:9,
          background:"#17365b",color:"white",textDecoration:"none",fontWeight:700}}>
          Review TEST attempt in Payments</a>
        <small>After signing in, locate the matching TEST attempt and explicitly
          select “Check provider TEST status”. The redirect itself never
          verifies or settles a payment.</small>
      </>:<>
        <p role="alert">The provider return did not contain a valid TradeOS
          TEST attempt context. Do not assume this checkout succeeded.</p>
        <a href="/settings?section=payments">Open payment settings</a>
      </>}
    </section>
  </main>;
}
