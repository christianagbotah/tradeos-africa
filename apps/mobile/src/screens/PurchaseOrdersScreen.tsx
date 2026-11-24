import {useEffect,useRef,useState,useCallback} from "react";
import {ScrollView,Text,View,Pressable,StyleSheet} from "react-native";
import * as Crypto from "expo-crypto";
import type {MobileApiClient,MobilePurchaseOrder,MobilePurchaseOrderSummary,MobileSupplier,MobileCatalogItem} from "../api-client";
import {orderDraft,orderInput,orderScope,linkedReceipt,canWritePurchaseOrders,canControlPurchaseOrders,type OrderDraft} from "../purchase-order-workspace";
import {canManageSuppliers,type SupplierTransaction} from "../supplier-workspace";
import type {ReceiptOutcome} from "../customer-payment";
import type {MobileActionFeedback} from "../action-feedback";
import {canBrowseStock} from "../catalog-workspace";
import {Button} from "../components/Button";
import {Card} from "../components/Card";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {formatMoney} from "../lib/format";
import {colors,spacing,typography} from "../theme";
type Props={api:MobileApiClient;businessId:string;branchId:string;role:string;online:boolean;currencyCode:string;onRecord:(r:SupplierTransaction)=>Promise<ReceiptOutcome>;onFeedback:(f:MobileActionFeedback)=>void;onBack:()=>void};
export function PurchaseOrdersScreen({api,businessId,branchId,role,online,currencyCode,onRecord,onFeedback,onBack}:Props){
 const read=canBrowseStock(role),write=canWritePurchaseOrders(role),control=canControlPurchaseOrders(role);
 const [rows,setRows]=useState<MobilePurchaseOrderSummary[]>([]),[suppliers,setSuppliers]=useState<MobileSupplier[]>([]),[catalog,setCatalog]=useState<MobileCatalogItem[]>([]);
 const [order,setOrder]=useState<MobilePurchaseOrder|null>(null),[draft,setDraft]=useState<OrderDraft|null>(null),[action,setAction]=useState<"issue"|"cancel"|null>(null);
 const [receiving,setReceiving]=useState(false),[received,setReceived]=useState<Record<string,{quantity:string;cost:string}>>({}),[reference,setReference]=useState(""),[review,setReview]=useState<SupplierTransaction|null>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState<string|null>(null);
 const [search,setSearch]=useState(""),[itemSearch,setItemSearch]=useState(""),[supplierSearch,setSupplierSearch]=useState("");
 const seq=useRef(0),detailSeq=useRef(0),lock=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;++seq.current;++detailSeq.current;};},[]);
 const refresh=useCallback(async()=>{
  const n=++seq.current;if(!online||!read){setRows([]);setSuppliers([]);setCatalog([]);return;}
  setLoading(true);
  try{const [r,s,c]=await Promise.all([api.getPurchaseOrders(businessId,branchId),api.getSuppliers(businessId),api.getCatalog(businessId)]);
    if(n===seq.current){setRows(r.orders.filter(x=>orderScope(x,businessId,branchId)));setSuppliers(s.suppliers);setCatalog(c.items.filter(i=>i.businessId===businessId&&i.active&&i.trackStock&&i.kind==="PRODUCT"));}
  }catch{if(n===seq.current)setError("Could not verify purchase orders and reference data.");}
  finally{if(n===seq.current)setLoading(false);}
 },[api,businessId,branchId,online,read]);
 useEffect(()=>{void refresh();return()=>{++seq.current;}},[refresh]);
 useEffect(()=>{if(!online){++detailSeq.current;setOrder(null);setReceiving(false);setReview(null);setAction(null);}},[online]);
 async function open(id:string){
  const n=++detailSeq.current;setLoading(true);setOrder(null);setAction(null);
  try{const r=await api.getPurchaseOrder(businessId,id);if(n===detailSeq.current&&r.order.id===id&&orderScope(r.order,businessId,branchId))setOrder(r.order);}
  catch{if(n===detailSeq.current)setError("Could not verify order details.");}
  finally{if(n===detailSeq.current)setLoading(false);}
 }
 function apply(r:MobilePurchaseOrder){if(!orderScope(r,businessId,branchId))throw new Error("Order scope mismatch.");++seq.current;setRows(old=>[r,...old.filter(x=>x.id!==r.id)]);setOrder(r);setDraft(null);setAction(null);setUncertain(false);}
 const change=(patch:Partial<OrderDraft>)=>setDraft(old=>old?{...old,...patch}:old);
 async function save(){
  if(!draft||!write||!online||lock.current)return;
  let input:ReturnType<typeof orderInput>;try{input=orderInput(draft,businessId,branchId,suppliers,catalog);}catch(e){setError((e as Error).message);return;}
  lock.current=true;setBusy(true);setError(null);
  try{const r=await api.savePurchaseOrder(input,draft.revision);if(!live.current)return;if(draft.revision&&r.order.id!==draft.revision.id)throw new Error("Order mismatch.");apply(r.order);onFeedback({tone:"success",title:"Purchase order saved",message:"The server confirmed the draft."});void refresh();}
  catch{if(live.current){setUncertain(true);setError("Save not confirmed. Retry only the unchanged new draft, or reload the existing order.");}}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function transition(){
  if(!order||!action||!control||!online||lock.current)return;
  lock.current=true;setBusy(true);setError(null);
  try{const r=await api.changePurchaseOrderStatus(businessId,order.id,action);if(!live.current)return;if(r.order.id!==order.id)throw new Error("Order mismatch.");apply(r.order);onFeedback({tone:"success",title:"Purchase order updated",message:"The server confirmed the new status."});void refresh();}
  catch{if(live.current)setError("Status update not confirmed. Reload the order.");}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function receive(){
  if(!order||!receiving||!online||lock.current||!canManageSuppliers(role))return;
  if(!review){try{setReview(linkedReceipt(order,received,reference));setError(null);}catch(e){setError((e as Error).message);}return;}
  lock.current=true;setBusy(true);setError(null);
  try{const result=await onRecord(review);if(!live.current)return;setReceiving(false);setReview(null);
   onFeedback({tone:result==="SYNCED"?"success":result==="PENDING"?"warning":"danger",title:result==="SYNCED"?"Delivery recorded":result==="PENDING"?"Delivery pending":"Delivery needs review",message:result==="SYNCED"?"The server accepted the linked delivery. Order fulfillment and stock are refreshing.":"Do not submit again; reconcile the original delivery in the queue."});void open(order.id);void refresh();
  }catch(e){if(live.current)setError((e as Error).message);}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
 <View style={styles.row}><Text style={[styles.title,styles.flex]}>Purchase orders</Text><Button variant="secondary" size="compact" disabled={busy} accessibilityLabel="Back to more" onPress={onBack}>Back</Button></View>
 {!read?<Banner tone="warning" message="Your role cannot access purchase orders."/>:!online?<Banner tone="info" message="Connect to manage supplier orders."/>:<>
 <View style={styles.row}><Button variant="secondary" style={styles.flex} disabled={busy} accessibilityLabel="Refresh purchase orders" onPress={()=>void refresh()}>Refresh</Button>{write?<Button variant="gold" style={styles.flex} disabled={busy||!!draft||receiving} accessibilityLabel="New purchase order" onPress={()=>{setOrder(null);setDraft({requestId:Crypto.randomUUID(),supplierId:"",notes:"",delivery:"",lines:[]});setUncertain(false);}}>New order</Button>:null}</View>
 {error?<Banner tone="warning" message={error}/>:null}
 {draft?<Card style={styles.card}><Text style={styles.heading}>{draft.revision?"Edit draft order":"New order"}</Text>
 <Input label="Find supplier" value={supplierSearch} onChangeText={setSupplierSearch}/>
 {suppliers.filter(s=>s.active&&s.name.toLowerCase().includes(supplierSearch.toLowerCase())).slice(0,10).map(s=><Button key={s.id} variant={s.id===draft.supplierId?"gold":"secondary"} disabled={busy||uncertain} accessibilityLabel={"Select "+s.name} onPress={()=>change({supplierId:s.id})}>{s.name}</Button>)}
 <Text style={styles.muted}>Selected: {suppliers.find(s=>s.id===draft.supplierId)?.name??"No supplier"}</Text>
 <Input label="Expected delivery (YYYY-MM-DD)" value={draft.delivery} editable={!busy&&!uncertain} onChangeText={delivery=>change({delivery})}/><Input label="Notes" value={draft.notes} editable={!busy&&!uncertain} multiline onChangeText={notes=>change({notes})}/>
 {draft.lines.map((l,index)=><Card key={index} style={styles.card}><Text style={styles.heading}>{catalog.find(i=>i.id===l.itemId)?.name??"Unavailable item"} · {l.purchaseUnitCode}</Text><Input label="Ordered quantity" value={l.quantity} keyboardType="decimal-pad" editable={!busy&&!uncertain} onChangeText={quantity=>change({lines:draft.lines.map((x,i)=>i===index?{...x,quantity}:x)})}/><Input label="Unit cost" value={l.cost} keyboardType="decimal-pad" editable={!busy&&!uncertain} onChangeText={cost=>change({lines:draft.lines.map((x,i)=>i===index?{...x,cost}:x)})}/><Button variant="secondary" disabled={busy||uncertain} accessibilityLabel="Remove order line" onPress={()=>change({lines:draft.lines.filter((_,i)=>i!==index)})}>Remove</Button></Card>)}
 {!uncertain?<><Input label="Find purchase item" value={itemSearch} onChangeText={setItemSearch}/>{catalog.filter(i=>(i.name+" "+(i.sku??"")).toLowerCase().includes(itemSearch.toLowerCase())).slice(0,15).map(i=><View key={i.id} style={styles.card}><Text style={styles.heading}>{i.name}</Text><View style={styles.wrap}>{i.units.filter(u=>u.canPurchase).map(u=><Button key={u.code} variant="secondary" size="compact" disabled={busy||draft.lines.length>=50} accessibilityLabel={"Add "+i.name+" "+u.label} onPress={()=>change({lines:[...draft.lines,{itemId:i.id,purchaseUnitCode:u.code,quantity:"1",cost:""}]})}>{u.label}</Button>)}</View></View>)}</>:null}
 <Button loading={busy} disabled={uncertain&&!!draft.revision} accessibilityLabel="Save draft order" onPress={()=>void save()}>{uncertain?"Retry identical draft":"Save draft"}</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Close order draft" onPress={()=>{setDraft(null);setUncertain(false);void refresh();}}>Close draft</Button></Card>:null}
 {order&&!draft?<Card style={styles.card}><View style={styles.row}><Text style={[styles.heading,styles.flex]}>{order.orderNumber}</Text><Button variant="secondary" size="compact" disabled={busy||receiving} accessibilityLabel="Close order" onPress={()=>setOrder(null)}>Close</Button></View>
 <Text style={styles.muted}>{order.supplierName} · {order.status} · {order.fulfillmentStatus}</Text><Text style={styles.title}>{formatMoney(order.totalMinor,order.currencyCode)}</Text>
 <Text style={styles.muted}>Received {formatMoney(order.receivedTotalMinor,order.currencyCode)} · Price variance {formatMoney(order.priceVarianceMinor,order.currencyCode)}</Text>
 {order.lines.map(l=><View key={l.id} style={styles.card}><Text style={styles.heading}>{l.itemName} · {l.purchaseUnitLabel}</Text><Text style={styles.muted}>Ordered {l.quantity} · Received {l.receivedQuantity} · Remaining {l.remainingQuantity}</Text>
 {receiving&&l.remainingQuantity>0?<><Input label="Delivered quantity (blank to skip)" value={received[l.id]?.quantity??""} keyboardType="decimal-pad" editable={!busy&&!review} onChangeText={quantity=>setReceived(old=>({...old,[l.id]:{quantity,cost:old[l.id]?.cost??(l.unitCostMinor/100).toFixed(2)}}))}/><Input label="Actual unit cost" keyboardType="decimal-pad" editable={!busy&&!review} value={received[l.id]?.cost??(l.unitCostMinor/100).toFixed(2)} onChangeText={cost=>setReceived(old=>({...old,[l.id]:{quantity:old[l.id]?.quantity??"",cost}}))}/></>:null}</View>)}
 {receiving?<><Input label="Supplier delivery reference" value={reference} editable={!busy&&!review} onChangeText={setReference}/>{review?<Banner tone="warning" title="Confirm delivery on supplier credit" message="Only confirm goods physically received. This posts inventory and supplier payable; settle the invoice separately under Suppliers & purchases."/>:null}<Button loading={busy} accessibilityLabel={review?"Confirm delivery":"Review delivery"} onPress={()=>void receive()}>{review?"Confirm delivery":"Review delivery"}</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel delivery" onPress={()=>{setReceiving(false);setReview(null);}}>Cancel</Button></>:<>
 {order.status==="DRAFT"&&write&&!action?<Button variant="gold" accessibilityLabel="Edit purchase order draft" onPress={()=>setDraft(orderDraft(order,Crypto.randomUUID()))}>Edit draft</Button>:null}
 {order.status==="DRAFT"&&control&&!action?<Button accessibilityLabel="Issue purchase order" onPress={()=>setAction("issue")}>Issue order</Button>:null}
 {order.status!=="CANCELLED"&&control&&!action?<Button variant="secondary" accessibilityLabel="Cancel purchase order" onPress={()=>setAction("cancel")}>Cancel order</Button>:null}
 {action?<><Banner tone="warning" message={action==="issue"?"Issue this order? Issued lines cannot be edited.":"Cancel remaining order fulfillment? Existing receipts remain posted."}/><Button loading={busy} accessibilityLabel={"Confirm "+action} onPress={()=>void transition()}>Confirm {action}</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Keep order unchanged" onPress={()=>setAction(null)}>Keep unchanged</Button></>:null}
 {order.canReceive&&canManageSuppliers(role)&&!action?<Button variant="gold" accessibilityLabel="Receive purchase order" onPress={()=>{setReceived({});setReference("");setReceiving(true);}}>Receive delivery</Button>:null}</>}
 <Text style={styles.heading}>Posted deliveries</Text>{order.receipts.map(r=><View style={styles.row} key={r.id}><Text style={styles.flex}>{r.receivedAt.slice(0,10)} · {r.settlementMethod}</Text><Text>{formatMoney(r.totalMinor,order.currencyCode)}</Text></View>)}</Card>:null}
 <Card style={styles.card}><Input label="Search orders" value={search} onChangeText={setSearch}/>{loading?<Text style={styles.muted}>Loading…</Text>:null}{rows.filter(r=>(r.orderNumber+" "+r.supplierName+" "+r.status).toLowerCase().includes(search.toLowerCase())).map(r=><Pressable key={r.id} disabled={busy||!!draft||receiving} style={styles.list} accessibilityRole="button" accessibilityLabel={"View "+r.orderNumber} onPress={()=>void open(r.id)}><View style={styles.flex}><Text style={styles.heading}>{r.orderNumber} · {r.status}</Text><Text style={styles.muted}>{r.supplierName}</Text></View><Text>{formatMoney(r.totalMinor,currencyCode)}</Text></Pressable>)}</Card></>}
 </ScrollView>;
}
const styles=StyleSheet.create({page:{flexGrow:1,padding:spacing.s4,gap:spacing.s4,backgroundColor:colors.canvas,paddingBottom:spacing.s8},row:{flexDirection:"row",alignItems:"center",gap:spacing.s2},flex:{flex:1,minWidth:0},title:{fontSize:typography.section,fontWeight:typography.weightHeavy,color:colors.textStrong},heading:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,color:colors.textMuted},card:{gap:spacing.s3},wrap:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},list:{flexDirection:"row",alignItems:"center",gap:spacing.s2,paddingVertical:spacing.s3,borderBottomWidth:1,borderBottomColor:colors.border}});
