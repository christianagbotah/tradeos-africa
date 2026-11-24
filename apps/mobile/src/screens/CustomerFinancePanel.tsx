import {useEffect,useRef,useState} from "react";
import {Pressable,StyleSheet,Text,View} from "react-native";
import {type MobileApiClient,type MobileCustomer,type MobileMoneyAccount,type MobileMoneyDefault,type CustomerPaymentMethod} from "../api-client";
import {type CustomerReceiptInput,type ReceiptOutcome,canCollectCustomerPayment,canControlCustomerCredit,creditTerms,eligibleCustomerAccounts,parseMinorAmount,paymentMethods,preferredAccount} from "../customer-payment";
import {Button} from "../components/Button";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {formatMoney} from "../lib/format";
import {colors,radius,spacing,typography} from "../theme";
import type {MobileActionFeedback} from "../action-feedback";
type Props={api:Pick<MobileApiClient,"getMoneyAccounts"|"getMoneyDefaults"|"updateCustomerCredit">;customer:MobileCustomer;businessId:string;branchId:string;currencyCode:string;role:string;online:boolean;onReceipt:(input:CustomerReceiptInput)=>Promise<ReceiptOutcome>;onRefresh:()=>Promise<void>;onFeedback:(feedback:MobileActionFeedback)=>void};
export function CustomerFinancePanel({api,customer,businessId,branchId,currencyCode,role,online,onReceipt,onRefresh,onFeedback}:Props){
  const [mode,setMode]=useState<"receipt"|"credit"|null>(null);
  const [amount,setAmount]=useState(""),[method,setMethod]=useState<CustomerPaymentMethod>("CASH");
  const [accountId,setAccountId]=useState<string|null>(null),[accounts,setAccounts]=useState<MobileMoneyAccount[]>([]),[defaults,setDefaults]=useState<MobileMoneyDefault[]>([]);
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [confirmed,setConfirmed]=useState(false),[blocked,setBlocked]=useState(false);
  const [limit,setLimit]=useState(""),[terms,setTerms]=useState("0"),[enabled,setEnabled]=useState(false);
  const lock=useRef(false),mounted=useRef(true),revision=useRef(customer.updatedAt);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;}},[]);
  useEffect(()=>{
    if(mode!=="receipt"||!online)return;
    let live=true;setLoading(true);setError(null);setAccounts([]);setDefaults([]);setAccountId(null);
    void Promise.all([api.getMoneyAccounts(businessId,branchId),api.getMoneyDefaults(businessId,branchId)]).then(([a,d])=>{
      if(live){setAccounts(a.accounts);setDefaults(d.defaults);}
    }).catch(()=>{if(live)setError("Could not verify receiving accounts.");}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[mode,api,businessId,branchId,online]);
  const eligible=eligibleCustomerAccounts(accounts,businessId,branchId,method,currencyCode);
  const selected=eligible.some(a=>a.id===accountId)?accountId:preferredAccount(eligible,defaults,branchId,method);
  const canCollect=canCollectCustomerPayment(role)&&customer.active;
  const canCredit=canControlCustomerCredit(role);
  function openCredit(){
    revision.current=customer.updatedAt;setEnabled(customer.creditEnabled);setLimit(customer.creditLimitMinor===null?"":(customer.creditLimitMinor/100).toFixed(2));setTerms(String(customer.creditTermsDays));setError(null);setMode("credit");
  }
  async function submitReceipt(){
    if(lock.current||!online||!canCollect||blocked||!selected)return;
    let minor:number;
    try{minor=parseMinorAmount(amount);}catch(e){setError((e as Error).message);return;}
    if(!confirmed){setConfirmed(true);setError(null);return;}
    lock.current=true;setBusy(true);setError(null);
    try{
      const outcome=await onReceipt({customerId:customer.id,amountMinor:minor,method,moneyAccountId:selected});
      if(!mounted.current)return;
      setMode(null);setConfirmed(false);setAmount("");
      if(outcome==="SYNCED"){
        onFeedback({tone:"success",title:"Payment recorded",message:"The server has posted this receipt to the customer account and cashbook."});
      }else{
        setBlocked(true);
        onFeedback({tone:outcome==="PENDING"?"warning":"danger",title:outcome==="PENDING"?"Receipt pending sync":"Receipt needs review",message:"Do not record this payment again. Review the existing submission in the sync queue."});
      }
      void onRefresh();
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:"Receipt could not be recorded. Review the sync queue.");}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  async function submitCredit(){
    if(lock.current||!online||!canCredit)return;
    let creditLimitMinor:number|null,creditTermsDays:number;
    try{creditLimitMinor=enabled?parseMinorAmount(limit,true):null;creditTermsDays=enabled?creditTerms(terms):0;}catch(e){setError((e as Error).message);return;}
    lock.current=true;setBusy(true);setError(null);
    try{
      const result=await api.updateCustomerCredit(businessId,customer.id,{expectedUpdatedAt:revision.current,creditLimitMinor,creditTermsDays});
      if(result.customer.id!==customer.id)throw new Error("Unexpected customer response.");
      if(!mounted.current)return;
      setMode(null);onFeedback({tone:"success",title:"Credit settings updated",message:"The new customer credit terms have been saved."});void onRefresh();
    }catch{if(mounted.current){setError("Credit update could not be confirmed. Close and reload the customer before retrying.");setMode(null);void onRefresh();}}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  return <View style={styles.panel}>
    <Text style={styles.heading}>Credit and payments</Text>
    <Text style={styles.muted}>{customer.creditEnabled?"Credit limit "+formatMoney(customer.creditLimitMinor??0,currencyCode)+" · "+customer.creditTermsDays+" days":"Credit disabled"}</Text>
    {blocked?<Banner tone="warning" message="An earlier payment is pending or needs review. Check the sync queue before recording another receipt."/>:null}
    {error?<Banner tone="danger" message={error}/>:null}
    {mode===null?<>{canCollect?<Button variant="gold" fullWidth disabled={!online||blocked||busy} accessibilityLabel="Record customer payment" onPress={()=>{setError(null);setConfirmed(false);setMode("receipt");}}>Record payment</Button>:null}
    {canCredit?<Button variant="secondary" fullWidth disabled={!online||busy} accessibilityLabel="Manage customer credit" onPress={openCredit}>Manage credit</Button>:null}</>:null}
    {mode==="receipt"?<>
      <Banner tone="info" message="Record funds already received. This does not charge a card, initiate a MoMo request or transfer money."/>
      <Input label="Amount received" value={amount} editable={!busy&&!confirmed} keyboardType="decimal-pad" onChangeText={setAmount} placeholder="0.00"/>
      <View style={styles.chips}>{paymentMethods.map(m=><Pressable key={m} disabled={busy||confirmed} accessibilityRole="button" accessibilityState={{selected:m===method}} onPress={()=>{setMethod(m);setAccountId(null);}} style={[styles.chip,m===method&&styles.active]}><Text style={styles.label}>{m}</Text></Pressable>)}</View>
      <Text style={styles.heading}>Receiving account</Text>
      {loading?<Text style={styles.muted}>Verifying accounts…</Text>:eligible.length===0?<Banner tone="warning" message="No verified receiving account for this method. Configure one in Cashbook."/>:eligible.map(a=><Button key={a.id} variant={a.id===selected?"gold":"secondary"} disabled={busy||confirmed} accessibilityLabel={"Receive into "+a.name} onPress={()=>setAccountId(a.id)}>{a.name}</Button>)}
      {confirmed?<Banner tone="warning" title="Confirm received funds" message={"Record "+amount+" "+currencyCode+" to "+(eligible.find(a=>a.id===selected)?.name??"the selected account")+"? Only confirm money already received."}/>:null}
      <Button variant="primary" loading={busy} disabled={!online||loading||!selected||!amount.trim()} accessibilityLabel={confirmed?"Confirm receipt":"Review receipt"} onPress={()=>void submitReceipt()}>{confirmed?"Confirm receipt":"Review receipt"}</Button>
    </>:null}
    {mode==="credit"?<>
      <View style={styles.chips}>{[true,false].map(v=><Pressable key={String(v)} disabled={busy} accessibilityRole="button" accessibilityState={{selected:v===enabled}} onPress={()=>setEnabled(v)} style={[styles.chip,v===enabled&&styles.active]}><Text style={styles.label}>{v?"Enable credit":"Disable credit"}</Text></Pressable>)}</View>
      {enabled?<><Input label="Credit limit" keyboardType="decimal-pad" editable={!busy} value={limit} onChangeText={setLimit}/><Input label="Credit terms (days)" keyboardType="number-pad" editable={!busy} value={terms} onChangeText={setTerms}/></>:null}
      <Button variant="primary" loading={busy} disabled={!online} accessibilityLabel="Save credit terms" onPress={()=>void submitCredit()}>Save credit terms</Button>
    </>:null}
    {mode!==null?<Button variant="secondary" disabled={busy} accessibilityLabel="Cancel finance form" onPress={()=>{setMode(null);setConfirmed(false);setError(null);}}>Cancel</Button>:null}
  </View>;
}
const styles=StyleSheet.create({panel:{gap:spacing.s2,padding:spacing.s3,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,backgroundColor:colors.surfaceSoft},heading:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,color:colors.textMuted},chips:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},chip:{borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,padding:spacing.s3},active:{backgroundColor:colors.goldSoft,borderColor:colors.gold},label:{color:colors.textStrong,fontWeight:typography.weightMedium}});
