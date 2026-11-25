import {useCallback,useEffect,useRef,useState} from "react";
import {ScrollView,Text,View,StyleSheet,Share} from "react-native";
import type {BusinessRole,StaffDirectoryItem} from "@tradeos/contracts";
import type {MobileApiClient,MobileBusinessContext,MobileBusinessPatch,MobileBranch,MobileBranchPatch} from "../api-client";
import {canManageBusiness,canReadStaff,assignableRoles,canEditStaff,validateName,validateBranchCode,validateAssignments,canDeactivateBranch} from "../business-admin-workspace";
import type {MobileActionFeedback} from "../action-feedback";
import {Button} from "../components/Button";
import {Card} from "../components/Card";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {colors,spacing,typography} from "../theme";
type Props={api:MobileApiClient;businessId:string;branchId:string;role:string;staffId:string|null;online:boolean;portalOrigin:string;onChanged:()=>void;onFeedback:(f:MobileActionFeedback)=>void;onBack:()=>void};
type Draft={kind:"profile"|"branch"|"staff";id?:string;values:Record<string,string>;original:Record<string,string>};
const contacts=["email","phone","addressLine1","addressLine2","city","region","postalCode"] as const;
const businessFields=["name","legalName","registrationNumber","taxId",...contacts,"timezone"] as const;
const branchFields=["name","code",...contacts,"timezone"] as const;
const staffFields=["displayName","email","phone"] as const;
const names:Record<string,string>={name:"Name",legalName:"Legal name",registrationNumber:"Registration number",taxId:"Tax ID",email:"Email",phone:"Phone (international format)",addressLine1:"Address line 1",addressLine2:"Address line 2",city:"City",region:"Region",postalCode:"Postal code",timezone:"Time zone (IANA)",code:"Branch code (optional)",displayName:"Staff name"};
function valuesFrom(row:object,keys:readonly string[]){return Object.fromEntries(keys.map(k=>[k,String((row as Record<string,unknown>)[k]??"")]));}
function makeDraft(kind:Draft["kind"],row:object,keys:readonly string[],id?:string):Draft{const values=valuesFrom(row,keys);return {kind,...(id?{id}:{}),values,original:{...values}};}
export function BusinessAdminScreen({api,businessId,branchId,role,staffId,online,portalOrigin,onChanged,onFeedback,onBack}:Props){
 const manage=canManageBusiness(role),readStaff=canReadStaff(role);
 const [context,setContext]=useState<MobileBusinessContext|null>(null),[staff,setStaff]=useState<StaffDirectoryItem[]>([]),[tab,setTab]=useState<"profile"|"branches"|"team">("profile");
 const [draft,setDraft]=useState<Draft|null>(null),[staffRole,setStaffRole]=useState<BusinessRole>("CASHIER");
 const [confirm,setConfirm]=useState<{kind:"branch"|"staff"|"invite";id:string;label:string;active?:boolean}|null>(null),[assignment,setAssignment]=useState<{id:string;label:string;branchIds:string[]}|null>(null);
 const [invite,setInvite]=useState<{url:string;expiresAt:string;label:string}|null>(null),[search,setSearch]=useState("");
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
 const seq=useRef(0),lock=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;++seq.current;}},[]);
 const refresh=useCallback(async()=>{
  const n=++seq.current;if(!online){setContext(null);setStaff([]);return;}
  setLoading(true);
  try{const [c,t]=await Promise.all([api.getBusinessContext(businessId),readStaff?api.getStaff(businessId):Promise.resolve({staff:[]})]);
   if(n===seq.current){if(c.business.id!==businessId||c.membership.role!==role)throw new Error("Workspace changed. Sign in again.");setContext(c);setStaff(t.staff.filter(s=>s.businessId===businessId));}}
  catch{if(n===seq.current){setContext(null);setStaff([]);setError("Could not verify the business profile and team.");}}
  finally{if(n===seq.current)setLoading(false);}
 },[api,businessId,online,readStaff,role]);
 useEffect(()=>{void refresh();return()=>{++seq.current;}},[refresh]);
 useEffect(()=>{if(!online){setDraft(null);setConfirm(null);setAssignment(null);setInvite(null);}},[online]);
 const editing=!!(draft||confirm||assignment||invite);
 function reset(){setDraft(null);setConfirm(null);setAssignment(null);setInvite(null);setError(null);}
 function beginStaff(s?:StaffDirectoryItem){reset();setStaffRole(s?.role??"CASHIER");setDraft(makeDraft("staff",s??{},staffFields,s?.id));}
 async function save(){
  if(!draft||!manage||!online||lock.current||!context)return;
  lock.current=true;setBusy(true);setError(null);
  try{
   const changes=Object.fromEntries(Object.entries(draft.values).filter(([k,v])=>!draft.id||v!==draft.original[k]).map(([k,v])=>[k,v.trim()||null]));
   if(draft.kind==="profile"){
    if("name" in changes)changes.name=validateName(draft.values.name??"");
    const r=await api.updateBusinessProfile(businessId,changes as MobileBusinessPatch);if(!live.current)return;
    if(r.business.id!==businessId)throw new Error("Profile response mismatch.");
    setContext(old=>old?{...old,business:r.business}:old);onChanged();
   }else if(draft.kind==="branch"){
    if("name" in changes)changes.name=validateName(draft.values.name??"");
    if(!draft.id){changes.name=validateName(draft.values.name??"");const code=validateBranchCode(draft.values.code??"");if(code)changes.code=code;else delete changes.code;}else delete changes.code;
    const r=await api.saveBranch(businessId,changes as MobileBranchPatch,draft.id);if(!live.current)return;if(draft.id&&r.branch.id!==draft.id)throw new Error("Branch response mismatch.");
    setContext(old=>old?{...old,branches:[r.branch,...old.branches.filter(b=>b.id!==r.branch.id)]}:old);onChanged();
   }else{
    const target=draft.id?staff.find(s=>s.id===draft.id):null;
    if((draft.id&&(!target||!canEditStaff(role,target,staffId)))||!assignableRoles(role).includes(staffRole))throw new Error("Staff role is not assignable.");
    const payload={businessId,...changes,...(!draft.id||staffRole!==target?.role?{role:staffRole}:{}),...(!draft.id||"displayName" in changes?{displayName:validateName(draft.values.displayName??"")}: {})};
    const r=await api.saveStaff(payload,draft.id);if(!live.current)return;if(r.staff.businessId!==businessId||(draft.id&&r.staff.id!==draft.id))throw new Error("Staff response mismatch.");
    setStaff(old=>[r.staff,...old.filter(s=>s.id!==r.staff.id)]);
   }
   reset();onFeedback({tone:"success",title:"Saved",message:"The server confirmed the change."});void refresh();
  }catch(e){if(live.current){setError(e instanceof Error?e.message:"Save not confirmed. Review the current record before retrying.");void refresh();}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function runConfirm(){
  if(!confirm||!manage||!online||lock.current||!context)return;lock.current=true;setBusy(true);setError(null);
  try{
   if(confirm.kind==="branch"){
    const target=context.branches.find(b=>b.id===confirm.id);if(!target||(!confirm.active&&!canDeactivateBranch(target,context.branches,branchId)))throw new Error("Keep the current branch and at least one active branch.");
    await api.changeBranchActive(businessId,confirm.id,!!confirm.active);onChanged();
   }else{
    const target=staff.find(s=>s.id===confirm.id);if(!target||!canEditStaff(role,target,staffId))throw new Error("This staff record cannot be changed.");
    if(confirm.kind==="invite"){
     const result=await api.inviteStaff(businessId,confirm.id);if(!live.current)return;
     if(result.invitation.businessId!==businessId||result.invitation.staffId!==confirm.id||!result.acceptanceToken)throw new Error("Invitation response mismatch.");
     setInvite({label:confirm.label,url:portalOrigin.replace(/\/$/,"")+"/invite/team#token="+encodeURIComponent(result.acceptanceToken),expiresAt:result.invitation.expiresAt});setConfirm(null);void refresh();return;
    }
    await api.changeStaffActive(businessId,confirm.id,!!confirm.active);
   }
   if(live.current){reset();onFeedback({tone:"success",title:"Access updated",message:"The server confirmed the change."});void refresh();}
  }catch(e){if(live.current){setConfirm(null);setError(e instanceof Error?e.message:"Change not confirmed. Review before retrying.");void refresh();}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function loadAssignments(s:StaffDirectoryItem){
  if(!manage||!s.active||s.role!=="POS_ATTENDANT"||lock.current)return;
  lock.current=true;setBusy(true);setError(null);
  try{const r=await api.getStaffBranches(businessId,s.id);if(live.current)setAssignment({id:s.id,label:s.displayName,branchIds:r.branchIds.filter(id=>context?.branches.some(b=>b.id===id&&b.active))});}
  catch{if(live.current)setError("Could not verify branch assignments.");}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function saveAssignments(){
  if(!assignment||!context||!manage||lock.current)return;
  try{validateAssignments(assignment.branchIds,context.branches);}catch(e){setError((e as Error).message);return;}
  lock.current=true;setBusy(true);
  try{await api.setStaffBranches(businessId,assignment.id,assignment.branchIds);if(live.current){reset();onFeedback({tone:"success",title:"Branch access saved",message:"The selected POS attendant branch assignments are confirmed."});void refresh();}}
  catch{if(live.current){setAssignment(null);setError("Assignment save not confirmed. Reopen assignments to verify.");}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 const fields=draft?.kind==="profile"?businessFields:draft?.kind==="branch"?branchFields:staffFields;
 return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
 <View style={styles.row}><Text style={[styles.title,styles.flex]}>Business administration</Text><Button variant="secondary" size="compact" disabled={busy} accessibilityLabel="Back to more" onPress={onBack}>Back</Button></View>
 {!online?<Banner tone="info" message="Connect to manage business settings and access."/>:<>
 {error?<Banner tone="warning" message={error}/>:null}
 <View style={styles.wrap}>{(["profile","branches","team"] as const).filter(t=>t!=="team"||readStaff).map(t=><Button key={t} variant={tab===t?"gold":"secondary"} size="compact" disabled={editing||busy} accessibilityLabel={t} onPress={()=>setTab(t)}>{t==="profile"?"Business profile":t==="branches"?"Branches":"Team & access"}</Button>)}</View>
 <Button variant="secondary" disabled={busy||loading||editing} accessibilityLabel="Refresh business settings" onPress={()=>void refresh()}>{loading?"Refreshing…":"Refresh"}</Button>
 {context&&!editing&&tab==="profile"?<Card style={styles.section}><Text style={styles.title}>{context.business.name}</Text><Text style={styles.muted}>{context.business.businessType.replaceAll("_"," ")} · {context.business.countryCode} · {context.business.currencyCode==="GHS"?"₵":context.business.currencyCode}</Text>
 {businessFields.filter(k=>k!=="name").map(k=><View key={k} style={styles.line}><Text style={[styles.muted,styles.flex]}>{names[k]}</Text><Text style={styles.flex}>{String(context.business[k]??"—")}</Text></View>)}
 {manage?<Button variant="gold" accessibilityLabel="Edit business profile" onPress={()=>setDraft(makeDraft("profile",context.business,businessFields,context.business.id))}>Edit business profile</Button>:null}<Text style={styles.muted}>Base currency and country are not editable here.</Text></Card>:null}
 {context&&!editing&&tab==="branches"?<Card style={styles.section}><Text style={styles.heading}>Business branches</Text>{manage?<Button variant="gold" accessibilityLabel="Add branch" onPress={()=>setDraft(makeDraft("branch",{timezone:context.business.timezone},branchFields))}>Add branch</Button>:null}
 {context.branches.map(b=><View key={b.id} style={styles.section}><Text style={styles.heading}>{b.name} · {b.code}</Text><Text style={styles.muted}>{b.active?"Active":"Inactive"} · {b.timezone}{b.id===branchId?" · Current branch":""}</Text>{manage?<View style={styles.wrap}><Button size="compact" variant="secondary" accessibilityLabel={"Edit "+b.name} onPress={()=>setDraft(makeDraft("branch",b,branchFields,b.id))}>Edit</Button>{!b.active||canDeactivateBranch(b,context.branches,branchId)?<Button variant="secondary" size="compact" accessibilityLabel={(b.active?"Deactivate ":"Reactivate ")+b.name} onPress={()=>setConfirm({kind:"branch",id:b.id,label:b.name,active:!b.active})}>{b.active?"Deactivate":"Reactivate"}</Button>:null}</View>:null}</View>)}</Card>:null}
 {context&&!editing&&tab==="team"&&readStaff?<Card style={styles.section}><Text style={styles.heading}>Team &amp; access</Text><Input label="Search staff" value={search} onChangeText={setSearch}/>{manage?<Button variant="gold" accessibilityLabel="Add staff member" onPress={()=>beginStaff()}>Add staff</Button>:null}
 {staff.filter(s=>(s.displayName+" "+s.role+" "+(s.email??"")).toLowerCase().includes(search.toLowerCase())).map(s=><View key={s.id} style={styles.section}><Text style={styles.heading}>{s.displayName}</Text><Text style={styles.muted}>{s.role.replaceAll("_"," ")} · {s.active?"Active":"Suspended"} · {s.access.membershipStatus??s.access.invitationStatus??"Not invited"}</Text><Text style={styles.muted}>{s.email??s.phone??"No contact"}</Text>{canEditStaff(role,s,staffId)?<View style={styles.wrap}><Button variant="secondary" size="compact" accessibilityLabel={"Edit "+s.displayName} onPress={()=>beginStaff(s)}>Edit</Button><Button variant="secondary" size="compact" accessibilityLabel={(s.active?"Suspend ":"Reactivate ")+s.displayName} onPress={()=>setConfirm({kind:"staff",id:s.id,label:s.displayName,active:!s.active})}>{s.active?"Suspend":"Reactivate"}</Button>{s.active&&s.access.membershipStatus!=="ACTIVE"&&(s.email||s.phone)?<Button variant="gold" size="compact" accessibilityLabel={"Invite "+s.displayName} onPress={()=>setConfirm({kind:"invite",id:s.id,label:s.displayName})}>Invite</Button>:null}{s.active&&s.role==="POS_ATTENDANT"?<Button variant="secondary" size="compact" accessibilityLabel={"Assign branches to "+s.displayName} onPress={()=>void loadAssignments(s)}>Branches</Button>:null}</View>:null}</View>)}</Card>:null}
 {draft?<Card style={styles.section}><Text style={styles.heading}>{draft.id?"Edit ":"Create "}{draft.kind}</Text>{fields.filter(k=>!(draft.kind==="branch"&&draft.id&&k==="code")).map(k=><Input key={k} label={names[k]??k} value={draft.values[k]??""} editable={!busy} onChangeText={value=>setDraft(old=>old?{...old,values:{...old.values,[k]:value}}:old)}/>)}
 {draft.kind==="staff"?<><Text style={styles.heading}>Role</Text><View style={styles.wrap}>{assignableRoles(role).map(r=><Button key={r} size="compact" variant={r===staffRole?"gold":"secondary"} disabled={busy} accessibilityLabel={r} onPress={()=>setStaffRole(r)}>{r.replaceAll("_"," ")}</Button>)}</View><Text style={styles.muted}>POS attendants are restricted to assigned branches; assign branches before inviting them.</Text></>:null}
 <Button loading={busy} accessibilityLabel="Save changes" onPress={()=>void save()}>Save changes</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel editing" onPress={reset}>Cancel</Button></Card>:null}
 {confirm?<Card style={styles.section}><Text style={styles.heading}>{confirm.kind==="invite"?"Create invitation":confirm.active?"Reactivate access":"Deactivate or suspend access"}</Text><Banner tone="warning" message={confirm.kind==="invite"?"Create a private invitation for "+confirm.label+". A previous invitation may be revoked. Share only with this staff member.":(confirm.active?"Restore access for ":"Restrict access for ")+confirm.label+"? Historical transactions are retained."}/><Button loading={busy} accessibilityLabel="Confirm access change" onPress={()=>void runConfirm()}>Confirm</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel access change" onPress={reset}>Cancel</Button></Card>:null}
 {assignment&&context?<Card style={styles.section}><Text style={styles.heading}>Branch access · {assignment.label}</Text><Text style={styles.muted}>Removing all assignments prevents POS access.</Text>{context.branches.filter(b=>b.active).map(b=><Button key={b.id} variant={assignment.branchIds.includes(b.id)?"gold":"secondary"} disabled={busy} accessibilityLabel={"Toggle "+b.name} onPress={()=>setAssignment(old=>old?{...old,branchIds:old.branchIds.includes(b.id)?old.branchIds.filter(id=>id!==b.id):[...old.branchIds,b.id]}:old)}>{assignment.branchIds.includes(b.id)?"✓ ":""}{b.name}</Button>)}<Button loading={busy} accessibilityLabel="Save branch assignments" onPress={()=>void saveAssignments()}>Save assignments</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel assignments" onPress={reset}>Cancel</Button></Card>:null}
 {invite?<Card style={styles.section}><Text style={styles.heading}>Private invitation · {invite.label}</Text><Text style={styles.muted}>Expires {invite.expiresAt}. Share only with the intended staff member; the link grants invitation access.</Text><Button variant="gold" accessibilityLabel="Share private invitation" onPress={()=>void Share.share({message:invite.url}).catch(()=>setError("Could not open sharing."))}>Share invitation</Button><Button variant="secondary" accessibilityLabel="Close invitation" onPress={reset}>Close</Button></Card>:null}
 </>}
 </ScrollView>;
}
const styles=StyleSheet.create({page:{flexGrow:1,padding:spacing.s4,gap:spacing.s4,backgroundColor:colors.canvas,paddingBottom:spacing.s8},section:{gap:spacing.s3},row:{flexDirection:"row",alignItems:"center",gap:spacing.s2},flex:{flex:1,minWidth:0},title:{fontSize:typography.section,fontWeight:typography.weightHeavy,color:colors.textStrong},heading:{fontSize:typography.body,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,color:colors.textMuted},line:{flexDirection:"row",alignItems:"center",gap:spacing.s2,paddingVertical:spacing.s2,borderBottomWidth:1,borderBottomColor:colors.border},wrap:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2}});
