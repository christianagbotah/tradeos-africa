import {useCallback,useEffect,useRef,useState} from "react";
import {ActivityIndicator,Pressable,ScrollView,Text,View,StyleSheet} from "react-native";
import type {MobileApiClient,MobileOperationsCurrent,MobileOperationInterval,MobileShiftPolicy} from "../api-client";
import {blankCounts,branchBusinessDate,canReadOperations,canManageDays,canManageOwnShift,canChangeShiftPolicy,inOperationScope,operationInput,type OperationAction,type OperationTransaction} from "../operations-workspace";
import {paymentMethods,type ReceiptOutcome} from "../customer-payment";
import type {MobileActionFeedback} from "../action-feedback";
import {Button} from "../components/Button";
import {Card} from "../components/Card";
import {Banner} from "../components/Banner";
import {Input} from "../components/Input";
import {formatMoney} from "../lib/format";
import {Icon} from "../components/icons";
import {colors,radius,spacing,touch,typography} from "../theme";
type Props={api:MobileApiClient;businessId:string;branchId:string;role:string;currencyCode:string;timezone:string;online:boolean;onRecord:(r:OperationTransaction)=>Promise<ReceiptOutcome>;onFeedback:(f:MobileActionFeedback)=>void;onBack:()=>void};
const actions:Record<OperationAction,string>={OPERATING_DAY_OPEN_CREATE:"Open business day",OPERATING_DAY_CLOSE_CREATE:"Close business day",SHIFT_OPEN_CREATE:"Open my shift",SHIFT_CLOSE_CREATE:"Close my shift"};
function localTime(value:string,timezone:string){try{return new Intl.DateTimeFormat("en-GB",{timeZone:timezone,day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value));}catch{return value;}}
function Interval({item,currencyCode,timezone,label}:{item:MobileOperationInterval;currencyCode:string;timezone:string;label:string}){
 return <View style={styles.section}><Text style={styles.heading}>{label} · {item.status}</Text><Text style={styles.muted}>Opened {localTime(item.openedAt,timezone)}{item.closedAt?" · Closed "+localTime(item.closedAt,timezone):""}</Text>
 {item.balances.map(b=><View key={b.method} style={styles.line}><View style={styles.flex}><Text style={styles.heading}>{b.method}</Text><Text style={styles.muted}>Opening {formatMoney(b.openingCountedMinor,currencyCode)} · Movement {formatMoney(b.movementMinor,currencyCode)}</Text><Text style={styles.muted}>{b.closingCountedMinor===null?"Not counted":"Counted "+formatMoney(b.closingCountedMinor,currencyCode)}</Text></View><View style={styles.amount}><Text style={[styles.heading,styles.right]}>{formatMoney(b.expectedClosingMinor,currencyCode)}</Text><Text style={b.varianceMinor?styles.variance:styles.muted}>{b.varianceMinor===null?"Expected":"Variance "+formatMoney(b.varianceMinor,currencyCode)}</Text></View></View>)}
 {item.note?<Text style={styles.muted}>{item.note}</Text>:null}</View>;
}
export function OperationsScreen({api,businessId,branchId,role,currencyCode,timezone,online,onRecord,onFeedback,onBack}:Props){
 const read=canReadOperations(role),manage=canManageDays(role),own=canManageOwnShift(role),policyWrite=canChangeShiftPolicy(role);
 const [current,setCurrent]=useState<MobileOperationsCurrent|null>(null),[days,setDays]=useState<MobileOperationInterval[]>([]),[shifts,setShifts]=useState<MobileOperationInterval[]>([]);
 const [policy,setPolicy]=useState<MobileShiftPolicy|null>(null),[policyEdit,setPolicyEdit]=useState<boolean|null>(null),[policyReason,setPolicyReason]=useState("");
 const [action,setAction]=useState<OperationAction|null>(null),[counts,setCounts]=useState(blankCounts),[date,setDate]=useState(""),[note,setNote]=useState(""),[review,setReview]=useState<OperationTransaction|null>(null);
 const [history,setHistory]=useState<"days"|"shifts">("days"),[selected,setSelected]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const seq=useRef(0),lock=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;++seq.current;}},[]);
 const refresh=useCallback(async()=>{
  const n=++seq.current;
  if(!online||!read){setCurrent(null);setDays([]);setShifts([]);setPolicy(null);return;}
  setLoading(true);
  try{
   const [c,d,s,p]=await Promise.all([api.getOperationsCurrent(businessId,branchId),api.getOperatingDays(businessId,branchId),api.getStaffShifts(businessId,branchId),api.getShiftPolicy(businessId,branchId).catch(()=>null)]);
   if(n===seq.current){
    if([c.operatingDay,c.shift].some(x=>x&&!inOperationScope(x,businessId,branchId)))throw new Error("Unexpected operation context.");
    setCurrent(c);setDays(d.days.filter(x=>inOperationScope(x,businessId,branchId)));setShifts(s.shifts.filter(x=>inOperationScope(x,businessId,branchId)));setPolicy(p?.policy??null);
   }
  }catch{if(n===seq.current){setCurrent(null);setDays([]);setShifts([]);setPolicy(null);setError("Could not verify current operations and history.");}}
  finally{if(n===seq.current)setLoading(false);}
 },[api,businessId,branchId,online,read]);
 useEffect(()=>{void refresh();return()=>{++seq.current;}},[refresh]);
 useEffect(()=>{if(!online){setAction(null);setReview(null);setPolicyEdit(null);}},[online]);
 function begin(next:OperationAction){setError(null);setAction(next);setCounts(blankCounts());setNote("");setReview(null);try{setDate(branchBusinessDate(timezone));}catch{setDate("");}}
 function prepare(){
  if(!current||!action)return;
  try{setReview(operationInput(action,current,counts,date,note,role,businessId,branchId));setError(null);}catch(e){setError((e as Error).message);}
 }
 async function submit(){
  if(!review||!online||lock.current)return;
  lock.current=true;setBusy(true);setError(null);
  try{const result=await onRecord(review);if(!live.current)return;setReview(null);setAction(null);
   onFeedback({tone:result==="SYNCED"?"success":result==="PENDING"?"warning":"danger",title:result==="SYNCED"?"Operation recorded":result==="PENDING"?"Operation pending":"Operation needs review",message:result==="SYNCED"?"The server confirmed the interval. Current status and reconciliation are refreshing.":"Do not submit again. Resolve the original operation in the sync queue."});void refresh();
  }catch(e){if(live.current)setError((e as Error).message);}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function savePolicy(){
  if(policyEdit===null||!policy||!policyWrite||!online||lock.current)return;
  if(policyReason.trim().length<10||policyReason.trim().length>500){setError("Explain the policy change in 10–500 characters.");return;}
  lock.current=true;setBusy(true);setError(null);
  try{const r=await api.updateShiftPolicy(businessId,branchId,{required:policyEdit,expectedRevision:policy.revision,reason:policyReason.trim()});if(!live.current)return;setPolicy(r.policy);setPolicyEdit(null);onFeedback({tone:"success",title:"Branch policy updated",message:"The server confirmed the shift requirement."});void refresh();}
  catch{if(live.current){setPolicyEdit(null);setError("Policy change not confirmed. Review the refreshed policy.");void refresh();}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 const records=history==="days"?days:shifts;
 return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
 <View style={styles.row}><Text accessibilityRole="header" style={[styles.title,styles.flex]}>Operating days &amp; shifts</Text><Pressable accessibilityRole="button" accessibilityLabel="Back to more" accessibilityState={{disabled:busy}} disabled={busy} onPress={onBack} style={styles.iconButton}><Icon name="close" size={20}/></Pressable></View>
 {!read?<Banner tone="warning" message="Your role cannot access this workspace."/>:!online?<Banner tone="info" message="Connect to verify operating days and staff shifts."/>:<>
 {error?<Banner tone="warning" message={error}/>:null}
 <Card padding="compact" style={styles.section}><View style={styles.row}><Text style={[styles.heading,styles.flex]}>Branch trading status</Text><Pressable accessibilityRole="button" accessibilityLabel="Refresh operating status" accessibilityState={{disabled:busy||loading||!!action||policyEdit!==null,busy:loading}} disabled={busy||loading||!!action||policyEdit!==null} onPress={()=>void refresh()} style={styles.iconButton}>{loading?<ActivityIndicator color={colors.midnight}/>:<Icon name="refresh" size={20}/>}</Pressable></View>
 {current?<><View style={styles.summary}><Text style={styles.muted}>Business day</Text><Text style={styles.title}>{current.operatingDay?"Open · "+(current.operatingDay.businessDate??""):"No open business day"}</Text></View><View style={styles.wrap}><View style={styles.metric}><Text style={styles.heading}>{current.openShiftCount}</Text><Text style={styles.muted}>Open staff shifts</Text></View><View style={styles.metric}><Text style={styles.heading}>{current.shift?"Open":"Closed / not opened"}</Text><Text style={styles.muted}>My shift</Text></View></View>
 {!action&&policyEdit===null?<>{manage&&!current.operatingDay?<Button variant="gold" accessibilityLabel={actions.OPERATING_DAY_OPEN_CREATE} onPress={()=>begin("OPERATING_DAY_OPEN_CREATE")}>{actions.OPERATING_DAY_OPEN_CREATE}</Button>:null}
 {own&&current.operatingDay?<Button variant="gold" accessibilityLabel={current.shift?actions.SHIFT_CLOSE_CREATE:actions.SHIFT_OPEN_CREATE} onPress={()=>begin(current.shift?"SHIFT_CLOSE_CREATE":"SHIFT_OPEN_CREATE")}>{current.shift?actions.SHIFT_CLOSE_CREATE:actions.SHIFT_OPEN_CREATE}</Button>:null}
 {manage&&current.operatingDay?<Button variant="secondary" disabled={current.openShiftCount>0||!!current.shift} accessibilityLabel={actions.OPERATING_DAY_CLOSE_CREATE} onPress={()=>begin("OPERATING_DAY_CLOSE_CREATE")}>{actions.OPERATING_DAY_CLOSE_CREATE}</Button>:null}
 {manage&&current.openShiftCount>0?<Text style={styles.muted}>Every staff member must close their own shift first.</Text>:null}</>:null}
 </>:<Text style={styles.muted}>Current status has not been verified.</Text>}
 </Card>
 {action?<Card style={styles.section}><Text style={styles.heading}>{actions[action]}</Text>
 {action==="OPERATING_DAY_OPEN_CREATE"?<Input label="Business date (YYYY-MM-DD)" value={date} editable={!busy&&!review} onChangeText={setDate}/>:null}
 <Banner tone="info" message="Count actual balances for every payment method. Enter 0 for methods with no funds. Do not copy expected balances without checking them."/>
 <View style={styles.wrap}>{paymentMethods.map(method=><View key={method} style={styles.field}><Input label={method+" counted amount"} value={counts[method]} keyboardType="decimal-pad" editable={!busy&&!review} onChangeText={value=>setCounts(old=>({...old,[method]:value}))}/></View>)}</View>
 <Input label="Handover note" value={note} multiline editable={!busy&&!review} onChangeText={setNote}/>
 {review?<Banner tone="warning" message={action.includes("CLOSE")?"Confirm actual closing counts. The server computes expected amounts and variances from its ledger.":"Confirm these opening balances before starting the interval."}/>:null}
 <Button loading={busy} accessibilityLabel={review?"Confirm operation":"Review counts"} onPress={()=>review?void submit():prepare()}>{review?"Confirm operation":"Review counts"}</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel operation" onPress={()=>{setAction(null);setReview(null);}}>Cancel</Button></Card>:null}
 {current?.operatingDay?<Card><Interval item={current.operatingDay} label="Current business day" currencyCode={currencyCode} timezone={timezone}/></Card>:null}
 {current?.shift?<Card><Interval item={current.shift} label="My current shift" currencyCode={currencyCode} timezone={timezone}/></Card>:null}
 <Card style={styles.section}><Text style={styles.heading}>Shift requirement for sales</Text>
 {policy?<><Text>{policy.required?"Active shift required before sales":"Shift requirement disabled"}</Text>{policyWrite&&!action&&policyEdit===null?<Button variant="secondary" accessibilityLabel="Change shift requirement" onPress={()=>{setPolicyEdit(!policy.required);setPolicyReason("");}}>{policy.required?"Disable requirement":"Enable requirement"}</Button>:null}</>:<Text style={styles.muted}>Policy unavailable on this server.</Text>}
 {policyEdit!==null?<><Banner tone="warning" message={policyEdit?"Sales will require a verified shift at the sale time. Ensure staff can open their shifts.":"Disables this branch's shift-before-sale requirement. Existing shift history remains."}/><Input label="Reason for change" value={policyReason} multiline editable={!busy} onChangeText={setPolicyReason}/><Button loading={busy} accessibilityLabel="Confirm shift policy" onPress={()=>void savePolicy()}>Confirm policy</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel shift policy" onPress={()=>setPolicyEdit(null)}>Cancel</Button></>:null}</Card>
 <Card style={styles.section}><View style={styles.row}>{(["days","shifts"] as const).map(h=><Pressable key={h} accessibilityRole="button" accessibilityState={{selected:history===h}} accessibilityLabel={"Show "+h} onPress={()=>{setHistory(h);setSelected(null);}} style={[styles.chip,history===h&&styles.chipActive]}><Text style={[styles.heading,history===h&&styles.chipTextActive]}>{h==="days"?"Business days":"Staff shifts"}</Text></Pressable>)}</View>
 {role==="CASHIER"&&history==="shifts"?<Text style={styles.muted}>Your own shift history</Text>:null}
 {records.length===0?<Text style={styles.muted}>No records returned.</Text>:null}
 {records.map(item=><View key={item.id} style={styles.section}><Button variant="secondary" accessibilityLabel={"View interval "+item.id} onPress={()=>setSelected(selected===item.id?null:item.id)}>{item.businessDate??localTime(item.openedAt,timezone)} · {item.status}</Button>
 {selected===item.id?<><Interval item={item} label={history==="days"?"Business day":"Staff shift"} currencyCode={currencyCode} timezone={timezone}/>{item.staffId?<Text style={styles.muted}>Staff reference: {item.staffId}</Text>:null}</>:null}</View>)}</Card>
 </>}
 </ScrollView>;
}
const styles=StyleSheet.create({page:{flexGrow:1,padding:spacing.s3,gap:spacing.s3,backgroundColor:colors.canvas,paddingBottom:spacing.s6},row:{flexDirection:"row",alignItems:"center",flexWrap:"wrap",gap:spacing.s2},flex:{flex:1,minWidth:0},title:{fontSize:typography.section,fontWeight:typography.weightHeavy,color:colors.textStrong},heading:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,lineHeight:typography.metaLine,color:colors.textMuted},variance:{fontSize:typography.meta,color:colors.danger,fontWeight:typography.weightBold},section:{gap:spacing.s3},line:{flexDirection:"row",alignItems:"center",gap:spacing.s2,borderBottomWidth:1,borderBottomColor:colors.border,paddingVertical:spacing.s2},summary:{backgroundColor:colors.goldSoft,borderRadius:radius.sm,padding:spacing.s3,gap:spacing.s1},wrap:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},metric:{flexGrow:1,flexBasis:120,minWidth:0,padding:spacing.s2,borderRadius:radius.sm,backgroundColor:colors.surfaceSoft,gap:spacing.s1},field:{flexGrow:1,flexBasis:130,minWidth:0},amount:{maxWidth:"44%",minWidth:0,alignItems:"flex-end"},right:{textAlign:"right"},iconButton:{width:touch.iconTarget,minHeight:touch.iconTarget,alignItems:"center",justifyContent:"center",borderRadius:radius.sm,backgroundColor:colors.surfaceSoft},chip:{minHeight:touch.iconTarget,padding:spacing.s2,borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,justifyContent:"center"},chipActive:{backgroundColor:colors.midnight,borderColor:colors.midnight},chipTextActive:{color:colors.textInverse}});
