import {useState,useRef,useEffect} from "react";
import {Text,View,StyleSheet} from "react-native";
import type {MobilePurchaseDetail} from "../api-client";
import type {SupplierTransaction} from "../supplier-workspace";
import type {ReceiptOutcome} from "../customer-payment";
import type {MobileActionFeedback} from "../action-feedback";
import {creditNoteReturn} from "../purchase-order-workspace";
import {Button} from "../components/Button";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {colors,spacing,typography} from "../theme";
type Props={detail:MobilePurchaseDetail;onRecord:(r:SupplierTransaction)=>Promise<ReceiptOutcome>;onRefresh:()=>void;onFeedback:(f:MobileActionFeedback)=>void};
export function PurchaseReturnPanel({detail,onRecord,onRefresh,onFeedback}:Props){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState<Record<string,{quantity:string;sourceLocation:"AVAILABLE"|"QUARANTINE"}>>({});
 const [review,setReview]=useState<SupplierTransaction|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const lock=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 async function submit(){
  if(lock.current)return;
  if(!review){try{setReview(creditNoteReturn(detail,selected));setError(null);}catch(e){setError((e as Error).message);}return;}
  lock.current=true;setBusy(true);setError(null);
  try{const result=await onRecord(review);if(!live.current)return;setOpen(false);setSelected({});setReview(null);
   onFeedback({tone:result==="SYNCED"?"success":result==="PENDING"?"warning":"danger",title:result==="SYNCED"?"Supplier return posted":result==="PENDING"?"Return pending":"Return needs review",message:result==="SYNCED"?"The server accepted the return and credit note. Stock and supplier balance are refreshing.":"Do not submit again. Resolve the existing transaction in the sync queue."});onRefresh();
  }catch(e){if(live.current)setError((e as Error).message);}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 const remaining=detail.lines.filter(l=>l.purchaseQuantity-l.returnedQuantity>0);
 if(!remaining.length)return null;
 if(!open)return <Button variant="secondary" accessibilityLabel="Return purchased goods" onPress={()=>setOpen(true)}>Return purchased goods</Button>;
 return <View style={styles.panel}><Text style={styles.title}>Supplier return · credit note</Text>
 <Banner tone="info" message="Return goods against the original purchase. The server determines the credit-note value and removes stock at its recorded valuation. This does not record a cash refund."/>
 {remaining.map(l=><View key={l.id} style={styles.panel}><Text style={styles.title}>{l.itemName}</Text><Text style={styles.muted}>Remaining {l.purchaseQuantity-l.returnedQuantity} {l.purchaseUnitCode}</Text><Input label="Return quantity (blank to skip)" value={selected[l.id]?.quantity??""} keyboardType="decimal-pad" editable={!busy&&!review} onChangeText={quantity=>setSelected(old=>({...old,[l.id]:{quantity,sourceLocation:old[l.id]?.sourceLocation??"AVAILABLE"}}))}/>
 <View style={styles.row}>{(["AVAILABLE","QUARANTINE"] as const).map(sourceLocation=><Button key={sourceLocation} variant={(selected[l.id]?.sourceLocation??"AVAILABLE")===sourceLocation?"gold":"secondary"} size="compact" disabled={busy||!!review} accessibilityLabel={l.itemName+" "+sourceLocation} onPress={()=>setSelected(old=>({...old,[l.id]:{quantity:old[l.id]?.quantity??"",sourceLocation}}))}>{sourceLocation}</Button>)}</View></View>)}
 {error?<Banner tone="danger" message={error}/>:null}{review?<Banner tone="warning" message="Confirm the goods have been returned and the supplier has agreed to the credit note. The original purchase remains in the audit history."/>:null}
 <Button loading={busy} accessibilityLabel={review?"Confirm supplier return":"Review supplier return"} onPress={()=>void submit()}>{review?"Confirm return":"Review return"}</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel supplier return" onPress={()=>{setOpen(false);setReview(null);setError(null);}}>Cancel</Button></View>;
}
const styles=StyleSheet.create({panel:{gap:spacing.s3,padding:spacing.s2,backgroundColor:colors.surfaceSoft},row:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},title:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,color:colors.textMuted}});
