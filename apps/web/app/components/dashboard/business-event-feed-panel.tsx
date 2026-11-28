"use client";

import {useState} from "react";
import {useWorkspace} from "../workspace/use-workspace";
import {useApiFetch} from "../../../lib/use-api-fetch";
import {Button} from "../ui/button";
import styles from "./business-notification-panel.module.css";

const roles=new Set(["OWNER","ADMIN","MANAGER","ACCOUNTANT"]);
type Scope={businessId:string;branchId:string};
type Feed=Scope&{items:{id:string;eventType:string;occurredAt:string;deliveredAt:string}[]};
type Delivery=Scope&{pending:number;retrying:number;reviewRequired:number;oldestPendingAt:string|null};
const labels:Record<string,string>={
  SALE_COMPLETED:"Sale recorded",PURCHASE_RECEIVED:"Purchase received",
  RETURN_ACCEPTED:"Return recorded",EXCHANGE_COMPLETED:"Exchange recorded",
  EXCHANGE_PROCESSING:"Exchange under review",CUSTOMER_PAYMENT_RECEIVED:"Customer payment recorded",
  SUPPLIER_PAYMENT_CREATED:"Supplier payment recorded",
};
export function BusinessEventFeedPanel(){
  const {session,role,queue}=useWorkspace();
  const allowed=role!==null&&roles.has(role);
  if(!allowed||!session)return null;
  const scopeKey=[session.businessId,session.branchId,session.staffId,role].join(":");
  return <ActivityPanel key={scopeKey}/>;
}

function ActivityPanel(){
  const {session,queue}=useWorkspace();
  const [expanded,setExpanded]=useState(false);
  const params=session&&expanded&&queue.online?
    "businessId="+encodeURIComponent(session.businessId)+"&branchId="+encodeURIComponent(session.branchId):null;
  const feed=useApiFetch<Feed>(params?"/v1/intelligence/activity-feed?"+params:null);
  const status=useApiFetch<Delivery>(params?"/v1/intelligence/activity-feed/status?"+params:null);
  if(!session)return null;
  const inScope=(data:Scope|null)=>!!data&&data.businessId===session.businessId&&data.branchId===session.branchId;
  const delivery=queue.online&&!status.loading&&!status.error&&inScope(status.data)?status.data:null;
  const items=queue.online&&!feed.loading&&!feed.error&&inScope(feed.data)?feed.data?.items:null;
  return <section className="tos-section" aria-label="Recorded business activity">
    <div className="tos-section__head"><h2 className="tos-section__title">Business activity</h2>
      <Button variant="outline" size="sm" disabled={!expanded||!queue.online||feed.loading||status.loading}
        onClick={()=>{feed.refetch();status.refetch();}}>Refresh</Button></div>
    <div className="tos-section__body">
      <details className={styles.panel} open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
        <summary className={styles.summary}><span className={styles.title}>Event delivery</span>
          <span className={styles.count}>{!expanded?"Open to view":delivery?delivery.pending.toLocaleString("en-GH")+" pending":status.loading?"Loading…":"Status unavailable"}</span></summary>
        <div className={styles.body}>
          <p className={styles.intro}>Recorded internal activity only. This is not proof of payment settlement, external message delivery or device synchronization.</p>
          {!expanded?null:!queue.online?<p className={styles.notice}>Connect to view current business activity.</p>:
            status.loading||feed.loading?<p role="status" className={styles.notice}>Loading activity…</p>:
            <>
              {delivery?<p className={styles.notice} role="status">{delivery.pending} awaiting delivery · {delivery.retrying} retrying · {delivery.reviewRequired} need review.
                {delivery.oldestPendingAt?" Oldest pending: "+new Date(delivery.oldestPendingAt).toLocaleString("en-GH")+".":""}</p>:
                <p className={styles.notice} role="status">Delivery status is temporarily unavailable.</p>}
              {delivery&&delivery.reviewRequired>0?<p className={styles.notice}>Contact support to review failed event delivery. Do not repost the original sale or payment.</p>:null}
              {!items?<p className={styles.notice}>Activity is temporarily unavailable.</p>:items.length===0?
                <p className={styles.notice}>No delivered activity yet.</p>:
                <ul className={styles.list}>{items.slice(0,8).map(item=><li key={item.id} className={styles.item}>
                  <div className={styles.itemBody}><div className={styles.itemHeading}><strong>{labels[item.eventType]??"Business event recorded"}</strong></div>
                    <small>{new Date(item.occurredAt).toLocaleString("en-GH",{dateStyle:"medium",timeStyle:"short"})}</small>
                  </div></li>)}</ul>}
            </>}
        </div>
      </details>
    </div>
  </section>;
}
