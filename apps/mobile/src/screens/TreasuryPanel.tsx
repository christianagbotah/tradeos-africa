import {useCallback,useEffect,useRef,useState} from "react";
import {Text,View,StyleSheet} from "react-native";
import type {MobileApiClient,MobileTreasuryAccount,MobileMoneyDefault,MobileReconciliation,CustomerPaymentMethod} from "../api-client";
import {accountDraft,reconciliationInput,resolutionInput,type TreasuryTransaction} from "../treasury-workspace";
import {canManageTreasury,canRecordExpense,accountInScope} from "../finance-workspace";
import {paymentMethods,type ReceiptOutcome} from "../customer-payment";
import type {MobileActionFeedback} from "../action-feedback";
import {Button} from "../components/Button";
import {Card} from "../components/Card";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {formatMoney} from "../lib/format";
import {colors,spacing,typography} from "../theme";
type Props={api:MobileApiClient;accounts:MobileTreasuryAccount[];businessId:string;branchId:string;currencyCode:string;role:string;onRecord:(r:TreasuryTransaction)=>Promise<ReceiptOutcome>;onRefresh:()=>void;onFeedback:(f:MobileActionFeedback)=>void};
type Draft={name:string;method:CustomerPaymentMethod;provider:string;referenceLabel:string;allowNegative:boolean;shared:boolean;active:boolean;id?:string;expectedUpdatedAt?:string};
const blank=():Draft=>({name:"",method:"CASH",provider:"",referenceLabel:"",allowNegative:false,shared:false,active:true});
export function TreasuryPanel({api,accounts,businessId,branchId,currencyCode,role,onRecord,onRefresh,onFeedback}:Props){
 const manage=canManageTreasury(role),count=canRecordExpense(role);
 const [expanded,setExpanded]=useState(false),[draft,setDraft]=useState<Draft|null>(null),[defaults,setDefaults]=useState<MobileMoneyDefault[]>([]),[rows,setRows]=useState<MobileReconciliation[]>([]);
 const [defaultEdit,setDefaultEdit]=useState<{mapping:MobileMoneyDefault;target:string}|null>(null),[selected,setSelected]=useState<MobileTreasuryAccount|null>(null),[observed,setObserved]=useState(""),[type,setType]=useState<"CASH_COUNT"|"STATEMENT">("CASH_COUNT"),[start,setStart]=useState(""),[end,setEnd]=useState(""),[note,setNote]=useState("");
 const [resolve,setResolve]=useState<MobileReconciliation|null>(null),[review,setReview]=useState<TreasuryTransaction|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(false);
 const lock=useRef(false),live=useRef(true),seq=useRef(0);
 useEffect(()=>{live.current=true;return()=>{live.current=false;++seq.current;}},[]);
 const refresh=useCallback(async()=>{
  const n=++seq.current;setLoading(true);
  try{const [d,r]=await Promise.all([api.getMoneyDefaults(businessId,branchId),api.getReconciliations(businessId,branchId)]);if(n===seq.current){setDefaults(d.defaults.filter(x=>x.branchId===branchId));setRows(r.reconciliations.filter(x=>x.branchId===branchId));}}
  catch{if(n===seq.current){setDefaults([]);setRows([]);setError("Could not verify treasury settings or reconciliations.");}}
  finally{if(n===seq.current)setLoading(false);}
 },[api,businessId,branchId]);
 useEffect(()=>{if(expanded)void refresh();return()=>{++seq.current;}},[expanded,refresh]);
 const eligible=accounts.filter(a=>accountInScope(a,businessId,branchId,currencyCode));
 const activeForm=!!(draft||selected||resolve||defaultEdit);
 function reset(){setDraft(null);setSelected(null);setResolve(null);setDefaultEdit(null);setReview(null);setNote("");setError(null);}
 async function saveAccount(){
  if(!draft||!manage||lock.current)return;
  let input:ReturnType<typeof accountDraft>;try{input=accountDraft(draft,branchId,currencyCode);}catch(e){setError((e as Error).message);return;}
  lock.current=true;setBusy(true);setError(null);
  try{const r=draft.id&&draft.expectedUpdatedAt?await api.updateTreasuryAccount(businessId,draft.id,{expectedUpdatedAt:draft.expectedUpdatedAt,name:input.name,provider:input.provider,referenceLabel:input.referenceLabel,allowNegative:input.allowNegative,active:draft.active}):await api.createTreasuryAccount(businessId,input);
   if(!live.current)return;
   if(r.account.businessId!==businessId||(draft.id&&r.account.id!==draft.id))throw new Error("Unexpected account response.");
   reset();onFeedback({tone:"success",title:"Treasury account saved",message:"The account configuration was confirmed."});onRefresh();void refresh();
  }catch{if(live.current){reset();setError("Account change not confirmed. Review refreshed accounts before trying again.");onRefresh();}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function saveDefault(){
  if(!defaultEdit||!manage||lock.current)return;
  const {mapping,target}=defaultEdit;
  if(!mapping.updatedAt||!eligible.some(a=>a.id===target&&a.method===mapping.method)){setError("Select an eligible account from the current mapping.");return;}
  lock.current=true;setBusy(true);setError(null);
  try{await api.setMoneyDefault(businessId,branchId,mapping.method,target,mapping.updatedAt);if(!live.current)return;reset();onFeedback({tone:"success",title:"Default account updated",message:"The server confirmed the payment-method mapping."});void refresh();onRefresh();}
  catch{if(live.current){setError("Default change not confirmed. Reload the current mapping.");void refresh();}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 function prepare(){
  try{
   if(resolve)setReview(resolutionInput(resolve,note,role,branchId));
   else if(selected)setReview(reconciliationInput(selected,observed,type,start,end,note,role,businessId,branchId,currencyCode));
   else return;setError(null);
  }catch(e){setError((e as Error).message);}
 }
 async function submit(){
  if(!review||lock.current)return;lock.current=true;setBusy(true);setError(null);
  try{const result=await onRecord(review);if(!live.current)return;reset();onFeedback({tone:result==="SYNCED"?"success":result==="PENDING"?"warning":"danger",title:result==="SYNCED"?"Reconciliation recorded":result==="PENDING"?"Reconciliation pending":"Reconciliation needs review",message:result==="SYNCED"?"Review the refreshed reconciliation status and account balance.":"Do not repeat the transaction; review the original queue entry."});onRefresh();void refresh();}
  catch(e){if(live.current)setError((e as Error).message);}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 return <Card style={styles.card}><Text style={styles.heading}>Treasury configuration &amp; reconciliation</Text>
 <Button variant="secondary" disabled={busy||activeForm} accessibilityLabel="Toggle treasury configuration" onPress={()=>setExpanded(!expanded)}>{expanded?"Hide treasury tools":"Open treasury tools"}</Button>
 {expanded?<>{error?<Banner tone="warning" message={error}/>:null}{loading?<Text style={styles.muted}>Loading verified records…</Text>:null}
 {!activeForm?<>{manage?<Button variant="gold" accessibilityLabel="Create treasury account" onPress={()=>{reset();setDraft(blank());}}>New account</Button>:null}
 {accounts.map(a=><View key={a.id} style={styles.line}><View style={styles.flex}><Text style={styles.heading}>{a.name}</Text><Text style={styles.muted}>{a.method} · {a.active?"Active":"Inactive"} · {formatMoney(a.balanceMinor,a.currencyCode)}</Text></View>{manage?<Button size="compact" variant="secondary" accessibilityLabel={"Edit "+a.name} onPress={()=>{reset();setDraft({id:a.id,expectedUpdatedAt:a.updatedAt,name:a.name,method:a.method as CustomerPaymentMethod,provider:a.provider??"",referenceLabel:a.referenceLabel??"",allowNegative:a.allowNegative,shared:!a.branchId,active:a.active});}}>Edit</Button>:null}{count&&a.active&&(role!=="CASHIER"||a.method==="CASH"&&a.branchId===branchId)?<Button size="compact" accessibilityLabel={"Reconcile "+a.name} onPress={()=>{reset();setSelected(a);setType(a.method==="CASH"?"CASH_COUNT":"STATEMENT");setObserved("");const now=new Date().toISOString();setStart(now);setEnd(now);}}>Count</Button>:null}</View>)}
 <Text style={styles.heading}>Default accounts · current branch</Text>{defaults.map(d=><View key={d.method} style={styles.line}><View style={styles.flex}><Text>{d.method}</Text><Text style={styles.muted}>{accounts.find(a=>a.id===d.moneyAccountId)?.name??"Configured account"}</Text></View>{manage&&d.updatedAt?<Button variant="secondary" size="compact" accessibilityLabel={"Change "+d.method+" default"} onPress={()=>{reset();setDefaultEdit({mapping:d,target:d.moneyAccountId});}}>Change</Button>:null}</View>)}
 </>:null}
 {draft?<><Text style={styles.heading}>{draft.id?"Edit account":"New account"}</Text><Input label="Account name" value={draft.name} editable={!busy} onChangeText={name=>setDraft(old=>old?{...old,name}:old)}/>{!draft.id?<View style={styles.wrap}>{paymentMethods.map(method=><Button key={method} size="compact" variant={draft.method===method?"gold":"secondary"} disabled={busy} accessibilityLabel={method} onPress={()=>setDraft(old=>old?{...old,method}:old)}>{method}</Button>)}</View>:null}
 <Input label="Provider (optional)" value={draft.provider} editable={!busy} onChangeText={provider=>setDraft(old=>old?{...old,provider}:old)}/><Input label="Reference label (optional)" value={draft.referenceLabel} editable={!busy} onChangeText={referenceLabel=>setDraft(old=>old?{...old,referenceLabel}:old)}/>
 {!draft.id?<Button variant="secondary" disabled={busy} accessibilityLabel="Toggle shared account" onPress={()=>setDraft(old=>old?{...old,shared:!old.shared}:old)}>{draft.shared?"Business shared account":"Current branch account"}</Button>:null}
 <Button variant="secondary" disabled={busy} accessibilityLabel="Toggle negative balance allowance" onPress={()=>setDraft(old=>old?{...old,allowNegative:!old.allowNegative}:old)}>{draft.allowNegative?"Negative balances allowed":"Prevent negative balances"}</Button>
 {draft.id?<Button variant="secondary" disabled={busy} accessibilityLabel="Toggle account status" onPress={()=>setDraft(old=>old?{...old,active:!old.active}:old)}>{draft.active?"Active account":"Inactive account"}</Button>:null}
 <Button loading={busy} accessibilityLabel="Save treasury account" onPress={()=>void saveAccount()}>Save account</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel account setup" onPress={reset}>Cancel</Button></>:null}
 {defaultEdit?<><Text style={styles.heading}>Default {defaultEdit.mapping.method} account</Text>{eligible.filter(a=>a.method===defaultEdit.mapping.method).map(a=><Button key={a.id} variant={defaultEdit.target===a.id?"gold":"secondary"} disabled={busy} accessibilityLabel={a.name} onPress={()=>setDefaultEdit(old=>old?{...old,target:a.id}:old)}>{a.name}</Button>)}<Button loading={busy} accessibilityLabel="Confirm default account" onPress={()=>void saveDefault()}>Confirm default</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel default selection" onPress={reset}>Cancel</Button></>:null}
 {selected||resolve?<><Text style={styles.heading}>{resolve?"Resolve reconciliation variance":selected?.name}</Text>
 {selected?<>{role!=="CASHIER"&&selected.method==="CASH"?<View style={styles.wrap}>{(["CASH_COUNT","STATEMENT"] as const).map(t=><Button key={t} variant={type===t?"gold":"secondary"} disabled={busy||!!review} accessibilityLabel={t} onPress={()=>setType(t)}>{t.replaceAll("_"," ")}</Button>)}</View>:null}
 <Input label="Observed balance" value={observed} keyboardType="numbers-and-punctuation" editable={!busy&&!review} onChangeText={setObserved}/><Input label="Period start (ISO date-time)" value={start} editable={!busy&&!review} onChangeText={setStart}/><Input label="Period end (ISO date-time)" value={end} editable={!busy&&!review} onChangeText={setEnd}/><Text style={styles.muted}>Use the actual count or statement cutoff. The server calculates the expected balance at that cutoff.</Text></>:<Banner tone="warning" message={"Variance "+formatMoney(resolve!.differenceMinor,currencyCode)+". Resolving it posts an audited cashbook correction. Check supporting evidence and confirm this variance has not already been corrected separately."}/>}
 <Input label={resolve?"Resolution explanation":"Note (optional)"} value={note} editable={!busy&&!review} multiline onChangeText={setNote}/>
 {review?<Banner tone="warning" message={resolve?"Confirm the reviewed ledger correction.":"Confirm the actual observed balance and cutoff. Recording a variance does not automatically correct the ledger."}/>:null}
 <Button loading={busy} accessibilityLabel={review?"Confirm reconciliation":"Review reconciliation"} onPress={()=>review?void submit():prepare()}>{review?"Confirm":"Review"}</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel reconciliation" onPress={reset}>Cancel</Button></>:null}
 <Text style={styles.heading}>Reconciliation history</Text>{rows.map(r=><View key={r.id} style={styles.card}><Text style={styles.heading}>{r.accountName} · {r.status}</Text><Text style={styles.muted}>{r.periodEnd} · {r.type}</Text><Text>Expected {formatMoney(r.expectedBalanceMinor,currencyCode)} · Observed {formatMoney(r.observedBalanceMinor,currencyCode)}</Text><Text style={r.differenceMinor===0?styles.muted:styles.variance}>Difference {formatMoney(r.differenceMinor,currencyCode)}</Text>{manage&&r.status==="VARIANCE"&&!activeForm?<Button variant="secondary" size="compact" accessibilityLabel={"Resolve variance "+r.id} onPress={()=>{reset();setResolve(r);}}>Review variance</Button>:null}</View>)}
 <Button variant="secondary" disabled={busy||loading||activeForm} accessibilityLabel="Refresh reconciliation history" onPress={()=>void refresh()}>Refresh treasury</Button></>:null}</Card>;
}
const styles=StyleSheet.create({card:{gap:spacing.s3},heading:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,color:colors.textMuted},variance:{color:colors.danger,fontWeight:typography.weightBold},line:{flexDirection:"row",alignItems:"center",gap:spacing.s2,paddingVertical:spacing.s2,borderBottomWidth:1,borderBottomColor:colors.border},flex:{flex:1,minWidth:0},wrap:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2}});
