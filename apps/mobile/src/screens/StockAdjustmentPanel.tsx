import {useState,useRef} from "react";
import {View,Text,StyleSheet} from "react-native";
import {buildStockAdjustment,stockLocations,type StockLocation,type StockAdjustment} from "../inventory-adjustment";
import type {ReceiptOutcome} from "../customer-payment";
import type {MobileActionFeedback} from "../action-feedback";
import {Button} from "../components/Button";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {colors,spacing,typography} from "../theme";
export function StockAdjustmentPanel({itemId,unit,onRecord,onRefresh,onFeedback}:{itemId:string;unit:string;onRecord:(input:StockAdjustment)=>Promise<ReceiptOutcome>;onRefresh:()=>void;onFeedback:(feedback:MobileActionFeedback)=>void}){
 const [open,setOpen]=useState(false),[source,setSource]=useState<StockLocation|"NONE">("AVAILABLE"),[destination,setDestination]=useState<StockLocation|"NONE">("DAMAGED");
 const [quantity,setQuantity]=useState(""),[note,setNote]=useState(""),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const lock=useRef(false);
 async function submit(){
   if(lock.current)return;
   let input:StockAdjustment;
   try{input=buildStockAdjustment(itemId,quantity,source,destination,note);}catch(e){setError((e as Error).message);return;}
   if(!confirm){setConfirm(true);setError(null);return;}
   lock.current=true;setBusy(true);setError(null);
   try{
     const result=await onRecord(input);
     setOpen(false);setConfirm(false);setQuantity("");setNote("");
     onFeedback({tone:result==="SYNCED"?"success":result==="PENDING"?"warning":"danger",title:result==="SYNCED"?"Stock adjusted":result==="PENDING"?"Adjustment pending":"Adjustment needs review",message:result==="SYNCED"?"The server recorded the stock movement and valuation.":"Do not resubmit. Resolve the original adjustment in the sync queue."});
     onRefresh();
   }catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}
 }
 if(!open)return <Button variant="gold" accessibilityLabel="Adjust stock" onPress={()=>setOpen(true)}>Adjust stock</Button>;
 return <View style={styles.panel}><Text style={styles.title}>Stock adjustment · {unit}</Text>
 <Text style={styles.label}>Source (None = count increase)</Text><View style={styles.row}>{(["NONE",...stockLocations] as const).map(v=><Button key={v} size="compact" variant={source===v?"gold":"secondary"} disabled={busy||confirm} accessibilityLabel={"Source "+v} onPress={()=>setSource(v)}>{v}</Button>)}</View>
 <Text style={styles.label}>Destination (None = count decrease)</Text><View style={styles.row}>{(["NONE",...stockLocations] as const).map(v=><Button key={v} size="compact" variant={destination===v?"gold":"secondary"} disabled={busy||confirm} accessibilityLabel={"Destination "+v} onPress={()=>setDestination(v)}>{v}</Button>)}</View>
 <Input label="Quantity" value={quantity} keyboardType="decimal-pad" editable={!busy&&!confirm} onChangeText={setQuantity}/><Input label="Reason note" value={note} multiline editable={!busy&&!confirm} onChangeText={setNote}/>
 {error?<Banner tone="danger" message={error}/>:null}{confirm?<Banner tone="warning" message={"Confirm "+quantity+" "+unit+" from "+source+" to "+destination+". This changes stock and valuation."}/>:null}
 <Button loading={busy} accessibilityLabel={confirm?"Confirm stock adjustment":"Review adjustment"} onPress={()=>void submit()}>{confirm?"Confirm adjustment":"Review adjustment"}</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Cancel stock adjustment" onPress={()=>{setOpen(false);setConfirm(false);setError(null);}}>Cancel</Button></View>;
}
const styles=StyleSheet.create({panel:{gap:spacing.s2,backgroundColor:colors.surfaceSoft,padding:spacing.s3},row:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s1},title:{fontSize:typography.body,fontWeight:typography.weightBold,color:colors.textStrong},label:{fontSize:typography.meta,color:colors.textMuted}});
