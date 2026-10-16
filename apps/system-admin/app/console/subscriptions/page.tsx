"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Badge, Banner, PageHeader, Section } from "../../components/admin-ui";
import { useAdminResource, usePlatformAdminSession } from "../../components/platform-admin-session";

const WRITE_ROLES = new Set(["SUPER_ADMIN", "PLATFORM_ADMIN", "BILLING"]);
type Subscription = { id:string; businessId:string; businessName:string; planId:string; planCode:string; planName:string; status:string; currentPeriodEndsAt:string|null; cancelAtPeriodEnd:boolean; updatedAt:string };
type Plan = { id:string; code:string; name:string; active:boolean };
type Tenant = { id:string; name:string; subscriptionStatus:string|null };
const ACTIONS = ["ACTIVATE","CHANGE_PLAN","PAUSE","REACTIVATE","CANCEL_AT_PERIOD_END","RESUME","CANCEL"] as const;

export default function SubscriptionsPage() {
  const { adminUser, apiFetch } = usePlatformAdminSession();
  const { data, loading, error, reload } = useAdminResource<{ subscriptions: Subscription[] }>("/api/admin/subscriptions");
  const { data: plansData } = useAdminResource<{ plans: Plan[] }>("/api/admin/plans");
  const { data: tenantData } = useAdminResource<{ tenants: Tenant[] }>("/api/admin/tenants");
  const [statusFilter, setStatusFilter] = useState("ALL"); const [query,setQuery]=useState("");
  const [notice,setNotice]=useState<string|null>(null); const [actionError,setActionError]=useState<string|null>(null); const [saving,setSaving]=useState(false);
  const canWrite = Boolean(adminUser && WRITE_ROLES.has(adminUser.role));
  const subscriptions=data?.subscriptions??[]; const plans=plansData?.plans??[];
  const filtered=useMemo(()=>subscriptions.filter((item)=>(statusFilter==="ALL"||item.status===statusFilter)&&`${item.businessName} ${item.planName}`.toLowerCase().includes(query.toLowerCase())),[subscriptions,statusFilter,query]);

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=event.currentTarget; const fd=new FormData(form); const businessId=String(fd.get("businessId")??""); const planId=String(fd.get("planId")??""); const mode=String(fd.get("mode")??"ACTIVE"); const reason=String(fd.get("reason")??"").trim();
    if (!window.confirm("Confirm subscription assignment? The tenant's available features and billing state can change.")) return;
    setSaving(true); setActionError(null); try { const response=await apiFetch(`/api/admin/tenants/${encodeURIComponent(businessId)}/subscription`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({planId,mode,reason})}); const body=await response.json().catch(()=>({})) as {message?:string}; if(!response.ok) throw new Error(body.message??"Subscription could not be assigned"); form.reset(); await reload(); setNotice("Subscription assigned."); } catch(e){setActionError(e instanceof Error?e.message:"Subscription could not be assigned");} finally{setSaving(false);}
  }

  async function transition(event: FormEvent<HTMLFormElement>, subscription: Subscription) {
    event.preventDefault(); const form=event.currentTarget; const fd=new FormData(form); const action=String(fd.get("action")??""); const reason=String(fd.get("reason")??"").trim(); const planId=String(fd.get("planId")??"");
    if (!window.confirm(`Confirm ${action.toLowerCase().replaceAll("_"," ")} for ${subscription.businessName}?`)) return;
    setSaving(true); setActionError(null); try { const response=await apiFetch(`/api/admin/subscriptions/${subscription.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,reason,expectedUpdatedAt:subscription.updatedAt,...(action==="CHANGE_PLAN"?{planId}:{})})}); const body=await response.json().catch(()=>({})) as {message?:string}; if(!response.ok) throw new Error(body.message??"Subscription could not be changed"); await reload(); setNotice("Subscription updated."); } catch(e){setActionError(e instanceof Error?e.message:"Subscription could not be changed");} finally{setSaving(false);}
  }

  return <div className="admin-page">
    <PageHeader eyebrow="Billing / Subscriptions" title="Tenant subscriptions" subtitle="Assign plans and make audited subscription changes with explicit impact confirmation." />
    {notice?<Banner title="Updated">{notice}</Banner>:null}{error||actionError?<Banner tone="danger" title="Action needed">{error??actionError}</Banner>:null}
    <div className="admin-billing-toolbar"><input className="admin-field__input" aria-label="Search subscriptions" placeholder="Search tenant or plan" value={query} onChange={e=>setQuery(e.target.value)} /><select className="admin-field__input" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="ALL">All statuses</option>{["TRIALING","ACTIVE","PAST_DUE","PAUSED","CANCELED","EXPIRED"].map(s=><option key={s}>{s}</option>)}</select><button className="admin-secondary-button" onClick={()=>void reload()} type="button">Refresh</button></div>
    {loading?<div className="admin-api-state" role="status">Loading subscriptions…</div>:null}
    <div className="admin-billing-grid">{filtered.map(subscription=><article className="admin-billing-card" key={subscription.id}>
      <div className="admin-billing-card__head"><div><strong>{subscription.businessName}</strong><small>{subscription.planName} · {subscription.planCode}</small></div><Badge tone={tone(subscription.status)}>{subscription.status.toLowerCase()}</Badge></div>
      <div className="admin-billing-card__facts"><span>Period ends {formatDate(subscription.currentPeriodEndsAt)}</span><span>{subscription.cancelAtPeriodEnd?"Cancels at period end":"Renews normally"}</span></div>
      {canWrite?<form className="admin-billing-inline-form" onSubmit={e=>void transition(e,subscription)}><select className="admin-field__input" name="action" aria-label="Subscription action">{ACTIONS.map(a=><option key={a} value={a}>{a.replaceAll("_"," ")}</option>)}</select><select className="admin-field__input" name="planId" aria-label="Replacement plan"><option value="">Replacement plan (when changing)</option>{plans.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input className="admin-field__input" name="reason" required placeholder="Reason for change" /><button className="admin-primary-button" type="submit" disabled={saving}>Review & confirm</button></form>:null}
    </article>)}</div>
    {!loading&&filtered.length===0?<div className="admin-api-state">No subscriptions match this view.</div>:null}
    {canWrite?<Section title="Assign a subscription" sub="Choose a tenant without a current plan, then confirm the commercial impact." padded><form className="admin-billing-form" onSubmit={assign}><label className="admin-field"><span className="admin-field__label">Tenant</span><select className="admin-field__input" name="businessId" required><option value="">Select tenant</option>{(tenantData?.tenants??[]).map(t=><option key={t.id} value={t.id}>{t.name}{t.subscriptionStatus?` · ${t.subscriptionStatus}`:""}</option>)}</select></label><label className="admin-field"><span className="admin-field__label">Plan</span><select className="admin-field__input" name="planId" required><option value="">Select plan</option>{plans.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="admin-field"><span className="admin-field__label">Start mode</span><select className="admin-field__input" name="mode"><option value="ACTIVE">Active now</option><option value="TRIAL">Trial</option></select></label><label className="admin-field"><span className="admin-field__label">Reason</span><input className="admin-field__input" name="reason" required placeholder="Why is this subscription being assigned?" /></label><div className="admin-profile-actions admin-billing-form__wide"><button className="admin-primary-button" disabled={saving} type="submit">Review & confirm assignment</button></div></form></Section>:null}
  </div>;
}
function tone(status:string):"positive"|"warning"|"danger"|"neutral" { if(status==="ACTIVE")return"positive"; if(status==="TRIALING"||status==="PAUSED")return"warning"; if(status==="PAST_DUE")return"danger"; return"neutral"; }
function formatDate(value:string|null){return value?new Date(value).toLocaleDateString():"—";}
