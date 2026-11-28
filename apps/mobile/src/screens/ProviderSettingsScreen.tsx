import {useCallback,useEffect,useRef,useState} from "react";
import {ActivityIndicator,Pressable,AppState,ScrollView,Text,View,StyleSheet} from "react-native";
import type {MobileApiClient} from "../api-client";
import {canManageProviders,assertVaultScope,paymentActionAllowed,paymentFields,smsFields,smsProviders,type ProviderEnvironment,type ProviderAction,type PaymentVault,type GatewayOptions,type SmsVault,type SmsProvider} from "../provider-workspace";
import type {MobileActionFeedback} from "../action-feedback";
import {Button} from "../components/Button";
import {Card} from "../components/Card";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {Icon} from "../components/icons";
import {colors,radius,spacing,touch,typography} from "../theme";
type Props={api:MobileApiClient;businessId:string;role:string;online:boolean;onFeedback:(f:MobileActionFeedback)=>void;onBack:()=>void};
type Action=ProviderAction|"preference";
const actionLabels:Record<Action,string>={save:"Save credentials",verify:"Verify account",request:"Request activation",revoke:"Revoke credentials",preference:"Set preferred gateway"};
export function ProviderSettingsScreen({api,businessId,role,online,onFeedback,onBack}:Props){
 const allowed=canManageProviders(role);
 const [tab,setTab]=useState<"payment"|"sms">("payment"),[provider,setProvider]=useState("HUBTEL"),[environment,setEnvironment]=useState<ProviderEnvironment>("LIVE"),[sms,setSms]=useState<SmsProvider>("HUBTEL_SMS");
 const [payment,setPayment]=useState<PaymentVault|null>(null),[gateway,setGateway]=useState<GatewayOptions|null>(null),[messaging,setMessaging]=useState<SmsVault|null>(null);
 const [values,setValues]=useState<Record<string,string>>({}),[password,setPassword]=useState(""),[secret,setSecret]=useState(""),[sender,setSender]=useState(""),[account,setAccount]=useState("");
 const [confirm,setConfirm]=useState<Action|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
 const seq=useRef(0),live=useRef(true),lock=useRef(false);
 const clear=useCallback(()=>{setValues({});setPassword("");setSecret("");setConfirm(null);},[]);
 useEffect(()=>{live.current=true;const sub=AppState.addEventListener("change",state=>{if(state!=="active")clear();});return()=>{live.current=false;++seq.current;sub.remove();};},[clear]);
 const refresh=useCallback(async()=>{
  const n=++seq.current;setPayment(null);setGateway(null);setMessaging(null);clear();
  if(!online||!allowed){setLoading(false);return;}
  setLoading(true);setError(null);
  try{
   if(tab==="payment"){
    const [p,g]=await Promise.all([api.getPaymentVault(businessId),api.getGatewayOptions(businessId)]);
    assertVaultScope(p,businessId);assertVaultScope(g,businessId);
    if(p.collectionEnabled!==false)throw new Error("Unexpected vault state.");
    if(n===seq.current){setPayment(p);setGateway(g);setProvider(old=>p.schemas.some(s=>s.providerCode===old)?old:p.schemas[0]?.providerCode??"");}
   }else{
    const s=assertVaultScope(await api.getSmsVault(businessId),businessId);
    if(s.sendingEnabled!==false)throw new Error("Unexpected messaging state.");
    if(n===seq.current)setMessaging(s);
   }
  }catch{if(n===seq.current)setError("Provider settings could not be verified. Refresh when connected.");}
  finally{if(n===seq.current)setLoading(false);}
 },[api,businessId,online,allowed,tab,clear]);
 useEffect(()=>{void refresh();return()=>{++seq.current;}},[refresh]);
 useEffect(()=>{clear();setError(null);},[provider,environment,sms,clear]);
 const schema=payment?.schemas.find(x=>x.providerCode===provider),current=payment?.connections.find(x=>x.providerCode===provider&&x.environment===environment);
 const smsInfo=smsProviders.find(x=>x.code===sms)!,smsCurrent=messaging?.connections.find(x=>x.providerCode===sms);
 useEffect(()=>{setSender(smsCurrent?.senderId??"");setAccount(smsCurrent?.accountId??"");},[smsCurrent]);
 const enabled=online&&allowed&&!busy&&!loading;
 function canAction(action:Action){
  if(!enabled)return false;
  if(tab==="payment"){
   if(action==="preference")return !!gateway?.providers.some(x=>x.code===provider&&x.eligible)&&gateway?.preferredProvider!==provider;
   return !!payment&&!!schema&&paymentActionAllowed(action,payment,schema,environment,current);
  }
  return !!messaging&&messaging.vaultReady&&messaging.sendingEnabled===false&&(action==="save"||action==="revoke"&&!!smsCurrent&&smsCurrent.status!=="REVOKED");
 }
 function prepare(action:Action){
  if(!canAction(action))return;
  try{
   if(action!=="preference"&&!password)throw new Error("Enter your current TradeOS password.");
   if(action==="save"){if(tab==="payment"&&schema)paymentFields(schema,values);else if(tab==="sms")smsFields(sms,secret,sender,account);}
   setError(null);setConfirm(action);
  }catch(e){setError((e as Error).message);}
 }
 async function submit(){
  const action=confirm;if(!action||!canAction(action)||lock.current)return;
  lock.current=true;setBusy(true);setError(null);
  try{
   if(action==="preference"&&gateway&&tab==="payment")await api.setGatewayPreference(businessId,provider,gateway.revision);
   else if(tab==="payment"&&schema){
    const r=await api.changePaymentCredentials(businessId,provider,environment,action as ProviderAction,{currentPassword:password,expectedRevision:current?.revision??0,...(action==="save"?{fields:paymentFields(schema,values)}:{})});
    if(r.connection.providerCode!==provider||r.connection.environment!==environment||r.connection.collectionEnabled!==false)throw new Error("Connection response mismatch.");
   }else if(tab==="sms"&&(action==="save"||action==="revoke")){
    const r=await api.changeSmsCredentials(businessId,sms,action,{currentPassword:password,expectedRevision:smsCurrent?.revision??0,...(action==="save"?smsFields(sms,secret,sender,account):{})});
    if(r.connection.providerCode!==sms||r.connection.enabled!==false)throw new Error("Connection response mismatch.");
   }else throw new Error("Invalid action.");
   if(!live.current)return;
   onFeedback({tone:"success",title:"Provider settings updated",message:action==="request"?"Activation request recorded. Collection remains disabled until approved.":action==="verify"?"Read-only verification confirmed; live collection is not enabled by verification.":action==="preference"?"Preference saved. This does not enable collection.":action==="revoke"?"Credentials revoked. Existing payments still require reconciliation.":"Credentials saved in the server vault. This does not activate collection or sending."});
   void refresh();
  }catch{if(live.current){setPayment(null);setMessaging(null);setGateway(null);setError("Change not confirmed. Refresh and inspect the current status before trying again.");}}
  finally{lock.current=false;if(live.current){clear();setBusy(false);}}
 }
 return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
 <View style={styles.row}><Text accessibilityRole="header" style={[styles.title,styles.flex]}>Payment &amp; SMS integrations</Text><Pressable accessibilityRole="button" accessibilityLabel="Back to more" accessibilityState={{disabled:busy}} disabled={busy} onPress={onBack} style={styles.iconButton}><Icon name="close" size={20}/></Pressable></View>
 {!allowed?<Banner tone="warning" message="Only business owners and administrators can configure provider credentials."/>:!online?<Banner tone="info" message="Connect online to manage secure provider settings."/>:<>
 <Banner tone="info" message="Use credentials issued to your own business. Secrets are sent directly to the HTTPS API and encrypted in the server vault. They cannot be viewed after saving."/>
 <View style={styles.wrap}>{(["payment","sms"] as const).map(t=><Button key={t} size="compact" variant={tab===t?"gold":"secondary"} disabled={busy||!!confirm} accessibilityLabel={t==="payment"?"Payment providers":"SMS providers"} onPress={()=>{if(t!==tab){clear();setTab(t);}}}>{t==="payment"?"Payment providers":"SMS providers"}</Button>)}</View>
 <View style={styles.row}><Text style={[styles.muted,styles.flex]}>{loading?"Loading…":"Provider status"}</Text><Pressable accessibilityRole="button" accessibilityLabel="Refresh providers" accessibilityState={{disabled:busy||loading||!!confirm,busy:loading}} disabled={busy||loading||!!confirm} onPress={()=>void refresh()} style={styles.iconButton}>{loading?<ActivityIndicator color={colors.midnight}/>:<Icon name="refresh" size={20}/>}</Pressable></View>
 {error?<Banner tone="warning" message={error}/>:null}
 {tab==="payment"&&payment&&schema?<Card style={styles.section}>
 <Text style={styles.heading}>Merchant payment provider</Text><View style={styles.wrap}>{payment.schemas.map(s=><Button key={s.providerCode} variant={provider===s.providerCode?"gold":"secondary"} size="compact" disabled={busy||!!confirm} accessibilityLabel={s.providerCode} onPress={()=>setProvider(s.providerCode)}>{s.providerCode}</Button>)}</View>
 <Text style={styles.muted}>Preferred: {gateway?.preferredProvider??gateway?.effectiveLegacyProvider??"Not set"} · Existing collection readiness: {gateway?.collectionReady?"Ready":"Not ready"}</Text>
 <Button variant="secondary" disabled={!canAction("preference")||!!confirm} accessibilityLabel="Set preferred payment gateway" onPress={()=>prepare("preference")}>Use {provider} as preferred gateway</Button>
 <View style={styles.wrap}>{(["TEST","LIVE"] as const).map(e=><Button key={e} size="compact" variant={environment===e?"gold":"secondary"} disabled={busy||!!confirm} accessibilityLabel={e+" credentials"} onPress={()=>setEnvironment(e)}>{e}</Button>)}</View>
 <View style={styles.record}><Text style={styles.muted}>Credential status · {environment}</Text><Text style={styles.heading}>{current?.status.replaceAll("_"," ")??"Not configured"}</Text></View>{current?.activationRequestedAt?<Text style={styles.muted}>Activation requested: {current.activationRequestedAt}</Text>:null}
 {!payment.vaultReady?<Banner tone="warning" message="Server credential vault is unavailable. Credential changes are disabled."/>:null}
 {schema.fields.map(f=><Input key={f.id} label={f.label+(f.required?" *":"")} hint={f.hint??null} value={values[f.id]??""} secureTextEntry={f.secret} autoCapitalize="none" autoCorrect={false} editable={enabled&&!confirm&&payment.vaultReady} onChangeText={v=>setValues(old=>({...old,[f.id]:v}))}/>)}
 <Input label="Current TradeOS password" value={password} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={enabled&&!confirm} onChangeText={setPassword}/>
 {!confirm?<View style={styles.section}>{(["save","verify","request","revoke"] as const).map(a=><Button key={a} variant={a==="save"?"gold":a==="revoke"?"danger":"secondary"} disabled={!canAction(a)} accessibilityLabel={actionLabels[a]} onPress={()=>prepare(a)}>{actionLabels[a]}</Button>)}</View>:null}
 <Text style={styles.muted}>Verification is available only for supported providers. Saving credentials or requesting activation does not enable live collection.</Text></Card>:null}
 {tab==="sms"&&messaging?<Card style={styles.section}><Text style={styles.heading}>SMS provider</Text><View style={styles.wrap}>{smsProviders.map(s=><Button key={s.code} variant={sms===s.code?"gold":"secondary"} size="compact" disabled={busy||!!confirm} accessibilityLabel={s.name} onPress={()=>setSms(s.code)}>{s.name}</Button>)}</View>
 <View style={styles.record}><Text style={styles.muted}>SMS credential status</Text><Text style={styles.heading}>{smsCurrent?.status.replaceAll("_"," ")??"Not configured"}</Text></View>
 {!messaging.vaultReady?<Banner tone="warning" message="Server credential vault is unavailable."/>:null}
 {smsInfo.accountLabel?<Input label={smsInfo.accountLabel} value={account} autoCapitalize="none" autoCorrect={false} editable={enabled&&!confirm&&messaging.vaultReady} onChangeText={setAccount}/>:null}
 <Input label={smsInfo.senderLabel} value={sender} autoCapitalize="none" autoCorrect={false} editable={enabled&&!confirm&&messaging.vaultReady} onChangeText={setSender}/>
 <Input label={smsInfo.secretLabel} value={secret} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={enabled&&!confirm&&messaging.vaultReady} onChangeText={setSecret}/>
 <Input label="Current TradeOS password" value={password} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={enabled&&!confirm} onChangeText={setPassword}/>
 {!confirm?<><Button variant="gold" disabled={!canAction("save")} accessibilityLabel="Save SMS credentials" onPress={()=>prepare("save")}>Save credentials</Button><Button variant="danger" disabled={!canAction("revoke")} accessibilityLabel="Revoke SMS credentials" onPress={()=>prepare("revoke")}>Revoke credentials</Button></>:null}
 <Text style={styles.muted}>Saving SMS credentials does not enable sending. Hubtel SMS credentials are separate from payment credentials.</Text></Card>:null}
 {confirm?<Card style={styles.section}><Text style={styles.heading}>{actionLabels[confirm]}</Text><Banner tone="warning" message={confirm==="preference"?"Changing the preferred gateway may interrupt existing electronic checkout. It does not activate the new gateway.":confirm==="revoke"?"Revoke this credential? Existing transactions must still be reconciled.":confirm==="request"?"Request live activation review. No collection will be enabled by this request.":confirm==="verify"?"Run a read-only provider verification. No customer payment is initiated.":"Replace the selected credential set using the current password. No collection or SMS sending is activated."}/><Button loading={busy} accessibilityLabel="Confirm provider action" onPress={()=>void submit()}>Confirm</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel provider action" onPress={clear}>Cancel</Button></Card>:null}
 </>}
 </ScrollView>;
}
const styles=StyleSheet.create({page:{flexGrow:1,padding:spacing.s3,gap:spacing.s3,backgroundColor:colors.canvas,paddingBottom:spacing.s6},section:{gap:spacing.s3},row:{flexDirection:"row",alignItems:"center",flexWrap:"wrap",gap:spacing.s2},flex:{flex:1,minWidth:0},title:{fontSize:typography.section,fontWeight:typography.weightHeavy,color:colors.textStrong},heading:{fontSize:typography.body,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,lineHeight:typography.metaLine,color:colors.textMuted},wrap:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},record:{backgroundColor:colors.surfaceSoft,borderRadius:radius.sm,padding:spacing.s3,gap:spacing.s2},iconButton:{width:touch.iconTarget,minHeight:touch.iconTarget,alignItems:"center",justifyContent:"center",borderRadius:radius.sm,backgroundColor:colors.surfaceSoft}});
