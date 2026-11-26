import {useCallback,useEffect,useRef,useState} from "react";
import {ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,View} from "react-native";
import * as Crypto from "expo-crypto";
import {MobileApiError,type MobileApiClient,type MobileDocument,type MobileDocumentSummary,type MobileCatalogItem} from "../api-client";
import {buildDocumentInput,canReadDocuments,canWriteDocuments,canCancelDocuments,documentMatchesScope,editDocumentDraft,reconcileDocuments,type DocumentDraft} from "../document-workspace";
import {PdfDeliveryPanel} from "./PdfDeliveryPanel";
import {Button} from "../components/Button";
import {Input} from "../components/Input";
import {Card} from "../components/Card";
import {Banner} from "../components/Banner";
import {formatMoney} from "../lib/format";
import type {MobileActionFeedback} from "../action-feedback";
import {Icon} from "../components/icons";
import {colors,radius,spacing,touch,typography} from "../theme";
type Props={api:Pick<MobileApiClient,"getDocuments"|"getDocument"|"getCatalog"|"saveDocument"|"changeDocumentStatus"|"downloadDocumentPdf">;businessId:string;branchId:string;role:string;online:boolean;currencyCode:string;onFeedback:(feedback:MobileActionFeedback)=>void;onBack:()=>void};
export function DocumentsScreen({api,businessId,branchId,role,online,currencyCode,onFeedback,onBack}:Props){
 const read=canReadDocuments(role),write=canWriteDocuments(role);
 const [rows,setRows]=useState<MobileDocumentSummary[]>([]),[catalog,setCatalog]=useState<MobileCatalogItem[]>([]);
 const [selected,setSelected]=useState<MobileDocument|null>(null),[draft,setDraft]=useState<DocumentDraft|null>(null);
 const [search,setSearch]=useState(""),[itemSearch,setItemSearch]=useState(""),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const [action,setAction]=useState<"issue"|"cancel"|null>(null),[uncertain,setUncertain]=useState(false);
 const sequence=useRef(0),detailSeq=useRef(0),lock=useRef(false),live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;++sequence.current;++detailSeq.current;}},[]);
 const refresh=useCallback(async()=>{
   const n=++sequence.current;
   if(!online||!read){setRows([]);setCatalog([]);return;}
   setLoading(true);
   try{const [list,items]=await Promise.all([api.getDocuments(businessId,branchId),api.getCatalog(businessId)]);
     if(n===sequence.current){setRows(list.documents.filter(d=>documentMatchesScope(d,businessId,branchId)));setCatalog(items.items.filter(i=>i.businessId===businessId));}
   }catch{if(n===sequence.current){setRows([]);setCatalog([]);setError("Could not load the document workspace.");}}
   finally{if(n===sequence.current)setLoading(false);}
 },[api,businessId,branchId,online,read]);
 useEffect(()=>{void refresh();return()=>{++sequence.current;}},[refresh]);
 useEffect(()=>{if(!online){++detailSeq.current;setSelected(null);setAction(null);}},[online]);
 const change=(patch:Partial<DocumentDraft>)=>setDraft(old=>old?{...old,...patch}:old);
 function start(){if(lock.current||draft)return;setError(null);setSelected(null);setDraft({requestId:Crypto.randomUUID(),kind:"QUOTATION",customerId:null,name:"",phone:"",email:"",notes:"",expiry:"",lines:[]});}
 async function open(id:string){
   if(lock.current||draft)return;
   const n=++detailSeq.current;setError(null);setSelected(null);setLoading(true);
   try{const data=await api.getDocument(businessId,id);if(n===detailSeq.current&&documentMatchesScope(data.document,businessId,branchId)&&data.document.id===id)setSelected(data.document);}
   catch{if(n===detailSeq.current)setError("Could not verify document details.");}
   finally{if(n===detailSeq.current)setLoading(false);}
 }
 function apply(d:MobileDocument){
   if(!documentMatchesScope(d,businessId,branchId))throw new Error("Document context mismatch.");
   ++sequence.current;setRows(old=>reconcileDocuments(old,d));setSelected(d);setDraft(null);setAction(null);setUncertain(false);setSearch("");
 }
 async function save(){
   if(!online||!write||!draft||lock.current)return;
   let input:ReturnType<typeof buildDocumentInput>;
   try{input=buildDocumentInput(draft,businessId,branchId,catalog);}catch(e){setError((e as Error).message);return;}
   lock.current=true;setBusy(true);setError(null);
   try{
     const response=await api.saveDocument(input,draft.revision);
     if(!live.current)return;
     if(draft.revision&&response.document.id!==draft.revision.id)throw new Error("Unexpected document.");
     apply(response.document);onFeedback({tone:"success",title:"Document saved",message:"The server confirmed the draft and calculated its total."});void refresh();
   }catch(e){if(live.current){
     setError(e instanceof MobileApiError&&e.statusCode===409?"Document changed or its request conflicts. Review the existing document before retrying.":e instanceof Error?e.message:"Could not confirm the document.");
     if(!(e instanceof MobileApiError&&[400,403,422].includes(e.statusCode)))setUncertain(true);
   }}finally{lock.current=false;if(live.current)setBusy(false);}
 }
 async function transition(){
   if(!online||!selected||!action||lock.current||(action==="issue"?!write||selected.status!=="DRAFT":!canCancelDocuments(role)||selected.status==="CANCELLED"))return;
   lock.current=true;setBusy(true);setError(null);
   try{const result=await api.changeDocumentStatus(businessId,selected.id,action);if(!live.current)return;if(result.document.id!==selected.id)throw new Error("Unexpected document.");apply(result.document);onFeedback({tone:"success",title:action==="issue"?"Document issued":"Document cancelled",message:"The server confirmed the document status."});void refresh();}
   catch(e){if(live.current)setError(e instanceof Error?e.message:"Status change not confirmed. Reload to verify.");}
   finally{lock.current=false;if(live.current)setBusy(false);}
 }
 const candidates=catalog.filter(i=>i.active&&i.units.some(u=>u.canSell&&u.defaultSalePriceMinor!==null)&&(!itemSearch.trim()||i.name.toLowerCase().includes(itemSearch.trim().toLowerCase())||(i.sku??"").toLowerCase().includes(itemSearch.trim().toLowerCase()))).slice(0,20);
 return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
  <View style={styles.row}><Text accessibilityRole="header" style={[styles.title,styles.flex]}>Quotes &amp; proformas</Text><Pressable accessibilityRole="button" accessibilityLabel="Back to more" accessibilityState={{disabled:busy}} disabled={busy} onPress={onBack} style={styles.iconButton}><Icon name="close" size={20}/></Pressable></View>
  {!read?<Banner tone="warning" message="Your role cannot access documents."/>:!online?<Banner tone="info" message="Documents require a live connection; drafts are not submitted offline."/>:<>
  <View style={styles.row}><Text style={[styles.muted,styles.flex]}>{loading?"Refreshing…":rows.length+" documents"}</Text><Pressable accessibilityRole="button" accessibilityLabel="Refresh documents" accessibilityState={{disabled:busy||loading,busy:loading}} disabled={busy||loading} onPress={()=>void refresh()} style={styles.iconButton}>{loading?<ActivityIndicator color={colors.midnight}/>:<Icon name="refresh" size={20}/>}</Pressable>{write?<Button variant="gold" disabled={busy||!!draft} accessibilityLabel="New document" onPress={start}>New document</Button>:null}</View>
  {error?<Banner tone="warning" message={error}/>:null}
  {draft?<Card style={styles.card}>
    <Text style={styles.heading}>{draft.revision?"Edit draft":"New draft"}</Text>
    <View style={styles.row}>{(["QUOTATION","PROFORMA"] as const).map(kind=><Button key={kind} size="compact" variant={draft.kind===kind?"gold":"secondary"} disabled={busy||uncertain||!!draft.revision} accessibilityLabel={kind} onPress={()=>change({kind})}>{kind==="PROFORMA"?"Proforma":"Quotation"}</Button>)}</View>
    <Input label="Customer name" value={draft.name} editable={!busy&&!uncertain&&!draft.customerId} onChangeText={name=>change({name})}/>
    {draft.customerId?<Text style={styles.muted}>Linked customer retained. Contact information uses the server customer record.</Text>:null}
    <Input label="Phone" value={draft.phone} editable={!busy&&!uncertain&&!draft.customerId} onChangeText={phone=>change({phone})}/>
    <Input label="Email" value={draft.email} editable={!busy&&!uncertain&&!draft.customerId} keyboardType="email-address" onChangeText={email=>change({email})}/>
    <Input label="Notes" value={draft.notes} editable={!busy&&!uncertain} multiline onChangeText={notes=>change({notes})}/>
    <Input label="Expiry date (optional, YYYY-MM-DD)" value={draft.expiry} editable={!busy&&!uncertain} onChangeText={expiry=>change({expiry})}/>
    <Text style={styles.heading}>Line items</Text>
    {draft.lines.map((l,index)=><Card variant="flat" key={index} style={styles.card}><Text style={styles.heading}>{catalog.find(i=>i.id===l.itemId)?.name??"Unavailable item"} · {l.saleUnitCode}</Text><Input label="Quantity" value={l.quantity} editable={!busy&&!uncertain} keyboardType="decimal-pad" onChangeText={quantity=>change({lines:draft.lines.map((row,i)=>i===index?{...row,quantity}:row)})}/><Button variant="secondary" disabled={busy||uncertain} accessibilityLabel="Remove line" onPress={()=>change({lines:draft.lines.filter((_,i)=>i!==index)})}>Remove line</Button></Card>)}
    {!uncertain?<><Input label="Find item" value={itemSearch} onChangeText={setItemSearch}/>{candidates.map(i=><View key={i.id} style={styles.card}><Text style={styles.heading}>{i.name}</Text><View style={styles.wrap}>{i.units.filter(u=>u.canSell&&u.defaultSalePriceMinor!==null).map(u=><Button key={u.code} size="compact" variant="secondary" disabled={busy||draft.lines.length>=50} accessibilityLabel={"Add "+i.name+" "+u.label} onPress={()=>change({lines:[...draft.lines,{itemId:i.id,saleUnitCode:u.code,quantity:"1"}]})}>{u.label} · {formatMoney(u.defaultSalePriceMinor!,currencyCode)}</Button>)}</View></View>)}</>:null}
    <Text style={styles.muted}>Prices and totals are calculated by the server when saved. Draft documents do not post sales or deduct stock.</Text>
    {uncertain?<Banner tone="warning" message="Submission not confirmed. Retry only the identical request, or close and check the directory before starting a different draft."/>:null}
    <Button loading={busy} disabled={uncertain&&!!draft.revision} accessibilityLabel="Save document draft" onPress={()=>void save()}>{uncertain?"Retry same draft":"Save draft"}</Button>
    <Button variant="secondary" disabled={busy} accessibilityLabel="Close draft" onPress={()=>{setDraft(null);setUncertain(false);void refresh();}}>Close draft</Button>
  </Card>:null}
  {selected&&!draft?<Card style={styles.card}>
    <View style={styles.row}><Text style={[styles.heading,styles.flex]}>{selected.documentNumber}</Text><Button variant="secondary" size="compact" disabled={busy} accessibilityLabel="Close document" onPress={()=>{setSelected(null);setAction(null);}}>Close</Button></View>
    <View style={styles.summary}><View style={styles.row}><Text style={[styles.heading,styles.flex]}>{selected.kind}</Text><Text style={styles.status}>{selected.status}</Text></View><Text style={styles.muted}>{selected.customerName}</Text><Text style={styles.muted}>Document total</Text><Text style={styles.money}>{formatMoney(selected.totalMinor,selected.currencyCode)}</Text></View>
    {selected.lines.map(l=><View key={l.id} style={styles.row}><View style={styles.flex}><Text style={styles.heading}>{l.itemName}</Text><Text style={styles.muted}>{l.quantity} {l.saleUnitCode} @ {formatMoney(l.unitNetMinor,selected.currencyCode)}</Text></View><Text style={[styles.heading,styles.amount]}>{formatMoney(l.lineTotalMinor,selected.currencyCode)}</Text></View>)}
    {selected.notes?<Text style={styles.muted}>{selected.notes}</Text>:null}
    {!action&&!draft?<PdfDeliveryPanel key={selected.id+":pdf"} api={api} kind="document" businessId={businessId} branchId={branchId} id={selected.id} online={online} disabled={busy}/>:null}
    {selected.status==="DRAFT"&&write&&!action?<><Button variant="gold" accessibilityLabel="Edit draft document" onPress={()=>setDraft(editDocumentDraft(selected,Crypto.randomUUID()))}>Edit draft</Button><Button accessibilityLabel="Issue document" onPress={()=>setAction("issue")}>Issue document</Button></>:null}
    {selected.status!=="CANCELLED"&&canCancelDocuments(role)&&!action?<Button variant="secondary" accessibilityLabel="Cancel document" onPress={()=>setAction("cancel")}>Cancel document</Button>:null}
    {action?<><Banner tone="warning" message={action==="issue"?"Issue this draft? Issued documents cannot be edited.":"Cancel this document? Its audit history remains."}/><Button loading={busy} variant={action==="cancel"?"danger":"primary"} accessibilityLabel={"Confirm "+action} onPress={()=>void transition()}>Confirm {action}</Button><Button variant="secondary" disabled={busy} accessibilityLabel="Keep document unchanged" onPress={()=>setAction(null)}>Keep unchanged</Button></>:null}
  </Card>:null}
  <Card style={styles.card}><Input label="Search documents" accessibilityLabel="Search documents" value={search} onChangeText={setSearch} placeholder="Number or customer" leftAdornment={<Icon name="search" size={18} color={colors.textMuted}/>} rightAdornment={search?<Pressable accessibilityRole="button" accessibilityLabel="Clear document search" onPress={()=>setSearch("")} style={styles.iconButton}><Icon name="close" size={18}/></Pressable>:undefined}/>{loading?<ActivityIndicator color={colors.goldStrong}/>:null}
    {rows.filter(d=>(d.documentNumber+" "+d.customerName+" "+d.kind).toLowerCase().includes(search.trim().toLowerCase())).map(d=><Pressable key={d.id} disabled={busy||!!draft} accessibilityRole="button" accessibilityLabel={"View "+d.documentNumber} onPress={()=>void open(d.id)} accessibilityState={{selected:selected?.id===d.id,disabled:busy||!!draft}} style={({pressed})=>[styles.list,(pressed||selected?.id===d.id)&&styles.selected]}><View style={styles.flex}><Text style={styles.heading}>{d.documentNumber}</Text><Text style={styles.muted}>{d.customerName} · {d.kind}</Text><Text style={styles.status}>{d.status}</Text></View><Text style={[styles.heading,styles.amount]}>{formatMoney(d.totalMinor,d.currencyCode)}</Text><Icon name="arrowRight" size={16} color={colors.textMuted}/></Pressable>)}
    {!loading&&rows.length===0?<Text style={styles.muted}>No documents yet.</Text>:null}
  </Card></>}
 </ScrollView>;
}
const styles=StyleSheet.create({page:{flexGrow:1,backgroundColor:colors.canvas,padding:spacing.s3,gap:spacing.s3,paddingBottom:spacing.s6},row:{flexDirection:"row",alignItems:"center",flexWrap:"wrap",gap:spacing.s2},flex:{flex:1,minWidth:0},title:{fontSize:typography.section,fontWeight:typography.weightHeavy,color:colors.textStrong},heading:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,lineHeight:typography.metaLine,color:colors.textMuted},card:{gap:spacing.s3},wrap:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},list:{flexDirection:"row",alignItems:"center",minHeight:touch.minTarget,gap:spacing.s2,paddingVertical:spacing.s3,borderBottomWidth:1,borderBottomColor:colors.border},selected:{backgroundColor:colors.goldSoft},iconButton:{width:touch.iconTarget,minHeight:touch.iconTarget,alignItems:"center",justifyContent:"center",borderRadius:radius.sm,backgroundColor:colors.surfaceSoft},summary:{backgroundColor:colors.goldSoft,borderRadius:radius.sm,padding:spacing.s3,gap:spacing.s1},money:{fontSize:typography.kpi,fontWeight:typography.weightHeavy,color:colors.midnight},amount:{maxWidth:"44%",flexShrink:1,textAlign:"right"},status:{fontSize:typography.meta,fontWeight:typography.weightBold,color:colors.info}});
