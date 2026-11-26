import {useCallback,useEffect,useRef,useState} from "react";
import {ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,View} from "react-native";
import {MobileApiError,type MobileApiClient,type MobileCatalogItem,type MobileInventoryItem,type MobileInventoryDetail} from "../api-client";
import {canBrowseStock,canManageCatalog,simpleCatalogDraft,multiUnitDraft,type AdditionalSaleUnit,catalogContactPatch,reconcileCatalog,matchesCatalogQuery,matchesStockAvailability,type StockAvailabilityFilter} from "../catalog-workspace";
import {StockAdjustmentPanel} from "./StockAdjustmentPanel";
import type {StockAdjustment} from "../inventory-adjustment";
import type {ReceiptOutcome} from "../customer-payment";
import {Button} from "../components/Button";
import {Card} from "../components/Card";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {EmptyState} from "../components/EmptyState";
import {Icon} from "../components/icons";
import {formatMoney,formatQuantity} from "../lib/format";
import {colors,radius,spacing,touch,typography} from "../theme";
import type {MobileActionFeedback} from "../action-feedback";

type Props={api:Pick<MobileApiClient,"getCatalog"|"getInventory"|"getInventoryDetail"|"createCatalogItem"|"updateCatalogItem">;businessId:string;branchId:string;currencyCode:string;role:string;online:boolean;mode:"catalog"|"inventory";queueVersion:string;onBack:()=>void;onFeedback:(feedback:MobileActionFeedback)=>void;onCatalogChanged:()=>void;onAdjustment:(input:StockAdjustment)=>Promise<ReceiptOutcome>};
type Draft={name:string;sku:string;kind:"PRODUCT"|"SERVICE"|"PREPARED_PRODUCT";unitLabel:string;price:string;trackStock:boolean};
const fresh=():Draft=>({name:"",sku:"",kind:"PRODUCT",unitLabel:"Each",price:"",trackStock:true});
export function CatalogStockScreen({api,businessId,branchId,currencyCode,role,online,mode,queueVersion,onBack,onFeedback,onCatalogChanged,onAdjustment}:Props){
 const allowed=canBrowseStock(role),write=canManageCatalog(role)&&mode==="catalog";
 const [items,setItems]=useState<MobileCatalogItem[]>([]),[stock,setStock]=useState<MobileInventoryItem[]>([]);
 const [query,setQuery]=useState(""),[filter,setFilter]=useState<"all"|"active"|"inactive">("all");
 const [stockFilter,setStockFilter]=useState<StockAvailabilityFilter>("all");
 const scrollRef=useRef<ScrollView>(null);
 const revealDetail=()=>scrollRef.current?.scrollTo({y:0,animated:false});
 const [loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
 const [selected,setSelected]=useState<MobileCatalogItem|null>(null),[detail,setDetail]=useState<MobileInventoryDetail|null>(null),[detailBusy,setDetailBusy]=useState(false);
 const [draft,setDraft]=useState<Draft|null>(null),[edit,setEdit]=useState<{name:string;sku:string;prices:Record<string,string>}|null>(null);
 const [extraUnits,setExtraUnits]=useState<AdditionalSaleUnit[]>([]);
 const [saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false),[confirmStatus,setConfirmStatus]=useState(false);
 const seq=useRef(0),detailSeq=useRef(0),lock=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;++seq.current;++detailSeq.current;};},[]);
 const refresh=useCallback(async()=>{
   const version=++seq.current;
   if(!online||!allowed){setItems([]);setStock([]);setLoading(false);return;}
   setLoading(true);setError(null);
   try{
     if(mode==="catalog"){
       const result=await api.getCatalog(businessId);
       if(version===seq.current)setItems(result.items.filter(i=>i.businessId===businessId));
     }else{
       const result=await api.getInventory(businessId,branchId);
       if(version===seq.current)setStock(result.items);
     }
   }catch{if(version===seq.current){setItems([]);setStock([]);setError("Could not load verified business data.");}}
   finally{if(version===seq.current)setLoading(false);}
 },[api,businessId,branchId,online,allowed,mode]);
 useEffect(()=>{void refresh();return()=>{++seq.current;}},[refresh,queueVersion]);
 useEffect(()=>{if(!online){++detailSeq.current;setSelected(null);setDetail(null);setDraft(null);setEdit(null);setConfirmStatus(false);}},[online]);
 async function openStock(id:string){
   const version=++detailSeq.current;
   setDetail(null);setDetailBusy(true);setError(null);
   try{const result=await api.getInventoryDetail(businessId,branchId,id);if(version===detailSeq.current&&result.item.id===id)setDetail(result);}
   catch{if(version===detailSeq.current)setError("Stock history could not be verified.");}
   finally{if(version===detailSeq.current)setDetailBusy(false);}
 }
 async function save(action:"create"|"edit"|"status"){
   if(lock.current||!online||!write||uncertain)return;
   let createInput:ReturnType<typeof simpleCatalogDraft>|null=null;
   let editInput:ReturnType<typeof catalogContactPatch>|null=null;
   try{
     if(action==="create"&&draft)createInput=multiUnitDraft(draft,extraUnits);
     if(action==="edit"&&selected&&edit)editInput=catalogContactPatch(selected,edit.name,edit.sku,edit.prices);
   }catch(e){setError(e instanceof Error?e.message:"Check item details.");return;}
   lock.current=true;setSaving(true);setError(null);
   try{
     let result:{item:MobileCatalogItem};
     if(action==="create"&&createInput)result=await api.createCatalogItem(businessId,createInput);
     else if(selected&&action==="edit"&&editInput)result=await api.updateCatalogItem(businessId,selected.id,editInput);
     else if(selected&&action==="status"&&confirmStatus)result=await api.updateCatalogItem(businessId,selected.id,{expectedUpdatedAt:selected.updatedAt,active:!selected.active});
     else return;
     if(!live.current)return;
     if(result.item.businessId!==businessId||(action!=="create"&&selected?.id!==result.item.id))throw new Error("Unexpected response.");
     ++seq.current;setItems(old=>reconcileCatalog(old,result.item));setSelected(result.item);setDraft(null);setEdit(null);setConfirmStatus(false);setFilter("all");setQuery("");
     onFeedback({tone:"success",title:action==="create"?"Item created":"Catalog updated",message:"The server confirmed the change. POS data is refreshing."});
     onCatalogChanged();void refresh();
   }catch(e){
     if(!live.current)return;
     setError(e instanceof Error?e.message:"Catalog change not confirmed.");
     // No automatic replay of non-idempotent creation if response is lost.
     if(action==="create"&&!(e instanceof MobileApiError&&[400,403,409,422].includes(e.statusCode))){setUncertain(true);void refresh();}
   }finally{lock.current=false;if(live.current)setSaving(false);}
 }
 const visible=items.filter(x=>matchesCatalogQuery(x,query)&&(filter==="all"||(filter==="active")===x.active));
 const visibleStock=stock.filter(x=>matchesCatalogQuery(x,query)&&matchesStockAvailability(x,stockFilter));
 return <ScrollView ref={scrollRef} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
   <View style={styles.row}><View style={styles.flex}><Text accessibilityRole="header" style={styles.title}>{mode==="catalog"?"Products & services":"Stock overview"}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Back to more" accessibilityState={{disabled:saving}} disabled={saving} onPress={onBack} style={styles.iconButton}><Icon name="close" size={20}/></Pressable></View>
   {!allowed?<Banner tone="warning" message="Your role cannot open this workspace."/>:!online?<Banner tone="info" message="This management view requires a live connection. Offline POS remains available."/>:<>
   <View style={styles.row}><Text style={[styles.muted,styles.flex]}>{loading?"Refreshing…":error?"Data unavailable":mode==="catalog"?items.length+" items":stock.length+" stock items"}</Text><Pressable accessibilityRole="button" accessibilityLabel="Refresh records" accessibilityState={{disabled:loading||saving,busy:loading}} disabled={loading||saving} onPress={()=>void refresh()} style={styles.iconButton}>{loading?<ActivityIndicator color={colors.midnight}/>:<Icon name="refresh" size={20}/>}</Pressable>{write?<Button variant="gold" disabled={saving||!!draft||uncertain} accessibilityLabel="Add catalog item" onPress={()=>{setSelected(null);setEdit(null);setDraft(fresh());setExtraUnits([]);revealDetail();}}>Add item</Button>:null}</View>
   {error?<Banner tone="warning" message={error}/>:null}
   {draft?<Card style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>New item</Text>
      <Input label="Name" value={draft.name} editable={!saving&&!uncertain} onChangeText={name=>setDraft(old=>old?{...old,name}:old)}/>
      <Input label="SKU (optional)" value={draft.sku} editable={!saving&&!uncertain} onChangeText={sku=>setDraft(old=>old?{...old,sku}:old)}/>
      <View style={styles.wrap}>{(["PRODUCT","SERVICE","PREPARED_PRODUCT"] as const).map(kind=><Button key={kind} size="compact" variant={draft.kind===kind?"gold":"secondary"} disabled={saving||uncertain} accessibilityLabel={kind} onPress={()=>setDraft(old=>old?{...old,kind}:old)}>{kind==="PREPARED_PRODUCT"?"Prepared food":kind==="PRODUCT"?"Product":"Service"}</Button>)}</View>
      {draft.kind==="PRODUCT"?<Button variant="secondary" disabled={saving||uncertain} accessibilityLabel="Toggle stock tracking" onPress={()=>setDraft(old=>old?{...old,trackStock:!old.trackStock}:old)}>{draft.trackStock?"Stock tracking enabled":"Stock tracking disabled"}</Button>:null}
      <Input label="Sale unit" value={draft.unitLabel} editable={!saving&&!uncertain} onChangeText={unitLabel=>setDraft(old=>old?{...old,unitLabel}:old)}/>
      <Input label="Sale price" value={draft.price} editable={!saving&&!uncertain} keyboardType="decimal-pad" onChangeText={price=>setDraft(old=>old?{...old,price}:old)}/>
      <Text style={styles.heading}>Additional sale units or portions</Text>
      {draft.kind==="PRODUCT"&&draft.trackStock?<Text style={styles.muted}>Conversion example: a box of 12 pieces uses factor 12.</Text>:null}
      {extraUnits.map((unit,index)=><Card key={index} variant="flat" style={styles.card}>
        <Input label="Unit or portion name" value={unit.label} editable={!saving&&!uncertain} onChangeText={label=>setExtraUnits(old=>old.map((u,i)=>i===index?{...u,label}:u))}/>
        <Input label="Sale price" keyboardType="decimal-pad" value={unit.price} editable={!saving&&!uncertain} onChangeText={price=>setExtraUnits(old=>old.map((u,i)=>i===index?{...u,price}:u))}/>
        {draft.kind==="PRODUCT"&&draft.trackStock?<Input label="Base stock units per sale unit" keyboardType="decimal-pad" value={unit.factor} editable={!saving&&!uncertain} onChangeText={factor=>setExtraUnits(old=>old.map((u,i)=>i===index?{...u,factor}:u))}/>:null}
        <Button variant="secondary" disabled={saving||uncertain} accessibilityLabel="Remove extra unit" onPress={()=>setExtraUnits(old=>old.filter((_,i)=>i!==index))}>Remove unit</Button>
      </Card>)}
      <Button variant="secondary" disabled={saving||uncertain||extraUnits.length>=20} accessibilityLabel="Add sale unit" onPress={()=>setExtraUnits(old=>[...old,{label:"",price:"",factor:"1"}])}>+ Add sale unit</Button>
      {uncertain?<Banner tone="warning" message="Check the directory for a confirmed item before trying again."/>:<Button variant="primary" fullWidth loading={saving} accessibilityLabel="Create catalog item" onPress={()=>void save("create")}>Create item</Button>}
      <Button variant="secondary" fullWidth disabled={saving} accessibilityLabel="Close item form" onPress={()=>{setDraft(null);setUncertain(false);}}>Close and review</Button>
   </Card>:null}
   {selected?<Card style={styles.card}>
      <View style={styles.row}><Text style={[styles.heading,styles.flex]}>{selected.name}</Text><Button size="compact" variant="secondary" disabled={saving} accessibilityLabel="Close catalog detail" onPress={()=>{setSelected(null);setEdit(null);setConfirmStatus(false);}}>Close</Button></View>
      <Text style={styles.muted}>{selected.sku??"No SKU"} · {selected.kind} · {selected.active?"Active":"Archived"}</Text>
      {edit?<><Input label="Name" value={edit.name} editable={!saving} onChangeText={name=>setEdit(old=>old?{...old,name}:old)}/><Input label="SKU" value={edit.sku} editable={!saving} onChangeText={sku=>setEdit(old=>old?{...old,sku}:old)}/>
      {selected.units.filter(u=>u.canSell).map(u=><Input key={u.code} label={u.label+" price"} value={edit.prices[u.code]??""} editable={!saving} keyboardType="decimal-pad" onChangeText={price=>setEdit(old=>old?{...old,prices:{...old.prices,[u.code]:price}}:old)}/>)}
      <Button loading={saving} accessibilityLabel="Save catalog changes" onPress={()=>void save("edit")}>Save changes</Button><Button variant="secondary" disabled={saving} accessibilityLabel="Cancel editing" onPress={()=>setEdit(null)}>Cancel</Button></>:<>
      {selected.units.map(u=><View key={u.code} style={styles.line}><Text style={styles.flex}>{u.label} · {u.code}</Text><Text style={styles.heading}>{u.defaultSalePriceMinor===null?"—":formatMoney(u.defaultSalePriceMinor,currencyCode)}</Text></View>)}
      {selected.conversions.map(c=><Text key={c.fromUnitCode+":"+c.toUnitCode} style={styles.muted}>1 {c.fromUnitCode} = {c.factor} {c.toUnitCode}</Text>)}
      {write?<><Button variant="gold" disabled={saving} accessibilityLabel="Edit item name and prices" onPress={()=>{setConfirmStatus(false);setEdit({name:selected.name,sku:selected.sku??"",prices:Object.fromEntries(selected.units.map(u=>[u.code,u.defaultSalePriceMinor===null?"":(u.defaultSalePriceMinor/100).toFixed(2)]))});}}>Edit item &amp; prices</Button>
      {confirmStatus?<><Banner tone="warning" message={selected.active?"Archive this item? Its history will remain intact.":"Reactivate this item for use?"}/><Button variant="primary" loading={saving} accessibilityLabel="Confirm item status" onPress={()=>void save("status")}>Confirm {selected.active?"archive":"reactivate"}</Button><Button variant="secondary" disabled={saving} accessibilityLabel="Cancel status change" onPress={()=>setConfirmStatus(false)}>Cancel</Button></>:<Button variant="secondary" accessibilityLabel="Change item status" onPress={()=>setConfirmStatus(true)}>{selected.active?"Archive":"Reactivate"}</Button>}</>:null}
      </>}
   </Card>:null}
   {detailBusy?<ActivityIndicator color={colors.goldStrong}/>:null}
   {detail?<Card style={styles.card}><View style={styles.row}><Text style={[styles.heading,styles.flex]}>{detail.item.name}</Text><Button variant="secondary" size="compact" accessibilityLabel="Close stock detail" onPress={()=>{++detailSeq.current;setDetail(null);}}>Close</Button></View>
      <View style={styles.stockSummary}><Text style={styles.muted}>Available stock</Text><Text style={styles.title}>{formatQuantity(detail.item.available)} {detail.item.stockUnitCode}</Text><Text style={styles.heading}>Stock value · {formatMoney(detail.item.inventoryValueMinor,currencyCode)}</Text></View><View style={styles.wrap}>{([{label:"Quarantine",value:detail.item.quarantine},{label:"Damaged",value:detail.item.damaged},{label:"Waste",value:detail.item.waste}]).map(metric=><View key={metric.label} style={styles.metric}><Text style={styles.heading}>{formatQuantity(metric.value)}</Text><Text style={styles.muted}>{metric.label}</Text></View>)}</View>
      {canManageCatalog(role)&&detail.item.active?<StockAdjustmentPanel key={detail.item.id} itemId={detail.item.id} unit={detail.item.stockUnitCode} onRecord={onAdjustment} onFeedback={onFeedback} onRefresh={()=>{void openStock(detail.item.id);void refresh();onCatalogChanged();}}/>:null}
      <Text style={styles.heading}>Recent movements</Text>{detail.movements.map(m=><View style={styles.line} key={m.id}><View style={styles.flex}><Text style={styles.heading}>{m.reason.replaceAll("_"," ")}</Text><Text style={styles.muted}>{m.occurredAt.slice(0,10)} · {m.location}</Text></View><Text style={styles.heading}>{m.quantityDelta>0?"+":""}{m.quantityDelta} {m.stockUnitCode}</Text></View>)}
      {detail.movements.length===0?<Text style={styles.muted}>No recorded movements.</Text>:null}
   </Card>:null}
   <Card style={styles.card}>
     <Input label="Find an item" accessibilityLabel="Search items" value={query} onChangeText={setQuery} placeholder="Item name or SKU" autoCorrect={false} autoCapitalize="none" leftAdornment={<Icon name="search" size={18} color={colors.textMuted}/>} rightAdornment={query?<Pressable accessibilityRole="button" accessibilityLabel="Clear item search" onPress={()=>setQuery("")} style={styles.iconButton}><Icon name="close" size={18}/></Pressable>:undefined}/>
     <View style={styles.wrap}>{mode==="catalog"?(["all","active","inactive"] as const).map(f=><FilterChip key={f} selected={filter===f} label={f==="inactive"?"Archived":f==="all"?"All":"Active"} onPress={()=>setFilter(f)}/>):(["all","available","out"] as const).map(f=><FilterChip key={f} selected={stockFilter===f} label={f==="out"?"Out of stock":f==="available"?"Available":"All"} onPress={()=>setStockFilter(f)}/>)}</View>
     {loading?<ActivityIndicator color={colors.goldStrong}/>:null}
     {mode==="catalog"?visible.map(i=><Pressable disabled={saving||!!draft} key={i.id} accessibilityRole="button" accessibilityLabel={"View "+i.name} accessibilityState={{selected:selected?.id===i.id,disabled:saving||!!draft}} style={({pressed})=>[styles.line,(pressed||selected?.id===i.id)&&styles.selected]} onPress={()=>{setSelected(i);setEdit(null);setConfirmStatus(false);revealDetail();}}><Icon name="catalog" size={22} color={colors.goldStrong}/><View style={styles.flex}><Text style={styles.heading}>{i.name}</Text><Text style={styles.muted}>{i.sku??"No SKU"} · {i.units.filter(u=>u.canSell).length} sale units</Text></View><Text style={[styles.status,i.active?styles.positive:styles.archived]}>{i.active?"Active":"Archived"}</Text><Icon name="arrowRight" size={16}/></Pressable>):visibleStock.map(i=><Pressable key={i.id} accessibilityRole="button" accessibilityLabel={"View stock "+i.name} accessibilityState={{selected:detail?.item.id===i.id}} style={({pressed})=>[styles.line,(pressed||detail?.item.id===i.id)&&styles.selected]} onPress={()=>{revealDetail();void openStock(i.id);}}><Icon name="store" color={colors.goldStrong}/><View style={styles.flex}><Text style={styles.heading}>{i.name}</Text><Text style={styles.muted}>{i.sku??"No SKU"}</Text></View><View style={styles.stockAmount}><Text style={[styles.heading,styles.right,i.available<=0&&styles.warning]}>{formatQuantity(i.available)} {i.stockUnitCode}</Text><Text style={[styles.muted,styles.right]}>{formatMoney(i.inventoryValueMinor,currencyCode)}</Text>{i.available<=0?<Text style={[styles.muted,styles.warning,styles.right]}>Out of stock</Text>:null}</View><Icon name="arrowRight" size={16}/></Pressable>)}
     {!loading&&!error&&(mode==="catalog"?visible.length:visibleStock.length)===0?<EmptyState title="No matching items"/>:null}
   </Card></>}
 </ScrollView>;
}
function FilterChip({selected,label,onPress}:{selected:boolean;label:string;onPress:()=>void}){
 return <Pressable accessibilityRole="button" accessibilityState={{selected}} accessibilityLabel={label+" items"} onPress={onPress} style={[styles.filter,selected&&styles.filterActive]}><Text style={[styles.filterLabel,selected&&styles.filterLabelActive]}>{label}</Text></Pressable>;
}
const styles=StyleSheet.create({
 page:{flexGrow:1,backgroundColor:colors.canvas,padding:spacing.s3,paddingBottom:spacing.s6,gap:spacing.s3},
 row:{flexDirection:"row",alignItems:"center",flexWrap:"wrap",gap:spacing.s2},flex:{flex:1,minWidth:0},
 title:{fontSize:typography.section,fontWeight:typography.weightHeavy,color:colors.textStrong},
 heading:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong,flexShrink:1},
 muted:{fontSize:typography.meta,lineHeight:typography.metaLine,color:colors.textMuted},card:{gap:spacing.s3},
 wrap:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},
 line:{flexDirection:"row",alignItems:"center",gap:spacing.s2,minHeight:touch.minTarget,paddingVertical:spacing.s3,borderBottomWidth:1,borderBottomColor:colors.border},
 selected:{backgroundColor:colors.goldSoft},
 iconButton:{width:touch.iconTarget,minHeight:touch.iconTarget,alignItems:"center",justifyContent:"center",borderRadius:radius.sm,backgroundColor:colors.surfaceSoft},
 filter:{minHeight:touch.iconTarget,justifyContent:"center",paddingHorizontal:spacing.s3,paddingVertical:spacing.s2,borderRadius:radius.sm,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
 filterActive:{backgroundColor:colors.midnight,borderColor:colors.midnight},filterLabel:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},filterLabelActive:{color:colors.textInverse},
 stockSummary:{padding:spacing.s3,backgroundColor:colors.surfaceSoft,borderRadius:radius.sm,gap:spacing.s1},
 metric:{flexGrow:1,flexBasis:78,minWidth:78,padding:spacing.s2,borderRadius:radius.sm,backgroundColor:colors.surfaceSoft,gap:spacing.s1},
 stockAmount:{maxWidth:"44%",alignItems:"flex-end",minWidth:0,gap:spacing.s1},right:{textAlign:"right"},
 status:{fontSize:typography.meta,fontWeight:typography.weightBold,maxWidth:"34%",flexShrink:1},positive:{color:colors.positive},archived:{color:colors.textMuted},warning:{color:colors.warning},
});
