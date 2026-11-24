"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { formatMoney } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { confirmAction } from "../ui/action-dialog";
import { useActionFeedbackMessages } from "../ui/action-feedback";
import styles from "./document-workspace.module.css";

type Kind = "QUOTATION" | "PROFORMA";
type Status = "DRAFT" | "ISSUED" | "CANCELLED";
interface Summary {
  id:string;branchId:string;documentNumber:string;kind:Kind;status:Status;
  customerName:string;currencyCode:string;totalMinor:number;
  expiresAt:string|null;createdAt:string;
}
interface DocumentLineDraft { key:string;itemId:string;unitCode:string;quantity:string }
interface Detail extends Summary {
  customerId:string|null;customerPhone:string|null;customerEmail:string|null;notes:string;updatedAt:string;
  lines:Array<{itemId:string;itemName:string;saleUnitCode:string;quantity:number}>;
}
interface DocumentResponse { document:Detail }
const labelKind=(kind:Kind)=>kind==="QUOTATION"?"Quotation":"Proforma invoice";
function newLine():DocumentLineDraft {
  return {key:crypto.randomUUID(),itemId:"",unitCode:"",quantity:"1"};
}
function formatDate(value:string|null):string {
  return value?new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"2-digit",year:"numeric",
    timeZone:"Africa/Accra"}).format(new Date(value)):"—";
}
export function DocumentWorkspace() {
  const {session,catalog,customers,queue} = useWorkspace();
  const [kind,setKind]=useState<Kind>("QUOTATION");
  const [filter,setFilter]=useState<"ALL"|Kind>("ALL");
  const [customerId,setCustomerId]=useState("");
  const [customerName,setCustomerName]=useState("");
  const [notes,setNotes]=useState("");
  const [expires,setExpires]=useState("");
  const [lines,setLines]=useState<DocumentLineDraft[]>([newLine()]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const requestId=useRef<string|null>(null);
  const scope=session?session.businessId+":"+session.branchId+":"+session.staffId:null;
  const scopeRef=useRef(scope);
  scopeRef.current=scope;
  const [editing,setEditing]=useState<Detail|null>(null);
  const formRef=useRef<HTMLDivElement>(null);
  useActionFeedbackMessages(notice,error);
  const path=session?
    `/v1/commercial-documents?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&limit=100`:null;
  const {data,loading,error:loadError,refetch,setData}=useApiFetch<{documents:Summary[]}>(path);
  function applyDocument(doc:Summary){
    setData(current=>({documents:[doc,...(current?.documents??[]).filter(d=>d.id!==doc.id)]
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100)}));
  }
  const available=useMemo(()=>catalog.filter(i=>i.active&&i.units.some(u=>u.canSell&&u.defaultSalePriceMinor!==null)),[catalog]);
  const currency=session?.currencyCode??"GHS";
  const canWrite=["OWNER","ADMIN","MANAGER","CASHIER","SALES"].includes(session?.role??"");
  const visible=useMemo(()=>data?.documents.filter(d=>filter==="ALL"||d.kind===filter)??[],[data,filter]);
  const itemById=useMemo(()=>new Map(available.map(item=>[item.id,item])),[available]);
  const setLine=(key:string,patch:Partial<DocumentLineDraft>)=>{
    requestId.current=null;
    setLines(current=>current.map(l=>l.key===key?{...l,...patch}:l));
  };
  const allValid=lines.every(l=>Boolean(l.itemId&&l.unitCode)&&Number(l.quantity)>0&&
    Number(l.quantity)<=1_000_000&&Number.isFinite(Number(l.quantity))&&
    itemById.get(l.itemId)?.units.some(u=>u.code===l.unitCode&&u.canSell&&u.defaultSalePriceMinor!==null));
  const estimated=lines.reduce((sum,line)=>{
    const unit=itemById.get(line.itemId)?.units.find(u=>u.code===line.unitCode);
    const qty=Number(line.quantity);
    return sum+(unit?.defaultSalePriceMinor??0)*(Number.isFinite(qty)?qty:0);
  },0);
  const selectedCustomer=customers.find(c=>c.id===customerId);
  function resetForm(){
    setEditing(null);setLines([newLine()]);setNotes("");setExpires("");setCustomerName("");setCustomerId("");
    requestId.current=null;
  }
  useEffect(()=>{resetForm();setError(null);setNotice(null);setBusy(false);},[scope]);
  async function edit(documentId:string){
    if(!session||busy||!queue.online||!canWrite)return;
    setBusy(true);setError(null);setNotice(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(
        `/v1/commercial-documents/${encodeURIComponent(documentId)}?businessId=${encodeURIComponent(session.businessId)}`,
        {cache:"no-store"});
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const {document:detail}=await response.json() as DocumentResponse;
      if(scopeRef.current!==scope)return;
      if(detail.status!=="DRAFT"||detail.branchId!==session.branchId)throw new Error("Only drafts in this branch can be edited.");
      setEditing(detail);setKind(detail.kind);setCustomerId(customers.some(c=>c.id===detail.customerId&&c.active)?detail.customerId??"":"");
      setCustomerName(detail.customerName);setNotes(detail.notes);setExpires(detail.expiresAt?.slice(0,10)??"");
      setLines(detail.lines.map(l=>({key:crypto.randomUUID(),itemId:l.itemId,unitCode:l.saleUnitCode,quantity:String(l.quantity)})));
      requestId.current=null;formRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
    }catch(e){if(scopeRef.current===scope)setError(e instanceof Error?e.message:"Could not open draft");}
    finally{if(scopeRef.current===scope)setBusy(false);}
  }
  async function create() {
    if(!session||!queue.online||!canWrite||busy||!allValid||(!customerId&&!customerName.trim()))return;
    if(expires && new Date(expires+"T23:59:59Z").getTime()<=Date.now()){
      setError("Expiry date must be in the future");return;
    }
    requestId.current??=crypto.randomUUID();
    setError(null);setNotice(null);setBusy(true);
    try {
      const response=await getOfflineQueue().authenticatedFetch(editing?"/v1/commercial-documents/"+encodeURIComponent(editing.id):"/v1/commercial-documents",{
        method:editing?"PATCH":"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          businessId:session.businessId,branchId:session.branchId,
          clientRequestId:requestId.current,kind,
          ...(editing?{expectedUpdatedAt:editing.updatedAt,customerPhone:editing.customerPhone??"",customerEmail:editing.customerEmail??""}:{}),
          ...(customerId?{customerId}:{customerName:customerName.trim()}),
          notes, ...(expires?{expiresAt:expires+"T23:59:59.000Z"}:{}),
          lines:lines.map(line=>({itemId:line.itemId,saleUnitCode:line.unitCode,
            quantity:Number(line.quantity)})),
        }),
      });
      if(!response.ok)throw new Error(await readApiErrorMessage(response,editing?"Could not update document":"Could not create document"));
      const result=await response.json() as DocumentResponse;
      if(scopeRef.current!==scope)return;
      applyDocument(result.document);
      setFilter(current=>current==="ALL"?current:result.document.kind);
      setNotice(`${result.document.documentNumber} ${editing?"updated":"created as a draft"}. Issue it after review.`);
      resetForm();refetch();
    }catch(e){if(scopeRef.current===scope)setError(e instanceof Error?e.message:"Unable to save document");}
    finally{if(scopeRef.current===scope)setBusy(false);}
  }
  async function transition(documentId:string,action:"issue"|"cancel"){
    if(!session||!queue.online||busy)return;
    if(action==="cancel"&&!await confirmAction("Cancel this document? This cannot be undone.",{title:"Cancel document",confirmLabel:"Cancel document",cancelLabel:"Keep document",danger:true}))return;
    if(scopeRef.current!==scope)return;
    setBusy(true);setError(null);setNotice(null);
    try {
      const response=await getOfflineQueue().authenticatedFetch(
        `/v1/commercial-documents/${encodeURIComponent(documentId)}/${action}`,{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({businessId:session.businessId}),
        });
      if(!response.ok)throw new Error(await readApiErrorMessage(response));
      const result=await response.json() as DocumentResponse;
      if(scopeRef.current!==scope)return;
      applyDocument(result.document);
      if(editing?.id===documentId)resetForm();
      setNotice(`${result.document.documentNumber} ${action==="issue"?"issued":"cancelled"}.`);
      refetch();
    }catch(e){if(scopeRef.current===scope)setError(e instanceof Error?e.message:"Could not change document");}
    finally{if(scopeRef.current===scope)setBusy(false);}
  }
  const requestedEdit=useRef<string|null>(null);
  useEffect(()=>{
    const target=new URLSearchParams(window.location.search).get("edit");
    if(!target||requestedEdit.current===target||!data||busy||!queue.online||!canWrite)return;
    if(/^[0-9a-f-]{36}$/i.test(target)){requestedEdit.current=target;void edit(target);}
  },[data,busy,queue.online,canWrite]);
  return (
    <main className={styles.workspace}>
      <header className={styles.heading}>
        <div><p className={styles.eyebrow}>Sales documentation</p>
          <h1>Quotations & proforma invoices</h1>
          <p>Create priced offers without reducing stock or recording payments.</p>
        </div>
        <span className={styles.online}>{queue.online?"Online · ready":"Offline · view only"}</span>
      </header>
      <section className={styles.layout}>
        <div className={styles.panel} ref={formRef}>
          <h2>{editing?`Edit ${editing.documentNumber}`:"New document"}</h2>
          <p className={styles.hint}>Catalog prices are confirmed by the server when saving. Editing a draft recalculates at current catalog prices. Tax is not added unless configured by the sales tax system.</p>
          <label className={styles.field}>Document type
            <select aria-label="Document type" value={kind} disabled={Boolean(editing)} onChange={e=>{setKind(e.target.value as Kind);requestId.current=null;}}>
              <option value="QUOTATION">Quotation</option>
              <option value="PROFORMA">Proforma invoice</option>
            </select>
          </label>
          <label className={styles.field}>Existing customer
            <select aria-label="Existing customer" value={customerId} onChange={e=>{setCustomerId(e.target.value);requestId.current=null;}}>
              <option value="">Walk-in / new customer</option>
              {customers.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {!selectedCustomer?<label className={styles.field}>Customer name
            <input maxLength={180} value={customerName} onChange={e=>{setCustomerName(e.target.value);requestId.current=null;}} placeholder="Business or customer name" />
          </label>:<div className={styles.selection}>Customer: <strong>{selectedCustomer.name}</strong></div>}
          <h3>Products & services</h3>
          {lines.map((line,index)=>{
            const item=itemById.get(line.itemId);
            const units=item?.units.filter(u=>u.canSell&&u.defaultSalePriceMinor!==null)??[];
            return <div className={styles.line} key={line.key}>
              <label className={styles.field}>Item {index+1}
                <select aria-label={`Item ${index+1}`} value={line.itemId} onChange={e=>{
                  const next=itemById.get(e.target.value);
                  const unit=next?.units.find(u=>u.canSell&&u.defaultSalePriceMinor!==null);
                  setLine(line.key,{itemId:e.target.value,unitCode:unit?.code??""});
                }}>
                  <option value="">Choose item</option>
                  {line.itemId&&!item?<option value={line.itemId}>{editing?.lines.find(l=>l.itemId===line.itemId)?.itemName??"Item"} (unavailable — replace)</option>:null}
                  {available.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <div className={styles.lineInputs}>
                <label className={styles.field}>Sale unit
                  <select aria-label={`Sale unit ${index+1}`} value={line.unitCode} onChange={e=>setLine(line.key,{unitCode:e.target.value})}>
                    {line.unitCode&&!units.some(u=>u.code===line.unitCode)?<option value={line.unitCode}>{line.unitCode} (unavailable)</option>:null}
                    {units.length===0?<option value="">Select item</option>:
                      units.map(unit=><option key={unit.code} value={unit.code}>{unit.label}</option>)}
                  </select>
                </label>
                <label className={styles.field}>Quantity
                  <input aria-label={`Quantity ${index+1}`} type="number" min="0.00000001" max="1000000" step="any" value={line.quantity}
                    onChange={e=>setLine(line.key,{quantity:e.target.value})}/>
                </label>
              </div>
              {lines.length>1?<button className={styles.smallButton} type="button"
                onClick={()=>{setLines(current=>current.filter(l=>l.key!==line.key));requestId.current=null;}}>
                Remove item</button>:null}
            </div>;
          })}
          <button type="button" className={styles.secondary} onClick={()=>{setLines(v=>v.length<50?[...v,newLine()]:v);requestId.current=null;}}>+ Add another item</button>
          <label className={styles.field}>Valid until (optional)
            <input type="date" value={expires} onChange={e=>{setExpires(e.target.value);requestId.current=null;}} />
          </label>
          <label className={styles.field}>Notes / terms
            <textarea rows={3} maxLength={2000} value={notes} onChange={e=>{setNotes(e.target.value);requestId.current=null;}}
              placeholder="Delivery terms, validity or special conditions"/>
          </label>
          <div className={styles.estimate}><span>Estimated amount</span><strong>{formatMoney(Math.round(estimated),currency)}</strong></div>
          <p className={styles.hint}>Final amount is calculated by the API from your current catalog; this preview can differ if prices change.</p>
          <button type="button" className={styles.primary} disabled={!canWrite||busy||!queue.online||!allValid||(!customerId&&!customerName.trim())}
            onClick={()=>void create()}>{busy?"Processing…":editing?"Save changes":"Create draft"}</button>
          {editing?<button type="button" className={styles.secondary} disabled={busy} onClick={async()=>{if(await confirmAction("Discard unsaved draft changes?"))resetForm();}}>Cancel editing</button>:null}
          {!queue.online?<p role="status">Connect to the internet before creating or issuing documents.</p>:null}
        </div>
        <div className={styles.panel}>
          <div className={styles.listHeader}><h2>Recent documents</h2>
            <button type="button" className={styles.secondary} onClick={refetch}>Refresh</button></div>
          <div className={styles.filters}>
            {(["ALL","QUOTATION","PROFORMA"] as const).map(value=>
              <button key={value} type="button" aria-pressed={filter===value}
                className={filter===value?styles.selected:styles.secondary} onClick={()=>setFilter(value)}>
                {value==="ALL"?"All":value==="QUOTATION"?"Quotes":"Proformas"}</button>)}
          </div>
          {error?<p className={styles.error} role="alert">{error}</p>:null}
          {notice?<p className={styles.notice} role="status">{notice}</p>:null}
          {loadError?<p className={styles.error} role="alert">{loadError}</p>:null}
          {loading&&!data?<p>Loading documents…</p>:visible.length===0?<p className={styles.hint}>No documents here yet. Create your first quotation.</p>:
            <div className={styles.list}>
              {visible.map(doc=><article key={doc.id} className={styles.document}>
                <div className={styles.documentTop}><strong>{doc.documentNumber}</strong>
                  <span className={styles.pill}>{doc.status}</span></div>
                <div>{labelKind(doc.kind)} · {doc.customerName}</div>
                <div className={styles.documentMeta}>{formatDate(doc.createdAt)} · {formatMoney(doc.totalMinor,doc.currencyCode)}</div>
                <div className={styles.actions}>
                  <Link className={styles.secondary} href={`/documents/${doc.id}`}>View</Link>
                  {doc.status==="DRAFT"?<button className={styles.secondary} disabled={!canWrite||busy||!queue.online}
                    type="button" onClick={()=>void edit(doc.id)}>Edit</button>:null}
                  {doc.status==="DRAFT"?<button className={styles.primary} disabled={!canWrite||busy||!queue.online}
                    type="button" onClick={()=>void transition(doc.id,"issue")}>Issue</button>:null}
                  {doc.status!=="CANCELLED"?<button className={styles.smallButton} type="button"
                    disabled={busy||!queue.online||!["OWNER","ADMIN","MANAGER"].includes(session?.role??"")}
                    onClick={()=>void transition(doc.id,"cancel")}>Cancel</button>:null}
                </div>
              </article>)}
            </div>}
        </div>
      </section>
    </main>
  );
}
