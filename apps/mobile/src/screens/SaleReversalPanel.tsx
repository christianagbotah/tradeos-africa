import {useEffect,useRef,useState} from "react";
import {View,Text,StyleSheet} from "react-native";
import type {MobileApiClient,MobileSaleDetail,MobileCatalogItem} from "../api-client";
import {availableDispositions,buildReversal,guardedReversal,positiveQuantity,refundMethods,returnable,type SaleReversal,type Disposition,type RefundMethod,type ReplacementLine} from "../sale-reversal";
import type {ReceiptOutcome} from "../customer-payment";
import type {MobileActionFeedback} from "../action-feedback";
import {Button} from "../components/Button";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {formatMoney} from "../lib/format";
import {colors,spacing,typography} from "../theme";
type Props={sale:MobileSaleDetail;api:Pick<MobileApiClient,"getCatalog">;onRecord:(r:SaleReversal)=>Promise<ReceiptOutcome>;onRefresh:()=>void;onFeedback:(feedback:MobileActionFeedback)=>void};
export function SaleReversalPanel({sale,api,onRecord,onRefresh,onFeedback}:Props){
 const [mode,setMode]=useState<"return"|"exchange"|null>(null),[reason,setReason]=useState(""),[method,setMethod]=useState<RefundMethod>("ORIGINAL_METHOD");
 const [returned,setReturned]=useState<Record<string,{quantity:string;disposition:Disposition}>>({});
 const [replacement,setReplacement]=useState<Array<{itemId:string;saleUnitCode:string;quantity:string}>>([]);
 const [catalog,setCatalog]=useState<MobileCatalogItem[]>([]),[search,setSearch]=useState(""),[loading,setLoading]=useState(false);
 const [review,setReview]=useState<SaleReversal|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const lock=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{
   if(mode!=="exchange")return;
   let active=true;setLoading(true);setCatalog([]);
   void api.getCatalog(sale.businessId).then(r=>{if(active)setCatalog(r.items.filter(i=>i.businessId===sale.businessId&&i.active));}).catch(()=>{if(active)setError("Replacement catalog could not be verified.");}).finally(()=>{if(active)setLoading(false);});
   return()=>{active=false;};
 },[mode,api,sale.businessId]);
 function reset(next:"return"|"exchange"|null){setMode(next);setReview(null);setError(null);setReturned({});setReplacement([]);setReason("");setMethod("ORIGINAL_METHOD");}
 async function submit(){
   if(lock.current||!mode)return;
   if(!review){
     try{
       const lines=Object.entries(returned).filter(([,r])=>r.quantity.trim()!=="").map(([saleLineId,r])=>({saleLineId,quantity:positiveQuantity(r.quantity),disposition:r.disposition}));
       const replacements:ReplacementLine[]=replacement.map(r=>({...r,quantity:positiveQuantity(r.quantity)}));
       setReview(guardedReversal(sale,buildReversal(sale,reason,method,lines,replacements,catalog,mode==="exchange"),catalog));setError(null);
     }catch(e){setError((e as Error).message);}
     return;
   }
   lock.current=true;setBusy(true);setError(null);
   try{
     const result=await onRecord(review);
     if(!live.current)return;
     reset(null);
     onFeedback({tone:result==="SYNCED"?"success":result==="PENDING"?"warning":"danger",title:result==="SYNCED"?"Transaction recorded":result==="PENDING"?"Waiting for server confirmation":"Transaction needs review",message:result==="SYNCED"?"The server accepted the return or exchange. External refund settlement may still be pending. Check the updated sale and refund history.":"Do not submit again. Review the original transaction in the local sync queue."});
     onRefresh();
   }catch(e){if(live.current)setError(e instanceof Error?e.message:"Transaction not confirmed.");}
   finally{lock.current=false;if(live.current)setBusy(false);}
 }
 if(!sale.lines.some(l=>returnable(l)>0)||!["COMPLETED","PARTIALLY_REFUNDED"].includes(sale.status))return null;
 if(sale.reversalAmountGuard!==true)return <Banner tone="info" title="After-sale services" message="This server requires an update before native returns and exchanges can safely post financial amounts."/>;
 const candidates=catalog.filter(i=>!search.trim()||(i.name+" "+(i.sku??"")).toLowerCase().includes(search.trim().toLowerCase())).slice(0,15);
 return <View style={styles.panel}>
 <Text style={styles.title}>After-sale service</Text>
 {!mode?<View style={styles.row}><Button variant="secondary" style={styles.flex} accessibilityLabel="Return or refund sale" onPress={()=>reset("return")}>Return / refund</Button><Button variant="gold" style={styles.flex} accessibilityLabel="Exchange sale" onPress={()=>reset("exchange")}>Exchange</Button></View>:<>
 <Banner tone="info" message="Choose the original sale lines. TradeOS calculates refund and exchange amounts on the server. Do not pay or collect an estimated difference."/>
 {sale.lines.filter(l=>returnable(l)>0).map(l=>{
   const row=returned[l.id],dispositions=availableDispositions(l).filter(d=>mode!=="exchange"||d!=="NOT_RETURNED");
   return <View style={styles.line} key={l.id}><Text style={styles.title}>{l.itemName}</Text><Text style={styles.muted}>Returnable: {returnable(l)} {l.saleUnitCode}</Text>
   <Input label="Return quantity (blank to skip)" value={row?.quantity??""} editable={!busy&&!review} keyboardType="decimal-pad" onChangeText={quantity=>setReturned(old=>({...old,[l.id]:{quantity,disposition:old[l.id]?.disposition??dispositions[0]!}}))}/>
   <View style={styles.row}>{dispositions.map(d=><Button key={d} size="compact" variant={(row?.disposition??dispositions[0])===d?"gold":"secondary"} disabled={busy||!!review} accessibilityLabel={l.itemName+" "+d} onPress={()=>setReturned(old=>({...old,[l.id]:{quantity:old[l.id]?.quantity??"",disposition:d}}))}>{d.replaceAll("_"," ")}</Button>)}</View></View>;
 })}
 {mode==="exchange"?<>
 <Text style={styles.title}>Replacement items</Text>
 {replacement.map((r,index)=><View style={styles.line} key={index}><Text style={styles.muted}>{catalog.find(i=>i.id===r.itemId)?.name??"Item"} · {r.saleUnitCode}</Text><Input label="Replacement quantity" value={r.quantity} keyboardType="decimal-pad" editable={!busy&&!review} onChangeText={quantity=>setReplacement(old=>old.map((x,i)=>i===index?{...x,quantity}:x))}/><Button variant="secondary" disabled={busy||!!review} accessibilityLabel="Remove replacement" onPress={()=>setReplacement(old=>old.filter((_,i)=>i!==index))}>Remove</Button></View>)}
 {!review?<><Input label="Find replacement item" value={search} onChangeText={setSearch}/>{loading?<Text style={styles.muted}>Loading verified items…</Text>:candidates.map(i=><View key={i.id} style={styles.line}><Text style={styles.title}>{i.name}</Text><View style={styles.row}>{i.units.filter(u=>u.canSell&&u.defaultSalePriceMinor!==null).map(u=><Button key={u.code} size="compact" variant="secondary" disabled={busy} accessibilityLabel={"Add "+i.name+" "+u.label} onPress={()=>setReplacement(old=>[...old,{itemId:i.id,saleUnitCode:u.code,quantity:"1"}])}>{u.label} · {formatMoney(u.defaultSalePriceMinor!,sale.currencyCode)}</Button>)}</View></View>)}</>:null}
 </>:null}
 <Input label="Reason" value={reason} editable={!busy&&!review} multiline onChangeText={setReason}/>
 <Text style={styles.title}>{mode==="return"?"Refund method":"Difference settlement method"}</Text>
 <View style={styles.row}>{refundMethods.filter(m=>m!=="CUSTOMER_CREDIT"||!!sale.customer?.id).map(m=><Button key={m} size="compact" variant={method===m?"gold":"secondary"} disabled={busy||!!review} accessibilityLabel={m} onPress={()=>setMethod(m)}>{m.replaceAll("_"," ")}</Button>)}</View>
 {error?<Banner tone="danger" message={error}/>:null}
 {review?<Banner tone="warning" title="Confirm financial amount" message={review.type==="RETURN_CREATE"?"Refund "+formatMoney(review.payload.expectedRefundTotalMinor!,sale.currencyCode)+". Confirm any cash payout has been made or credit is authorized. External provider refunds remain pending until verified.":(review.payload.expectedNetDifferenceMinor!>0?"Collect "+formatMoney(review.payload.expectedNetDifferenceMinor!,sale.currencyCode)+" before confirming, or authorize credit.":review.payload.expectedNetDifferenceMinor!<0?"Refund difference "+formatMoney(-review.payload.expectedNetDifferenceMinor!,sale.currencyCode)+". Confirm cash payout or authorized credit; external settlement remains pending.":"Even exchange. No additional payment.")}/>:null}
 <Button loading={busy} accessibilityLabel={review?"Confirm transaction":"Review transaction"} onPress={()=>void submit()}>{review?"Confirm transaction":"Review transaction"}</Button>
 <Button variant="secondary" disabled={busy} accessibilityLabel="Cancel reversal" onPress={()=>reset(null)}>Cancel</Button>
 </>}
 </View>;
}
const styles=StyleSheet.create({panel:{padding:spacing.s3,gap:spacing.s3,backgroundColor:colors.surface},row:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},flex:{flex:1},title:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,color:colors.textMuted},line:{gap:spacing.s2,paddingVertical:spacing.s2,borderBottomWidth:1,borderBottomColor:colors.border}});
