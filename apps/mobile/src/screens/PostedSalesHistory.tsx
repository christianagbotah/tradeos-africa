import { useCallback,useEffect,useRef,useState } from "react";
import { ActivityIndicator,Pressable,StyleSheet,Text,View } from "react-native";
import type { MobileApiClient,MobileSaleSummary,MobileSaleDetail } from "../api-client";
import {SaleReversalPanel} from "./SaleReversalPanel";
import {canReverseSale,type SaleReversal} from "../sale-reversal";
import type {ReceiptOutcome} from "../customer-payment";
import type {MobileActionFeedback} from "../action-feedback";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Banner } from "../components/Banner";
import { Input } from "../components/Input";
import { Icon,IconTile } from "../components/icons";
import { EmptyState } from "../components/EmptyState";
import { colors,radius,spacing,typography } from "../theme";
import { formatMoney,formatQuantity } from "../lib/format";
import { canReadSalesHistory,displaySaleDate,saleMatchesScope } from "../sales-history";

type Props={api:Pick<MobileApiClient,"getSales"|"getSale"|"getCatalog">;businessId:string;branchId:string;role:string;timezone:string;online:boolean;syncing:boolean;pendingCount:number;onReversal:(input:SaleReversal)=>Promise<ReceiptOutcome>;onFeedback:(feedback:MobileActionFeedback)=>void};
export function PostedSalesHistory({api,businessId,branchId,role,timezone,online,syncing,pendingCount,onReversal,onFeedback}:Props){
  const allowed=canReadSalesHistory(role);
  const [query,setQuery]=useState("");
  const [rows,setRows]=useState<MobileSaleSummary[]|null>(null);
  const [detail,setDetail]=useState<MobileSaleDetail|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [detailLoading,setDetailLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [detailError,setDetailError]=useState<string|null>(null);
  const sequence=useRef(0),detailSequence=useRef(0);
  const reload=useCallback(async()=>{
    const current=++sequence.current;
    if(!online||!allowed){setRows(null);setLoading(false);return;}
    setLoading(true);setError(null);setRows(null);
    try{
      const result=await api.getSales(businessId,branchId,query);
      if(sequence.current===current)setRows(result.sales);
    }catch{
      if(sequence.current===current)setError("Sales history could not be loaded. Check your connection and try again.");
    }finally{if(sequence.current===current)setLoading(false);}
  },[api,businessId,branchId,query,online,allowed]);
  useEffect(()=>{
    const timer=setTimeout(()=>{void reload();},250);
    return ()=>{clearTimeout(timer);++sequence.current;};
  },[reload,syncing,pendingCount]);
  useEffect(()=>{
    ++detailSequence.current;setDetail(null);setSelectedId(null);setDetailError(null);setDetailLoading(false);
    return ()=>{++detailSequence.current;};
  },[businessId,branchId,online,allowed]);
  async function openSale(saleId:string){
    if(!online||!allowed)return;
    const current=++detailSequence.current;
    setSelectedId(saleId);setDetail(null);setDetailError(null);setDetailLoading(true);
    try{
      const result=await api.getSale(businessId,saleId);
      if(current!==detailSequence.current)return;
      if(!saleMatchesScope(result.sale,businessId,branchId,saleId))throw new Error("Wrong sale scope");
      setDetail(result.sale);
    }catch{if(current===detailSequence.current)setDetailError("Sale details could not be loaded for this branch.");}
    finally{if(current===detailSequence.current)setDetailLoading(false);}
  }
  function closeDetail(){++detailSequence.current;setSelectedId(null);setDetail(null);setDetailError(null);setDetailLoading(false);}
  return <Card padding="default" style={styles.card}>
    <View style={styles.heading}>
      <IconTile name="sales" size={44} background={colors.goldSoft} tint={colors.goldStrong}/>
      <View style={styles.flex}><Text style={styles.title}>Posted sales</Text><Text style={styles.muted}>Verified transactions for this branch</Text></View>
      {allowed&&online?<Pressable accessibilityRole="button" accessibilityLabel="Refresh posted sales" onPress={()=>void reload()} style={styles.refresh}><Icon name="refresh" size={20}/></Pressable>:null}
    </View>
    {!allowed?<Banner tone="info" title="Restricted history" message="Your role can record permitted sales but cannot view branch-wide sales history."/>
    :!online?<Banner tone="warning" title="Offline" message="Posted sales require a connection. Your pending sales remain in the local queue."/>
    :<>
      <Input label="Search sales" accessibilityLabel="Search sales" value={query} onChangeText={setQuery} placeholder="Receipt ID, customer or phone" leftAdornment={<Icon name="search" size={18} color={colors.textMuted}/>}/>
      {error?<Banner tone="danger" message={error}/>:null}
      {loading?<ActivityIndicator color={colors.goldStrong}/>:null}
      {rows?.length===0&&!loading?<EmptyState title="No matching sales" description="Completed or pending-payment sales will appear here after server processing."/>:null}
      {selectedId?<View style={styles.detail}>
        <View style={styles.heading}><Text style={[styles.title,styles.flex]}>Sale details</Text><Button variant="secondary" size="compact" accessibilityLabel="Close sale details" onPress={closeDetail}>Close</Button></View>
        {detailLoading?<ActivityIndicator color={colors.goldStrong}/>:null}
        {detailError?<Banner tone="danger" message={detailError}/>:null}
        {detail?<><Text style={styles.muted} selectable>{detail.id}</Text><Text style={styles.amount}>{formatMoney(detail.totalMinor,detail.currencyCode)}</Text>
          <Text style={styles.muted}>{detail.status} · {displaySaleDate(detail.completedAt??detail.createdAt,timezone)}</Text>
          <Text style={styles.muted}>{detail.customer?.name??"Walk-in customer"} · {detail.cashierName??"Cashier unavailable"}</Text>
          {detail.lines.map(line=><View key={line.id} style={styles.line}><View style={styles.flex}><Text style={styles.rowTitle}>{line.itemName}</Text><Text style={styles.muted}>{formatQuantity(line.quantity)} {line.saleUnitCode} @ {formatMoney(line.unitNetMinor,detail.currencyCode)}</Text>{line.quantityReturned>0?<Text style={styles.refund}>Returned: {formatQuantity(line.quantityReturned)}</Text>:null}</View><Text style={styles.amount}>{formatMoney(line.lineTotalMinor,detail.currencyCode)}</Text></View>)}
          {canReverseSale(role)?<SaleReversalPanel key={detail.id} sale={detail} api={api} onRecord={onReversal} onFeedback={onFeedback} onRefresh={()=>{void openSale(detail.id);void reload();}}/>:null}
          <Text style={styles.title}>Payments</Text>
          {detail.payments.map(payment=><View key={payment.id} style={styles.line}><View style={styles.flex}><Text style={styles.rowTitle}>{payment.method.replaceAll("_"," ")}</Text><Text style={styles.muted}>{payment.status}</Text>{payment.refundedMinor>0?<Text style={styles.refund}>Refunded {formatMoney(payment.refundedMinor,detail.currencyCode)}</Text>:null}</View><Text style={styles.amount}>{formatMoney(payment.amountMinor,detail.currencyCode)}</Text></View>)}
        </>:null}
      </View>:null}
      {rows?.map(row=><Pressable key={row.id} accessibilityRole="button" accessibilityLabel={"View sale "+row.id} onPress={()=>void openSale(row.id)} style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.rowTitle} numberOfLines={1}>{row.customer?.name??"Walk-in customer"}</Text>
          <Text style={styles.muted}>{displaySaleDate(row.completedAt??row.createdAt,timezone)}</Text>
          <Text style={styles.muted} numberOfLines={1}>{row.id.slice(0,8).toUpperCase()} · {row.payments.map(p=>p.method.replaceAll("_"," ")).join(", ")||"No payment recorded"}</Text>
        </View>
        <View style={styles.amountGroup}><Text style={styles.amount}>{formatMoney(row.totalMinor,row.currencyCode)}</Text><Text style={styles.status}>{row.status.replaceAll("_"," ")}</Text>{row.refundTotalMinor>0?<Text style={styles.refund}>Refund {formatMoney(row.refundTotalMinor,row.currencyCode)}</Text>:null}</View>
        <Icon name="arrowRight" size={16} color={colors.textMuted}/>
      </Pressable>)}
      {rows?.length===100?<Text style={styles.muted}>Showing the latest 100 matching sales. Search to find an older transaction.</Text>:null}
    </>}
  </Card>;
}
const styles=StyleSheet.create({
  card:{gap:spacing.s3},heading:{flexDirection:"row",gap:spacing.s3,alignItems:"center"},flex:{flex:1,minWidth:0},
  title:{fontSize:typography.body,fontWeight:typography.weightHeavy,color:colors.textStrong},
  muted:{fontSize:typography.meta,lineHeight:typography.metaLine,color:colors.textMuted},
  refresh:{padding:spacing.s3,borderRadius:radius.sm,backgroundColor:colors.surfaceSoft},
  row:{flexDirection:"row",alignItems:"center",gap:spacing.s2,paddingVertical:spacing.s3,borderBottomWidth:1,borderBottomColor:colors.border},
  rowTitle:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},
  amountGroup:{alignItems:"flex-end",maxWidth:"48%"},
  amount:{fontSize:typography.supporting,fontWeight:typography.weightHeavy,color:colors.textStrong},
  status:{fontSize:typography.meta,color:colors.info,fontWeight:typography.weightMedium},
  refund:{fontSize:typography.meta,color:colors.warning},
  detail:{padding:spacing.s3,backgroundColor:colors.surfaceSoft,borderRadius:radius.md,gap:spacing.s3},
  line:{flexDirection:"row",gap:spacing.s2,justifyContent:"space-between",paddingBottom:spacing.s2,borderBottomWidth:1,borderBottomColor:colors.border},
});
