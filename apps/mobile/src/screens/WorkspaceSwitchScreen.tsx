import {useEffect,useRef,useState} from "react";
import {ScrollView,Text,View,StyleSheet} from "react-native";
import type {MobileApiClient,MobileMembership,MobileBusinessContext} from "../api-client";
import type {MobileReadyState} from "../runtime";
import {Button} from "../components/Button";
import {Card} from "../components/Card";
import {Banner} from "../components/Banner";
import {colors,spacing,typography} from "../theme";
type Props={api:MobileApiClient;ready:MobileReadyState;online:boolean;cartCount:number;syncing:boolean;getCurrentPending:()=>Promise<number>;onSwitch:(businessId:string,branchId:string)=>Promise<void>;onBack:()=>void};
export function WorkspaceSwitchScreen({api,ready,online,cartCount,syncing,getCurrentPending,onSwitch,onBack}:Props){
 const [memberships,setMemberships]=useState<MobileMembership[]>([]),[businessId,setBusinessId]=useState(ready.business.id),[branchId,setBranchId]=useState(ready.branch.id),[context,setContext]=useState<MobileBusinessContext|null>(null);
 const [pendingHere,setPendingHere]=useState<number|null>(null);
 useEffect(()=>{let live=true;setPendingHere(null);void getCurrentPending().then(n=>{if(live)setPendingHere(n);}).catch(()=>{});return()=>{live=false;};},[getCurrentPending,ready.queue.pending,syncing]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[review,setReview]=useState(false),[error,setError]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
 const generation=useRef(0),lock=useRef(false);
 const allowed=ready.membership.role!=="POS_ATTENDANT";
 useEffect(()=>{
  const n=++generation.current;setContext(null);setMemberships([]);setReview(false);
  if(!online||!allowed){setLoading(false);return;}
  setLoading(true);setError(null);
  void api.getMe().then(async me=>{
   if(me.user.id!==ready.user.id)throw new Error("Account changed.");
   const available=me.memberships.filter(m=>m.businessStatus==="ACTIVE");
   if(n!==generation.current)return;
   setMemberships(available);
   const selected=available.find(m=>m.businessId===businessId);
   if(!selected)throw new Error("Business no longer available.");
   const data=await api.getBusinessContext(businessId);
   if(n!==generation.current)return;
   if(data.business.id!==businessId||data.membership.role!==selected.role||data.membership.staffId!==selected.staffId)throw new Error("Workspace permission changed.");
   setContext(data);
   setBranchId(old=>data.branches.some(b=>b.id===old&&b.active)?old:data.branches.find(b=>b.active&&b.code==="MAIN")?.id??data.branches.find(b=>b.active)?.id??"");
  }).catch(()=>{if(n===generation.current)setError("Could not verify accessible workspaces. Refresh before switching.");}).finally(()=>{if(n===generation.current)setLoading(false);});
  return()=>{++generation.current;};
 },[api,businessId,ready.user.id,online,allowed,refresh]);
 const target=context?.branches.find(b=>b.id===branchId&&b.active);
 const blocked=!online||!allowed||loading||busy||syncing||cartCount>0||pendingHere!==0||!target||context?.business.id!==businessId||(businessId===ready.business.id&&branchId===ready.branch.id);
 async function submit(){
  if(blocked||!review||lock.current)return;
  lock.current=true;setBusy(true);
  try{await onSwitch(businessId,branchId);}catch(e){setError(e instanceof Error?e.message:"Could not switch workspace.");setReview(false);}
  finally{lock.current=false;setBusy(false);}
 }
 return <ScrollView contentContainerStyle={styles.page}>
 <View style={styles.row}><Text style={[styles.title,styles.flex]}>Switch workspace</Text><Button variant="secondary" size="compact" disabled={busy} accessibilityLabel="Back to more" onPress={onBack}>Back</Button></View>
 <Card style={styles.section}><Text style={styles.muted}>CURRENT WORKSPACE</Text><Text style={styles.heading}>{ready.business.name} · {ready.branch.name}</Text><Text style={styles.muted}>{ready.membership.role.replaceAll("_"," ")} · {ready.business.currencyCode==="GHS"?"₵":ready.business.currencyCode}</Text></Card>
 {!online?<Banner tone="warning" message="Workspace switching requires an online permissions check."/>:null}
 {cartCount>0?<Banner tone="warning" message="Complete or clear your current sale cart before switching."/>:null}
 {pendingHere!==0?<Banner tone="warning" message={pendingHere===null?"Verifying pending transactions.":"Sync pending transactions in the current business before switching."}/>:null}
 {ready.queue.failed>0?<Banner tone="info" message="Rejected records remain in their original business queue for review."/>:null}
 {error?<Banner tone="warning" message={error}/>:null}
 <Card style={styles.section}><Text style={styles.heading}>Your businesses</Text>{memberships.map(m=><Button key={m.businessId} variant={businessId===m.businessId?"gold":"secondary"} disabled={busy||review} accessibilityLabel={"Select "+m.businessName} onPress={()=>{if(m.businessId!==businessId){++generation.current;setContext(null);setBranchId("");setBusinessId(m.businessId);}}}>{m.businessName} · {m.role.replaceAll("_"," ")}</Button>)}
 <Text style={styles.heading}>Active branches</Text>{context?.branches.filter(b=>b.active).map(b=><Button key={b.id} variant={branchId===b.id?"gold":"secondary"} disabled={busy||review} accessibilityLabel={"Select "+b.name} onPress={()=>setBranchId(b.id)}>{b.name} · {b.code}</Button>)}
 <Button variant="secondary" disabled={loading||busy||review||!online} accessibilityLabel="Refresh workspace permissions" onPress={()=>setRefresh(x=>x+1)}>{loading?"Verifying access…":"Refresh access"}</Button></Card>
 {review?<Card style={styles.section}><Text style={styles.heading}>Confirm workspace change</Text><Text>{context?.business.name} · {target?.name}</Text><Banner tone="info" message="The app will reload catalog, stock and permissions. Existing transaction records stay in their original workspace."/><Button loading={busy} disabled={blocked} accessibilityLabel="Confirm switch workspace" onPress={()=>void submit()}>Confirm switch</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel switch" onPress={()=>setReview(false)}>Cancel</Button></Card>:<Button variant="gold" disabled={blocked} accessibilityLabel="Review workspace change" onPress={()=>setReview(true)}>Switch workspace</Button>}
 </ScrollView>;
}
const styles=StyleSheet.create({page:{flexGrow:1,padding:spacing.s4,gap:spacing.s4,backgroundColor:colors.canvas,paddingBottom:spacing.s8},section:{gap:spacing.s3},row:{flexDirection:"row",alignItems:"center",gap:spacing.s2},flex:{flex:1,minWidth:0},title:{fontSize:typography.section,fontWeight:typography.weightHeavy,color:colors.textStrong},heading:{fontSize:typography.body,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,color:colors.textMuted}});
