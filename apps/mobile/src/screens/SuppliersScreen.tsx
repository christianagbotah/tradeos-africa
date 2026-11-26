import {useCallback,useEffect,useRef,useState} from "react";
import {ActivityIndicator,ScrollView,Text,View,Pressable,StyleSheet} from "react-native";
import type {MobileApiClient,MobileSupplier,MobileSupplierDetail,MobilePurchase,MobilePurchaseDetail,MobileCatalogItem,MobileMoneyAccount,MobileMoneyDefault} from "../api-client";
import {canManageSuppliers,canPaySuppliers,supplierInput,purchaseInput,supplierPayment,type PurchaseLineDraft,type PurchaseSettlement,type SupplierTransaction} from "../supplier-workspace";
import {eligibleCustomerAccounts,preferredAccount,type ReceiptOutcome} from "../customer-payment";
import {canBrowseStock} from "../catalog-workspace";
import type {MobileActionFeedback} from "../action-feedback";
import {PurchaseReturnPanel} from "./PurchaseReturnPanel";
import {Button} from "../components/Button";
import {Card} from "../components/Card";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {formatMoney} from "../lib/format";
import {Icon} from "../components/icons";
import {colors,radius,spacing,touch,typography} from "../theme";
type Props={api:MobileApiClient;businessId:string;branchId:string;role:string;currencyCode:string;online:boolean;onRecord:(input:SupplierTransaction)=>Promise<ReceiptOutcome>;onFeedback:(feedback:MobileActionFeedback)=>void;onBack:()=>void};
type Contact={name:string;phone:string;email:string;address:string;terms:string;revision?:{id:string;expectedUpdatedAt:string}};
const blank=():Contact=>({name:"",phone:"",email:"",address:"",terms:"0"});
export function SuppliersScreen({api,businessId,branchId,role,currencyCode,online,onRecord,onFeedback,onBack}:Props){
 const read=canBrowseStock(role),write=canManageSuppliers(role),pay=canPaySuppliers(role);
 const [rows,setRows]=useState<MobileSupplier[]>([]),[purchases,setPurchases]=useState<MobilePurchase[]>([]);
 const [supplier,setSupplier]=useState<MobileSupplierDetail|null>(null),[purchase,setPurchase]=useState<MobilePurchaseDetail|null>(null);
 const [contact,setContact]=useState<Contact|null>(null),[mode,setMode]=useState<"receive"|"payment"|null>(null);
 const [catalog,setCatalog]=useState<MobileCatalogItem[]>([]),[accounts,setAccounts]=useState<MobileMoneyAccount[]>([]),[defaults,setDefaults]=useState<MobileMoneyDefault[]>([]);
 const [lines,setLines]=useState<PurchaseLineDraft[]>([]),[method,setMethod]=useState<PurchaseSettlement>("SUPPLIER_CREDIT"),[account,setAccount]=useState<string|null>(null);
 const [amount,setAmount]=useState(""),[reference,setReference]=useState(""),[search,setSearch]=useState(""),[itemSearch,setItemSearch]=useState("");
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[review,setReview]=useState<SupplierTransaction|null>(null),[uncertain,setUncertain]=useState(false);
 const scrollRef=useRef<ScrollView>(null);
 const revealDetail=()=>scrollRef.current?.scrollTo({y:0,animated:false});
 const seq=useRef(0),detailSeq=useRef(0),lock=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;++seq.current;++detailSeq.current;};},[]);
 const refresh=useCallback(async()=>{
  const n=++seq.current;
  if(!online||!read){setRows([]);setPurchases([]);return;}
  setLoading(true);
  try{const [s,p]=await Promise.all([api.getSuppliers(businessId),api.getPurchases(businessId,branchId)]);if(n===seq.current){setRows(s.suppliers);setPurchases(p.purchases);}}
  catch{if(n===seq.current){setRows([]);setPurchases([]);setError("Could not load suppliers and purchases.");}}
  finally{if(n===seq.current)setLoading(false);}
 },[api,businessId,branchId,online,read]);
 useEffect(()=>{void refresh();return()=>{++seq.current;}},[refresh]);
 useEffect(()=>{if(!online){++detailSeq.current;setSupplier(null);setPurchase(null);setContact(null);setMode(null);setReview(null);setCatalog([]);setAccounts([]);}},[online]);
 async function openSupplier(id:string){
  if(lock.current)return;
  const n=++detailSeq.current;setSupplier(null);setPurchase(null);setError(null);
  try{const data=await api.getSupplier(businessId,id);if(n===detailSeq.current&&data.supplier.id===id)setSupplier(data);}
  catch{if(n===detailSeq.current)setError("Could not verify supplier details.");}
 }
 async function openPurchase(id:string){
  if(lock.current)return;
  const n=++detailSeq.current;setSupplier(null);setPurchase(null);setError(null);
  try{const data=await api.getPurchase(businessId,id);if(n===detailSeq.current&&data.purchase.id===id&&data.purchase.businessId===businessId&&data.purchase.branchId===branchId)setPurchase(data);}
  catch{if(n===detailSeq.current)setError("Could not verify purchase details.");}
 }
 async function saveContact(){
  if(!contact||!write||!online||lock.current||uncertain)return;
  let input:ReturnType<typeof supplierInput>;
  try{input=supplierInput(contact,role);}catch(e){setError((e as Error).message);return;}
  lock.current=true;setBusy(true);setError(null);
  try{const data=await api.saveSupplier(businessId,input,contact.revision);
   if(!live.current)return;
   if(contact.revision&&data.supplier.id!==contact.revision.id)throw new Error("Unexpected supplier response.");
   ++seq.current;setRows(old=>[data.supplier,...old.filter(x=>x.id!==data.supplier.id)]);setContact(null);setUncertain(false);
   onFeedback({tone:"success",title:"Supplier saved",message:"The server confirmed the supplier details."});void refresh();void openSupplierAfter(data.supplier.id);
  }catch{if(live.current){setUncertain(true);setError("Supplier change not confirmed. Close and check the directory before retrying.");void refresh();}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function openSupplierAfter(id:string){const n=++detailSeq.current;try{const data=await api.getSupplier(businessId,id);if(n===detailSeq.current&&data.supplier.id===id)setSupplier(data);}catch{/* Directory remains authoritative. */}}
 async function start(next:"receive"|"payment"){
  if(!supplier||lock.current)return;
  const n=++detailSeq.current;setMode(next);setReview(null);setError(null);setLines([]);setReference("");setAmount("");setMethod(next==="receive"?"SUPPLIER_CREDIT":"CASH");setAccount(null);setAccounts([]);setDefaults([]);setCatalog([]);setLoading(true);
  try{const [c,a,d]=await Promise.all([next==="receive"?api.getCatalog(businessId):Promise.resolve({items:[]}),pay?api.getMoneyAccounts(businessId,branchId):Promise.resolve({accounts:[]}),pay?api.getMoneyDefaults(businessId,branchId):Promise.resolve({defaults:[]})]);if(n===detailSeq.current){setCatalog(c.items.filter(i=>i.businessId===businessId&&i.active&&i.trackStock&&i.kind==="PRODUCT"));setAccounts(a.accounts);setDefaults(d.defaults);}}
  catch{if(n===detailSeq.current)setError("Could not verify purchase catalog or treasury accounts.");}
  finally{if(n===detailSeq.current)setLoading(false);}
 }
 const eligible=eligibleCustomerAccounts(accounts,businessId,branchId,method,currencyCode);
 const selectedAccount=eligible.some(a=>a.id===account)?account:preferredAccount(eligible,defaults,branchId,method);
 function prepare(){
  if(!supplier||!mode)return;
  try{setReview(mode==="receive"?purchaseInput(supplier.supplier,lines,catalog,businessId,reference,method,selectedAccount??undefined):supplierPayment(supplier.supplier,amount,method==="SUPPLIER_CREDIT"?"CASH":method,selectedAccount??"",reference));setError(null);}
  catch(e){setError((e as Error).message);}
 }
 async function submit(){
  if(!review||!online||lock.current)return;
  lock.current=true;setBusy(true);setError(null);
  try{const result=await onRecord(review);if(!live.current)return;
   setMode(null);setReview(null);
   onFeedback({tone:result==="SYNCED"?"success":result==="PENDING"?"warning":"danger",title:result==="SYNCED"?"Supplier transaction posted":result==="PENDING"?"Transaction pending":"Transaction needs review",message:result==="SYNCED"?"The server accepted the transaction. Supplier balances and affected accounts are refreshing.":"Do not record the transaction again. Resolve the original submission in the sync queue."});void refresh();void openSupplierAfter(review.payload.supplierId);
  }catch(e){if(live.current)setError(e instanceof Error?e.message:"Transaction not confirmed.");}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 const candidates=catalog.filter(i=>(i.name+" "+(i.sku??"")).toLowerCase().includes(itemSearch.toLowerCase())).slice(0,15);
 const total=review?.type==="PURCHASE_RECEIVE_CREATE"?review.payload.lines.reduce((sum,l)=>sum+Math.round(l.quantity*l.unitCostMinor),0):review?.type==="SUPPLIER_PAYMENT_CREATE"?review.payload.amountMinor:0;
 return <ScrollView ref={scrollRef} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
 <View style={styles.row}><Text accessibilityRole="header" style={[styles.title,styles.flex]}>Suppliers &amp; purchases</Text><Pressable accessibilityRole="button" accessibilityLabel="Back to more" accessibilityState={{disabled:busy}} disabled={busy} onPress={onBack} style={styles.iconButton}><Icon name="close" size={20}/></Pressable></View>
 {!read?<Banner tone="warning" message="Your role cannot access suppliers."/>:!online?<Banner tone="info" message="Connect to manage suppliers and receive goods."/>:<>
 <View style={styles.row}><Text style={[styles.muted,styles.flex]}>{loading?"Refreshing…":rows.length+" suppliers"}</Text><Pressable accessibilityRole="button" accessibilityLabel="Refresh suppliers and purchases" accessibilityState={{disabled:busy||loading,busy:loading}} disabled={busy||loading} onPress={()=>void refresh()} style={styles.iconButton}>{loading?<ActivityIndicator color={colors.midnight}/>:<Icon name="refresh" size={20}/>}</Pressable>{write?<Button variant="gold" disabled={busy||!!mode||!!contact} accessibilityLabel="Add supplier" onPress={()=>{setSupplier(null);setPurchase(null);setContact(blank());setUncertain(false);revealDetail();}}>Add supplier</Button>:null}</View>
 {error?<Banner tone="warning" message={error}/>:null}
 {contact?<Card style={styles.card}><Text style={styles.heading}>{contact.revision?"Edit supplier":"New supplier"}</Text>
 {(["name","phone","email","address"] as const).map(k=><Input key={k} label={k[0]!.toUpperCase()+k.slice(1)} value={contact[k]} editable={!busy&&!uncertain} onChangeText={v=>setContact(old=>old?{...old,[k]:v}:old)}/>)}
 {pay?<Input label="Payment terms (days)" value={contact.terms} keyboardType="number-pad" editable={!busy&&!uncertain} onChangeText={terms=>setContact(old=>old?{...old,terms}:old)}/>:null}
 <Button loading={busy} disabled={uncertain} accessibilityLabel="Save supplier" onPress={()=>void saveContact()}>Save supplier</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Close supplier form" onPress={()=>{setContact(null);setUncertain(false);void refresh();}}>Close</Button></Card>:null}
 {supplier&&!contact?<Card style={styles.card}><View style={styles.row}><Text style={[styles.heading,styles.flex]}>{supplier.supplier.name}</Text><Button size="compact" variant="secondary" disabled={busy||!!mode} accessibilityLabel="Close supplier details" onPress={()=>setSupplier(null)}>Close</Button></View>
 <View style={styles.summary}><Text style={styles.muted}>Outstanding payable</Text><Text style={styles.money}>{formatMoney(supplier.supplier.balanceMinor,currencyCode)}</Text><Text style={styles.muted}>Payment terms · {supplier.supplier.paymentTermsDays} days</Text></View><Text style={styles.muted}>{supplier.supplier.phone??""} {supplier.supplier.email??""}</Text>
 {!mode?<>{write?<Button variant="secondary" accessibilityLabel="Edit supplier" onPress={()=>{const s=supplier.supplier;setContact({name:s.name,phone:s.phone??"",email:s.email??"",address:s.address??"",terms:String(s.paymentTermsDays),revision:{id:s.id,expectedUpdatedAt:s.updatedAt}});}}>Edit supplier</Button>:null}{write&&supplier.supplier.active?<Button variant="gold" accessibilityLabel="Receive purchase" onPress={()=>void start("receive")}>Receive goods</Button>:null}{pay&&supplier.supplier.balanceMinor>0?<Button accessibilityLabel="Record supplier payment" onPress={()=>void start("payment")}>Record payment</Button>:null}</>:<View style={styles.card}>
 <Text style={styles.heading}>{mode==="receive"?"Receive goods":"Pay supplier"}</Text><Input label="Reference (optional)" value={reference} editable={!busy&&!review} onChangeText={setReference}/>
 {mode==="receive"?<>{lines.map((l,index)=><Card key={index} style={styles.card}><Text style={styles.heading}>{catalog.find(i=>i.id===l.itemId)?.name??"Item"} · {l.purchaseUnitCode}</Text><View style={styles.formPair}><View style={styles.field}><Input label="Quantity received" value={l.quantity} keyboardType="decimal-pad" editable={!busy&&!review} onChangeText={quantity=>setLines(old=>old.map((x,i)=>i===index?{...x,quantity}:x))}/></View><View style={styles.field}><Input label="Cost per purchase unit" value={l.cost} keyboardType="decimal-pad" editable={!busy&&!review} onChangeText={cost=>setLines(old=>old.map((x,i)=>i===index?{...x,cost}:x))}/></View></View><Button variant="secondary" disabled={busy||!!review} accessibilityLabel="Remove purchase line" onPress={()=>setLines(old=>old.filter((_,i)=>i!==index))}>Remove</Button></Card>)}
 {!review?<><Input label="Find purchase item" accessibilityLabel="Find purchase item" value={itemSearch} onChangeText={setItemSearch} placeholder="Name or SKU" leftAdornment={<Icon name="search" size={18} color={colors.textMuted}/>}/>{candidates.map(i=><View key={i.id} style={styles.card}><Text style={styles.heading}>{i.name}</Text><View style={styles.wrap}>{i.units.filter(u=>u.canPurchase).map(u=><Button key={u.code} size="compact" variant="secondary" disabled={lines.length>=100} accessibilityLabel={"Add "+i.name+" "+u.label} onPress={()=>setLines(old=>[...old,{itemId:i.id,purchaseUnitCode:u.code,quantity:"1",cost:""}])}>{u.label}</Button>)}</View></View>)}</>:null}</>:<Input label="Amount already paid" keyboardType="decimal-pad" value={amount} editable={!busy&&!review} onChangeText={setAmount}/>}
 <Text style={styles.heading}>Settlement method</Text><View style={styles.wrap}>{(["SUPPLIER_CREDIT","CASH","MOMO","BANK","CARD","OTHER"] as const).filter(m=>mode==="receive"?(pay||m==="SUPPLIER_CREDIT"):m!=="SUPPLIER_CREDIT").map(m=><Button key={m} variant={method===m?"gold":"secondary"} size="compact" disabled={busy||!!review} accessibilityLabel={m} onPress={()=>{setMethod(m);setAccount(null);}}>{m.replaceAll("_"," ")}</Button>)}</View>
 {method!=="SUPPLIER_CREDIT"?<><Text style={styles.muted}>Paying account</Text>{eligible.map(a=><Button key={a.id} variant={selectedAccount===a.id?"gold":"secondary"} disabled={busy||!!review} accessibilityLabel={a.name} onPress={()=>setAccount(a.id)}>{a.name}</Button>)}{!loading&&eligible.length===0?<Banner tone="warning" message="No eligible configured account. Configure treasury accounts before posting."/>:null}</>:null}
 {review?<Banner tone="warning" title="Confirm transaction" message={formatMoney(total,currencyCode)+(method==="SUPPLIER_CREDIT"?" will increase the supplier payable. Confirm goods were received.":" will be recorded against the selected account. Confirm funds have already been paid.")}/>:null}
 <Button loading={busy} disabled={loading} accessibilityLabel={review?"Confirm supplier transaction":"Review supplier transaction"} onPress={()=>review?void submit():prepare()}>{review?"Confirm transaction":"Review transaction"}</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel supplier transaction" onPress={()=>{setMode(null);setReview(null);}}>Cancel</Button></View>}
 <Text style={styles.heading}>Open obligations</Text>{supplier.obligations.filter(o=>o.openMinor>0).map(o=><View key={o.id} style={styles.row}><Text style={styles.flex}>{o.dueAt.slice(0,10)}</Text><Text style={styles.heading}>{formatMoney(o.openMinor,currencyCode)}</Text></View>)}
 <Text style={styles.heading}>Recent ledger</Text>{supplier.ledger.slice(0,20).map(l=><View key={l.id} style={styles.row}><Text style={styles.flex}>{l.sourceType} · {l.occurredAt.slice(0,10)}</Text><Text>{formatMoney(l.balanceDeltaMinor,l.currencyCode)}</Text></View>)}</Card>:null}
 {purchase?<Card style={styles.card}><View style={styles.row}><Text style={[styles.heading,styles.flex]}>{purchase.purchase.supplierName}</Text><Button variant="secondary" size="compact" accessibilityLabel="Close purchase" onPress={()=>setPurchase(null)}>Close</Button></View><Text style={styles.title}>{formatMoney(purchase.purchase.totalMinor,purchase.purchase.currencyCode)}</Text><Text style={styles.muted}>{purchase.purchase.settlementMethod}</Text>{purchase.lines.map(l=><View key={l.id} style={styles.list}><View style={styles.flex}><Text style={styles.heading}>{l.itemName}</Text><Text style={styles.muted}>{l.purchaseQuantity} {l.purchaseUnitCode} · Stock {l.stockQuantity} {l.stockUnitCode}</Text></View><Text>{formatMoney(l.lineCostMinor,purchase.purchase.currencyCode)}</Text></View>)}{write?<PurchaseReturnPanel key={purchase.purchase.id} detail={purchase} onRecord={onRecord} onFeedback={onFeedback} onRefresh={()=>{void openPurchase(purchase.purchase.id);void refresh();}}/>:null}</Card>:null}
 <Card style={styles.card}><Text style={styles.heading}>Supplier directory</Text><Input label="Search suppliers" accessibilityLabel="Search suppliers" value={search} onChangeText={setSearch} placeholder="Name or phone" leftAdornment={<Icon name="search" size={18} color={colors.textMuted}/>} rightAdornment={search?<Pressable accessibilityRole="button" accessibilityLabel="Clear supplier search" onPress={()=>setSearch("")} style={styles.iconButton}><Icon name="close" size={18}/></Pressable>:undefined}/>{loading?<Text style={styles.muted}>Loading…</Text>:null}{rows.filter(r=>(r.name+" "+(r.phone??"")).toLowerCase().includes(search.toLowerCase())).map(r=><Pressable key={r.id} disabled={busy||!!mode||!!contact} style={({pressed})=>[styles.list,(pressed||supplier?.supplier.id===r.id)&&styles.selected]} accessibilityRole="button" accessibilityLabel={"View "+r.name} accessibilityState={{selected:supplier?.supplier.id===r.id,disabled:busy||!!mode||!!contact}} onPress={()=>{revealDetail();void openSupplier(r.id);}}><View style={styles.flex}><Text style={styles.heading}>{r.name}</Text><Text style={styles.muted}>{r.active?"Active":"Inactive"} · {r.phone??"No phone"}</Text></View><View style={styles.amount}><Text style={[styles.amountText,{maxWidth:"100%"}]}>{formatMoney(r.balanceMinor,currencyCode)}</Text><Text style={styles.muted}>Payable</Text></View><Icon name="arrowRight" size={16} color={colors.textMuted}/></Pressable>)}</Card>
 <Card style={styles.card}><Text style={styles.heading}>Recent branch purchases</Text>{purchases.map(p=><Pressable key={p.id} disabled={busy||!!mode||!!contact} style={({pressed})=>[styles.list,(pressed||purchase?.purchase.id===p.id)&&styles.selected]} accessibilityRole="button" accessibilityLabel={"View purchase "+p.id} accessibilityState={{selected:purchase?.purchase.id===p.id,disabled:busy||!!mode||!!contact}} onPress={()=>{revealDetail();void openPurchase(p.id);}}><View style={styles.flex}><Text style={styles.heading}>{p.supplierName}</Text><Text style={styles.muted}>{p.receivedAt?.slice(0,10)} · {p.settlementMethod}</Text></View><Text style={styles.amountText}>{formatMoney(p.totalMinor,p.currencyCode)}</Text><Icon name="arrowRight" size={16} color={colors.textMuted}/></Pressable>)}</Card>
 </>}
 </ScrollView>;
}
const styles=StyleSheet.create({page:{flexGrow:1,padding:spacing.s3,gap:spacing.s3,backgroundColor:colors.canvas,paddingBottom:spacing.s6},row:{flexDirection:"row",alignItems:"center",flexWrap:"wrap",gap:spacing.s2},flex:{flex:1,minWidth:0},title:{fontSize:typography.section,fontWeight:typography.weightHeavy,color:colors.textStrong},heading:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,lineHeight:typography.metaLine,color:colors.textMuted},card:{gap:spacing.s3},wrap:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},list:{flexDirection:"row",alignItems:"center",minHeight:touch.minTarget,gap:spacing.s2,borderBottomWidth:1,borderBottomColor:colors.border,paddingVertical:spacing.s3},selected:{backgroundColor:colors.goldSoft},iconButton:{width:touch.iconTarget,minHeight:touch.iconTarget,alignItems:"center",justifyContent:"center",borderRadius:radius.sm,backgroundColor:colors.surfaceSoft},summary:{backgroundColor:colors.goldSoft,borderRadius:radius.sm,padding:spacing.s3,gap:spacing.s1},money:{fontSize:typography.kpi,fontWeight:typography.weightHeavy,color:colors.midnight},amount:{maxWidth:"42%",minWidth:0,alignItems:"flex-end"},amountText:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong,textAlign:"right",maxWidth:"44%",flexShrink:1},formPair:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},field:{flexGrow:1,flexBasis:125,minWidth:0}});
