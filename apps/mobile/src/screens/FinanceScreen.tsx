import {useCallback,useEffect,useRef,useState} from "react";
import {ScrollView,View,Text,StyleSheet} from "react-native";
import type {MobileApiClient,MobileTreasuryAccount,MobileExpenseCategory,MobileCashbook,MobileExpense} from "../api-client";
import {canReadFinance,canRecordExpense,canManageTreasury,accountInScope,expenseInput,transferInput,type FinanceTransaction} from "../finance-workspace";
import type {ReceiptOutcome} from "../customer-payment";
import type {MobileActionFeedback} from "../action-feedback";
import {TreasuryPanel} from "./TreasuryPanel";
import type {TreasuryTransaction} from "../treasury-workspace";
import {Button} from "../components/Button";
import {Card} from "../components/Card";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {formatMoney} from "../lib/format";
import {colors,spacing,typography} from "../theme";
type Props={api:MobileApiClient;businessId:string;branchId:string;role:string;currencyCode:string;online:boolean;onRecord:(r:FinanceTransaction|TreasuryTransaction)=>Promise<ReceiptOutcome>;onFeedback:(f:MobileActionFeedback)=>void;onBack:()=>void};
export function FinanceScreen({api,businessId,branchId,role,currencyCode,online,onRecord,onFeedback,onBack}:Props){
 const read=canReadFinance(role),write=canRecordExpense(role),manage=canManageTreasury(role);
 const [accounts,setAccounts]=useState<MobileTreasuryAccount[]>([]),[categories,setCategories]=useState<MobileExpenseCategory[]>([]),[cashbook,setCashbook]=useState<MobileCashbook|null>(null),[expenses,setExpenses]=useState<MobileExpense[]>([]);
 const [mode,setMode]=useState<"expense"|"transfer"|"category"|null>(null),[source,setSource]=useState(""),[destination,setDestination]=useState(""),[category,setCategory]=useState(""),[amount,setAmount]=useState(""),[description,setDescription]=useState(""),[payee,setPayee]=useState("");
 const [categoryDraft,setCategoryDraft]=useState<{name:string;active:boolean;id?:string;expectedUpdatedAt?:string}>({name:"",active:true});
 const [tab,setTab]=useState<"cashbook"|"expenses"|"categories">("cashbook"),[review,setReview]=useState<FinanceTransaction|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
 const seq=useRef(0),lock=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;++seq.current;}},[]);
 const refresh=useCallback(async()=>{
  const n=++seq.current;if(!read||!online){setAccounts([]);setCategories([]);setCashbook(null);setExpenses([]);return;}
  setLoading(true);
  try{
   const [a,c,b,e]=await Promise.all([api.getTreasuryAccounts(businessId,branchId),api.getExpenseCategories(businessId),api.getCashbook(businessId,branchId),api.getExpenses(businessId,branchId)]);
   if(n===seq.current){setAccounts(a.accounts.filter(x=>x.businessId===businessId&&(!x.branchId||x.branchId===branchId)&&x.currencyCode===currencyCode));setCategories(c.categories);setCashbook(b);setExpenses(e.expenses.filter(x=>x.branchId===branchId&&x.currencyCode===currencyCode));}
  }catch{if(n===seq.current){setAccounts([]);setCategories([]);setCashbook(null);setExpenses([]);setError("Could not verify finance records.");}}
  finally{if(n===seq.current)setLoading(false);}
 },[api,businessId,branchId,currencyCode,online,read]);
 useEffect(()=>{void refresh();return()=>{++seq.current;}},[refresh]);
 useEffect(()=>{if(!online){setMode(null);setReview(null);}},[online]);
 const eligible=accounts.filter(a=>accountInScope(a,businessId,branchId,currencyCode));
 const account=eligible.find(a=>a.id===source),target=eligible.find(a=>a.id===destination),expenseCategory=categories.find(c=>c.id===category);
 function begin(next:"expense"|"transfer"|"category"){setMode(next);setSource("");setDestination("");setCategory("");setAmount("");setDescription("");setPayee("");setReview(null);setError(null);setCategoryDraft({name:"",active:true});}
 function prepare(){
  try{if(!account)throw new Error("Select an account.");
   if(mode==="expense"){if(!expenseCategory)throw new Error("Select an expense category.");setReview(expenseInput(account,expenseCategory,amount,description,payee,businessId,branchId,currencyCode));}
   else if(mode==="transfer"){if(!target)throw new Error("Select a destination account.");setReview(transferInput(account,target,amount,description,businessId,branchId,currencyCode));}setError(null);
  }catch(e){setError((e as Error).message);}
 }
 async function submit(){
  if(!review||!online||lock.current)return;
  lock.current=true;setBusy(true);setError(null);
  try{const r=await onRecord(review);if(!live.current)return;setMode(null);setReview(null);
   onFeedback({tone:r==="SYNCED"?"success":r==="PENDING"?"warning":"danger",title:r==="SYNCED"?"Finance transaction posted":r==="PENDING"?"Transaction pending":"Transaction needs review",message:r==="SYNCED"?"The ledger entry was accepted. Balances are refreshing.":"Do not submit again; reconcile the original entry in the sync queue."});void refresh();
  }catch(e){if(live.current)setError((e as Error).message);}finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function saveCategory(){
  if(!online||!manage||lock.current)return;
  if(!categoryDraft.name.trim()||categoryDraft.name.trim().length>160){setError("Enter a category name of up to 160 characters.");return;}
  lock.current=true;setBusy(true);setError(null);
  try{const r=await api.saveExpenseCategory(businessId,{name:categoryDraft.name.trim(),...(categoryDraft.id?{active:categoryDraft.active}:{})},categoryDraft.id&&categoryDraft.expectedUpdatedAt?{id:categoryDraft.id,expectedUpdatedAt:categoryDraft.expectedUpdatedAt}:undefined);
    if(!live.current)return;
    ++seq.current;setCategories(old=>[r.category,...old.filter(c=>c.id!==r.category.id)]);setMode(null);onFeedback({tone:"success",title:"Category saved",message:"Expense categories have been updated."});void refresh();
  }catch{if(live.current){setMode(null);setError("Category save not confirmed. Reload and review before trying again.");void refresh();}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
 <View style={styles.row}><Text style={[styles.title,styles.flex]}>Cashbook &amp; expenses</Text><Button variant="secondary" size="compact" disabled={busy} accessibilityLabel="Back to more" onPress={onBack}>Back</Button></View>
 {!read?<Banner tone="warning" message="Your role cannot access finance records."/>:!online?<Banner tone="info" message="Connect to view and post financial records."/>:<>
 {error?<Banner tone="warning" message={error}/>:null}
 <Card style={styles.card}><Text style={styles.heading}>Branch cash movements · all time</Text>
 {cashbook?<><View style={styles.row}><Text style={styles.flex}>Inflows</Text><Text style={styles.positive}>{formatMoney(cashbook.summary.inflowMinor,currencyCode)}</Text></View><View style={styles.row}><Text style={styles.flex}>Outflows</Text><Text style={styles.negative}>{formatMoney(cashbook.summary.outflowMinor,currencyCode)}</Text></View><View style={styles.row}><Text style={styles.flex}>Net movement</Text><Text style={styles.title}>{formatMoney(cashbook.summary.netMinor,currencyCode)}</Text></View></>:<Text style={styles.muted}>No verified totals available.</Text>}
 <Text style={styles.muted}>Net branch movement is not the same as account balance or profit.</Text><Button variant="secondary" disabled={busy||loading} accessibilityLabel="Refresh finance" onPress={()=>void refresh()}>Refresh</Button></Card>
 <Card style={styles.card}><Text style={styles.heading}>Treasury accounts</Text>{accounts.map(a=><View key={a.id} style={styles.list}><View style={styles.flex}><Text style={styles.heading}>{a.name}</Text><Text style={styles.muted}>{a.method} · {a.branchId?"Branch":"Business shared"} · {a.active?"Active":"Inactive"}</Text></View><Text style={styles.heading}>{formatMoney(a.balanceMinor,a.currencyCode)}</Text></View>)}
 {!mode?<>{write?<Button variant="gold" accessibilityLabel="Record expense" onPress={()=>begin("expense")}>Record expense</Button>:null}{manage?<Button variant="secondary" accessibilityLabel="Record account transfer" onPress={()=>begin("transfer")}>Record transfer</Button>:null}{manage?<Button variant="secondary" accessibilityLabel="Create expense category" onPress={()=>begin("category")}>New expense category</Button>:null}</>:null}</Card>
 {!mode?<TreasuryPanel api={api} accounts={accounts} businessId={businessId} branchId={branchId} currencyCode={currencyCode} role={role} onRecord={onRecord} onFeedback={onFeedback} onRefresh={()=>void refresh()}/>:null}
 {mode==="expense"||mode==="transfer"?<Card style={styles.card}><Text style={styles.heading}>{mode==="expense"?"New expense":"Account transfer"}</Text>
 <Banner tone="info" message={mode==="expense"?"Record a business expense already paid.":"Record money already moved between business accounts. This does not initiate a bank or mobile money transfer."}/>
 <Text style={styles.muted}>Paying account</Text>{eligible.map(a=><Button key={a.id} variant={source===a.id?"gold":"secondary"} disabled={busy||!!review} accessibilityLabel={"Source "+a.name} onPress={()=>setSource(a.id)}>{a.name} · {formatMoney(a.balanceMinor,a.currencyCode)}</Button>)}
 {mode==="transfer"?<><Text style={styles.muted}>Receiving account</Text>{eligible.filter(a=>a.id!==source).map(a=><Button key={a.id} variant={destination===a.id?"gold":"secondary"} disabled={busy||!!review} accessibilityLabel={"Destination "+a.name} onPress={()=>setDestination(a.id)}>{a.name}</Button>)}</>:<><Text style={styles.muted}>Expense category</Text>{categories.filter(c=>c.active).map(c=><Button key={c.id} variant={category===c.id?"gold":"secondary"} disabled={busy||!!review} accessibilityLabel={"Category "+c.name} onPress={()=>setCategory(c.id)}>{c.name}</Button>)}<Input label="Payee (optional)" value={payee} editable={!busy&&!review} onChangeText={setPayee}/></>}
 <Input label="Amount" value={amount} keyboardType="decimal-pad" editable={!busy&&!review} onChangeText={setAmount}/><Input label={mode==="expense"?"Description":"Transfer reference"} value={description} multiline editable={!busy&&!review} onChangeText={setDescription}/>
 {review?<Banner tone="warning" title="Confirm amount" message={formatMoney(review.payload.amountMinor,currencyCode)+" will be posted to the selected account(s). Confirm the real-world payment has occurred."}/>:null}
 <Button loading={busy} accessibilityLabel={review?"Confirm finance transaction":"Review finance transaction"} onPress={()=>review?void submit():prepare()}>{review?"Confirm transaction":"Review transaction"}</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel finance transaction" onPress={()=>{setMode(null);setReview(null);}}>Cancel</Button></Card>:null}
 {mode==="category"?<Card style={styles.card}><Text style={styles.heading}>Expense category</Text><Input label="Category name" value={categoryDraft.name} editable={!busy} onChangeText={name=>setCategoryDraft(old=>({...old,name}))}/>{categoryDraft.id?<Button variant="secondary" disabled={busy} accessibilityLabel="Toggle category status" onPress={()=>setCategoryDraft(old=>({...old,active:!old.active}))}>{categoryDraft.active?"Active":"Inactive"}</Button>:null}<Button loading={busy} accessibilityLabel="Save expense category" onPress={()=>void saveCategory()}>Save category</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel category edit" onPress={()=>setMode(null)}>Cancel</Button></Card>:null}
 <Card style={styles.card}><View style={styles.wrap}>{(["cashbook","expenses","categories"] as const).map(t=><Button key={t} size="compact" variant={tab===t?"gold":"secondary"} accessibilityLabel={t} onPress={()=>setTab(t)}>{t==="cashbook"?"Cashbook":t==="expenses"?"Expenses":"Categories"}</Button>)}</View>
 {loading?<Text style={styles.muted}>Loading records…</Text>:null}
 {tab==="cashbook"?cashbook?.entries.filter(e=>e.branchId===branchId&&e.currencyCode===currencyCode).map(e=><View key={e.id} style={styles.list}><View style={styles.flex}><Text style={styles.heading}>{e.entryType.replaceAll("_"," ")}</Text><Text style={styles.muted}>{accounts.find(a=>a.id===e.moneyAccountId)?.name??e.method} · {e.occurredAt.slice(0,10)}</Text></View><Text style={e.amountDeltaMinor<0?styles.negative:styles.positive}>{formatMoney(e.amountDeltaMinor,e.currencyCode)}</Text></View>):tab==="expenses"?expenses.map(e=><View key={e.id} style={styles.list}><View style={styles.flex}><Text style={styles.heading}>{e.categoryName}</Text><Text style={styles.muted}>{e.description??e.payee??e.method} · {e.status}</Text></View><Text style={styles.negative}>{formatMoney(e.amountMinor,e.currencyCode)}</Text></View>):categories.map(c=><View key={c.id} style={styles.list}><View style={styles.flex}><Text style={styles.heading}>{c.name}</Text><Text style={styles.muted}>{c.active?"Active":"Inactive"}</Text></View>{manage?<Button size="compact" variant="secondary" disabled={busy||!!mode} accessibilityLabel={"Edit "+c.name} onPress={()=>{begin("category");setCategoryDraft({id:c.id,name:c.name,active:c.active,expectedUpdatedAt:c.updatedAt});}}>Edit</Button>:null}</View>)}
 {tab!=="categories"?<Text style={styles.muted}>Showing up to 100 recent records; branch totals cover the full period.</Text>:null}</Card></>}
 </ScrollView>;
}
const styles=StyleSheet.create({page:{flexGrow:1,padding:spacing.s4,gap:spacing.s4,backgroundColor:colors.canvas,paddingBottom:spacing.s8},row:{flexDirection:"row",alignItems:"center",gap:spacing.s2},flex:{flex:1,minWidth:0},title:{fontSize:typography.section,fontWeight:typography.weightHeavy,color:colors.textStrong},heading:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,color:colors.textMuted},positive:{color:colors.positive,fontWeight:typography.weightBold},negative:{color:colors.danger,fontWeight:typography.weightBold},card:{gap:spacing.s3},wrap:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},list:{flexDirection:"row",alignItems:"center",gap:spacing.s2,paddingVertical:spacing.s3,borderBottomWidth:1,borderBottomColor:colors.border}});
